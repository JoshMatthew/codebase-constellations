import * as THREE from "three";
import { NODE, EDGE, THEME, folderColor } from "./constants.js";
import { createSimulation } from "./simulation.js";
import { getScene } from "./scene.js";

const EDGE_KEY_SEP = "|||";

const state = {
  graphData: null,
  nodeMeshes: {},
  nodeLabels: {},
  edgeLines: {},
  edgeCurveOffsets: {},
  simNodes: [],
  simEdges: [],
  simulation: null,
  is3D: true,
};

export function getState() { return state; }

export function buildGraph(data, filters) {
  clearScene();

  state.graphData = data;
  const { nodes, edges } = applyFilters(data, filters);
  if (nodes.length === 0) return;

  createNodeMeshes(nodes);
  createNodeLabels(nodes);

  state.simNodes = nodes.map((n) => ({ ...n }));
  state.simEdges = edges.map((e) => ({ ...e }));

  computeCurveOffsets(state.simEdges);
  createEdgeCurves(state.simEdges);

  state.simulation = createSimulation(state.simNodes, state.simEdges, state.is3D);

  return { nodeCount: nodes.length, edgeCount: edges.length };
}

export function setIs3D(value) {
  state.is3D = value;
}

export function tickSimulation(dimmedIds) {
  if (!state.simulation) return;
  state.simulation.tick();

  syncNodePositions(dimmedIds);
  syncEdgeCurves(dimmedIds);
}

export function findSimNode(nodeId) {
  return state.simNodes.find((n) => n.id === nodeId);
}

export function getConnectedIds(nodeId) {
  const connected = new Set([nodeId]);
  for (const e of state.simEdges) {
    if (e.source === nodeId) connected.add(e.target);
    if (e.target === nodeId) connected.add(e.source);
  }
  return connected;
}

export function highlightConnections(nodeId, dimOpacity) {
  const connected = getConnectedIds(nodeId);

  for (const [id, mesh] of Object.entries(state.nodeMeshes)) {
    if (connected.has(id)) {
      mesh.material.opacity = NODE.opacity;
      mesh.material.emissiveIntensity =
        id === nodeId ? NODE.emissiveHighlightSelf : NODE.emissiveHighlightNeighbor;
    } else {
      mesh.material.opacity = dimOpacity;
      mesh.material.emissiveIntensity = NODE.emissiveDimmed;
    }
  }

  for (const line of Object.values(state.edgeLines)) {
    const e = line.userData.edge;
    if (e.source === nodeId || e.target === nodeId) {
      line.material.opacity = EDGE.highlightOpacity;
      line.material.color.set(THEME.accentHighlight);
    } else {
      line.material.opacity = dimOpacity * 0.3;
      line.material.color.set(THEME.accent);
    }
  }
}

export function resetHighlights() {
  const maxWeight = Math.max(1, ...state.simEdges.map((e) => e.weight));

  for (const mesh of Object.values(state.nodeMeshes)) {
    mesh.material.opacity = NODE.opacity;
    mesh.material.emissiveIntensity = NODE.emissive;
  }
  for (const line of Object.values(state.edgeLines)) {
    const e = line.userData.edge;
    line.material.opacity = EDGE.baseOpacity + (e.weight / maxWeight) * EDGE.opacityRange;
    line.material.color.set(THEME.accent);
  }
}

// ─── Internal ─────────────────────────────────────────────────────

function clearScene() {
  const scene = getScene();
  for (const m of Object.values(state.nodeMeshes)) scene.remove(m);
  for (const l of Object.values(state.nodeLabels)) scene.remove(l);
  for (const l of Object.values(state.edgeLines)) scene.remove(l);
  state.nodeMeshes = {};
  state.nodeLabels = {};
  state.edgeLines = {};
  state.edgeCurveOffsets = {};
}

