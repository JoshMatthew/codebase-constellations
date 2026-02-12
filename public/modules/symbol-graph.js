const TYPE_COLORS = {
  function: "#06b6d4",
  class: "#8b5cf6",
  variable: "#10b981",
  method: "#6366f1",
  type: "#f59e0b",
  interface: "#f59e0b",
  enum: "#ec4899",
  branch: "#f59e0b",
};

const TYPE_BADGES = {
  function: "fn",
  class: "C",
  variable: "var",
  method: "m",
  type: "T",
  interface: "I",
  enum: "E",
};

const EDGE_TYPE_COLORS = {
  calls: "#06b6d4",
  imports: "#8b5cf6",
  extends: "#f59e0b",
  condition: "#f59e0b",
};

const NODE_PAD_X = 24;
const NODE_H = 56;
const NODE_H_PARAMS = 70;
const BRANCH_H = 32;
const NODE_RADIUS = 6;
const COL_GAP = 120;
const ROW_GAP = 28;
const PIN_RADIUS = 3.5;
const MIN_NODE_W = 140;
const GRID_SIZE = 20;
const MAX_DEPTH = 2;
const MAX_NODES = 40;

let canvas, ctx;
let layoutNodes = [];
let layoutEdges = [];
let hoveredNode = null;
let onClickCallback = null;
let animFrame = null;
let animRunning = false;
let transform = { x: 0, y: 0, scale: 1 };
let isPanning = false;
let dragNode = null;
let dragOffset = { x: 0, y: 0 };
let lastMouse = { x: 0, y: 0 };
let mouseDownPos = { x: 0, y: 0 };
let measureCtx = null;

export function initSymbolGraph(canvasEl, onClick) {
  canvas = canvasEl;
  ctx = canvas.getContext("2d");
  onClickCallback = onClick;
  const offscreen = document.createElement("canvas");
  measureCtx = offscreen.getContext("2d");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("click", onCanvasClick);
}

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  if (layoutNodes.length > 0) draw();
}

function formatParams(params) {
  if (!params || !Array.isArray(params) || params.length === 0) return null;
  return "(" + params.join(", ") + ")";
}

function measureNodeWidth(node, isCenter) {
  const font = isCenter ? "bold 12px 'SF Mono', monospace" : "11px 'SF Mono', monospace";
  measureCtx.font = font;
  const nameW = measureCtx.measureText(node.name || "").width;
  let paramsW = 0;
  const paramsStr = formatParams(node.params);
  if (paramsStr) {
    measureCtx.font = "9px 'SF Mono', monospace";
    paramsW = measureCtx.measureText(paramsStr).width;
  }
  return Math.max(MIN_NODE_W, Math.max(nameW, paramsW) + NODE_PAD_X * 2);
}

function measureBranchWidth(text) {
  measureCtx.font = "9px 'SF Mono', monospace";
  const display = text.length > 28 ? text.slice(0, 25) + "..." : text;
  return Math.max(100, measureCtx.measureText(display).width + 40);
}

function getNodeH(node) {
  if (node.type === "branch") return BRANCH_H;
  return formatParams(node.params) ? NODE_H_PARAMS : NODE_H;
}

// ── Main render entry ──

