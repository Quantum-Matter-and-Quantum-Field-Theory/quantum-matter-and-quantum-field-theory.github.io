
/* ========================================
   NEWS POSTS
   Add new posts to this list.
   ======================================== */


const newsPosts = [
  {
    title: "ICTP Lectures on (Non-)Invertible Generalized Symmetries",
    category: "recommended-paper",
    date: "2026-11-26",
    author: "Sakura Schäfer-Nameki",
    reference: "arXiv:2305.18296",
    subject: "High Energy Physics – Theory",

    abstract: "",

    description: "These lecture notes introduce generalized symmetries in quantum field theory, with particular emphasis on non-invertible symmetries. They discuss topological symmetry defects, gauging, generalized charges, and the symmetry topological field theory framework.",

    image: "",
    link: "https://arxiv.org/abs/2305.18296",
    linkText: "arXiv",
    pdf: "https://arxiv.org/pdf/2305.18296"
  }
];



/* ========================================
   NEWS SYSTEM
   ======================================== */

const categories = {
  "group-news": "Group News",
  "recommended-paper": "Recommended Paper",
  "recent-preprint": "Recent Preprint",
  "event": "Seminars & Events",
  "publication": "Publication"
};

let arxivPosts = [];
let youtubePosts = [];
// Group News opportunities v1
let groupEvents = [];
let eventsStatus = { phase: "loading", updatedAt: null };
const PAGE_SIZE = 6;
// Contextual news filters v1
const state = { category: "all", search: "", author: "", channel: "", opportunity: "", institution: "", limit: PAGE_SIZE };
let followedNames = [];
let arxivStatus = { phase: "loading", updatedAt: null };
let youtubeStatus = { phase: "loading", updatedAt: null };
const newsGrid = document.getElementById("news-grid");
const filterButtons = document.querySelectorAll(".news-filter[data-category]");
const searchInput = document.getElementById("news-search");
const authorFilter = document.getElementById("news-author-filter");
const feedStatus = document.getElementById("news-feed-status");
const resultCount = document.getElementById("news-result-count");
const loadMore = document.getElementById("news-load-more");

function normalizeSearch(value) {
  return String(value || "").normalize("NFD")
    .replace(/\p{M}/gu, "").toLowerCase().trim();
}

function isYouTubeSeminar(post) {
  return post.category === "event" && post.source === "YouTube";
}

function isRecentVideo(post, now = Date.now()) {
  const published = Date.parse(post.publishedAt || post.date);
  const age = now - published;
  return isYouTubeSeminar(post) && Number.isFinite(age) && age >= 0 && age < 7 * 86400000;
}

function videoWatchUrl(post) {
  try {
    const url = new URL(post.video || post.link);
    if (url.protocol === "https:" && url.hostname === "www.youtube.com" &&
        url.pathname === "/watch" && /^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get("v") || "")) {
      return "https://www.youtube.com/watch?v=" + url.searchParams.get("v");
    }
  } catch (error) { /* No valid video link. */ }
  return "";
}

function isNewPreprint(post, now = Date.now()) {
  if (post.category !== "recent-preprint") return false;
  const today = new Date(now).toISOString().slice(0, 10);
  const age = Date.parse(today) - Date.parse(post.date);
  return Number.isFinite(age) && age >= 0 && age < 7 * 86400000;
}

// Author filters stay in the selected category v2
function recommendedAuthors() {
  return newsPosts.filter(post => post.category === "recommended-paper")
    .flatMap(post => String(post.author || "").split(","))
    .map(name => name.trim()).filter(Boolean);
}
function matchesPaperAuthor(post, author) {
  const expected = normalizeSearch(author);
  if (post.category === "recent-preprint") {
    return (post.followedAuthors || []).some(name => normalizeSearch(name) === expected);
  }
  if (post.category === "recommended-paper") {
    return String(post.author || "").split(",").some(name => normalizeSearch(name) === expected);
  }
  return false;
}
function isGroupEvent(post) {
  return post.category === "group-news" && Boolean(post.startDate);
}
function opportunityType(post) {
  return post.eventType || "Group Announcement";
}
function eventDateRange(post) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC"
  });
  const start = new Date(post.startDate);
  const end = new Date(post.endDate || post.startDate);
  return Number.isFinite(end.getTime()) && end >= start
    ? formatter.formatRange(start, end) : formatter.format(start);
}
// Group News institution filter v1
const institutionLabel = document.createElement("label");
institutionLabel.className = "news-field";
institutionLabel.htmlFor = "news-institution-filter";
institutionLabel.hidden = true;
const institutionCaption = document.createElement("span");
institutionCaption.textContent = "Institution";
const institutionFilter = document.createElement("select");
institutionFilter.id = "news-institution-filter";
institutionLabel.append(institutionCaption, institutionFilter);
const institutionToolbar = authorFilter.closest(".news-toolbar");
institutionToolbar.appendChild(institutionLabel);

