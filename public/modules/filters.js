import { getState } from "./graph.js";

const activeFilters = {
  folders: new Set(),
  extensions: new Set(),
  minRefs: 0,
  minWeight: 0,
};

export function getFilters() {
  return activeFilters;
}

/**
 * Returns the set of node IDs that fall below the reference threshold.
 * These get visually dimmed but remain in the graph.
 */
export function getDimmedNodeIds() {
  const dimmed = new Set();
  if (activeFilters.minRefs <= 0) return dimmed;

  for (const n of getState().simNodes) {
    if (n.incomingCount < activeFilters.minRefs) {
      dimmed.add(n.id);
    }
  }
  return dimmed;
}

/**
 * Builds the sidebar filter controls and wires up their change handlers.
 * Calls `onFilterChange` whenever a filter value changes.
 */
export function buildFilterUI(data, onFilterChange) {
  buildCheckboxGroup("folder-filters", data.folders, data.nodes, "folder", (selected) => {
    activeFilters.folders = selected;
    onFilterChange();
  });

  buildCheckboxGroup("ext-filters", data.extensions, data.nodes, "extension", (selected) => {
    activeFilters.extensions = selected;
    onFilterChange();
  });

  bindSlider("ref-slider", "ref-val", {
    max: Math.max(20, ...data.nodes.map((n) => n.incomingCount)),
    onChange(value) {
      activeFilters.minRefs = value;
      onFilterChange();
    },
  });

  bindSlider("weight-slider", "weight-val", {
    max: Math.max(10, ...data.edges.map((e) => e.weight)),
    onChange(value) {
      activeFilters.minWeight = value;
      onFilterChange();
    },
  });
}

// ─── Internal ─────────────────────────────────────────────────────

function buildCheckboxGroup(containerId, items, nodes, nodeKey, onChange) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const counts = {};
  for (const n of nodes) {
    counts[n[nodeKey]] = (counts[n[nodeKey]] || 0) + 1;
  }

  const dataAttr = nodeKey === "folder" ? "data-folder" : "data-ext";

  for (const item of items) {
    const label = document.createElement("label");
    label.className = "filter-item";
    label.innerHTML = `
      <input type="checkbox" ${dataAttr}="${item}" checked>
      <span>${item || "(root)"}</span>
      <span class="count">${counts[item] || 0}</span>`;
    container.appendChild(label);
  }

  container.addEventListener("change", () => {
    const checked = container.querySelectorAll("input:checked");
    const all = container.querySelectorAll("input");

    if (checked.length === all.length) {
      onChange(new Set());
    } else {
      const attr = nodeKey === "folder" ? "folder" : "ext";
      onChange(new Set([...checked].map((c) => c.dataset[attr])));
    }
  });
}

function bindSlider(sliderId, displayId, { max, onChange }) {
  const slider = document.getElementById(sliderId);
  const display = document.getElementById(displayId);

  slider.max = max;
  slider.addEventListener("input", () => {
    const value = parseInt(slider.value);
    display.textContent = value;
    onChange(value);
  });
}
