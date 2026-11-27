"""Collect upcoming ICTP-SAIFR activities from its public annual calendars."""
import hashlib
import json
import re
import unicodedata
import time
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

import truststore

truststore.inject_into_ssl()

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'event-sources.json'
OUTPUT = ROOT / 'events-feed.json'

MONTHS = {name.lower(): i for i, name in enumerate(
    'January February March April May June July August September October November December'.split(), 1)}
MONTH = '|'.join(MONTHS)
DATE_RE = re.compile(
    rf'\b(?P<m1>{MONTH})\s+(?P<d1>\d{{1,2}})'
    rf'(?:\s*[-–—]\s*(?:(?P<m2>{MONTH})\s+)?(?P<d2>\d{{1,2}}))?'
    r'(?:\s*,?\s*(?P<year>20\d{2}))?(?!\d)', re.I)


def clean(value):
    return ' '.join(''.join(c for c in value if unicodedata.category(c) != 'Cf').split())


class CalendarParser(HTMLParser):
    blocks = {'p', 'div', 'section', 'article', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'tr', 'br', 'hr'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lines = []
        self.parts = []
        self.links = []
        self.anchor = None
        self.skip = 0

    def flush(self):
        value = clean(''.join(self.parts))
        if value:
            self.lines.append((value, self.links[:]))
        self.parts.clear()
        self.links.clear()

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style'}:
            self.skip += 1
        if self.skip:
            return
        if tag in self.blocks:
            self.flush()
        if tag == 'a':
            self.anchor = dict(attrs).get('href')

    def handle_endtag(self, tag):
        if tag in {'script', 'style'}:
            self.skip = max(0, self.skip - 1)
        if self.skip:
            return
        if tag == 'a':
            self.anchor = None
        if tag in self.blocks:
            self.flush()

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)
            if self.anchor and data.strip() and self.anchor not in self.links:
                self.links.append(self.anchor)


def safe_link(links, calendar_url):
    for href in links:
        if not href or href.startswith('#'):
            continue
        url = urljoin(calendar_url, href)
        parts = urlsplit(url)
        if parts.scheme == 'https' and parts.hostname in {'www.ictp-saifr.org', 'ictp-saifr.org'} and url != calendar_url:
            return url
    return calendar_url


def parse_calendar(html, year, source, keywords, today):
    parser = CalendarParser()
    parser.feed(html)
    parser.close()
    parser.flush()
    section = None
    pending = None
    parsed = 0
    posts = []
    calendar_url = source['calendarUrl'].format(year=year)
    for line, links in parser.lines:
        lower = line.casefold()
        if 'international schools on theoretical physics' in lower:
            section, pending = 'School', None
            continue
        if lower == 'minicourses and meetings':
            section, pending = None, None
            continue
        if lower == 'programs and workshops':
            section, pending = 'Workshop', None
            continue
        if lower == 'outreach':
            if parsed:
                break
            section, pending = None, None
            continue
        if not section:
            continue
        match = DATE_RE.search(line)
        if not match:
            pending = (line, links)
            continue
        prefix = line[:match.start()].strip(' :–—-')
        title, title_links = (prefix, links) if prefix else (pending or ('', []))
        pending = None
        if not title:
            continue
        try:
            y = int(match['year'] or year)
            if y != year:
                continue
            m1 = MONTHS[match['m1'].lower()]
            m2 = MONTHS[(match['m2'] or match['m1']).lower()]
            start = date(y, m1, int(match['d1']))
            end = date(y + (m2 < m1), m2, int(match['d2'] or match['d1']))
            if end < start:
                continue
        except (ValueError, KeyError):
            continue
        parsed += 1
        if start < today or not any(k.casefold() in title.casefold() for k in keywords):
            continue
        event_type = 'Focus Program' if 'focus program' in title.casefold() else section
        venue = 'Instituto Principia, São Paulo, Brazil' if 'instituto principia' in lower else 'São Paulo, Brazil'
        link = safe_link(title_links, calendar_url)
        key = hashlib.sha256(f"{source['id']}|{title.casefold()}|{start}".encode()).hexdigest()[:16]
        posts.append({
            'id': f"{source['id']}:{key}", 'category': 'group-news',
            'title': title, 'author': source['name'], 'source': source['name'],
            'eventType': event_type, 'date': start.isoformat(),
            'startDate': start.isoformat(), 'endDate': end.isoformat(),
            'location': venue, 'subject': venue,
            'reference': source['name'], 'applicationDeadline': None,
            'link': link, 'linkText': 'Event website' if link != calendar_url else 'Official calendar'
        })
    if parsed == 0:
        raise ValueError(f'No dated activities recognized for {year}; calendar structure may have changed.')
    return parsed, posts



# SBF announcement discovery and reviewed events v1
def sbf_reviewed_posts(source, today):
    posts = []
    for event in source.get('reviewedEvents', []):
        start = date.fromisoformat(event['startDate'])
        end = date.fromisoformat(event['endDate'])
        if end < start:
            raise ValueError('Invalid SBF event date range')
        deadline = event.get('applicationDeadline')
        if deadline and date.fromisoformat(deadline) > start:
            raise ValueError('Invalid SBF application deadline')
        if start < today:
            continue
        url = event['link']
        if urlsplit(url).scheme != 'https' or not urlsplit(url).hostname:
            raise ValueError('Invalid SBF event URL')
        key = hashlib.sha256(event['announcement'].encode()).hexdigest()[:16]
        posts.append({**event, 'id': 'sbf:' + key, 'category': 'group-news',
                      'source': source['name'], 'reference': 'SBF',
                      'date': start.isoformat(), 'subject': event['location'],
                      'linkText': 'Event website'})
    return posts


# Collect explicit deadlines only from the linked official event page.
DEADLINE_LABEL = re.compile(
    r'^(?:(?:online\s+)?(?:application|registration)\s+deadline|'
    r'deadline(?:\s+for\s+(?:online\s+)?(?:applications?|registration))?)\s*:?\s*',
    re.I)
FULL_DATE = re.compile(
    rf'\b(?:(?P<month1>{MONTH})\s+(?P<day1>\d{{1,2}})(?:st|nd|rd|th)?\s*,?\s*'
    rf'|(?P<day2>\d{{1,2}})(?:st|nd|rd|th)?\s+(?P<month2>{MONTH})\s*,?\s*)'
    r'(?P<year>20\d{2})\b', re.I)