function institutionName(post) {
  return String(post.institution || post.reference || post.source || post.author || "").trim();
}
function syncInstitutionFilter() {
  const active = state.category === "group-news";
  institutionLabel.hidden = !active;
  institutionToolbar.classList.toggle("news-group-toolbar", active);
  if (!active) {
    state.institution = "";
    institutionFilter.value = "";
    return;
  }
  const names = new Map();
  for (const post of [...newsPosts, ...groupEvents]) {
    if (post.category !== "group-news") continue;
    const name = institutionName(post);
    if (name && !names.has(normalizeSearch(name))) names.set(normalizeSearch(name), name);
  }
  const sorted = [...names.values()].sort((a, b) => a.localeCompare(b, "en"));
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All institutions";
  institutionFilter.replaceChildren(all);
  for (const name of sorted) {
    const option = document.createElement("option");
    option.value = option.textContent = name;
    institutionFilter.appendChild(option);
  }
  state.institution = sorted.find(name => normalizeSearch(name) === normalizeSearch(state.institution)) || "";
  institutionFilter.value = state.institution;
  institutionFilter.disabled = !sorted.length;
}
institutionFilter.addEventListener("change", () => {
  if (state.category !== "group-news") return;
  state.institution = institutionFilter.value;
  resetResults();
});

function matchingPosts(posts, filters) {
  const terms = normalizeSearch(filters.search).split(/\s+/).filter(Boolean);
  return posts.filter(post => {
    if (filters.category !== "all" && post.category !== filters.category) return false;
    if (filters.author && !matchesPaperAuthor(post, filters.author)) return false;
    if (filters.channel && (!isYouTubeSeminar(post) || post.author !== filters.channel)) return false;
    if (filters.opportunity && (post.category !== "group-news" || opportunityType(post) !== filters.opportunity)) return false;
    if (filters.institution && (post.category !== "group-news" || normalizeSearch(institutionName(post)) !== normalizeSearch(filters.institution))) return false;
    const searchable = normalizeSearch([post.title, post.author, post.reference, post.source, post.subject, post.affiliation, post.eventType, post.location, institutionName(post)].join(" "));
    return terms.every(term => searchable.includes(term));
  }).sort((a, b) => {
    if (filters.category === "group-news" && Boolean(a.manualGroupNews) !== Boolean(b.manualGroupNews)) {
      return a.manualGroupNews ? -1 : 1;
    }
    const ae = isGroupEvent(a), be = isGroupEvent(b);
    if (ae && be) return a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title);
    if (ae !== be) return ae ? (filters.category === "group-news" ? -1 : 1) : (filters.category === "group-news" ? 1 : -1);
    return b.date.localeCompare(a.date);
  });
}

// Serialize typesetting and DOM replacement; never block on loading the CDN.
let mathQueue = Promise.resolve();
let mathReady = null;
let revision = 0;
function enqueue(task) {
  mathQueue = mathQueue.then(task).catch(error => console.warn("News rendering:", error));
  return mathQueue;
}
function whenMathReady() {
  if (!mathReady) {
    mathReady = new Promise(resolve => {
      const script = document.getElementById("news-mathjax");
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        const math = window.MathJax;
        if (!math?.startup?.promise) return resolve(null);
        math.startup.promise.then(() => resolve(math), () => resolve(null));
      };
      const timer = setTimeout(finish, 15000);
      if (window.MathJax?.startup?.promise || !script) finish();
      else {
        script.addEventListener("load", finish, { once: true });
        script.addEventListener("error", finish, { once: true });
      }
    });
  }
  return mathReady;
}
const mathDone = new WeakSet();
function typesetElements(elements) {
  if (!elements.length) return;
  whenMathReady().then(math => {
    if (!math) return;
    enqueue(async () => {
      const live = elements.filter(el => el.isConnected && !mathDone.has(el) &&
        !el.closest("details:not([open])"));
      if (!live.length) return;
      await math.typesetPromise(live);
      live.forEach(el => mathDone.add(el));
    });
  });
}