function applyFilters(data, filters) {
  const nodes = data.nodes.filter((n) => {
    if (filters.folders.size > 0 && !filters.folders.has(n.folder)) return false;
    if (filters.extensions.size > 0 && !filters.extensions.has(n.extension)) return false;
    return true;
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = data.edges.filter((e) => {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return false;
    if (e.weight < filters.minWeight) return false;
    return true;
  });

  return { nodes, edges };
}

const sharedSphereGeo = new THREE.SphereGeometry(1, NODE.segments, NODE.segments);

function createNodeMeshes(nodes) {
  const scene = getScene();
  const maxIncoming = Math.max(1, ...nodes.map((n) => n.incomingCount));

  for (const node of nodes) {
    const size = NODE.minSize + (node.incomingCount / maxIncoming) * NODE.maxSizeBonus;
    const color = folderColor(node.folder);

    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: NODE.emissive,
      transparent: true,
      opacity: NODE.opacity,
    });

    const mesh = new THREE.Mesh(sharedSphereGeo, material);
    mesh.scale.setScalar(size);
    mesh.userData = { nodeId: node.id, nodeData: node, baseSize: size, baseColor: color };

    scene.add(mesh);
    state.nodeMeshes[node.id] = mesh;
  }
}

function createNodeLabels(nodes) {
  const scene = getScene();

  for (const node of nodes) {
    // Show just the filename without extension, truncated
    const basename = node.id.split("/").pop().replace(/\.[^.]+$/, "");
    const label = basename.length > 10 ? basename.slice(0, 9) + "..." : basename;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = 256;
    canvas.height = 64;

    ctx.font = "bold 32px sans-serif";
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(spriteMat);
    const mesh = state.nodeMeshes[node.id];
    const size = mesh ? mesh.userData.baseSize : 2;
    sprite.scale.set(size * 4, size * 1, 1);
    sprite.userData = { nodeId: node.id };

    scene.add(sprite);
    state.nodeLabels[node.id] = sprite;
  }
}

// ─── Curved Edges ─────────────────────────────────────────────────

/**
 * Compute perpendicular offset indices for each edge so edges sharing
 * a node fan out instead of stacking. Edges from the same node get
 * spread symmetrically: offsets like 0, -1, +1, -2, +2, ...
 */
function computeCurveOffsets(edges) {
  state.edgeCurveOffsets = {};

  // Group edges by each endpoint they touch
  const nodeEdges = {};
  for (const edge of edges) {
    const key = edge.source + EDGE_KEY_SEP + edge.target;
    if (!nodeEdges[edge.source]) nodeEdges[edge.source] = [];
    if (!nodeEdges[edge.target]) nodeEdges[edge.target] = [];
    nodeEdges[edge.source].push(key);
    nodeEdges[edge.target].push(key);
  }

  // For each edge, its offset is the max "fan index" across its two endpoints
  const edgeSlots = {};
  for (const nodeId in nodeEdges) {
    const keys = nodeEdges[nodeId];
    if (keys.length <= 1) continue;

    for (let i = 0; i < keys.length; i++) {
      // Spread: 0, 1, -1, 2, -2, ...
      const slot = i === 0 ? 0 : (i % 2 === 1 ? Math.ceil(i / 2) : -Math.ceil(i / 2));
      const existing = edgeSlots[keys[i]];
      // Keep the larger absolute offset so the fan is determined by the busier endpoint
      if (existing === undefined || Math.abs(slot) > Math.abs(existing)) {
        edgeSlots[keys[i]] = slot;
      }
    }
  }

  state.edgeCurveOffsets = edgeSlots;
}

