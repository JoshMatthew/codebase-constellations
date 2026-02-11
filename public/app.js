import { CAMERA } from "./modules/constants.js";
import { initScene, getScene, getCamera, getRenderer, getControls } from "./modules/scene.js";
import { buildGraph, tickSimulation, setIs3D, getState } from "./modules/graph.js";
import { initInteraction, getSelectedNode, getHoveredNode } from "./modules/interaction.js";
import { buildFilterUI, getFilters, getDimmedNodeIds } from "./modules/filters.js";
import { analyzeCodebase, fetchCachedGraph } from "./modules/api.js";

initScene(document.getElementById("canvas-container"));
initInteraction();
animate();
loadCachedGraph();
bindUIControls();

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
  document.getElementById("stats").textContent =
    `${result.nodeCount} files  ·  ${result.edgeCount} connections`;
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

function bindUIControls() {
  bindAnalyzeForm();
  bindViewToggle();
  bindSidebarToggle();
}

function bindAnalyzeForm() {
  document.getElementById("path-form").addEventListener("submit", async (e) => {
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
}

function bindViewToggle() {
  const btn3d = document.getElementById("btn-3d");
  const btn2d = document.getElementById("btn-2d");
  const camera = getCamera();
  const controls = getControls();

  btn3d.addEventListener("click", () => {
    setIs3D(true);
    btn3d.classList.add("active");
    btn2d.classList.remove("active");
    camera.position.set(0, 0, CAMERA.defaultZ);
    controls.enableRotate = true;
    rebuildGraph();
  });

  btn2d.addEventListener("click", () => {
    setIs3D(false);
    btn2d.classList.add("active");
    btn3d.classList.remove("active");
    camera.position.set(0, 0, CAMERA.defaultZ);
    camera.up.set(0, 1, 0);
    controls.enableRotate = false;
    rebuildGraph();
  });
}

function bindSidebarToggle() {
  const sidebar = document.getElementById("sidebar");
  const btn = document.getElementById("sidebar-toggle");

  btn.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    btn.classList.toggle("open");
    btn.textContent = sidebar.classList.contains("collapsed") ? "▶" : "◀";
  });
}