def extract_deadline(html, start_date):
    parser = CalendarParser()
    parser.feed(html)
    parser.close()
    parser.flush()
    candidates = set()
    for i, (line, _) in enumerate(parser.lines):
        label = DEADLINE_LABEL.match(line)
        if not label:
            continue
        remainder = line[label.end():].strip()
        if not remainder and i + 1 < len(parser.lines):
            remainder = parser.lines[i + 1][0]
        # Do not guess when a heading has no actual date, or lists multiple dates.
        matches = list(FULL_DATE.finditer(remainder))
        if len(matches) != 1 or matches[0].start() != 0:
            continue
        match = matches[0]
        try:
            value = date(int(match['year']),
                         MONTHS[(match['month1'] or match['month2']).lower()],
                         int(match['day1'] or match['day2']))
        except (KeyError, ValueError):
            continue
        candidates.add(value)
    # A page may announce different deadlines for a school and a workshop.
    # In that case no single date is safe to display.
    if len(candidates) != 1:
        return None
    value = next(iter(candidates))
    return value.isoformat() if value <= date.fromisoformat(start_date) else None


def enrich_deadlines(posts):
    checked = {}
    for post in posts:
        if post.get('linkText') != 'Event website':
            continue
        url = post.get('link', '')
        parts = urlsplit(url)
        if parts.scheme != 'https' or parts.hostname not in {'www.ictp-saifr.org', 'ictp-saifr.org'}:
            continue
        if url not in checked:
            try:
                req = Request(url, headers={'User-Agent': 'UEL-QMQFT-ResearchGroup/1.0', 'Accept': 'text/html'})
                with urlopen(req, timeout=20) as response:
                    final = urlsplit(response.geturl())
                    if final.scheme != 'https' or final.hostname not in {'www.ictp-saifr.org', 'ictp-saifr.org'}:
                        raise ValueError('Unexpected redirect')
                    checked[url] = response.read().decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
            except Exception as exc:
                print(f'  Deadline not checked: {url}: {exc}')
                checked[url] = None
            finally:
                time.sleep(0.5)
        html = checked[url]
        if html:
            post['applicationDeadline'] = extract_deadline(html, post['startDate'])
    print(f"Application deadlines found: {sum(bool(p.get('applicationDeadline')) for p in posts)} of {len(posts)}")



# Automatic SBF announcements v2
SBF_HOSTS = {'www.sbfisica.org.br', 'sbfisica.org.br'}
SBF_AGE_DAYS = 45


def sbf_normalize(text):
    return ''.join(c for c in unicodedata.normalize('NFKD', text.casefold())
                   if not unicodedata.combining(c))


def sbf_key(url):
    parts = urlsplit(url)
    return parts.path.rstrip('/') if parts.hostname in SBF_HOSTS else ''


class SbfPublishedParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.values = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta' and (a.get('property') == 'article:published_time' or
                              a.get('itemprop') == 'datePublished' or
                              a.get('name') in {'article:published_time', 'datePublished'}):
            self.values.append(a.get('content', ''))
        elif tag == 'time' and (a.get('itemprop') == 'datePublished' or
                               'published' in a.get('class', '').split()):
            self.values.append(a.get('datetime', ''))


def sbf_publication_date(html):
    parser = SbfPublishedParser()
    parser.feed(html)
    dates = set()
    for value in parser.values:
        try:
            dates.add(date.fromisoformat(value[:10]))
        except (ValueError, TypeError):
            pass
    return next(iter(dates)) if len(dates) == 1 else None


def sbf_fetch(url):
    request = Request(url, headers={'User-Agent': 'UEL-QMQFT-ResearchGroup/1.0', 'Accept': 'text/html'})
    with urlopen(request, timeout=15) as response:
        final = urlsplit(response.geturl())
        if final.scheme != 'https' or final.hostname not in SBF_HOSTS:
            raise ValueError('Unexpected SBF redirect')
        return response.read(3_000_000).decode(response.headers.get_content_charset() or 'utf-8', errors='replace')


def sbf_candidates(html, source):
    parser = CalendarParser()
    parser.feed(html)
    parser.close()
    parser.flush()
    reviewed = {sbf_key(e['announcement']) for e in source.get('reviewedEvents', [])}
    terms = ('escola', 'school', 'workshop', 'curso de verao', 'curso de inverno',
             'conference', 'conferencia', 'congresso', 'encontro', 'simposio', 'meeting', 'jornada')
    topics = ('fisic', 'physic', 'quantum', 'quantic', 'condensed matter', 'materia condensada',
              'topolog', 'simetr', 'symmetr', 'gravita', 'cosmolog', 'particul', 'particle',
              'mathematical', 'matematica', 'astronom', 'astrofis', 'astrophys', 'many-body',
              'materiais', 'materials', 'field theory', 'teoria de campos', 'verao', 'inverno',
              'summer school', 'winter school')
    candidates = {}
    for title, links in parser.lines:
        norm = sbf_normalize(title)
        if not 15 <= len(title) <= 400 or not any(t in norm for t in terms):
            continue
        if any(t in norm for t in ('ensino medio', 'vestibular', 'ictp-saifr', 'educacao basica')):
            continue
        for href in links:
            target = urljoin(source['url'], href)
            parts = urlsplit(target)
            key = sbf_key(target)
            slug = key.removeprefix('/v1/sbf/')
            if (parts.scheme != 'https' or not key.startswith('/v1/sbf/') or
                not slug or '/' in slug or key in reviewed or slug in {'eventos', 'anuncios-da-sbf'}):
                continue
            if not any(t in norm + ' ' + sbf_normalize(slug.replace('-', ' ')) for t in topics):
                continue
            candidates.setdefault(key, (title, 'https://www.sbfisica.org.br' + key + '/'))
    return candidates


