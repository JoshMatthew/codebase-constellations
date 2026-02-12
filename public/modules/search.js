let allSymbols = [];
let onSelectCallback = null;

const input = document.getElementById("search-input");
const results = document.getElementById("search-results");
let activeIndex = -1;

export function initSearch(symbols, onSelect) {
  allSymbols = symbols;
  onSelectCallback = onSelect;
}

function fuzzyMatch(query, text) {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  // Exact substring match gets highest score
  const idx = lower.indexOf(q);
  if (idx === 0) return 100;
  if (idx > 0) return 80;
  // Fuzzy: all chars must appear in order
  let qi = 0;
  let score = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      qi++;
      score += 1;
    }
  }
  if (qi === q.length) return score;
  return -1;
}

function renderResults(matches) {
  if (matches.length === 0) {
    results.style.display = "none";
    return;
  }
  results.style.display = "block";
  activeIndex = -1;
  results.innerHTML = matches.slice(0, 20).map((sym, i) => {
    const typeClass = `type-${sym.type}`;
    return `<div class="search-item" data-index="${i}">
      <span class="sym-type ${typeClass}">${sym.type}</span>
      <span class="sym-name">${escapeHtml(sym.name)}</span>
      <span class="sym-file">${sym.file}</span>
    </div>`;
  }).join("");

  results.querySelectorAll(".search-item").forEach((el, i) => {
    el.addEventListener("click", () => {
      selectResult(matches[i]);
    });
  });
}

function selectResult(sym) {
  results.style.display = "none";
  input.value = sym.name;
  input.blur();
  if (onSelectCallback) onSelectCallback(sym);
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

input.addEventListener("input", () => {
  const query = input.value.trim();
  if (query.length < 1) {
    results.style.display = "none";
    return;
  }
  const scored = [];
  for (const sym of allSymbols) {
    const score = fuzzyMatch(query, sym.name);
    if (score > 0) scored.push({ ...sym, _score: score });
  }
  scored.sort((a, b) => b._score - a._score);
  renderResults(scored);
});

input.addEventListener("keydown", (e) => {
  const items = results.querySelectorAll(".search-item");
  if (!items.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (activeIndex >= 0) {
      items[activeIndex].click();
    }
  } else if (e.key === "Escape") {
    results.style.display = "none";
    input.blur();
  }
});

input.addEventListener("focus", () => {
  if (input.value.trim().length > 0) {
    input.dispatchEvent(new Event("input"));
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest("#search-container")) {
    results.style.display = "none";
  }
});