export function renderGraph(centerSymbol, allSymbols, allEdges) {
  const symbolMap = new Map(allSymbols.map(s => [s.id, s]));

  // ── Step 1: BFS traversal (multi-level) ──
  const nodeLayers = new Map();
  nodeLayers.set(centerSymbol.id, 0);
  let frontier = [centerSymbol.id];

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const next = [];
    for (const id of frontier) {
      const myLayer = nodeLayers.get(id);
      for (const edge of allEdges) {
        if (nodeLayers.size >= MAX_NODES) break;
        if (edge.source === id && !nodeLayers.has(edge.target) && symbolMap.has(edge.target)) {
          nodeLayers.set(edge.target, myLayer + 1);
          next.push(edge.target);
        } else if (edge.target === id && !nodeLayers.has(edge.source) && symbolMap.has(edge.source)) {
          nodeLayers.set(edge.source, myLayer - 1);
          next.push(edge.source);
        }
      }
    }
    frontier = next;
  }

  if (nodeLayers.size === 0) {
    document.getElementById("graph-empty").style.display = "block";
    stopAnimLoop();
    ctx.clearRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
    return;
  }
  document.getElementById("graph-empty").style.display = "none";

  // ── Step 2: Collect edges between visited nodes ──
  const graphEdges = allEdges.filter(e => nodeLayers.has(e.source) && nodeLayers.has(e.target));

  // ── Step 3: Insert branch nodes for conditions ──
  const allGraphNodes = [];
  layoutEdges = [];
  let branchCount = 0;

  // Collect unique layers between which conditions exist
  for (const edge of graphEdges) {
    if (edge.conditions && edge.conditions.length > 0 && edge.source !== edge.target) {
      const cond = edge.conditions[0];
      const branchId = `__br_${branchCount++}`;
      const srcLayer = nodeLayers.get(edge.source);
      const tgtLayer = nodeLayers.get(edge.target);

      // Branch node label
      const label = cond.branch === "else" ? `!${cond.condition}` : cond.condition;

      allGraphNodes.push({
        id: branchId,
        name: label,
        type: "branch",
        branch: cond.branch,
        fromId: edge.source,
        toId: edge.target,
        _isBranch: true,
      });

      // Assign branch to intermediate layer (shift target layers to make room)
      const branchLayer = srcLayer < tgtLayer ? srcLayer + 0.5 : srcLayer - 0.5;
      nodeLayers.set(branchId, branchLayer);

      layoutEdges.push({ source: edge.source, target: branchId, type: "condition" });
      layoutEdges.push({ source: branchId, target: edge.target, type: edge.type });
    } else {
      layoutEdges.push(edge);
    }
  }

  // Add real symbol nodes
  for (const [id] of nodeLayers) {
    const sym = symbolMap.get(id);
    if (sym) {
      allGraphNodes.push({ ...sym, _isBranch: false });
    }
  }
  // Add branch nodes that are already in allGraphNodes
  // (they were pushed above)

  // ── Step 4: Build integer layers (remap fractional to integer) ──
  const uniqueLayerVals = [...new Set([...nodeLayers.values()])].sort((a, b) => a - b);
  const layerRemap = new Map();
  uniqueLayerVals.forEach((v, i) => layerRemap.set(v, i));

  const intLayers = new Map();
  for (const [id, layer] of nodeLayers) {
    intLayers.set(id, layerRemap.get(layer));
  }

  // Organize into layer buckets
  const layerBuckets = new Map();
  for (const [id, layer] of intLayers) {
    if (!layerBuckets.has(layer)) layerBuckets.set(layer, []);
    layerBuckets.get(layer).push(id);
  }
  const sortedLayers = [...layerBuckets.keys()].sort((a, b) => a - b);

  // ── Step 5: Barycenter ordering ──
  const nodeOrder = new Map();
  for (const layer of sortedLayers) {
    layerBuckets.get(layer).forEach((id, i) => nodeOrder.set(id, i));
  }

  // Use all graph edges (including through branch nodes) for ordering
  const allEdgesForOrdering = layoutEdges;

  for (let iter = 0; iter < 8; iter++) {
    const direction = iter % 2 === 0 ? sortedLayers : [...sortedLayers].reverse();
    for (const layer of direction) {
      const bucket = layerBuckets.get(layer);
      const barycenters = bucket.map(id => {
        const neighbors = [];
        for (const edge of allEdgesForOrdering) {
          if (edge.source === id && intLayers.has(edge.target) && intLayers.get(edge.target) !== layer) {
            neighbors.push(nodeOrder.get(edge.target) ?? 0);
          }
          if (edge.target === id && intLayers.has(edge.source) && intLayers.get(edge.source) !== layer) {
            neighbors.push(nodeOrder.get(edge.source) ?? 0);
          }
        }
        if (neighbors.length === 0) return nodeOrder.get(id) ?? 0;
        return neighbors.reduce((a, b) => a + b, 0) / neighbors.length;
      });

      const indexed = bucket.map((id, i) => ({ id, bc: barycenters[i] }));
      indexed.sort((a, b) => a.bc - b.bc);
      const reordered = indexed.map(item => item.id);
      layerBuckets.set(layer, reordered);
      reordered.forEach((id, i) => nodeOrder.set(id, i));
    }
  }

  // ── Step 6: Position nodes ──
  const nodeMap = new Map(allGraphNodes.map(n => [n.id, n]));

  // Compute max width per layer
  const layerWidths = new Map();
  for (const layer of sortedLayers) {
    let maxW = 0;
    for (const id of layerBuckets.get(layer)) {
      const node = nodeMap.get(id);
      if (!node) continue;
      const isCenter = id === centerSymbol.id;
      const w = node._isBranch ? measureBranchWidth(node.name) : measureNodeWidth(node, isCenter);
      maxW = Math.max(maxW, w);
    }
    layerWidths.set(layer, maxW);
  }

  // Compute x positions
  let currentX = 0;
  const layerX = new Map();
  for (const layer of sortedLayers) {
    layerX.set(layer, currentX);
    currentX += layerWidths.get(layer) + COL_GAP;
  }

  // Position nodes in each layer
  layoutNodes = [];
  for (const layer of sortedLayers) {
    const bucket = layerBuckets.get(layer);
    const colW = layerWidths.get(layer);
    const x = layerX.get(layer);

    // Compute total height
    let totalH = 0;
    const heights = [];
    for (const id of bucket) {
      const node = nodeMap.get(id);
      if (!node) { heights.push(NODE_H); continue; }
      const h = getNodeH(node);
      heights.push(h);
      totalH += h;
    }
    totalH += (bucket.length - 1) * ROW_GAP;

    let y = -totalH / 2; // center around y=0

    for (let i = 0; i < bucket.length; i++) {
      const id = bucket[i];
      const node = nodeMap.get(id);
      if (!node) continue;
      const isCenter = id === centerSymbol.id;
      const nh = heights[i];
      const nw = node._isBranch ? measureBranchWidth(node.name) : measureNodeWidth(node, isCenter);

      layoutNodes.push({
        ...node,
        x: x + (colW - nw) / 2,
        y,
        w: nw,
        h: nh,
        isCenter,
        layer,
      });

      y += nh + ROW_GAP;
    }
  }

  // ── Step 7: Auto-fit to view ──
  fitToView();

  stopAnimLoop();
  startAnimLoop();
}