def discover_sbf(source, today):
    # Keep recent previous announcements as a fallback, not as dated future events.
    reviewed = {sbf_key(e['announcement']) for e in source.get('reviewedEvents', [])}
    previous = {}
    if OUTPUT.exists():
        try:
            for post in json.loads(OUTPUT.read_text(encoding='utf-8')).get('posts', []):
                if post.get('id', '').startswith('sbf-announcement:'):
                    age = (today - date.fromisoformat(post['date'])).days
                    key = sbf_key(post.get('link', ''))
                    if 0 <= age <= SBF_AGE_DAYS and key and key not in reviewed:
                        previous[key] = post
        except (OSError, ValueError, TypeError, KeyError):
            pass
    try:
        candidates = sbf_candidates(sbf_fetch(source['url']), source)
    except Exception as exc:
        print(f'SBF listing unavailable: {exc}. Keeping recent saved announcements.')
        return list(previous.values())
    print(f'SBF announcement candidates: {len(candidates)}')
    for key, (title, url) in list(candidates.items())[:20]:
        try:
            published = sbf_publication_date(sbf_fetch(url))
            if published is None:
                print(f'  Skipped (publication date not confirmed): {title}')
                continue
            if not 0 <= (today - published).days <= SBF_AGE_DAYS:
                previous.pop(key, None)
                continue
            digest = hashlib.sha256(key.encode()).hexdigest()[:16]
            previous[key] = {
                'id': 'sbf-announcement:' + digest, 'category': 'group-news',
                'title': title, 'author': source['name'], 'source': source['name'],
                'reference': 'SBF', 'eventType': 'Event Announcement',
                'date': published.isoformat(), 'announcementOnly': True,
                'description': 'See the official announcement for event dates, registration and venue.',
                'link': url, 'linkText': 'Official announcement'
            }
        except Exception as exc:
            print(f'  Could not verify announcement: {url}: {exc}')
        finally:
            time.sleep(0.3)
    result = sorted(previous.values(), key=lambda p: p['date'], reverse=True)[:15]
    print(f'SBF automatic recent announcements: {len(result)}')
    return result



# Institutional announcement collector v1
class InstitutionParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.href = None
        self.anchor_text = []
        self.heading = []
        self.in_h1 = False
        self.text = []
        self.skip = 0
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('script', 'style'):
            self.skip += 1
        if self.skip:
            return
        if tag == 'a':
            self.href = a.get('href')
            self.anchor_text = []
        if tag == 'h1':
            self.in_h1 = True
    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.skip:
            self.skip -= 1
            return
        if self.skip:
            return
        if tag == 'a' and self.href:
            self.links.append((self.href, ' '.join(' '.join(self.anchor_text).split())))
            self.href = None
        if tag == 'h1':
            self.in_h1 = False
    def handle_data(self, text):
        if self.skip:
            return
        self.text.append(text)
        if self.href:
            self.anchor_text.append(text)
        if self.in_h1:
            self.heading.append(text)


def institution_url(url, source):
    p = urlsplit(url)
    prefix = source['articlePrefix']
    path = p.path.rstrip('/')
    if (p.scheme != 'https' or p.hostname not in source['allowedHosts'] or
            not path.startswith(prefix) or '/' in path[len(prefix):] or not path[len(prefix):]):
        return None
    return 'https://' + source['allowedHosts'][0] + path


def institution_fetch(url, source):
    req = Request(url, headers={'User-Agent': 'UEL-QMQFT-ResearchGroup/1.0', 'Accept': 'text/html'})
    with urlopen(req, timeout=15) as response:
        final = urlsplit(response.geturl())
        if final.scheme != 'https' or final.hostname not in source['allowedHosts']:
            raise ValueError('Unexpected institutional redirect')
        return response.read(3_000_000).decode(response.headers.get_content_charset() or 'utf-8', errors='replace')


def institution_relevant(title):
    n = sbf_normalize(title)
    types = ('escola', 'school', 'workshop', 'congresso', 'conference', 'conferencia',
             'simposio', 'encontro', 'curso de verao', 'curso de inverno', 'bolsa', 'fellowship',
             'pos-doutor', 'pos doutor', 'postdoc', 'postdoctoral', 'hackathon')
    topics = ('fisic', 'physic', 'quantum', 'quantic', 'topolog', 'simetr', 'symmetr',
              'materia condensada', 'condensed matter', 'teoria de campos', 'field theory',
              'particula', 'particle', 'gravita', 'cosmolog', 'matematica', 'mathematical',
              'supercondut', 'superconduct', 'many-body', 'materiais quanticos', 'quantum materials')
    excluded = ('ensino medio', 'educacao basica', 'vestibular', 'reune pesquisadores',
                'reune estudantes', 'reuniu', 'revisita', 'realizou', 'foi realizado', 'encerrad')
    return (15 <= len(title) <= 400 and any(t in n for t in types) and
            any(t in n for t in topics) and not any(t in n for t in excluded))


def institution_article(html):
    parser = InstitutionParser()
    parser.feed(html)
    title = ' '.join(' '.join(parser.heading).split())
    text = ' '.join(' '.join(parser.text).split())
    # Prefer an explicit publication date, not modification dates.
    values = set()
    meta = sbf_publication_date(html)
    if meta:
        values.add(meta)
    for m in re.finditer(r'\bPublicado\s+em\s+(\d{1,2})/(\d{1,2})/(20\d{2})\b', text, re.I):
        try:
            values.add(date(int(m[3]), int(m[2]), int(m[1])))
        except ValueError:
            pass
    return title, next(iter(values)) if len(values) == 1 else None


def discover_institution(source, today):
    prefix = source['id'] + '-announcement:'
    previous = {}
    if OUTPUT.exists():
        try:
            for p in json.loads(OUTPUT.read_text(encoding='utf-8')).get('posts', []):
                if p.get('id', '').startswith(prefix) and 0 <= (today - date.fromisoformat(p['date'])).days <= 45:
                    key = institution_url(p.get('link', ''), source)
                    if key:
                        previous[key] = p
        except (OSError, ValueError, TypeError, KeyError):
            pass
    try:
        parser = InstitutionParser()
        parser.feed(institution_fetch(source['url'], source))
        links = {}
        for href, title in parser.links:
            url = institution_url(urljoin(source['url'], href), source)
            if url and institution_relevant(title):
                links.setdefault(url, title)
        print(f"{source['reference']} candidates: {len(links)}")
        for url in list(links)[:25]:
            try:
                title, published = institution_article(institution_fetch(url, source))
                if not published or not 0 <= (today - published).days <= 45 or not institution_relevant(title):
                    continue
                key = hashlib.sha256(url.encode()).hexdigest()[:16]
                n = sbf_normalize(title)
                opportunity = any(x in n for x in ('bolsa', 'fellowship', 'pos-doutor', 'pos doutor', 'postdoc'))
                previous[url] = {'id': prefix + key, 'category': 'group-news', 'title': title,
                    'author': source['name'], 'source': source['name'], 'reference': source['reference'],
                    'eventType': 'Research Opportunity' if opportunity else 'Event Announcement',
                    'date': published.isoformat(), 'announcementOnly': True,
                    'description': 'See the official announcement for eligibility, dates and application details.',
                    'link': url, 'linkText': 'Official announcement'}
            except Exception as exc:
                print(f'  Announcement unavailable: {url}: {exc}')
            finally:
                time.sleep(0.3)
    except Exception as exc:
        print(f"{source['reference']} unavailable: {exc}. Keeping recent saved announcements.")
    result = sorted(previous.values(), key=lambda p: p['date'], reverse=True)[:source.get('maxAnnouncements', 15)]
    print(f"{source['reference']} automatic recent announcements: {len(result)}")
    return result



