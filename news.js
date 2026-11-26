
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

const newsGrid = document.getElementById("news-grid");
const filterButtons = document.querySelectorAll(".news-filter");


function createNewsCard(post) {
  const card = document.createElement("article");
  card.className = "news-card";

  const content = document.createElement("div");
  content.className = "news-card-content";

  // Category and reference

  const meta = document.createElement("div");
  meta.className = "news-meta";

  const category = document.createElement("span");
  category.className = "news-category";

  category.textContent = categories[post.category];

  if (post.reference) {
    category.textContent += " · " + post.reference;
  }

  meta.appendChild(category);
  content.appendChild(meta);

  // Title

  const title = document.createElement("h2");
  title.textContent = post.title;
  content.appendChild(title);

  // Authors

  if (post.author) {
    const author = document.createElement("p");
    author.className = "news-author";
    author.textContent = post.author;
    content.appendChild(author);
  }

  // Date

  const date = document.createElement("time");
  date.className = "news-date";
  date.dateTime = post.date;

  const formattedDate = new Date(post.date)
    .toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC"
    });

  date.textContent =
  (post.category === "recommended-paper"
    ? "Recommended on "
    : post.category === "recent-preprint"
      ? "Submitted on "
      : "Posted on ") + formattedDate;

  content.appendChild(date);

  // Research subject

  if (post.subject) {
    const subject = document.createElement("p");
    subject.className = "news-subject";
    subject.textContent = post.subject;
    content.appendChild(subject);
  }

  
// Abstract or description

if (post.abstract || post.description) {

  const paragraph = document.createElement("p");

  paragraph.textContent =
    post.abstract || post.description;

  if (post.abstract ||
      post.category === "recommended-paper") {

    const details = document.createElement("details");
    details.className = "news-abstract";

    const summary = document.createElement("summary");
    summary.className = "news-abstract-toggle";

    const label = post.abstract ? "abstract" : "summary";

    summary.textContent = "Show " + label;

    details.addEventListener("toggle", () => {
      summary.textContent = details.open
        ? "Hide " + label
        : "Show " + label;
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


  // Optional image

  if (post.image) {
    const image = document.createElement("img");
    image.className = "news-image";
    image.src = post.image;
    image.alt = post.imageAlt || "";
    image.loading = "lazy";

    image.addEventListener("error", () => image.remove());

    content.appendChild(image);
  }

  // External links

  const links = document.createElement("div");
  links.className = "news-links";

  if (post.link) {
    const link = document.createElement("a");
    link.className = "news-link";
    link.href = post.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = (post.linkText || "Read more") + " ↗";

    links.appendChild(link);
  }

  if (post.pdf) {
    const pdf = document.createElement("a");
    pdf.className = "news-link";
    pdf.href = post.pdf;
    pdf.target = "_blank";
    pdf.rel = "noopener noreferrer";
    pdf.textContent = "PDF ↗";

    links.appendChild(pdf);
  }

  if (links.children.length > 0) {
    content.appendChild(links);
  }

  card.appendChild(content);

  return card;
}


function renderNews(category = "all") {
  newsGrid.replaceChildren();

  const posts = [...newsPosts, ...arxivPosts]
    .filter(post => category === "all" || post.category === category)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (posts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "news-empty";
    empty.textContent = "No posts in this category yet.";
    newsGrid.appendChild(empty);
    return;
  }

  posts.forEach(post => {
    newsGrid.appendChild(createNewsCard(post));
  });
}

filterButtons.forEach(button => {
  button.addEventListener("click", () => {
    filterButtons.forEach(btn => {
      btn.classList.remove("is-active");
      btn.setAttribute("aria-pressed", "false");
    });

    button.classList.add("is-active");
    button.setAttribute("aria-pressed", "true");
    renderNews(button.dataset.category);
  });
});


/* ========================================
   AUTOMATIC ARXIV FEED
   ======================================== */

async function loadArxivFeed() {
  try {
    const response = await fetch("arxiv-feed.json", {
      cache: "no-cache"
    });

    if (!response.ok) {
      throw new Error("Could not load arXiv feed.");
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("Invalid arXiv feed.");
    }

    const manualReferences = new Set(
      newsPosts
        .map(post => post.reference)
        .filter(Boolean)
        .map(ref => ref.toLowerCase().replace(/v\d+$/, ""))
    );

    arxivPosts = data.filter(post =>
      !manualReferences.has(
        post.reference.toLowerCase().replace(/v\d+$/, "")
      )
    );

    console.log(
      "Loaded " + arxivPosts.length + " arXiv papers."
    );

    const activeFilter = document.querySelector(
      ".news-filter.is-active"
    );

    renderNews(activeFilter?.dataset.category || "all");

  } catch (error) {
    console.error("arXiv feed error:", error);
  }
}

renderNews();
loadArxivFeed();
