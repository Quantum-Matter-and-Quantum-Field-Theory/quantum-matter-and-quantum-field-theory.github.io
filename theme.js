const themeStorageKey = "quantum-matter-site-theme";
const root = document.documentElement;

try {
  const savedTheme = localStorage.getItem(themeStorageKey);
  if (savedTheme === "light" || savedTheme === "dark") {
    root.dataset.theme = savedTheme;
  }
} catch {
  root.dataset.theme = "dark";
}

function initializeThemeToggle() {
  const toggle = document.querySelector(".theme-toggle");
  if (!toggle) return;

  const icons = Array.from(toggle.querySelectorAll("[data-theme-icon]"));

  function updateToggle() {
    const nextTheme = root.dataset.theme === "light" ? "dark" : "light";
    const activeIcon = root.dataset.theme === "light" ? "moon" : "sun";
    const label = `Switch to ${nextTheme} mode`;
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    icons.forEach((icon) => {
      icon.classList.toggle("is-visible", icon.dataset.themeIcon === activeIcon);
    });
  }

  toggle.addEventListener("click", () => {
    const nextTheme = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = nextTheme;
    updateToggle();
    try {
      localStorage.setItem(themeStorageKey, nextTheme);
    } catch {
      // Theme switching remains available when storage is disabled.
    }
  });

  updateToggle();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeThemeToggle, { once: true });
} else {
  initializeThemeToggle();
}