# University announcements v1
from urllib.parse import unquote, parse_qs

PT_MONTHS = dict(zip('janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro'.split(), range(1, 13)))


def university_url(url, source):
    p = urlsplit(url)
    if p.scheme != 'https' or p.hostname not in source['allowedHosts'] or p.username or p.password:
        return None
    path = unquote(p.path).rstrip('/')
    if source['id'] == 'ifusp':
        q = parse_qs(p.query).get('q', [''])[0]
        if re.fullmatch(r'node/\d+', q) and path in ('/pesquisa', '/pesquisa/pt-br', '/ifusp', '/ifusp/pt-br'):
            path += '/' + q
    if not re.fullmatch(source['articlePattern'], path):
        return None
    from urllib.parse import quote
    return 'https://' + p.hostname + quote(path, safe='/-._~')


def university_relevant(title):
    n = sbf_normalize(title)
    if any(x in n for x in ('ensino medio', 'educacao basica', 'vestibular', 'fisica para curiosos', 'portas abertas', 'escola publica')):
        return False
    seasonal = any(x in n for x in ('escola de verao', 'escola de inverno', 'summer school', 'winter school', 'curso de verao', 'curso de inverno'))
    return 12 <= len(title) <= 400 and (seasonal or institution_relevant(title))


def university_dates(html):
    # Only explicit event-date labels or a textual date range attached to the event.
    parser = InstitutionParser()
    parser.feed(html)
    text = sbf_normalize(' '.join(' '.join(parser.text).split()))
    ranges = set()
    for m in re.finditer(r'(?:ocorrera|acontecera|sera realizado|sera realizada|realizacao do evento)\s*(?:nos dias|entre|:)?\s*(?:de\s+)?(\d{1,2})\s*(?:a|ate|e|[-–])\s*(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(20\d{2})', text):
        try:
            y, month = int(m[4]), PT_MONTHS[m[3]]
            ranges.add((date(y, month, int(m[1])), date(y, month, int(m[2]))))
        except (ValueError, KeyError):
            pass
    starts = set()
    ends = set()
    for label, target in [('inicio', starts), ('termino', ends), ('fim', ends)]:
        for m in re.finditer(r'data de '+label+r'\s*:\s*(\d{1,2})/(\d{1,2})/(20\d{2})', text):
            try:
                target.add(date(int(m[3]), int(m[2]), int(m[1])))
            except ValueError:
                pass
    if len(starts) == 1 and len(ends) == 1:
        ranges.add((next(iter(starts)), next(iter(ends))))
    deadline = set()
    for m in re.finditer(r'inscricoes\s+(?:abertas\s+)?ate\s+(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(20\d{2})', text):
        try:
            deadline.add(date(int(m[3]), PT_MONTHS[m[2]], int(m[1])))
        except (ValueError, KeyError):
            pass
    pair = next(iter(ranges)) if len(ranges) == 1 else None
    if pair and (pair[1] < pair[0] or (starts and starts != {pair[0]}) or (ends and ends != {pair[1]})):
        pair = None
    return pair, next(iter(deadline)) if len(deadline) == 1 else None


def discover_university(source, today):
    prefix = source['id'] + ': '
    key_prefix = source['id'] + '-university:'
    previous = {}
    try:
        for p in json.loads(OUTPUT.read_text(encoding='utf-8')).get('posts', []):
            if not p.get('id', '').startswith(key_prefix):
                continue
            if p.get('startDate'):
                keep = date.fromisoformat(p['startDate']) >= today
            else:
                keep = 0 <= (today - date.fromisoformat(p['date'])).days <= 45
            if keep and university_url(p.get('link', ''), source):
                previous[p['link']] = p
    except (OSError, ValueError, TypeError, KeyError):
        pass
    candidates = {}
    for listing in source['listings']:
        try:
            parser = InstitutionParser()
            parser.feed(institution_fetch(listing, source))
            for href, title in parser.links:
                url = university_url(urljoin(listing, href), source)
                if url and university_relevant(title):
                    candidates.setdefault(url, title)
        except Exception as exc:
            print(prefix + f'Listing unavailable: {listing}: {exc}')
    print(f"{source['reference']} candidates: {len(candidates)}")
    for url, title in list(candidates.items())[:30]:
        try:
            html = institution_fetch(url, source)
            pair, deadline = university_dates(html)
            _, published = institution_article(html)
            n = sbf_normalize(title)
            if any(w in n for w in ('cancelado', 'cancelada', 'cancelled', 'canceled')):
                previous.pop(url, None)
                continue
            post = {'id': key_prefix + hashlib.sha256(url.encode()).hexdigest()[:16], 'category': 'group-news',
                    'title': title, 'author': source['name'], 'source': source['name'], 'reference': source['reference'], 'link': url}
            if pair:
                start, end = pair
                if start < today:
                    previous.pop(url, None)
                    continue
                event_type = 'School' if any(w in n for w in ('escola', 'school', 'curso')) else 'Workshop' if 'workshop' in n else 'Conference' if any(w in n for w in ('congresso', 'conference', 'conferencia')) else 'Scientific Event'
                post.update(eventType=event_type, date=start.isoformat(), startDate=start.isoformat(), endDate=end.isoformat(),
                            applicationDeadline=deadline.isoformat() if deadline and deadline <= start else None, linkText='Event website')
            elif published and 0 <= (today - published).days <= 45:
                opportunity = any(w in n for w in ('bolsa', 'fellowship', 'pos-doutor', 'postdoc'))
                post.update(eventType='Research Opportunity' if opportunity else 'Event Announcement', date=published.isoformat(), announcementOnly=True,
                            description='See the official announcement for dates, eligibility and application details.', linkText='Official announcement')
            else:
                print(prefix + 'Skipped (no confirmed date): ' + title)
                continue
            previous[url] = post
        except Exception as exc:
            print(prefix + f'Article unavailable: {url}: {exc}')
        finally:
            time.sleep(0.3)
    dated = sorted((p for p in previous.values() if p.get('startDate')), key=lambda p: p['startDate'])
    notices = sorted((p for p in previous.values() if p.get('announcementOnly')), key=lambda p: p['date'], reverse=True)
    result = dated[:15] + notices[:source.get('maxAnnouncements', 15)]
    print(f"{source['reference']} automatic events/announcements: {len(result)}")
    return result