function createEdgeCurves(edges) {
  const scene = getScene();
  const maxWeight = Math.max(1, ...edges.map((e) => e.weight));
  const segments = EDGE.curveSegments;

  for (const edge of edges) {
    if (!state.nodeMeshes[edge.source] || !state.nodeMeshes[edge.target]) continue;

    const opacity = EDGE.baseOpacity + (edge.weight / maxWeight) * EDGE.opacityRange;

    // Allocate enough vertices for the curve segments
    const vertexCount = segments + 1;
    const positions = new Float32Array(vertexCount * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: THEME.accent,
      transparent: true,
      opacity,
      linewidth: 1,
    });

    const line = new THREE.Line(geometry, material);
    line.userData = { edge };

    scene.add(line);
    state.edgeLines[edge.source + EDGE_KEY_SEP + edge.target] = line;
  }
}

// Reusable vectors to avoid per-frame allocations
const _src = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _ctrl = new THREE.Vector3();
const _up = new THREE.Vector3(0, 0, 1);
const _pt = new THREE.Vector3();

function syncEdgeCurves(dimmedIds) {
  const hasDimming = dimmedIds && dimmedIds.size > 0;
  const segments = EDGE.curveSegments;

  for (const edge of state.simEdges) {
    const key = edge.source + EDGE_KEY_SEP + edge.target;
    const line = state.edgeLines[key];
    if (!line) continue;

    const sMesh = state.nodeMeshes[edge.source];
    const tMesh = state.nodeMeshes[edge.target];
    if (!sMesh || !tMesh) continue;

    _src.copy(sMesh.position);
    _tgt.copy(tMesh.position);

    // Compute the curve control point
    _mid.addVectors(_src, _tgt).multiplyScalar(0.5);
    _dir.subVectors(_tgt, _src);
    const edgeLength = _dir.length() || 1;

    // Perpendicular vector — cross with up, fallback if parallel
    _perp.crossVectors(_dir, _up);
    if (_perp.lengthSq() < 0.001) {
      _perp.crossVectors(_dir, new THREE.Vector3(1, 0, 0));
    }
    _perp.normalize();

    // Offset based on fan slot
    const slot = state.edgeCurveOffsets[key] || 0;
    const offsetAmount = slot * EDGE.curvature * edgeLength;
    _ctrl.copy(_mid).addScaledVector(_perp, offsetAmount);

    // Sample the quadratic bezier into the position buffer
    const pos = line.geometry.attributes.position.array;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      quadraticBezier(_src, _ctrl, _tgt, t, _pt);
      const idx = i * 3;
      pos[idx] = _pt.x;
      pos[idx + 1] = _pt.y;
      pos[idx + 2] = _pt.z;
    }
    line.geometry.attributes.position.needsUpdate = true;

    if (hasDimming && (dimmedIds.has(edge.source) || dimmedIds.has(edge.target))) {
      line.material.opacity = EDGE.thresholdDimmedOpacity;
    }
  }
}

function quadraticBezier(p0, p1, p2, t, target) {
  const inv = 1 - t;
  target.x = inv * inv * p0.x + 2 * inv * t * p1.x + t * t * p2.x;
  target.y = inv * inv * p0.y + 2 * inv * t * p1.y + t * t * p2.y;
  target.z = inv * inv * p0.z + 2 * inv * t * p1.z + t * t * p2.z;
  return target;
}

function syncNodePositions(dimmedIds) {
  const hasDimming = dimmedIds && dimmedIds.size > 0;

  for (const simNode of state.simNodes) {
    const mesh = state.nodeMeshes[simNode.id];
    if (!mesh) continue;

    mesh.position.set(simNode.x, simNode.y, simNode.z);

    const label = state.nodeLabels[simNode.id];
    if (label) {
      const offset = mesh.userData.baseSize + 1.5;
      label.position.set(simNode.x, simNode.y + offset, simNode.z);
    }

    if (hasDimming) {
      const isDimmed = dimmedIds.has(simNode.id);
      mesh.material.opacity = isDimmed ? NODE.opacityDimmed : NODE.opacity;
      mesh.material.emissiveIntensity = isDimmed ? NODE.emissiveThresholdDimmed : NODE.emissive;
      if (label) label.material.opacity = isDimmed ? 0.05 : 1.0;
    }
  }
}
