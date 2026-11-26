
import json
import urllib.request
import xml.etree.ElementTree as ET
import re

from pathlib import Path
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parent.parent

with (ROOT / "youtube-channels.json").open(
    encoding="utf-8"
) as file:
    config = json.load(file)

with (ROOT / "seminar-sources.json").open(
    encoding="utf-8"
) as file:
    seminar_config = json.load(file)

keywords = [
    word.casefold()
    for word in seminar_config["keywords"]
]

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/"
}

now = datetime.now(timezone.utc)

cutoff = now - timedelta(
    days=config["maxAgeDays"]
)

posts = []
seen = set()
successful_channels = 0

for channel in config["channels"]:

    name = channel["name"]
    channel_id = channel["id"]

    print(f"\nFetching: {name}")

    url = (
        "https://www.youtube.com/feeds/videos.xml"
        f"?channel_id={channel_id}"
    )

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/atom+xml, application/xml"
        }
    )

    try:
        with urllib.request.urlopen(
            request, timeout=40
        ) as response:
            root = ET.fromstring(response.read())

        if root.tag != f"{{{NS['atom']}}}feed":
            raise ValueError("Invalid Atom feed.")

    except Exception as error:
        print(f"Could not fetch {name}: {error}")
        continue

    successful_channels += 1

    actual_name = root.findtext(
        "atom:title", default="", namespaces=NS
    )

    print(f"Channel returned: {actual_name}")

    count = 0

    for entry in root.findall("atom:entry", NS):

        video_id = entry.findtext(
            "yt:videoId", default="", namespaces=NS
        )

        title = entry.findtext(
            "atom:title", default="", namespaces=NS
        ).strip()

        published = entry.findtext(
            "atom:published", default="", namespaces=NS
        )

        description = entry.findtext(
            "media:group/media:description",
            default="",
            namespaces=NS
        )

        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            continue

        if not title or video_id in seen:
            continue

        try:
            date = datetime.fromisoformat(
                published.replace("Z", "+00:00")
            )

            if date.tzinfo is None:
                continue

        except ValueError:
            continue

        if date < cutoff or date > now:
            continue

        searchable = (
            title + " " + description
        ).casefold()

        if channel.get("filterByKeywords", True):
            if not any(
                word in searchable
                for word in keywords
            ):
                continue

        seen.add(video_id)

        video_url = (
            "https://www.youtube.com/watch"
            f"?v={video_id}"
        )

        thumbnail = (
            "https://i.ytimg.com/vi/"
            f"{video_id}/hqdefault.jpg"
        )

        posts.append({
            "id": f"youtube:{video_id}",
            "category": "event",
            "eventStatus": "recorded",
            "title": title,
            "author": name,
            "source": "YouTube",
            "reference": "YouTube",
            "date": date.date().isoformat(),
            "publishedAt": date.isoformat(),
            "image": thumbnail,
            "imageAlt": title,
            "video": video_url,
            "link": video_url,
            "linkText": "Watch on YouTube"
        })

        count += 1
        print(f"  - {title}")

    print(f"Relevant videos: {count}")

if successful_channels == 0:
    raise RuntimeError(
        "All YouTube feeds failed. "
        "Existing feed was not overwritten."
    )

# Preserve previous data from unavailable channels
# by stopping if the collection is incomplete.
if successful_channels < len(config["channels"]):
    raise RuntimeError(
        "Some channels failed. "
        "Existing feed was not overwritten."
    )

posts.sort(
    key=lambda post: datetime.fromisoformat(
        post["publishedAt"]
    ),
    reverse=True
)

posts = posts[:config["maxVideos"]]

feed = {
    "updatedAt": datetime.now(timezone.utc).isoformat(
        timespec="seconds"
    ),
    "posts": posts
}

output = ROOT / "youtube-feed.json"
temporary = ROOT / "youtube-feed.json.tmp"

with temporary.open("w", encoding="utf-8") as file:
    json.dump(
        feed,
        file,
        ensure_ascii=False,
        indent=2
    )

temporary.replace(output)

print("\n" + "=" * 50)
print("YouTube feed successfully generated.")
print(f"Channels available: {successful_channels}")
print(f"Videos saved: {len(posts)}")
print(f"Output: {output}")
print("=" * 50)
