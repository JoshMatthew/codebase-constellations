import { initSymbolGraph, renderGraph, destroySymbolGraph } from "./modules/symbol-graph.js";
import { initSearch } from "./modules/search.js";
import { showFile, clearCodePanel } from "./modules/code-panel.js";

let symbolData = null; // { symbols, edges, files }
let currentSymbol = null;
let navHistory = [];
let galaxyLoaded = false;

// ── Boot ──
init();

async function init() {
  initSymbolGraph(document.getElementById("graph-canvas"), onGraphNodeClick);
  setupResizeHandle();
  setupViewToggle();
  setupPathForm();
  setupKeyboardShortcuts();
  await loadSymbols();
}

async function loadSymbols() {
  try {
    const res = await fetch("/api/symbols");
    if (!res.ok) return;
    symbolData = await res.json();
    initSearch(symbolData.symbols, onSymbolSelect);
    document.getElementById("stats").textContent =
      `${symbolData.symbols.length} symbols  ·  ${symbolData.edges.length} relationships  ·  ${symbolData.files.length} files`;
    document.getElementById("graph-empty").querySelector("p").textContent =
      "Search for a symbol to explore";
  } catch {
    document.getElementById("graph-empty").querySelector("p").textContent =
      "No codebase analyzed yet. Use the path input to analyze one.";
  }
}

function onSymbolSelect(sym) {
  navigateTo(sym);
}

function onGraphNodeClick(sym) {
  navigateTo(sym);
}

function navigateTo(sym) {
  if (currentSymbol) {
    navHistory.push(currentSymbol);
  }
  currentSymbol = sym;
  renderCurrentSymbol();
}

function renderCurrentSymbol() {
  if (!currentSymbol || !symbolData) return;

  // Update graph
  renderGraph(currentSymbol, symbolData.symbols, symbolData.edges);

  // Update code panel
  showFile(currentSymbol.file, currentSymbol.startLine, currentSymbol.endLine);

  // Update breadcrumbs
  updateBreadcrumbs();
}

function updateBreadcrumbs() {
  const bc = document.getElementById("breadcrumbs");
  if (!currentSymbol) {
    bc.innerHTML = "";
    return;
  }

  const parts = [];

  // File path parts
  const fileParts = currentSymbol.file.split("/");
  fileParts.forEach((part, i) => {
    const isLast = i === fileParts.length - 1;
    parts.push(`<span class="breadcrumb-item" data-file="${fileParts.slice(0, i + 1).join("/")}">${part}</span>`);
    if (!isLast || currentSymbol.name) {
      parts.push(`<span class="breadcrumb-sep">/</span>`);
    }
  });

  // Symbol name
  if (currentSymbol.name.includes(".")) {
    const [className, methodName] = currentSymbol.name.split(".");
    parts.push(`<span class="breadcrumb-item" data-symbol="${currentSymbol.file}::${className}">${className}</span>`);
    parts.push(`<span class="breadcrumb-sep">.</span>`);
    parts.push(`<span class="breadcrumb-item current">${methodName}</span>`);
  } else {
    parts.push(`<span class="breadcrumb-item current">${currentSymbol.name}</span>`);
  }

  bc.innerHTML = parts.join("");

  // Click handlers for breadcrumbs
  bc.querySelectorAll(".breadcrumb-item[data-symbol]").forEach(el => {
    el.addEventListener("click", () => {
      const symId = el.dataset.symbol;
      const sym = symbolData.symbols.find(s => s.id === symId);
      if (sym) navigateTo(sym);
    });
  });

  bc.querySelectorAll(".breadcrumb-item[data-file]").forEach(el => {
    el.addEventListener("click", () => {
      const filePath = el.dataset.file;
      // Find first symbol in this file
      const sym = symbolData.symbols.find(s => s.file === filePath);
      if (sym) navigateTo(sym);
    });
  });
}

// ── Panel resize ──
function setupResizeHandle() {
  const handle = document.getElementById("resize-handle");
  const graphPanel = document.getElementById("graph-panel");
  let startX, startWidth;

  handle.addEventListener("mousedown", (e) => {
    startX = e.clientX;
    startWidth = graphPanel.offsetWidth;
    document.addEventListener("mousemove", onResize);
    document.addEventListener("mouseup", stopResize);
    e.preventDefault();
  });

  function onResize(e) {
    const newWidth = Math.max(200, Math.min(window.innerWidth - 200, startWidth + (e.clientX - startX)));
    graphPanel.style.width = newWidth + "px";
    // Trigger canvas resize
    const canvas = document.getElementById("graph-canvas");
    const rect = graphPanel.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
  }

  function stopResize() {
    document.removeEventListener("mousemove", onResize);
    document.removeEventListener("mouseup", stopResize);
  }
}

// ── View toggle (Explorer / Galaxy Map) ──
function setupViewToggle() {
  const btnExplorer = document.getElementById("btn-explorer");
  const btnGalaxy = document.getElementById("btn-galaxy");
  const explorerView = document.getElementById("explorer-view");
  const galaxyView = document.getElementById("galaxy-view");
  const searchContainer = document.getElementById("search-container");
  const pathForm = document.getElementById("path-form");
  const breadcrumbs = document.getElementById("breadcrumbs");
  const sidebar = document.getElementById("sidebar");
  const sidebarToggle = document.getElementById("sidebar-toggle");

  btnExplorer.addEventListener("click", () => {
    btnExplorer.classList.add("active");
    btnGalaxy.classList.remove("active");
    explorerView.style.display = "flex";
    galaxyView.style.display = "none";
    searchContainer.style.display = "block";
    pathForm.style.display = "none";
    breadcrumbs.style.display = "flex";
    sidebar.style.display = "none";
    sidebarToggle.style.display = "none";
  });

  btnGalaxy.addEventListener("click", async () => {
    btnGalaxy.classList.add("active");
    btnExplorer.classList.remove("active");
    explorerView.style.display = "none";
    galaxyView.style.display = "block";
    searchContainer.style.display = "none";
    pathForm.style.display = "flex";
    breadcrumbs.style.display = "none";
    sidebar.style.display = "block";
    sidebarToggle.style.display = "flex";

    if (!galaxyLoaded) {
      galaxyLoaded = true;
      // Dynamically load the galaxy app
      const { initGalaxy } = await import("./galaxy.js");
      initGalaxy();
    }
  });
}

// ── Path form (for analyze) ──
function setupPathForm() {
  document.getElementById("path-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pathInput = document.getElementById("path-input").value.trim();
    if (!pathInput) return;

    const loading = document.getElementById("loading");
    const btn = document.getElementById("analyze-btn");
    loading.style.display = "block";
    btn.disabled = true;

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathInput }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Reload symbols
      await loadSymbols();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      loading.style.display = "none";
      btn.disabled = false;
    }
  });
}

// ── Keyboard shortcuts ──
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Ctrl+K or Cmd+K to focus search
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      document.getElementById("search-input").focus();
    }
    // Backspace to go back (when not in input)
    if (e.key === "Backspace" && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      if (navHistory.length > 0) {
        currentSymbol = navHistory.pop();
        renderCurrentSymbol();
      }
    }
  });
}
