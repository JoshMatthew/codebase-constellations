const TYPE_COLORS = {
  function: "#06b6d4",
  class: "#8b5cf6",
  variable: "#10b981",
  method: "#6366f1",
  type: "#f59e0b",
  interface: "#f59e0b",
  enum: "#ec4899",
};

const EDGE_TYPE_COLORS = {
  calls: "#06b6d4",
  imports: "#8b5cf6",
  extends: "#f59e0b",
};

let canvas, ctx;
let nodes = [];
let edges = [];
let simNodes = [];
let hoveredNode = null;
let onClickCallback = null;
let animFrame = null;
let transform = { x: 0, y: 0, scale: 1 };
let isDragging = false;
let isPanning = false;
let dragNode = null;
let lastMouse = { x: 0, y: 0 };

export function initSymbolGraph(canvasEl, onClick) {
  canvas = canvasEl;
  ctx = canvas.getContext("2d");
  onClickCallback = onClick;
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
}

export function renderGraph(centerSymbol, allSymbols, allEdges) {
  // Find related symbols (1 degree from center)
  const related = new Set();
  const relevantEdges = [];

  if (centerSymbol) {
    related.add(centerSymbol.id);
    for (const edge of allEdges) {
      if (edge.source === centerSymbol.id) {
        related.add(edge.target);
        relevantEdges.push(edge);
      } else if (edge.target === centerSymbol.id) {
        related.add(edge.source);
        relevantEdges.push(edge);
      }
    }
  }

  const symbolMap = new Map(allSymbols.map(s => [s.id, s]));
  nodes = [];
  edges = relevantEdges;

  for (const id of related) {
    const sym = symbolMap.get(id);
    if (sym) nodes.push(sym);
  }

  // If no center, show nothing
  if (nodes.length === 0) {
    document.getElementById("graph-empty").style.display = "block";
    if (animFrame) cancelAnimationFrame(animFrame);
    ctx.clearRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
    return;
  }

  document.getElementById("graph-empty").style.display = "none";

  // Initialize positions — center node in middle, others around it
  const w = canvas.width / window.devicePixelRatio;
  const h = canvas.height / window.devicePixelRatio;
  const cx = w / 2;
  const cy = h / 2;

  simNodes = nodes.map((sym, i) => {
    if (sym.id === centerSymbol?.id) {
      return { ...sym, x: cx, y: cy, vx: 0, vy: 0, fixed: true };
    }
    const angle = (i / Math.max(nodes.length - 1, 1)) * Math.PI * 2;
    const radius = Math.min(w, h) * 0.3;
    return {
      ...sym,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      fixed: false,
    };
  });

  // Reset transform
  transform = { x: 0, y: 0, scale: 1 };

  // Run simulation
  let alpha = 1;
  if (animFrame) cancelAnimationFrame(animFrame);

  function tick() {
    animFrame = requestAnimationFrame(tick);

    if (alpha > 0.01) {
      simulateForces(alpha);
      alpha *= 0.96;
    }

    draw();
  }
  tick();
}

function simulateForces(alpha) {
  const nodeMap = new Map(simNodes.map(n => [n.id, n]));

  // Repulsion between all nodes
  for (let i = 0; i < simNodes.length; i++) {
    for (let j = i + 1; j < simNodes.length; j++) {
      const a = simNodes[i];
      const b = simNodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = 3000 / (dist * dist) * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.fixed) { a.vx -= fx; a.vy -= fy; }
      if (!b.fixed) { b.vx += fx; b.vy += fy; }
    }
  }

  // Attraction along edges
  for (const edge of edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const targetDist = 150;
    const force = (dist - targetDist) * 0.05 * alpha;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!source.fixed) { source.vx += fx; source.vy += fy; }
    if (!target.fixed) { target.vx -= fx; target.vy -= fy; }
  }

  // Center gravity
  const w = canvas.width / window.devicePixelRatio;
  const h = canvas.height / window.devicePixelRatio;
  for (const n of simNodes) {
    if (n.fixed) continue;
    n.vx += (w / 2 - n.x) * 0.002 * alpha;
    n.vy += (h / 2 - n.y) * 0.002 * alpha;
  }

  // Apply velocity with damping
  for (const n of simNodes) {
    if (n.fixed) continue;
    n.vx *= 0.6;
    n.vy *= 0.6;
    n.x += n.vx;
    n.y += n.vy;
  }
}