// Shared event destinations v1
function groupSharedEventLinks(posts) {
  const buckets = new Map();
  function destination(post) {
    if (!isGroupEvent(post) || !post.link) return '';
    try {
      const url = new URL(post.link);
      if (!['https:', 'http:'].includes(url.protocol)) return '';
      // Preserve query strings and fragments: they may identify distinct events.
      return JSON.stringify([post.source || post.author || '', url.href]);
    } catch (_) { return ''; }
  }
  for (const post of posts) {
    const key = destination(post);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(post);
  }
  const emitted = new Set();
  const cards = [];
  for (const post of posts) {
    const key = destination(post);
    const events = buckets.get(key);
    if (!events || events.length < 2) {
      cards.push(post);
    } else if (!emitted.has(key)) {
      emitted.add(key);
      cards.push({ ...post, sharedEvents: events });
    }
  }
  return cards;
}

function createSharedEventCard(post) {
  const events = post.sharedEvents;
  const card = document.createElement('article');
  card.className = 'news-card';
  const content = document.createElement('div');
  content.className = 'news-card-content';
  const source = post.source || post.author || 'Scientific events';
  const calendar = events.every(event => event.linkText === 'Official calendar');
  const years = [...new Set(events.map(event => event.startDate.slice(0, 4)))];
  const meta = document.createElement('div');
  meta.className = 'news-meta';
  const category = document.createElement('span');
  category.className = 'news-category';
  category.textContent = (calendar ? 'Scientific Calendar' : 'Scientific Events') + ' · ' + source;
  meta.appendChild(category);
  const title = document.createElement('h2');
  title.textContent = source + ' — ' + (years.length === 1 ? years[0] + ' ' : '') + (calendar ? 'Scientific Calendar' : 'Upcoming Events');
  const count = document.createElement('p');
  count.className = 'news-subject';
  count.textContent = events.length + ' upcoming activities · Shared official page';
  content.append(meta, title, count);
  const details = document.createElement('details');
  details.className = 'news-abstract';
  details.open = true;
  const summary = document.createElement('summary');
  summary.className = 'news-abstract-toggle';
  summary.textContent = 'Upcoming activities (' + events.length + ')';
  const list = document.createElement('div');
  for (const event of events) {
    const item = document.createElement('div');
    item.style.padding = '0.7rem 0';
    const type = document.createElement('p');
    type.className = 'news-category';
    type.textContent = opportunityType(event);
    const heading = document.createElement('strong');
    heading.textContent = event.title;
    const date = document.createElement('p');
    date.className = 'news-subject';
    date.textContent = eventDateRange(event);
    item.append(type, heading, date);
    if (event.location) {
      const location = document.createElement('p');
      location.className = 'news-subject';
      location.textContent = event.location;
      item.appendChild(location);
    }
    if (event.applicationDeadline) {
      const deadline = new Date(event.applicationDeadline);
      if (Number.isFinite(deadline.getTime())) {
        const line = document.createElement('p');
        line.className = 'news-subject';
        line.textContent = 'Application deadline: ' + deadline.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
        item.appendChild(line);
      }
    }
    list.appendChild(item);
  }
  details.append(summary, list);
  content.appendChild(details);
  const links = document.createElement('div');
  links.className = 'news-links';
  const link = document.createElement('a');
  link.className = 'news-link';
  link.href = post.link;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = (calendar ? 'Official calendar' : 'Event website') + ' ↗';
  links.appendChild(link);
  content.appendChild(links);
  card.appendChild(content);
  return card;
}

