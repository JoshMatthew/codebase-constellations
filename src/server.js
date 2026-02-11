const express = require("express");
const path = require("path");
const { analyzeCodebase } = require("./parser");

const app = express();
const PORT = process.env.PORT || 42069;

app.use(express.static(path.join(__dirname, "..", "public")));
app.use(express.json());

let cachedGraph = null;
let cachedTarget = null;

app.post("/api/analyze", async (req, res) => {
  const targetDir = req.body.path || process.cwd();
  const resolved = path.resolve(targetDir);

  try {
    console.log(`Analyzing: ${resolved}`);
    const graph = await analyzeCodebase(resolved);
    cachedGraph = graph;
    cachedTarget = resolved;
    console.log(
      `Done: ${graph.nodes.length} files, ${graph.edges.length} edges`,
    );
    res.json(graph);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
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
  analyzeCodebase(resolved).then((graph) => {
    cachedGraph = graph;
    cachedTarget = resolved;
    console.log(
      `Ready: ${graph.nodes.length} files, ${graph.edges.length} edges`,
    );
  });
}

app.listen(PORT, () => {
  console.log(`Code Visualizer running at http://localhost:${PORT}`);
});