function fitToView() {
  if (layoutNodes.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of layoutNodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }

  const w = canvas.width / window.devicePixelRatio;
  const h = canvas.height / window.devicePixelRatio;
  const pad = 50;

  const graphW = maxX - minX || 1;
  const graphH = maxY - minY || 1;

  const scaleX = (w - pad * 2) / graphW;
  const scaleY = (h - pad * 2) / graphH;
  const scale = Math.min(1.5, Math.min(scaleX, scaleY));

  transform.scale = scale;
  transform.x = w / 2 - (minX + graphW / 2) * scale;
  transform.y = h / 2 - (minY + graphH / 2) * scale;
}

// ── Drawing ──

function startAnimLoop() {
  if (animRunning) return;
  animRunning = true;
  function loop() {
    if (!animRunning) return;
    draw();
    animFrame = requestAnimationFrame(loop);
  }
  loop();
}

function stopAnimLoop() {
  animRunning = false;
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
}

function draw() {
  const w = canvas.width / window.devicePixelRatio;
  const h = canvas.height / window.devicePixelRatio;
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.scale, transform.scale);

  drawGrid(w, h);

  const posMap = new Map(layoutNodes.map(n => [n.id, n]));
  const now = performance.now();

  // Draw edges + animated flow dots
  for (let i = 0; i < layoutEdges.length; i++) {
    const edge = layoutEdges[i];
    const src = posMap.get(edge.source);
    const tgt = posMap.get(edge.target);
    if (!src || !tgt) continue;
    drawWire(src, tgt, edge, now, i);
  }

  // Draw nodes (branches first, then regular on top)
  const branches = layoutNodes.filter(n => n._isBranch);
  const regular = layoutNodes.filter(n => !n._isBranch);
  for (const node of branches) drawBranchNode(node);
  for (const node of regular) drawNode(node);

  ctx.restore();
}

