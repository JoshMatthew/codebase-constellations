import { SIMULATION } from "./constants.js";

/**
 * Force-directed graph simulation with folder clustering.
 * Nodes in the same folder attract toward their cluster centroid,
 * while different clusters repel each other, producing clean separated groups.
 */
export function createSimulation(nodes, edges, is3D) {
  const alpha = {
    current: 1,
    decay: SIMULATION.alphaDecay,
    min: SIMULATION.alphaMin,
  };

  const folderGroups = buildFolderGroups(nodes);

  initializePositions(nodes, folderGroups, is3D);
  indexEdges(nodes, edges);

  function tick() {
    if (alpha.current < alpha.min) return false;
    alpha.current *= 1 - alpha.decay;

    const k = alpha.current;
    applyClusterForces(nodes, folderGroups, k);
    applyNodeRepulsion(nodes, k);
    applyLinkAttraction(nodes, edges, k);
    applyCenterGravity(nodes, k);
    integrateVelocities(nodes, is3D);

    return true;
  }

  function reheat() {
    alpha.current = 1;
  }

  return { tick, reheat, alpha };
}

function buildFolderGroups(nodes) {
  const groups = {};
  for (let i = 0; i < nodes.length; i++) {
    const folder = nodes[i].folder;
    if (!groups[folder]) groups[folder] = [];
    groups[folder].push(i);
  }
  return groups;
}

/**
 * Initialize positions by placing each folder cluster at a distinct
 * spot on a large circle, with nodes scattered near their cluster center.
 * This gives the simulation a huge head start vs random placement.
 */
function initializePositions(nodes, folderGroups, is3D) {
  const folders = Object.keys(folderGroups);
  const count = folders.length;
  const clusterRadius = Math.max(300, count * 30);

  for (let fi = 0; fi < count; fi++) {
    const angle = (fi / count) * Math.PI * 2;
    const cx = Math.cos(angle) * clusterRadius;
    const cy = Math.sin(angle) * clusterRadius;
    const cz = is3D ? (Math.random() - 0.5) * clusterRadius * 0.2 : 0;

    const indices = folderGroups[folders[fi]];
    const spread = Math.max(20, Math.sqrt(indices.length) * 12);

    for (const idx of indices) {
      const n = nodes[idx];
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      n.x = cx + Math.cos(a) * r;
      n.y = cy + Math.sin(a) * r;
      n.z = is3D ? cz + (Math.random() - 0.5) * spread * 0.5 : 0;
      n.vx = 0;
      n.vy = 0;
      n.vz = 0;
      n.fx = null;
      n.fy = null;
      n.fz = null;
    }
  }
}

function indexEdges(nodes, edges) {
  for (const e of edges) {
    e._si = nodes.findIndex((n) => n.id === e.source);
    e._ti = nodes.findIndex((n) => n.id === e.target);
  }
}

/**
 * Two cluster forces in one pass:
 * 1) Pull each node toward its folder centroid (intra-cluster attraction)
 * 2) Push cluster centroids apart from each other (inter-cluster repulsion)
 */