function createNewsCard(post) {
  if (post.sharedEvents) return createSharedEventCard(post);
  const card = document.createElement("article");
  const videoCard = isYouTubeSeminar(post);
  const groupEvent = isGroupEvent(post);
  const watchUrl = videoCard ? videoWatchUrl(post) : "";
  card.className = videoCard ? "news-card news-video-card" : "news-card";
  const content = document.createElement("div");
  content.className = "news-card-content";
  const meta = document.createElement("div");
  meta.className = "news-meta";
  const category = document.createElement("span");
  category.className = "news-category";
  category.textContent = videoCard ? "Recorded Seminar" : (groupEvent || post.announcementOnly) ? opportunityType(post) : (categories[post.category] || post.category);
  if (post.reference) category.textContent += " · " + post.reference;
  meta.appendChild(category);
  if (isNewPreprint(post) || isRecentVideo(post)) {
    const badge = document.createElement("span");
    badge.className = "news-new";
    badge.textContent = "New";
    badge.title = videoCard ? "Published within the last seven days" : "Submitted within the last seven calendar days (UTC)";
    meta.appendChild(badge);
  }
  const title = document.createElement("h2");
  title.textContent = post.title;
  content.appendChild(meta);
  if (videoCard && watchUrl) {
    const preview = document.createElement("a");
    preview.className = "news-video-thumbnail";
    preview.href = watchUrl;
    preview.target = "_blank";
    preview.rel = "noopener noreferrer";
    preview.setAttribute("aria-label", "Watch on YouTube: " + post.title);
    const image = document.createElement("img");
    const id = new URL(watchUrl).searchParams.get("v");
    image.src = "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => image.remove());
    const play = document.createElement("span");
    play.className = "news-video-play";
    play.setAttribute("aria-hidden", "true");
    preview.append(image, play);
    content.appendChild(preview);
  }
  content.appendChild(title);
  if (post.author) {
    const author = document.createElement("p");
    author.className = "news-author";
    const tokens = name => normalizeSearch(name).match(/[a-z]+/g) || [];
    const followed = (post.followedAuthors || []).map(tokens);
    String(post.author).split(",").forEach((name, index) => {
      if (index) author.appendChild(document.createTextNode(", "));
      const span = document.createElement("span");
      span.textContent = name.trim();
      const actual = tokens(name);
      const matched = followed.some(expected => expected.length && actual.length &&
        actual[0] === expected[0] &&
        actual[actual.length - 1] === expected[expected.length - 1] &&
        expected.every(word => actual.includes(word)));
      if (matched) span.className = "news-followed-author";
      author.appendChild(span);
    });
    content.appendChild(author);
  }
  const date = document.createElement("time");
  date.className = "news-date";
  date.dateTime = post.date;
  const formattedDate = new Date(post.date).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC"
  });
  const dateLabel = post.category === "recent-preprint" ? "Submitted on " :
    post.category === "recommended-paper" ? "Recommended on " :
    post.source === "YouTube" ? "Published on " :
    post.eventStatus === "upcoming" ? "Scheduled for " :
    post.eventStatus === "recorded" ? "Held on " : "Posted on ";
  date.textContent = groupEvent ? eventDateRange(post) : dateLabel + formattedDate;
  if (groupEvent) date.dateTime = post.startDate;
  content.appendChild(date);
  if (post.subject || (groupEvent && post.location)) {
    const subject = document.createElement("p");
    subject.className = "news-subject";
    subject.textContent = groupEvent ? (post.location || post.subject) : post.subject;
    content.appendChild(subject);
  }
  if (groupEvent) {
    const deadline = document.createElement("p");
    deadline.className = "news-subject";
    const value = new Date(post.applicationDeadline || "");
    deadline.textContent = "Application deadline: " + (Number.isFinite(value.getTime())
      ? value.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
      : "Check official website");
    content.appendChild(deadline);
  }
  if (post.abstract || post.description) {
    const paragraph = document.createElement("p");
    paragraph.textContent = post.abstract || post.description;
    if (post.abstract || post.category === "recommended-paper") {
      const details = document.createElement("details");
      details.className = "news-abstract";
      const summary = document.createElement("summary");
      summary.className = "news-abstract-toggle";
      const label = post.abstract ? "abstract" : "summary";
      summary.textContent = "Show " + label;
      details.addEventListener("toggle", () => {
        summary.textContent = (details.open ? "Hide " : "Show ") + label;
        if (details.open) typesetElements([paragraph]);
      });
      details.append(summary, paragraph);
      content.appendChild(details);
    } else {
      const section = document.createElement("div");
      section.className = "news-abstract";
      section.appendChild(paragraph);
      content.appendChild(section);
    }
  }
  if (post.image && !videoCard) {
    const image = document.createElement("img");
    image.className = "news-image";
    image.src = post.image;
    image.alt = post.imageAlt || "";
    image.loading = "lazy";
    image.addEventListener("error", () => image.remove());
    content.appendChild(image);
  }
  const links = document.createElement("div");
  links.className = "news-links";
  for (const [url, label] of [[post.link, post.linkText || "Read more"], [post.pdf, "PDF"], [post.video !== post.link ? post.video : "", "Watch seminar"]]) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
    const link = document.createElement("a");
    link.className = "news-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label + " ↗";
    links.appendChild(link);
  }
  if (links.children.length) content.appendChild(links);
  card.appendChild(content);
  return card;
}