function drawGrid(w, h) {
  const x0 = -transform.x / transform.scale;
  const y0 = -transform.y / transform.scale;
  const x1 = (w - transform.x) / transform.scale;
  const y1 = (h - transform.y) / transform.scale;

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.03;

  const startX = Math.floor(x0 / GRID_SIZE) * GRID_SIZE;
  const startY = Math.floor(y0 / GRID_SIZE) * GRID_SIZE;

  ctx.beginPath();
  for (let x = startX; x <= x1; x += GRID_SIZE) {
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
  }
  for (let y = startY; y <= y1; y += GRID_SIZE) {
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawWire(src, tgt, edge, now, idx) {
  const color = EDGE_TYPE_COLORS[edge.type] || "#444";
  const leftToRight = src.x + src.w / 2 < tgt.x + tgt.w / 2;

  let srcX, srcY, tgtX, tgtY;
  if (leftToRight) {
    srcX = src.x + src.w;
    srcY = src.y + src.h / 2;
    tgtX = tgt.x;
    tgtY = tgt.y + tgt.h / 2;
  } else {
    srcX = src.x;
    srcY = src.y + src.h / 2;
    tgtX = tgt.x + tgt.w;
    tgtY = tgt.y + tgt.h / 2;
  }

  // Pins
  drawPin(srcX, srcY, color);
  drawPin(tgtX, tgtY, color);

  // Bezier control points
  const dist = Math.abs(tgtX - srcX);
  const cpOffset = Math.max(50, dist * 0.4);
  const dir = leftToRight ? 1 : -1;
  const cp1x = srcX + dir * cpOffset;
  const cp1y = srcY;
  const cp2x = tgtX - dir * cpOffset;
  const cp2y = tgtY;

  // Wire
  ctx.beginPath();
  ctx.moveTo(srcX, srcY);
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tgtX, tgtY);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Arrow at target
  const at = 0.92;
  const atx = bezierTangent(srcX, cp1x, cp2x, tgtX, at);
  const aty = bezierTangent(srcY, cp1y, cp2y, tgtY, at);
  const angle = Math.atan2(aty, atx);

  ctx.beginPath();
  ctx.moveTo(tgtX, tgtY);
  ctx.lineTo(tgtX - Math.cos(angle - 0.3) * 9, tgtY - Math.sin(angle - 0.3) * 9);
  ctx.lineTo(tgtX - Math.cos(angle + 0.3) * 9, tgtY - Math.sin(angle + 0.3) * 9);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.globalAlpha = 1;

  // ── Flowing electricity dot ──
  const speed = 0.0004;           // how fast the dot travels (lower = slower)
  const phase = (idx * 0.37) % 1; // stagger dots so they don't sync
  const t = ((now * speed) + phase) % 1;

  const dotX = bezierPos(srcX, cp1x, cp2x, tgtX, t);
  const dotY = bezierPos(srcY, cp1y, cp2y, tgtY, t);

  // Glow
  ctx.beginPath();
  ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.15;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Dot core
  ctx.beginPath();
  ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawPin(x, y, color) {
  ctx.beginPath();
  ctx.arc(x, y, PIN_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawBranchNode(node) {
  const { x, y, w: nw, h: nh, name, branch } = node;
  const color = TYPE_COLORS.branch;
  const isHovered = hoveredNode === node;

  if (isHovered) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
  }

  // Diamond background
  ctx.beginPath();
  roundRect(ctx, x, y, nw, nh, 4);
  ctx.fillStyle = "#161218";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  // Diamond icon
  const dSize = 6;
  const dX = x + 12;
  const dY = y + nh / 2;
  ctx.beginPath();
  ctx.moveTo(dX, dY - dSize);
  ctx.lineTo(dX + dSize, dY);
  ctx.lineTo(dX, dY + dSize);
  ctx.lineTo(dX - dSize, dY);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.fill();
  ctx.globalAlpha = 1;

  // "?" in diamond
  ctx.font = "bold 7px 'SF Mono', monospace";
  ctx.fillStyle = "#161218";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", dX, dY);

  // Condition text
  const label = name.length > 28 ? name.slice(0, 25) + "..." : name;
  ctx.font = "9px 'SF Mono', monospace";
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, dX + dSize + 6, dY);
  ctx.globalAlpha = 1;
}

function drawNode(node) {
  const color = TYPE_COLORS[node.type] || "#888";
  const isHovered = hoveredNode === node;
  const { x, y, w: nw, h: nh, isCenter } = node;

  if (isCenter || isHovered) {
    ctx.shadowColor = color;
    ctx.shadowBlur = isCenter ? 20 : 12;
  }

  // Card
  ctx.beginPath();
  roundRect(ctx, x, y, nw, nh, NODE_RADIUS);
  ctx.fillStyle = isCenter ? "#161628" : "#10101c";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = isCenter ? 2 : 1.2;
  ctx.stroke();

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  // Header accent
  ctx.beginPath();
  ctx.moveTo(x + NODE_RADIUS, y + 0.5);
  ctx.lineTo(x + nw - NODE_RADIUS, y + 0.5);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Badge
  const badge = TYPE_BADGES[node.type] || "?";
  ctx.font = "bold 9px 'SF Mono', monospace";
  const badgeW = ctx.measureText(badge).width + 10;
  const badgeH = 16;
  const badgeX = x + 8;
  const badgeY = y + 6;

  ctx.beginPath();
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 3);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.15;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(badge, badgeX + 5, badgeY + 3);

  // Name
  const paramsStr = formatParams(node.params);
  const nameY = paramsStr ? y + nh / 2 - 3 : y + nh / 2 + 2;
  ctx.font = `${isCenter ? "bold 12px" : "11px"} 'SF Mono', monospace`;
  ctx.fillStyle = isHovered || isCenter ? "#e8e8f0" : "#b0b0c0";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(node.name, x + nw / 2, nameY);

  // Params
  if (paramsStr) {
    ctx.font = "9px 'SF Mono', monospace";
    ctx.fillStyle = "#606070";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(paramsStr, x + nw / 2, nameY + 10);
  }
}

// ── Math ──

function bezierPos(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function bezierTangent(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Hit testing ──

function screenToWorld(sx, sy) {
  return {
    x: (sx - transform.x) / transform.scale,
    y: (sy - transform.y) / transform.scale,
  };
}

function getNodeAt(sx, sy) {
  const { x, y } = screenToWorld(sx, sy);
  for (let i = layoutNodes.length - 1; i >= 0; i--) {
    const n = layoutNodes[i];
    if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) return n;
  }
  return null;
}

// ── Interaction ──

function onMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (dragNode) {
    const world = screenToWorld(mx, my);
    dragNode.x = world.x - dragOffset.x;
    dragNode.y = world.y - dragOffset.y;
    requestDraw();
    return;
  }

  if (isPanning) {
    transform.x += mx - lastMouse.x;
    transform.y += my - lastMouse.y;
    lastMouse = { x: mx, y: my };
    requestDraw();
    return;
  }

  const node = getNodeAt(mx, my);
  if (node !== hoveredNode) {
    hoveredNode = node;
    requestDraw();
  }
  canvas.style.cursor = node ? "grab" : "default";
}

function onMouseDown(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  lastMouse = { x: mx, y: my };

  mouseDownPos = { x: mx, y: my };

  const node = getNodeAt(mx, my);
  if (node) {
    dragNode = node;
    const world = screenToWorld(mx, my);
    dragOffset.x = world.x - node.x;
    dragOffset.y = world.y - node.y;
    canvas.style.cursor = "grabbing";
  } else {
    isPanning = true;
  }
}

function onMouseUp() {
  if (dragNode) {
    canvas.style.cursor = "grab";
    dragNode = null;
  }
  isPanning = false;
}

function onWheel(e) {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newScale = Math.max(0.1, Math.min(5, transform.scale * delta));

  transform.x = mx - (mx - transform.x) * (newScale / transform.scale);
  transform.y = my - (my - transform.y) * (newScale / transform.scale);
  transform.scale = newScale;
  requestDraw();
}

function onCanvasClick(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  // Skip if this was a drag
  const dx = mx - mouseDownPos.x;
  const dy = my - mouseDownPos.y;
  if (dx * dx + dy * dy > 25) return;

  const node = getNodeAt(mx, my);
  if (node && !node.isCenter && !node._isBranch && onClickCallback) {
    onClickCallback(node);
  }
}

function requestDraw() {
  // Animation loop handles continuous redraws; no-op when running
}

export function destroySymbolGraph() {
  stopAnimLoop();
  layoutNodes = [];
  layoutEdges = [];
}
