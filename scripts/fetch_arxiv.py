
import json
import re
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from pathlib import Path
from datetime import datetime, timezone


# Configuration

ROOT = Path(__file__).resolve().parent.parent

AUTHORS_FILE = ROOT / "followed-authors.json"
OUTPUT_FILE = ROOT / "arxiv-feed.json"

MAX_PAPERS = 30

CATEGORIES = [
    "hep-th",
    "cond-mat.str-el",
    "quant-ph",
    "math-ph"
]

API_URL = "https://export.arxiv.org/api/query"

NS = {
    "atom": "http://www.w3.org/2005/Atom"
}


# Load followed authors

with AUTHORS_FILE.open(encoding="utf-8") as file:
    followed_authors = json.load(file)


def normalize(name):
    name = unicodedata.normalize("NFKD", name)

    name = "".join(
        char for char in name
        if not unicodedata.combining(char)
    )

    return re.findall(r"[a-z]+", name.lower())


def matches_author(name, followed):
    actual = normalize(name)
    expected = normalize(followed)

    if not actual or not expected:
        return False

    return (
        actual[0] == expected[0]
        and all(word in actual for word in expected)
        and actual[-1] == expected[-1]
    )


# Build the arXiv query

author_queries = []

for author in followed_authors:
    words = normalize(author)

    if words:
        query = " AND ".join(
            f'au:"{word}"' for word in words
        )

        author_queries.append(f"({query})")

if not author_queries:
    raise ValueError("No followed authors configured.")

author_query = " OR ".join(author_queries)

category_query = " OR ".join(
    f"cat:{category}"
    for category in CATEGORIES
)

query = (
    f"({author_query}) "
    f"AND ({category_query})"
)

params = urllib.parse.urlencode({
    "search_query": query,
    "start": 0,
    "max_results": 100,
    "sortBy": "submittedDate",
    "sortOrder": "descending"
})

url = f"{API_URL}?{params}"


# Fetch metadata from arXiv

request = urllib.request.Request(
    url,
    headers={
        "User-Agent": "UEL-QMQFT-ResearchGroup/1.0"
    }
)

print("Fetching papers from arXiv...")

with urllib.request.urlopen(
    request, timeout=90
) as response:
    xml_data = response.read()

feed = ET.fromstring(xml_data)

papers = []
seen_ids = set()


# Process articles

for entry in feed.findall("atom:entry", NS):

    raw_id = entry.findtext(
        "atom:id", "", NS
    )

    if "/abs/" not in raw_id:
        raise RuntimeError(
            f"Unexpected arXiv entry: {raw_id}"
        )

    arxiv_id = raw_id.split("/abs/")[-1]

    # Remove the version suffix to avoid duplicates

    arxiv_id = re.sub(
        r"v\d+$", "", arxiv_id
    )

    if arxiv_id in seen_ids:
        continue

    title = entry.findtext(
        "atom:title", "", NS
    )

    title = " ".join(title.split())

    abstract = entry.findtext(
        "atom:summary", "", NS
    )

    abstract = " ".join(abstract.split())

    published = entry.findtext(
        "atom:published", "", NS
    )

    authors = [
        author.findtext("atom:name", "", NS)
        for author in entry.findall("atom:author", NS)
    ]

    matched_authors = [
        followed
        for followed in followed_authors
        if any(
            matches_author(author, followed)
            for author in authors
        )
    ]

    if not matched_authors:
        continue

    subjects = [
        category.attrib.get("term", "")
        for category in entry.findall(
            "atom:category", NS
        )
    ]

    paper = {
        "title": title,
        "category": "recent-preprint",
        "date": published[:10],
        "author": ", ".join(authors),
        "reference": f"arXiv:{arxiv_id}",
        "subject": ", ".join(subjects),
        "abstract": abstract,
        "followedAuthors": matched_authors,
        "image": "",
        "link": f"https://arxiv.org/abs/{arxiv_id}",
        "linkText": "arXiv",
        "pdf": f"https://arxiv.org/pdf/{arxiv_id}"
    }

    papers.append(paper)
    seen_ids.add(arxiv_id)


# Sort and limit the feed

papers.sort(
    key=lambda paper: paper["date"],
    reverse=True
)

papers = papers[:MAX_PAPERS]


# Save the generated feed

with OUTPUT_FILE.open(
    "w", encoding="utf-8"
) as file:
    json.dump(
        {
            "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "posts": papers
        },
        file,
        ensure_ascii=False,
        indent=2
    )

print(f"Successfully retrieved {len(papers)} papers.")
print(f"Feed saved to: {OUTPUT_FILE}")