function applyClusterForces(nodes, folderGroups, k) {
  const folders = Object.keys(folderGroups);

  // Compute centroids
  const centroids = [];
  for (const folder of folders) {
    const indices = folderGroups[folder];
    let cx = 0, cy = 0, cz = 0;
    for (const idx of indices) {
      cx += nodes[idx].x;
      cy += nodes[idx].y;
      cz += nodes[idx].z;
    }
    const n = indices.length;
    centroids.push({ x: cx / n, y: cy / n, z: cz / n, indices });
  }

  // Intra-cluster: pull nodes toward their centroid
  const pullStrength = SIMULATION.clusterStrength * k;
  for (const c of centroids) {
    for (const idx of c.indices) {
      const n = nodes[idx];
      n.vx += (c.x - n.x) * pullStrength;
      n.vy += (c.y - n.y) * pullStrength;
      n.vz += (c.z - n.z) * pullStrength;
    }
  }

  // Inter-cluster: push centroids apart
  const pushStrength = SIMULATION.clusterRepulsion * k;
  for (let i = 0; i < centroids.length; i++) {
    for (let j = i + 1; j < centroids.length; j++) {
      const a = centroids[i];
      const b = centroids[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const d2 = Math.max(1, dx * dx + dy * dy + dz * dz);
      const d = Math.sqrt(d2);
      const f = (-pushStrength * a.indices.length * b.indices.length) / d2;
      const fx = (f * dx) / d;
      const fy = (f * dy) / d;
      const fz = (f * dz) / d;

      // Apply to all nodes in each cluster
      for (const idx of a.indices) {
        nodes[idx].vx += fx;
        nodes[idx].vy += fy;
        nodes[idx].vz += fz;
      }
      for (const idx of b.indices) {
        nodes[idx].vx -= fx;
        nodes[idx].vy -= fy;
        nodes[idx].vz -= fz;
      }
    }
  }
}

/**
 * Node-level repulsion to prevent overlap within clusters.
 * Uses a distance cutoff to avoid O(n²) on distant nodes.
 */
function applyNodeRepulsion(nodes, k) {
  const cutoff = SIMULATION.repulsionCutoff;
  const cutoff2 = cutoff * cutoff;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const dz = nodes[j].z - nodes[i].z;
      const d2 = dx * dx + dy * dy + dz * dz;

      // Skip pairs that are far apart
      if (d2 > cutoff2) continue;

      const dist2 = Math.max(1, d2);
      const d = Math.sqrt(dist2);
      const f = (-SIMULATION.repulsion * k) / dist2;
      const fx = (f * dx) / d;
      const fy = (f * dy) / d;
      const fz = (f * dz) / d;

      nodes[i].vx += fx;
      nodes[i].vy += fy;
      nodes[i].vz += fz;
      nodes[j].vx -= fx;
      nodes[j].vy -= fy;
      nodes[j].vz -= fz;
    }
  }
}

function applyLinkAttraction(nodes, edges, k) {
  for (const e of edges) {
    if (e._si < 0 || e._ti < 0) continue;

    const s = nodes[e._si];
    const t = nodes[e._ti];
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dz = t.z - s.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

    // Shorter ideal distance for same-folder links, longer for cross-folder
    const idealDist = s.folder === t.folder
      ? SIMULATION.linkDistance * 0.6
      : SIMULATION.linkDistance * 1.5;

    const f = (d - idealDist) * SIMULATION.linkStrength * k;
    const fx = (f * dx) / d;
    const fy = (f * dy) / d;
    const fz = (f * dz) / d;

    s.vx += fx;
    s.vy += fy;
    s.vz += fz;
    t.vx -= fx;
    t.vy -= fy;
    t.vz -= fz;
  }
}

function applyCenterGravity(nodes, k) {
  const strength = SIMULATION.centerStrength * k;
  for (const n of nodes) {
    n.vx -= n.x * strength;
    n.vy -= n.y * strength;
    n.vz -= n.z * strength;
  }
}

function integrateVelocities(nodes, is3D) {
  const d = SIMULATION.damping;
  const maxV = SIMULATION.maxVelocity;
  for (const n of nodes) {
    if (n.fx != null) { n.x = n.fx; n.vx = 0; }
    else {
      n.vx *= d;
      n.vx = Math.max(-maxV, Math.min(maxV, n.vx));
      n.x += n.vx;
    }

    if (n.fy != null) { n.y = n.fy; n.vy = 0; }
    else {
      n.vy *= d;
      n.vy = Math.max(-maxV, Math.min(maxV, n.vy));
      n.y += n.vy;
    }

    if (is3D) {
      if (n.fz != null) { n.z = n.fz; n.vz = 0; }
      else {
        n.vz *= d;
        n.vz = Math.max(-maxV, Math.min(maxV, n.vz));
        n.z += n.vz;
      }
    } else {
      n.z = 0;
      n.vz = 0;
    }
  }
}