let visiblePosts = [];
function renderNews({ append = false } = {}) {
  const current = ++revision;
  const matches = matchingPosts([...newsPosts, ...arxivPosts, ...youtubePosts, ...groupEvents], state);
  const posts = groupSharedEventLinks(matches);
  const selected = posts.slice(0, state.limit);
  enqueue(() => {
    if (current !== revision) return;
    const canAppend = append && visiblePosts.length > 0 &&
      visiblePosts.every((post, index) => post === selected[index]);
    if (!canAppend) {
      if (typeof window.MathJax?.typesetClear === "function") {
        try { window.MathJax.typesetClear([newsGrid]); }
        catch (error) { console.warn("MathJax cleanup:", error); }
      }
      newsGrid.replaceChildren();
      visiblePosts = [];
    }
    const fragment = document.createDocumentFragment();
    const toTypeset = [];
    for (const post of selected.slice(visiblePosts.length)) {
      const card = createNewsCard(post);
      fragment.appendChild(card);
      toTypeset.push(...card.querySelectorAll("h2, div.news-abstract p"));
    }
    newsGrid.appendChild(fragment);
    visiblePosts = selected;
    if (!selected.length) {
      const empty = document.createElement("p");
      empty.className = "news-empty";
      empty.textContent = "No posts match your filters.";
      newsGrid.appendChild(empty);
    }
    const grouped = posts.some(post => post.sharedEvents);
    resultCount.textContent = grouped
      ? "Showing " + selected.length + " of " + posts.length + " cards · " + matches.length + " matching posts"
      : "Showing " + selected.length + " of " + posts.length + " posts";
    loadMore.hidden = selected.length >= posts.length;
    typesetElements(toTypeset);
  });
}

