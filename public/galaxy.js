import { CAMERA } from "./modules/constants.js";
import { initScene, getScene, getCamera, getRenderer, getControls } from "./modules/scene.js";
import { buildGraph, tickSimulation, setIs3D, getState } from "./modules/graph.js";
import { initInteraction, getSelectedNode, getHoveredNode } from "./modules/interaction.js";
import { buildFilterUI, getFilters, getDimmedNodeIds } from "./modules/filters.js";
import { analyzeCodebase, fetchCachedGraph } from "./modules/api.js";

let initialized = false;

export function initGalaxy() {
  if (initialized) return;
  initialized = true;

  initScene(document.getElementById("canvas-container"));
  initInteraction();
  animate();
  loadCachedGraph();
  bindGalaxyControls();

  // Galaxy file click → switch to explorer view
  window.addEventListener("galaxyFileClick", (e) => {
    const fileId = e.detail?.fileId;
    if (!fileId) return;

    // Switch to explorer view
    document.getElementById("btn-explorer").click();

    // Tell explorer to show this file's symbols
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("showFileSymbols", {
        detail: { fileId },
      }));
    }, 50);
  });
}

function animate() {
  requestAnimationFrame(animate);
  const skipDimming = getSelectedNode() || getHoveredNode();
  tickSimulation(skipDimming ? null : getDimmedNodeIds());
  getControls().update();
  getRenderer().render(getScene(), getCamera());
}

function rebuildGraph() {
  const data = getState().graphData;
  if (data) buildGraph(data, getFilters());
}

function updateStats(result) {
  if (!result) return;
  // Only update stats if in galaxy mode
  const statsEl = document.getElementById("stats");
  if (statsEl) {
    statsEl.textContent = `${result.nodeCount} files  ·  ${result.edgeCount} connections`;
  }
}

function loadData(data) {
  buildFilterUI(data, rebuildGraph);
  updateStats(buildGraph(data, getFilters()));
}

async function loadCachedGraph() {
  try {
    const data = await fetchCachedGraph();
    if (data?.nodes) loadData(data);
  } catch { /* no cached graph */ }
}

function bindGalaxyControls() {
  // Path form handler
  const pathForm = document.getElementById("path-form");
  pathForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pathInput = document.getElementById("path-input").value.trim();
    if (!pathInput) return;

    const loading = document.getElementById("loading");
    const btn = document.getElementById("analyze-btn");
    loading.style.display = "block";
    btn.disabled = true;

    try {
      loadData(await analyzeCodebase(pathInput));
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      loading.style.display = "none";
      btn.disabled = false;
    }
  });

  // Sidebar toggle
  const sidebar = document.getElementById("sidebar");
  const sidebarBtn = document.getElementById("sidebar-toggle");
  sidebarBtn.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    sidebarBtn.classList.toggle("open");
    sidebarBtn.textContent = sidebar.classList.contains("open") ? "\u25C0" : "\u25B6";
  });
}