function draw() {
  const w = canvas.width / window.devicePixelRatio;
  const h = canvas.height / window.devicePixelRatio;
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.scale, transform.scale);

  const nodeMap = new Map(simNodes.map(n => [n.id, n]));

  // Draw edges
  for (const edge of edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;

    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.strokeStyle = EDGE_TYPE_COLORS[edge.type] || "#444";
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Arrow
    const angle = Math.atan2(target.y - source.y, target.x - source.x);
    const nodeRadius = getNodeRadius(target);
    const ax = target.x - Math.cos(angle) * (nodeRadius + 4);
    const ay = target.y - Math.sin(angle) * (nodeRadius + 4);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - Math.cos(angle - 0.4) * 8, ay - Math.sin(angle - 0.4) * 8);
    ctx.lineTo(ax - Math.cos(angle + 0.4) * 8, ay - Math.sin(angle + 0.4) * 8);
    ctx.closePath();
    ctx.fillStyle = EDGE_TYPE_COLORS[edge.type] || "#444";
    ctx.globalAlpha = 0.4;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Edge label
    const mx = (source.x + target.x) / 2;
    const my = (source.y + target.y) / 2;
    ctx.font = "9px 'SF Mono', monospace";
    ctx.fillStyle = "#555";
    ctx.textAlign = "center";
    ctx.fillText(edge.type, mx, my - 4);
  }

  // Draw nodes
  for (const node of simNodes) {
    const radius = getNodeRadius(node);
    const color = TYPE_COLORS[node.type] || "#888";
    const isHovered = hoveredNode === node;
    const isCenter = node.fixed;

    // Glow for center/hovered
    if (isCenter || isHovered) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.15;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = isCenter ? color : "#1a1a2e";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = isCenter ? 2.5 : 1.5;
    ctx.stroke();

    // Type badge
    ctx.font = "bold 8px 'SF Mono', monospace";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const badge = node.type === "function" ? "f" : node.type === "class" ? "C" : node.type === "variable" ? "v" : node.type === "method" ? "m" : node.type === "type" || node.type === "interface" ? "T" : "?";
    if (!isCenter) ctx.fillText(badge, node.x, node.y);

    // Label
    ctx.font = `${isCenter ? "bold " : ""}11px 'SF Mono', monospace`;
    ctx.fillStyle = isHovered || isCenter ? "#e0e0e0" : "#888";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(node.name, node.x, node.y + radius + 4);
  }

  ctx.restore();
}

function getNodeRadius(node) {
  if (node.fixed) return 18;
  return node.type === "class" ? 14 : 11;
}

function screenToWorld(sx, sy) {
  return {
    x: (sx - transform.x) / transform.scale,
    y: (sy - transform.y) / transform.scale,
  };
}

function getNodeAt(sx, sy) {
  const { x, y } = screenToWorld(sx, sy);
  for (let i = simNodes.length - 1; i >= 0; i--) {
    const n = simNodes[i];
    const r = getNodeRadius(n) + 4;
    if ((n.x - x) ** 2 + (n.y - y) ** 2 < r * r) return n;
  }
  return null;
}

function onMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (isPanning) {
    transform.x += mx - lastMouse.x;
    transform.y += my - lastMouse.y;
    lastMouse = { x: mx, y: my };
    return;
  }

  if (dragNode) {
    const world = screenToWorld(mx, my);
    dragNode.x = world.x;
    dragNode.y = world.y;
    return;
  }

  const node = getNodeAt(mx, my);
  hoveredNode = node;
  canvas.style.cursor = node ? "pointer" : "default";
}

function onMouseDown(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  lastMouse = { x: mx, y: my };

  const node = getNodeAt(mx, my);
  if (node && !node.fixed) {
    dragNode = node;
    isDragging = true;
  } else {
    isPanning = true;
  }
}

function onMouseUp() {
  isPanning = false;
  dragNode = null;
  isDragging = false;
}

function onWheel(e) {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newScale = Math.max(0.2, Math.min(5, transform.scale * delta));

  // Zoom towards mouse position
  transform.x = mx - (mx - transform.x) * (newScale / transform.scale);
  transform.y = my - (my - transform.y) * (newScale / transform.scale);
  transform.scale = newScale;
}

function onCanvasClick(e) {
  if (isDragging) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const node = getNodeAt(mx, my);
  if (node && !node.fixed && onClickCallback) {
    onClickCallback(node);
  }
}

export function destroySymbolGraph() {
  if (animFrame) cancelAnimationFrame(animFrame);
  simNodes = [];
  nodes = [];
  edges = [];
}