function syncToolbar() {
  const seminars = state.category === "event";
  const recommended = state.category === "recommended-paper";
  const group = state.category === "group-news";
  const papers = recommended || state.category === "recent-preprint";
  const authorMode = state.category === "all" || papers;
  const searchLabel = searchInput.closest("label")?.querySelector("span");
  const filterLabel = authorFilter.closest("label")?.querySelector("span");
  if (searchLabel) searchLabel.textContent = group ? "Search opportunities" : seminars ? "Search seminars" : papers ? "Search papers" : "Search news";
  searchInput.placeholder = group ? "Search by title, institution, or location" : seminars ? "Search by title or channel" : papers ? "Search by title or author" : "Search by title, author, or channel";
  if (filterLabel) filterLabel.textContent = group ? "Opportunity type" : seminars ? "YouTube channel" : state.category === "recent-preprint" ? "Followed author" : "Author";
  const names = group ? [...newsPosts, ...groupEvents].filter(post => post.category === "group-news").map(opportunityType) :
    seminars ? youtubePosts.map(post => post.author) :
    recommended ? recommendedAuthors() :
    state.category === "all" ? [...recommendedAuthors(), ...followedNames] :
    authorMode ? followedNames : [];
  const unique = new Map();
  for (const name of names) {
    if (typeof name !== "string" || !name.trim()) continue;
    const key = seminars ? name : normalizeSearch(name);
    if (!unique.has(key)) unique.set(key, name);
  }
  const sorted = [...unique.values()].sort((a, b) => a.localeCompare(b, "en"));
  const all = document.createElement("option");
  all.value = "";
  all.textContent = group ? "All opportunities" : seminars ? "All channels" : "All authors";
  authorFilter.replaceChildren(all);
  for (const name of sorted) {
    const option = document.createElement("option");
    option.value = option.textContent = name;
    authorFilter.appendChild(option);
  }
  const key = group ? "opportunity" : seminars ? "channel" : "author";
  state[key] = sorted.find(name => seminars ? name === state[key] :
    normalizeSearch(name) === normalizeSearch(state[key])) || "";
  authorFilter.value = state[key];
  authorFilter.disabled = (!group && !seminars && !authorMode) || !sorted.length;
  syncInstitutionFilter();
}
function updateFeedStatus() {
  const seminars = state.category === "event";
  const group = state.category === "group-news";
  const name = group ? "Scientific events feed" : seminars ? "YouTube feed" : "arXiv feed";
  const status = group ? eventsStatus : seminars ? youtubeStatus : arxivStatus;
  if (status.phase === "loading") {
    feedStatus.textContent = "Loading " + name + "…";
    return;
  }
  if (status.phase === "error") {
    feedStatus.textContent = name + " unavailable. Other sources are unaffected.";
    return;
  }
  const date = new Date(status.updatedAt || "");
  if (!Number.isFinite(date.getTime())) {
    feedStatus.textContent = name + " · Last updated: unavailable";
    return;
  }
  const time = document.createElement("time");
  time.dateTime = date.toISOString();
  time.textContent = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone: "America/Sao_Paulo"
  }).format(date) + " (BRT)";
  feedStatus.replaceChildren(name + " · Last updated: ", time);
}
function setCategory(category) {
  state.category = category;
  if (category !== "event") state.channel = "";
  if (category !== "group-news") state.opportunity = "";
  if (!["all", "recent-preprint", "recommended-paper"].includes(category)) state.author = "";
  filterButtons.forEach(button => {
    const active = button.dataset.category === category;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  syncToolbar();
  updateFeedStatus();
}
function resetResults() {
  state.limit = PAGE_SIZE;
  renderNews();
}
filterButtons.forEach(button => {
  button.addEventListener("click", () => {
    setCategory(button.dataset.category);
    resetResults();
  });
});
searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  resetResults();
});
authorFilter.addEventListener("change", () => {
  if (state.category === "group-news") {
    state.opportunity = authorFilter.value;
  } else if (state.category === "event") {
    state.channel = authorFilter.value;
  } else {
    state.author = authorFilter.value;
  }
  resetResults();
});
loadMore.addEventListener("click", () => {
  state.limit += PAGE_SIZE;
  renderNews({ append: true });
});
function populateAuthors(authors) {
  followedNames = authors;
  if (state.category !== "event") syncToolbar();
}
async function loadArxivFeed() {
  try {
    const response = await fetch("arxiv-feed.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Could not load arXiv feed.");
    const data = await response.json();
    const posts = Array.isArray(data) ? data : data.posts;
    if (!Array.isArray(posts)) throw new Error("Invalid arXiv feed.");
    const referenceKey = value => String(value || "").toLowerCase().replace(/v\d+$/, "");
    const references = new Set(newsPosts.map(post => referenceKey(post.reference)).filter(Boolean));
    arxivPosts = posts.filter(post => {
      const key = referenceKey(post.reference);
      if (!key || references.has(key)) return false;
      references.add(key);
      return true;
    });
    arxivStatus = { phase: "ready", updatedAt: Array.isArray(data) ? null : data.updatedAt };
    updateFeedStatus();
    renderNews();
    let authors = posts.flatMap(post => post.followedAuthors || []);
    try {
      const authorResponse = await fetch("followed-authors.json", { cache: "no-cache" });
      if (authorResponse.ok) {
        const configured = await authorResponse.json();
        if (Array.isArray(configured)) authors = [...authors, ...configured];
      }
    } catch (error) {
      console.warn("Followed authors list unavailable:", error);
    }
    populateAuthors(authors);
  } catch (error) {
    arxivStatus = { phase: "error", updatedAt: null };
    updateFeedStatus();
    console.error("arXiv feed error:", error);
  }
}
async function loadYouTubeFeed() {
  try {
    const response = await fetch("youtube-feed.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Could not load YouTube feed: " + response.status);
    const data = await response.json();
    if (!Array.isArray(data.posts)) throw new Error("Invalid YouTube feed.");
    youtubePosts = data.posts.filter(post => post && isYouTubeSeminar(post) && videoWatchUrl(post) &&
      typeof post.title === "string" && typeof post.date === "string" && Number.isFinite(Date.parse(post.date)));
    youtubeStatus = { phase: "ready", updatedAt: data.updatedAt };
    if (state.category === "event") syncToolbar();
    updateFeedStatus();
    renderNews();
  } catch (error) {
    youtubeStatus = { phase: "error", updatedAt: null };
    updateFeedStatus();
    console.warn("YouTube feed unavailable:", error);
  }
}
// Manual Group News v1
function validGroupNewsDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function manualGroupNewsPosts(data, today) {
  if (!data || !Array.isArray(data.posts)) throw new Error("Invalid group-news.json: expected a posts array.");
  const seen = new Set();
  const posts = [];
  for (const item of data.posts) {
    if (!item || item.enabled === false) continue;
    if (typeof item.title !== "string" || !item.title.trim() || !validGroupNewsDate(item.date)) {
      console.warn("Invalid manual Group News entry:", item);
      continue;
    }
    if (item.date > today) continue;
    if (item.expiresOn && (!validGroupNewsDate(item.expiresOn) || item.expiresOn < today)) continue;
    const title = item.title.trim();
    const key = normalizeSearch(title) + "|" + item.date;
    if (seen.has(key)) continue;
    seen.add(key);
    const institution = "UEL";
    let link = "";
    if (typeof item.link === "string" && item.link) {
      try {
        const url = new URL(item.link);
        if (["https:", "http:"].includes(url.protocol)) link = url.href;
      } catch (_) { /* An optional invalid link is omitted. */ }
    }
    posts.push({
      category: "group-news", eventType: "Group Announcement", announcementOnly: true,
      manualGroupNews: true, title, date: item.date, institution, source: "Research Group",
      reference: institution,
      author: typeof item.author === "string" && item.author.trim() ? item.author.trim() : "Quantum Matter and Quantum Field Theory Group",
      description: typeof item.description === "string" ? item.description.trim() : "",
      link, linkText: typeof item.linkText === "string" && item.linkText.trim() ? item.linkText.trim() : "Read more"
    });
  }
  return posts;
}
async function loadManualGroupNews() {
  try {
    const response = await fetch("group-news.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Could not load group-news.json: " + response.status);
    const data = await response.json();
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const posts = manualGroupNewsPosts(data, today);
    newsPosts.push(...posts);
    if (state.category === "group-news") syncToolbar();
    renderNews();
  } catch (error) {
    console.warn("Manual Group News unavailable:", error);
  }
}