# Additional scientific calendars v1
class ScientificRows(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.row = None
        self.parser = None
    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
            self.parser = InstitutionParser()
        if self.parser is not None:
            self.parser.handle_starttag(tag, attrs)
    def handle_data(self, text):
        if self.parser is not None:
            self.parser.handle_data(text)
    def handle_endtag(self, tag):
        if self.parser is not None:
            self.parser.handle_endtag(tag)
        if tag == 'tr' and self.parser is not None:
            self.rows.append((' '.join(self.parser.text), self.parser.links))
            self.parser = None


def calendar_date(value):
    try:
        d, m, y = map(int, value.split('/'))
        return date(y,m,d)
    except (ValueError, TypeError):
        return None


def calendar_type(title):
    n = sbf_normalize(title)
    if any(x in n for x in ('escola', 'school', 'curso de verao', 'curso de inverno')):
        return 'School'
    if 'workshop' in n:
        return 'Workshop'
    if any(x in n for x in ('congresso','conference','conferencia','simposio','symposium')):
        return 'Conference'
    if any(x in n for x in ('coloquio','colloquium','seminar','seminario')):
        return 'Scientific Event'
    if any(x in n for x in ('program','programa')):
        return 'Focus Program'
    return 'Scientific Event'


def calendar_relevant(title):
    n = sbf_normalize(title)
    if any(x in n for x in ('ensino medio','educacao basica','vestibular','jovens fisicos','divulgacao cientifica','cancelado','cancelada','cancelled','canceled')):
        return False
    return university_relevant(title) or (
        any(x in n for x in ('program','coloquio','colloquium','seminar','seminario','symposium')) and
        any(x in n for x in ('quantum','quantic','topolog','simetr','symmetr','field theory','teoria de campos','condensed matter','materia condensada','gravita','many-body','string theory','supercondut','superconduct')))


def calendar_link(url, source):
    p = urlsplit(url)
    if p.scheme != 'https' or p.hostname not in source['allowedHosts'] or p.username or p.password:
        return None
    if source['id'] == 'fapesp' and not re.fullmatch(r'/(?:index\.php/)?[^/]+/\d+/?', p.path):
        return None
    if source['id'] == 'ufmg' and not re.fullmatch(r'/(?:eventos/|posgraduacao/)[^/]+/?', p.path):
        return None
    return 'https://' + p.hostname + p.path.rstrip('/')


def discover_additional_calendar(source, today):
    ref = source['reference']
    prefix = source['id'] + '-calendar:'
    previous = {}
    try:
        for p in json.loads(OUTPUT.read_text(encoding='utf-8')).get('posts', []):
            if p.get('id','').startswith(prefix) and date.fromisoformat(p['startDate']) >= today:
                previous[p['id']] = p
    except (OSError, ValueError, TypeError, KeyError):
        pass
    found = {}
    def add(title, start, end, url, deadline=None):
        if not start or start < today or (end and end < start) or not calendar_relevant(title):
            return
        if not scientific_event_relevant({'title': title, 'reference': ref, 'source': source['name'], 'link': url}):
            return
        if not url or urlsplit(url).scheme != 'https':
            return
        key = prefix + hashlib.sha256((sbf_normalize(title)+'|'+start.isoformat()).encode()).hexdigest()[:16]
        p = dict(id=key, category='group-news', title=title, author=source['name'],
                 source=source['name'], reference=ref, eventType=calendar_type(title),
                 date=start.isoformat(), startDate=start.isoformat(),
                 applicationDeadline=deadline.isoformat() if deadline and deadline <= start else None,
                 link=url, linkText='Event website' if source['id'] != 'principia' else 'Official calendar')
        if end:
            p['endDate'] = end.isoformat()
        found[key] = p
    successes = 0
    for listing in source['listings']:
        try:
            html = institution_fetch(listing, source)
            parser = InstitutionParser()
            parser.feed(html)
            parser.close()
            if source['id'] == 'fapesp':
                entries = {}
                for href, label in parser.links:
                    url = calendar_link(urljoin(listing,href),source)
                    if not url:
                        continue
                    # The agenda links the title, Início and Fim to the same article.
                    # Normalize index.php variants to join those fields.
                    key = url.replace('/index.php/','/')
                    row = entries.setdefault(key, {'titles':set(),'starts':set(),'ends':set()})
                    n = sbf_normalize(label)
                    m = re.fullmatch(r'(inicio|fim)\s*:?[ ]*(\d{1,2}/\d{1,2}/20\d{2})',n)
                    if m:
                        d = calendar_date(m[2])
                        if d:
                            row['starts' if m[1]=='inicio' else 'ends'].add(d)
                    elif calendar_relevant(label):
                        row['titles'].add(label)
                print(f'{ref} calendar candidates: {len(entries)}')
                for url,row in entries.items():
                    if len(row['titles'])!=1 or len(row['starts'])!=1 or len(row['ends'])!=1:
                        continue
                    title,start,end = next(iter(row['titles'])),next(iter(row['starts'])),next(iter(row['ends']))
                    if start < today or end < start:
                        continue
                    # Check the article for school-level outreach and an explicit deadline.
                    try:
                        article = institution_fetch(url,source)
                        detail = InstitutionParser(); detail.feed(article)
                        text = sbf_normalize(' '.join(detail.text))
                        if any(x in text for x in ('destinado a estudantes do ensino medio','voltado a estudantes do ensino medio','voltada a estudantes do ensino medio','professores da educacao basica','para estudantes do ensino medio')):
                            continue
                        _,deadline = university_dates(article)
                        add(title,start,end,url,deadline)
                    except Exception as exc:
                        print(f'{ref} article unavailable: {url}: {exc}')
                    finally:
                        time.sleep(0.3)
                if entries:
                    successes += 1
            elif source['id'] == 'principia':
                rows = ScientificRows(); rows.feed(html); rows.close()
                print(f'{ref} calendar rows: {len(rows.rows)}')
                for text,links in rows.rows:
                    dates = set(re.findall(r'\b\d{1,2}/\d{1,2}/20\d{2}\b',text))
                    titles = {label for _,label in links if calendar_relevant(label)}
                    if len(dates)==1 and len(titles)==1:
                        add(next(iter(titles)),calendar_date(next(iter(dates))),None,listing)
                if rows.rows:
                    successes += 1
            else:
                candidates = {}
                for href,title in parser.links:
                    url = calendar_link(urljoin(listing,href),source)
                    if url and calendar_relevant(title):
                        candidates.setdefault(url,title)
                print(f'{ref} calendar candidates: {len(candidates)}')
                for url,title in list(candidates.items())[:25]:
                    # Never treat WordPress migration/publication timestamps as event dates.
                    dates = set(re.findall(r'\b\d{1,2}/\d{1,2}/20\d{2}\b',title))
                    single = calendar_date(next(iter(dates))) if len(dates)==1 and '/eventos/' in url else None
                    if single and single < today:
                        continue
                    try:
                        article = institution_fetch(url,source)
                        pair,deadline = university_dates(article)
                        if pair:
                            add(title,pair[0],pair[1],url,deadline)
                        elif single:
                            add(title,single,single,url,deadline)
                    except Exception as exc:
                        print(f'{ref} article unavailable: {url}: {exc}')
                    finally:
                        time.sleep(0.3)
                if candidates:
                    successes += 1
        except Exception as exc:
            print(f'{ref} listing unavailable: {listing}: {exc}')
    if not successes:
        print(f'{ref}: no recognized calendar structure. Keeping saved upcoming events.')
    # Preserve known future activities even when they disappear from a short listing.
    previous.update(found)
    result = sorted(previous.values(),key=lambda p:(p['startDate'],p['title']))[:15]
    print(f'{ref} automatic upcoming events: {len(result)} ({len(found)} found in this run)')
    return result



# IIP and UEL sources v1
from urllib.parse import unquote


def final_source_url(url, source):
    p = urlsplit(url)
    if p.scheme != 'https' or p.hostname not in source['allowedHosts'] or p.username or p.password:
        return None
    path = unquote(p.path).rstrip('/')
    if source['id'] == 'iip':
        ok = re.fullmatch(r'/(?:en|pt)/(?:events|news)/[^/]+', path)
    else:
        ok = ((p.hostname == 'portal.uel.br' and re.fullmatch(r'/evento/[^/]+', path)) or
              (p.hostname == 'pos.uel.br' and re.fullmatch(r'/fisica/(?:[^/]+/)*[^/]+', path) and
               path not in ('/fisica/editais','/fisica/postagens','/fisica/teses-e-dissertacoes')))
    if not ok:
        return None
    from urllib.parse import quote
    host = 'www.iip.ufrn.br' if source['id'] == 'iip' else p.hostname
    return 'https://' + host + quote(path, safe='/-._~') + ('/' if source['id']=='uel' else '')


def final_source_relevant(title, source, url):
    n = sbf_normalize(title)
    if len(n) < 10 or len(n) > 450 or any(w in n for w in ('cancelado','cancelada','cancelled','canceled','ensino medio','educacao basica','vestibular','educacao fisica','resultado','classificacao','homologacao','convocacao para matricula')):
        return False
    if source['id'] == 'iip' and '/events/' in url:
        return any(w in n for w in ('physics','physic','quantum','topolog','symmetr','gravity','gravitation','holograph','field theory','many-body','condensed matter','mathematical','string theory','statistical','school','workshop','conference','fellowship','postdoc','physics','materia','quantic','fisic'))
    if source['id'] == 'uel' and urlsplit(url).hostname == 'pos.uel.br':
        return any(w in n for w in ('edital','bolsa','doutorado','mestrado','pdse','pos-doutor','escola','workshop','seminar','congresso'))
    return calendar_relevant(title) or university_relevant(title) or (
        any(w in n for w in ('seminar','seminario','semana','coloquio','colloquium','defesa','qualification','school')) and
        any(w in n for w in ('fisic','physic','quantum','quantic','topolog','simetr','symmetr','field theory')))


def final_source_dates(html, source):
    parser = InstitutionParser(); parser.feed(html)
    text = ' '.join(' '.join(parser.text).split())
    n = sbf_normalize(text)
    pair, deadline = university_dates(html)
    ranges = set([pair] if pair else [])
    deadlines = set([deadline] if deadline else [])
    # UEL's official event detail pages explicitly label these two date ranges.
    def numeric(value):
        return calendar_date(value)
    for label, target in ((r'periodo de realizacao', ranges), (r'periodo de inscricao', None)):
        for m in re.finditer(label+r'\s*:\s*(\d{1,2}/\d{1,2}/20\d{2})(?:\s+\d{1,2}:\d{2})?\s*(?:a|ate|[-–])\s*(\d{1,2}/\d{1,2}/20\d{2})', n):
            a,b = numeric(m[1]),numeric(m[2])
            if a and b and a<=b:
                if target is not None: target.add((a,b))
                else: deadlines.add(b)
    # Explicit labelled English ranges, including same-month and cross-month forms.
    if source['id']=='iip':
        months = '|'.join(MONTHS)
        sep = r'\s*(?:-|–|—|to|until)\s*'
        patterns = [
            (rf'({months})\s+(\d{{1,2}})(?:st|nd|rd|th)?'+sep+rf'(?:(?P<m2>{months})\s+)?(\d{{1,2}})(?:st|nd|rd|th)?\s*,?\s*(20\d{{2}})', 'month-first'),
            (rf'(\d{{1,2}})(?:st|nd|rd|th)?'+sep+rf'(\d{{1,2}})(?:st|nd|rd|th)?\s+({months})\s*,?\s*(20\d{{2}})', 'day-first')]
        # Read a range only if it is explicitly introduced as event dates/period.
        for match in re.finditer(r'\b(?:event dates?|date of event|dates?|period|event period|when)\s*:\s*([^\n]{1,100})', n):
            for pattern, form in patterns:
                m = re.match(pattern,match[1],re.I)
                if not m: continue
                try:
                    if form=='month-first':
                        a=date(int(m[5]),MONTHS[m[1].lower()],int(m[2])); b=date(int(m[5]),MONTHS[(m['m2'] or m[1]).lower()],int(m[4]))
                    else:
                        a=date(int(m[4]),MONTHS[m[3].lower()],int(m[1])); b=date(int(m[4]),MONTHS[m[3].lower()],int(m[2]))
                    if a<=b: ranges.add((a,b))
                except (KeyError,ValueError): pass
        # Event structured data, if present; not article publication dates.
        for m in re.finditer(r'<script\b[^>]*type=[\"\']application/ld\+json[\"\'][^>]*>(.*?)</script>',html,re.I|re.S):
            try: pending=[json.loads(m[1])]
            except ValueError: continue
            while pending:
                item=pending.pop()
                if isinstance(item,list): pending.extend(item); continue
                if not isinstance(item,dict): continue
                pending.extend(v for v in item.values() if isinstance(v,(dict,list)))
                types=item.get('@type',[]); types=[types] if isinstance(types,str) else types
                if not isinstance(types,list) or not any(isinstance(t,str) and t.split('/')[-1] in ('Event','EducationEvent','BusinessEvent','SocialEvent') for t in types): continue
                if 'EventCancelled' in str(item.get('eventStatus','')): continue
                try:
                    a=date.fromisoformat(item['startDate'][:10]); b=date.fromisoformat(item.get('endDate',item['startDate'])[:10]);
                    if a<=b: ranges.add((a,b))
                except (KeyError,ValueError,TypeError): pass
    return (next(iter(ranges)) if len(ranges)==1 else None, next(iter(deadlines)) if len(deadlines)==1 else None, bool(ranges))


def final_source_browser(url, source):
    # Optional renderer for public JavaScript-driven IIP pages only.
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        try:
            page=browser.new_page()
            page.goto(url,wait_until='domcontentloaded',timeout=30000)
            try:
                page.wait_for_selector('a[href*="/events/"], a[href*="/news/"]',timeout=12000)
            except Exception:
                pass
            if urlsplit(page.url).scheme!='https' or urlsplit(page.url).hostname not in source['allowedHosts']:
                raise ValueError('Unexpected browser redirect')
            return page.content()
        finally: browser.close()


def discover_iip_uel(source,today):
    ref=source['reference']; prefix=source['id']+'-local:'; previous={}
    try:
        for p in json.loads(OUTPUT.read_text(encoding='utf-8')).get('posts',[]):
            if not p.get('id','').startswith(prefix): continue
            keep=(date.fromisoformat(p['startDate'])>=today if p.get('startDate') else 0<=(today-date.fromisoformat(p['date'])).days<=45)
            if keep and final_source_url(p.get('link',''),source): previous[p['link']]=p
    except (OSError,ValueError,TypeError,KeyError): pass
    candidates={}
    def scan(html,listing):
        parser=InstitutionParser(); parser.feed(html)
        found={}
        for href,label in parser.links:
            url=final_source_url(urljoin(listing,href),source)
            if url and final_source_relevant(label,source,url): found.setdefault(url,label)
        return found
    for listing in source['listings']:
        print(f'{ref}: fetching {listing}',flush=True)
        try:
            found=scan(institution_fetch(listing,source),listing)
        except Exception as exc:
            print(f'{ref} listing unavailable: {exc}',flush=True); found={}
        if not found and source['id']=='iip':
            try: found=scan(final_source_browser(listing,source),listing)
            except Exception as exc: print(f'{ref} browser fallback unavailable: {exc}',flush=True)
        candidates.update(found)
    print(f'{ref} candidates: {len(candidates)}',flush=True)
    fresh=0
    for url,label in list(candidates.items())[:25]:
        try:
            try:
                html=institution_fetch(url,source)
            except Exception:
                if source['id']!='iip': raise
                html=final_source_browser(url,source)
            title,published=institution_article(html)
            if not title or not final_source_relevant(title,source,url): title=label
            pair,deadline,has_dates=final_source_dates(html,source)
            if source['id']=='iip' and '/events/' in url and not pair:
                try:
                    html=final_source_browser(url,source)
                    pair,deadline,has_dates=final_source_dates(html,source)
                    title2,published2=institution_article(html)
                    if title2 and final_source_relevant(title2,source,url): title=title2
                    published=published2 or published
                except Exception as exc: print(f'{ref} event rendering unavailable: {url}: {exc}',flush=True)
            if not final_source_relevant(title,source,url): continue
            post=dict(id=prefix+hashlib.sha256(url.encode()).hexdigest()[:16],category='group-news',title=title,author=source['name'],source=source['name'],reference=ref,link=url)
            if pair:
                a,b=pair
                if a<today: previous.pop(url,None); continue
                post.update(eventType=calendar_type(title),date=a.isoformat(),startDate=a.isoformat(),endDate=b.isoformat(),applicationDeadline=deadline.isoformat() if deadline and deadline<=a else None,linkText='Event website')
            elif not has_dates and published and 0<=(today-published).days<=45 and (source['id']!='iip' or '/news/' in url):
                if deadline and deadline<today: previous.pop(url,None); continue
                opportunity=any(w in sbf_normalize(title) for w in ('bolsa','edital','fellowship','postdoc','doutorado','mestrado'))
                post.update(eventType='Research Opportunity' if opportunity else 'Event Announcement',date=published.isoformat(),announcementOnly=True,description='See the official announcement for dates and application details.',linkText='Official announcement')
            else:
                print(f'{ref} skipped (no unambiguous event/publication date): {title}',flush=True); continue
            previous[url]=post; fresh+=1
        except Exception as exc: print(f'{ref} detail unavailable: {url}: {exc}',flush=True)
        finally: time.sleep(0.3)
    dated=sorted((p for p in previous.values() if p.get('startDate')),key=lambda p:p['startDate'])[:15]
    notices=sorted((p for p in previous.values() if p.get('announcementOnly')),key=lambda p:p['date'],reverse=True)[:15]
    result=dated+notices
    print(f'{ref} automatic events/announcements: {len(result)} ({fresh} found in this run)',flush=True)
    return result



# Scientific relevance gate v1
def scientific_event_relevant(post):
    def norm(value):
        value = unicodedata.normalize('NFKD', str(value or '')).casefold()
        value = ''.join(c for c in value if not unicodedata.combining(c))
        return ' '.join(re.findall(r'[^\W_]+', value, re.UNICODE))

    title = norm(post.get('title'))
    if not title:
        return False
    # Match disciplines in the title, not in menus, institution names or footers.
    strong = bool(re.search(
        r'\b(?:quantum|quantic\w*|quantiz\w*|qcd|qft|tqft|'
        r'condensed matter|materia condensada|many body|muitos corpos|'
        r'field theor\w*|teoria\w* de campos|'
        r'topological|topologic\w*|gauge theor\w*|teoria\w* de gauge|'
        r'string theor\w*|teoria\w* de cordas|holograph\w*|holograf\w*|'
        r'generalized symmetr\w*|simetrias generalizadas|'
        r'non invertible|nao invertive\w*|anyon\w*|anions? topologicos?|'
        r'gravitation\w*|gravity|gravitac\w*|cosmolog\w*|astrophysic\w*|astrofisic\w*|'
        r'particle physics|fisica de particulas|high energy physics|altas energias|'
        r'superconduct\w*|supercondut\w*|statistical physics|fisica estatistica|'
        r'mathematical physics|fisica matematica|theoretical physics|fisica teorica)\b', title))
    physics = strong or bool(re.search(
        r'\b(?:physics|fisica|fisicas|physicists|fisicos|'
        r'physics research|mechanics|mecanica|electromagnet\w*|eletromagnet\w*|'
        r'optics|optica|photonics|fotonica|spectroscop\w*|'
        r'condensed matter|statistical mechanics|mecanica estatistica|'
        r'fusion categor\w*|categorias de fusao|algebraic geometry|geometria algebrica|'
        r'mathematics|matematica|matematicas)\b', title))
    unrelated = bool(re.search(
        r'\b(?:genetic\w*|genomic\w*|genomica|dna|rna|'
        r'biologia|biology|biologic\w*|biological|biomedic\w*|'
        r'medicina|medicine|medical|odontolog\w*|dentistry|'
        r'farmacia|pharmacy|farmaceutic\w*|pharmaceutic\w*|'
        r'agronom\w*|veterinar\w*|agropecu\w*|'
        r'psicolog\w*|psycholog\w*|enfermagem|nursing|'
        r'direito|law school|ciencias humanas|humanities|'
        r'educacao fisica|physical education)\b', title))
    if unrelated and not strong:
        return False

    reference = norm(post.get('reference'))
    source = norm(post.get('source'))
    identifier = str(post.get('id') or '').casefold()
    broad = (identifier.startswith(('fapesp-', 'fapesp:', 'uel-', 'uel:', 'principia-', 'principia:')) or
             reference in {'fapesp', 'uel', 'instituto principia'} or
             source in {'agencia fapesp', 'state university of londrina uel', 'instituto principia'})
    if broad:
        # The dedicated UEL Physics department and graduate programme can also
        # publish generic fellowship/school titles, unlike the general UEL portal.
        url = urlsplit(str(post.get('link') or ''))
        physics_department = (url.scheme == 'https' and url.hostname in {'pos.uel.br', 'departamentos.uel.br'}
                              and (url.path == '/fisica' or url.path.startswith('/fisica/')))
        return physics or physics_department
    return True


def main():
    config = json.loads(CONFIG.read_text(encoding='utf-8'))
    today = datetime.now(timezone.utc).date()
    posts = {}
    success = 0
    for source in config['sources']:
        if not source.get('enabled', True):
            continue
        if source['id'] == 'sbf':
            found = sbf_reviewed_posts(source, today)
            for post in found:
                posts[post['id']] = post
            print(f'SBF reviewed upcoming events: {len(found)}')
            for post in discover_sbf(source, today):
                posts[post['id']] = post
            continue
        if source.get('kind') == 'iip-uel-events':
            for post in discover_iip_uel(source, today):
                posts[post['id']] = post
            continue
        if source.get('kind') == 'additional-calendar':
            for post in discover_additional_calendar(source, today):
                posts[post['id']] = post
            continue
        if source.get('kind') == 'university-announcements':
            for post in discover_university(source, today):
                posts[post['id']] = post
            continue
        if source.get('kind') == 'institutional-announcements':
            for post in discover_institution(source, today):
                posts[post['id']] = post
            continue
        if source['id'] != 'ictp-saifr':
            raise ValueError(f"Unsupported source: {source['id']}")
        for year in range(today.year, today.year + 2):
            url = source['url'].format(year=year)
            print(f'Fetching {source["name"]} ({year}): {url}')
            try:
                req = Request(url, headers={'User-Agent': 'UEL-QMQFT-ResearchGroup/1.0', 'Accept': 'text/html'})
                with urlopen(req, timeout=45) as response:
                    html = response.read().decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
                count, found = parse_calendar(html, year, source, config['keywords'], today)
                print(f'  Recognized {count} activities; selected {len(found)} upcoming events.')
                success += 1
                for post in found:
                    posts[post['id']] = post
            except Exception as exc:
                print(f'  Could not collect {year}: {exc}')
                # Never overwrite a valid feed with an incomplete collection.
                if year == today.year:
                    raise RuntimeError('Current calendar unavailable. Previous feed preserved.') from exc
                if OUTPUT.exists():
                    previous = json.loads(OUTPUT.read_text(encoding='utf-8'))
                    if any(p.get('id', '').startswith(source['id'] + ':') and p.get('startDate', '').startswith(str(year)) for p in previous.get('posts', [])):
                        raise RuntimeError('Previously available next-year calendar unavailable. Previous feed preserved.') from exc
    if not success:
        raise RuntimeError('No calendar was collected. Previous feed preserved.')
    before_relevance = len(posts)
    posts = {key: post for key, post in posts.items() if scientific_event_relevant(post)}
    print(f'Out-of-scope events removed: {before_relevance - len(posts)}', flush=True)
    dated = sorted((p for p in posts.values() if p.get('startDate')), key=lambda p: (p['startDate'], p['title']))[:config.get('maxEvents', 40)]
    notices = sorted((p for p in posts.values() if p.get('announcementOnly')), key=lambda p: p['date'], reverse=True)
    result = dated + notices
    enrich_deadlines(dated)
    data = {'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'posts': result}
    temporary = OUTPUT.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(OUTPUT)
    print(f'\nEvents feed successfully generated. Saved events: {len(result)}')
    for post in result:
        if post.get('announcementOnly'):
            print(f"  Published {post['date']} | {post['eventType']} | {post['title']}")
        else:
            print(f"  {post['startDate']} to {post['endDate']} | {post['eventType']} | {post['title']}")
    print(f'Output: {OUTPUT}')


if __name__ == '__main__':
    main()
