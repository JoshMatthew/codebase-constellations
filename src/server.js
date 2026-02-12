const express = require("express");
const path = require("path");
const fs = require("fs");
const { analyzeCodebase, analyzeSymbols } = require("./parser");

const app = express();
const PORT = process.env.PORT || 42069;

app.use(express.static(path.join(__dirname, "..", "public")));
app.use(express.json());

let cachedGraph = null;
let cachedTarget = null;
let cachedSymbols = null;

app.post("/api/analyze", async (req, res) => {
  const targetDir = req.body.path || process.cwd();
  const resolved = path.resolve(targetDir);

  try {
    console.log(`Analyzing: ${resolved}`);
    const graph = await analyzeCodebase(resolved);
    cachedGraph = graph;
    cachedTarget = resolved;
    cachedSymbols = await analyzeSymbols(resolved);
    console.log(
      `Done: ${graph.nodes.length} files, ${graph.edges.length} edges`,
    );
    res.json(graph);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/symbols", async (req, res) => {
  if (cachedSymbols && cachedTarget) {
    return res.json(cachedSymbols);
  }
  if (!cachedTarget) {
    return res.status(404).json({ error: "No codebase analyzed yet. POST to /api/analyze first." });
  }
  try {
    cachedSymbols = await analyzeSymbols(cachedTarget);
    res.json(cachedSymbols);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/file", (req, res) => {
  if (!cachedTarget) {
    return res.status(404).json({ error: "No codebase analyzed yet." });
  }
  const relPath = req.query.path;
  if (!relPath) {
    return res.status(400).json({ error: "Missing ?path= parameter" });
  }
  const fullPath = path.resolve(cachedTarget, relPath);
  // Ensure the resolved path is inside the target directory
  if (!fullPath.startsWith(path.resolve(cachedTarget))) {
    return res.status(403).json({ error: "Path outside of analyzed directory" });
  }
  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    res.json({ path: relPath, content });
  } catch (err) {
    res.status(404).json({ error: "File not found: " + relPath });
  }
});

app.get("/api/graph", (req, res) => {
  if (cachedGraph) {
    res.json(cachedGraph);
  } else {
    res
      .status(404)
      .json({ error: "No graph loaded. POST to /api/analyze first." });
  }
});

// Auto-analyze if a target was passed via CLI
const targetArg = process.argv[2];
if (targetArg) {
  const resolved = path.resolve(targetArg);
  console.log(`Auto-analyzing: ${resolved}`);
  analyzeCodebase(resolved).then(async (graph) => {
    cachedGraph = graph;
    cachedTarget = resolved;
    console.log(
      `Ready: ${graph.nodes.length} files, ${graph.edges.length} edges`,
    );
    try {
      cachedSymbols = await analyzeSymbols(resolved);
      console.log(`Symbols: ${cachedSymbols.symbols.length} symbols, ${cachedSymbols.edges.length} relationships`);
    } catch (err) {
      console.error("Symbol analysis failed:", err.message);
    }
  });
}

app.listen(PORT, () => {
  console.log(`Code Visualizer running at http://localhost:${PORT}`);
});