async function loadGroupEvents() {
  try {
    const response = await fetch("events-feed.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Could not load events feed: " + response.status);
    const data = await response.json();
    if (!Array.isArray(data.posts)) throw new Error("Invalid events feed.");
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    // SBF announcement cards v2
    groupEvents = data.posts.filter(post => {
      if (!post || post.category !== "group-news" || typeof post.title !== "string") return false;
      if (post.announcementOnly === true) {
        if (typeof post.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(post.date)) return false;
        const age = Date.parse(today) - Date.parse(post.date);
        return Number.isFinite(age) && age >= 0 && age <= 45 * 86400000;
      }
      return typeof post.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(post.startDate) &&
        Number.isFinite(Date.parse(post.startDate)) && post.startDate > today;
    }).map(post => ({ ...post, date: post.announcementOnly ? post.date : post.startDate }));
    eventsStatus = { phase: "ready", updatedAt: data.updatedAt };
    if (state.category === "group-news") syncToolbar();
    updateFeedStatus();
    renderNews();
  } catch (error) {
    eventsStatus = { phase: "error", updatedAt: null };
    updateFeedStatus();
    console.warn("Scientific events feed unavailable:", error);
  }
}
setCategory("all");
renderNews();
loadArxivFeed();
loadYouTubeFeed();
loadGroupEvents();
loadManualGroupNews();
