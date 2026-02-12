import * as THREE from "three";
import { getCamera, getRenderer, getControls } from "./scene.js";
import { getState, findSimNode, highlightConnections, resetHighlights } from "./graph.js";

const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const dragPlane = new THREE.Plane();
const dragOffset = new THREE.Vector3();

let selectedNode = null;
let hoveredNode = null;
let draggingNode = null;

export function getSelectedNode() { return selectedNode; }
export function getHoveredNode() { return hoveredNode; }

export function initInteraction() {
  const canvas = getRenderer().domElement;
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("click", handleClick);
}

function updateMouse(event) {
  const rect = getRenderer().domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function raycast() {
  raycaster.setFromCamera(mouse, getCamera());
  const meshes = Object.values(getState().nodeMeshes);
  const hits = raycaster.intersectObjects(meshes, false);
  return hits.length > 0 ? hits[0].object : null;
}

function handlePointerMove(event) {
  if (draggingNode) {
    handleDrag(event);
    return;
  }

  updateMouse(event);
  const mesh = raycast();

  if (mesh) {
    hoveredNode = mesh;
    getRenderer().domElement.style.cursor = "pointer";
    showTooltip(mesh, event);
    highlightConnections(mesh.userData.nodeId, 0.12);
  } else {
    hoveredNode = null;
    getRenderer().domElement.style.cursor = "default";
    hideTooltip();
    if (!selectedNode) resetHighlights();
  }
}

function handleDrag(event) {
  updateMouse(event);
  raycaster.setFromCamera(mouse, getCamera());

  const intersection = new THREE.Vector3();
  raycaster.ray.intersectPlane(dragPlane, intersection);
  intersection.add(dragOffset);

  const simNode = findSimNode(draggingNode.userData.nodeId);
  if (simNode) {
    simNode.fx = intersection.x;
    simNode.fy = intersection.y;
    if (getState().is3D) simNode.fz = intersection.z;
  }
}

function handlePointerDown(event) {
  updateMouse(event);
  const mesh = raycast();
  if (!mesh) return;

  draggingNode = mesh;
  getControls().enabled = false;

  const cameraDir = new THREE.Vector3();
  getCamera().getWorldDirection(cameraDir);
  dragPlane.setFromNormalAndCoplanarPoint(cameraDir.negate(), mesh.position);

  raycaster.setFromCamera(mouse, getCamera());
  const intersection = new THREE.Vector3();
  raycaster.ray.intersectPlane(dragPlane, intersection);
  dragOffset.copy(mesh.position).sub(intersection);

  const simNode = findSimNode(mesh.userData.nodeId);
  if (simNode) {
    simNode.fx = simNode.x;
    simNode.fy = simNode.y;
    if (getState().is3D) simNode.fz = simNode.z;
  }

  const { simulation } = getState();
  if (simulation) simulation.reheat();
}

function handlePointerUp() {
  if (!draggingNode) return;

  const simNode = findSimNode(draggingNode.userData.nodeId);
  if (simNode) {
    simNode.fx = null;
    simNode.fy = null;
    simNode.fz = null;
  }

  draggingNode = null;
  getControls().enabled = true;
}

function handleClick(event) {
  updateMouse(event);
  const mesh = raycast();

  if (mesh && mesh === selectedNode) {
    selectedNode = null;
    resetHighlights();
  } else if (mesh) {
    selectedNode = mesh;
    highlightConnections(mesh.userData.nodeId, 0.03);
    // Dispatch event so galaxy.js can navigate to explorer
    window.dispatchEvent(new CustomEvent("galaxyFileClick", {
      detail: { fileId: mesh.userData.nodeId },
    }));
  } else {
    selectedNode = null;
    resetHighlights();
  }
}

// ─── Tooltip ──────────────────────────────────────────────────────

const tooltip = document.getElementById("tooltip");

function showTooltip(mesh, event) {
  const data = mesh.userData.nodeData;

  tooltip.querySelector(".tt-file").textContent = data.id;
  tooltip.querySelector(".tt-meta").textContent =
    `${data.lines} lines · ${data.incomingCount} incoming refs · ${data.folder}/`;

  const exportsHtml = data.exports
    .slice(0, 10)
    .map((e) => `<span>${e.type === "default" ? "default" : e.name}</span>`)
    .join("");
  tooltip.querySelector(".tt-exports").innerHTML =
    exportsHtml ? `Exports: ${exportsHtml}` : "";

  tooltip.style.display = "block";
  positionTooltip(event.clientX, event.clientY);
}

function hideTooltip() {
  tooltip.style.display = "none";
}

function positionTooltip(x, y) {
  const offset = 14;
  tooltip.style.left = x + offset + "px";
  tooltip.style.top = y + offset + "px";

  const rect = tooltip.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    tooltip.style.left = x - rect.width - offset + "px";
  }
  if (rect.bottom > window.innerHeight) {
    tooltip.style.top = y - rect.height - offset + "px";
  }
}
