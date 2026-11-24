const tabs = Array.from(document.querySelectorAll("[role='tab']"));
const panels = Array.from(document.querySelectorAll("[data-panel]"));
const currentIndex = document.querySelector("#current-index");

function activateTab(tab, moveFocus = false) {
  const selectedTab = tab.dataset.tab;

  tabs.forEach((item, index) => {
    const isSelected = item === tab;
    item.classList.toggle("is-active", isSelected);
    item.setAttribute("aria-selected", String(isSelected));
    item.tabIndex = isSelected ? 0 : -1;

    if (isSelected) {
      currentIndex.textContent = String(index + 1).padStart(2, "0");
    }
  });

  panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== selectedTab;
  });

  if (moveFocus) {
    tab.focus();
  }
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateTab(tab));
  tab.addEventListener("keydown", (event) => {
    let nextIndex;

    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    activateTab(tabs[nextIndex], true);
  });
});

document.querySelectorAll("[data-open-tab]").forEach((link) => {
  link.addEventListener("click", () => {
    const targetTab = tabs.find((tab) => tab.dataset.tab === link.dataset.openTab);
    if (targetTab) {
      activateTab(targetTab);
    }
  });
});
