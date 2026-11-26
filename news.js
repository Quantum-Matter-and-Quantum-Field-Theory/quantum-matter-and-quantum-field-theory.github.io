
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
  "publication": "Publication",
  "research-highlight": "Research Highlight"
};

let arxivPosts = [];
const PAGE_SIZE = 6;
const state = { category: "all", search: "", author: "", limit: PAGE_SIZE };
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

function isNewPreprint(post, now = Date.now()) {
  if (post.category !== "recent-preprint") return false;
  const today = new Date(now).toISOString().slice(0, 10);
  const age = Date.parse(today) - Date.parse(post.date);
  return Number.isFinite(age) && age >= 0 && age < 7 * 86400000;
}

function matchingPosts(posts, filters) {
  const terms = normalizeSearch(filters.search).split(/\s+/).filter(Boolean);
  return posts.filter(post => {
    if (filters.category !== "all" && post.category !== filters.category) return false;
    if (filters.author && (post.category !== "recent-preprint" ||
      !(post.followedAuthors || []).includes(filters.author))) return false;
    const searchable = normalizeSearch([post.title, post.author, post.reference].join(" "));
    return terms.every(term => searchable.includes(term));
  }).sort((a, b) => b.date.localeCompare(a.date));
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

function createNewsCard(post) {
  const card = document.createElement("article");
  card.className = "news-card";
  const content = document.createElement("div");
  content.className = "news-card-content";
  const meta = document.createElement("div");
  meta.className = "news-meta";
  const category = document.createElement("span");
  category.className = "news-category";
  category.textContent = categories[post.category] || post.category;
  if (post.reference) category.textContent += " · " + post.reference;
  meta.appendChild(category);
  if (isNewPreprint(post)) {
    const badge = document.createElement("span");
    badge.className = "news-new";
    badge.textContent = "New";
    badge.title = "Submitted within the last seven calendar days (UTC)";
    meta.appendChild(badge);
  }
  const title = document.createElement("h2");
  title.textContent = post.title;
  content.append(meta, title);
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
    post.category === "recommended-paper" ? "Recommended on " : "Posted on ";
  date.textContent = dateLabel + formattedDate;
  content.appendChild(date);
  if (post.subject) {
    const subject = document.createElement("p");
    subject.className = "news-subject";
    subject.textContent = post.subject;
    content.appendChild(subject);
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
  if (post.image) {
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
  for (const [url, label] of [[post.link, post.linkText || "Read more"], [post.pdf, "PDF"]]) {
    if (!url) continue;
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
  const posts = matchingPosts([...newsPosts, ...arxivPosts], state);
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
    resultCount.textContent = "Showing " + selected.length + " of " + posts.length + " posts";
    loadMore.hidden = selected.length >= posts.length;
    typesetElements(toTypeset);
  });
}

function setCategory(category) {
  state.category = category;
  filterButtons.forEach(button => {
    const active = button.dataset.category === category;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
function resetResults() {
  state.limit = PAGE_SIZE;
  renderNews();
}
filterButtons.forEach(button => {
  button.addEventListener("click", () => {
    setCategory(button.dataset.category);
    if (state.category !== "all" && state.category !== "recent-preprint") {
      authorFilter.value = "";
      state.author = "";
    }
    resetResults();
  });
});
searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  resetResults();
});
authorFilter.addEventListener("change", () => {
  state.author = authorFilter.value;
  if (state.author) setCategory("recent-preprint");
  resetResults();
});
loadMore.addEventListener("click", () => {
  state.limit += PAGE_SIZE;
  renderNews({ append: true });
});

function populateAuthors(authors) {
  const names = [...new Set(authors)].filter(name => typeof name === "string" && name.trim())
    .sort((a, b) => a.localeCompare(b, "en"));
  for (const name of names) {
    const option = document.createElement("option");
    option.value = option.textContent = name;
    authorFilter.appendChild(option);
  }
}
function showUpdatedAt(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) {
    feedStatus.textContent = "arXiv feed · Last updated: unavailable";
    return;
  }
  const time = document.createElement("time");
  time.dateTime = date.toISOString();
  time.textContent = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone: "America/Sao_Paulo"
  }).format(date) + " (BRT)";
  feedStatus.replaceChildren("arXiv feed · Last updated: ", time);
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
    showUpdatedAt(Array.isArray(data) ? null : data.updatedAt);
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
    feedStatus.textContent = "arXiv feed unavailable. Manual posts are still shown.";
    console.error("arXiv feed error:", error);
  }
}
renderNews();
loadArxivFeed();
