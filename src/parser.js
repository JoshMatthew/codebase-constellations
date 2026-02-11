const fs = require("fs");
const path = require("path");
const { glob } = require("glob");
const babelParser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];
const ALL_EXTENSIONS = [...EXTENSIONS, ".html", ".htm"];

const IGNORE_DIRS = [
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".git",
  "vendor",
  "__pycache__",
];

function parseFile(filePath) {
  const code = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath);
  const isTS = ext === ".ts" || ext === ".tsx";
  const isJSX = ext === ".jsx" || ext === ".tsx";

  const plugins = [
    "decorators-legacy",
    "classProperties",
    "classPrivateProperties",
    "classPrivateMethods",
    "exportDefaultFrom",
    "exportNamespaceFrom",
    "dynamicImport",
    "nullishCoalescingOperator",
    "optionalChaining",
    "topLevelAwait",
  ];

  if (isTS) plugins.push("typescript");
  if (isJSX || !isTS) plugins.push("jsx");

  try {
    const ast = babelParser.parse(code, {
      sourceType: "unambiguous",
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      allowSuperOutsideMethod: true,
      plugins,
    });
    return ast;
  } catch {
    return null;
  }
}

function extractExports(ast, filePath) {
  const exports = [];

  traverse(ast, {
    ExportNamedDeclaration(nodePath) {
      const decl = nodePath.node.declaration;
      if (decl) {
        if (decl.type === "FunctionDeclaration" && decl.id) {
          exports.push({ name: decl.id.name, type: "function" });
        } else if (decl.type === "ClassDeclaration" && decl.id) {
          exports.push({ name: decl.id.name, type: "class" });
        } else if (decl.type === "VariableDeclaration") {
          for (const d of decl.declarations) {
            if (d.id && d.id.name) {
              exports.push({ name: d.id.name, type: "variable" });
            }
          }
        } else if (decl.type === "TSTypeAliasDeclaration" && decl.id) {
          exports.push({ name: decl.id.name, type: "type" });
        } else if (decl.type === "TSInterfaceDeclaration" && decl.id) {
          exports.push({ name: decl.id.name, type: "interface" });
        } else if (decl.type === "TSEnumDeclaration" && decl.id) {
          exports.push({ name: decl.id.name, type: "enum" });
        }
      }
      if (nodePath.node.specifiers) {
        for (const spec of nodePath.node.specifiers) {
          if (spec.exported) {
            exports.push({ name: spec.exported.name, type: "re-export" });
          }
        }
      }
    },

    ExportDefaultDeclaration(nodePath) {
      const decl = nodePath.node.declaration;
      const name =
        decl.id?.name || decl.name || "default";
      exports.push({ name, type: "default" });
    },

    // CommonJS: module.exports = ... or exports.X = ...
    AssignmentExpression(nodePath) {
      const left = nodePath.node.left;
      if (
        left.type === "MemberExpression" &&
        left.object.name === "module" &&
        left.property.name === "exports"
      ) {
        const right = nodePath.node.right;
        if (right.type === "Identifier") {
          exports.push({ name: right.name, type: "cjs-default" });
        } else if (right.type === "ObjectExpression") {
          for (const prop of right.properties) {
            if (prop.key?.name) {
              exports.push({ name: prop.key.name, type: "cjs" });
            }
          }
        } else {
          exports.push({ name: "default", type: "cjs-default" });
        }
      } else if (
        left.type === "MemberExpression" &&
        left.object.name === "exports" &&
        left.property.name
      ) {
        exports.push({ name: left.property.name, type: "cjs" });
      }
    },
  });

  return exports;
}

function extractImports(ast, filePath, rootDir) {
  const imports = [];

  traverse(ast, {
    ImportDeclaration(nodePath) {
      const source = nodePath.node.source.value;
      const resolved = resolveImport(source, filePath, rootDir);
      if (!resolved) return;

      const specifiers = nodePath.node.specifiers.map((s) => {
        if (s.type === "ImportDefaultSpecifier") return { name: s.local.name, type: "default" };
        if (s.type === "ImportNamespaceSpecifier") return { name: s.local.name, type: "namespace" };
        return { name: (s.imported?.name || s.local.name), type: "named" };
      });

      imports.push({ source, resolved, specifiers });
    },

    CallExpression(nodePath) {
      const node = nodePath.node;
      // require('...')
      if (
        node.callee.name === "require" &&
        node.arguments.length === 1 &&
        node.arguments[0].type === "StringLiteral"
      ) {
        const source = node.arguments[0].value;
        const resolved = resolveImport(source, filePath, rootDir);
        if (resolved) {
          imports.push({ source, resolved, specifiers: [{ name: "default", type: "require" }] });
        }
      }
      // dynamic import('...')
      if (
        node.callee.type === "Import" &&
        node.arguments.length >= 1 &&
        node.arguments[0].type === "StringLiteral"
      ) {
        const source = node.arguments[0].value;
        const resolved = resolveImport(source, filePath, rootDir);
        if (resolved) {
          imports.push({ source, resolved, specifiers: [{ name: "default", type: "dynamic" }] });
        }
      }
    },
  });

  return imports;
}

// Extract top-level declarations (functions, classes, vars) that could be global
function extractGlobalDeclarations(ast) {
  const declarations = [];

  traverse(ast, {
    FunctionDeclaration(nodePath) {
      // Only top-level or program-level functions
      if (nodePath.parent.type === "Program") {
        declarations.push({ name: nodePath.node.id.name, type: "function" });
      }
    },
    ClassDeclaration(nodePath) {
      if (nodePath.parent.type === "Program" && nodePath.node.id) {
        declarations.push({ name: nodePath.node.id.name, type: "class" });
      }
    },
    VariableDeclaration(nodePath) {
      if (nodePath.parent.type === "Program") {
        for (const d of nodePath.node.declarations) {
          if (d.id && d.id.name) {
            // Skip common short/generic names to avoid noise
            if (d.id.name.length < 3) continue;
            // Skip variables initialized with require() — those are module imports
            if (
              d.init &&
              d.init.type === "CallExpression" &&
              d.init.callee &&
              d.init.callee.name === "require"
            ) continue;
            // Skip destructured require: const { x } = require(...)
            if (d.id.type === "ObjectPattern") continue;
            declarations.push({ name: d.id.name, type: "variable" });
          }
        }
      }
    },
  });

  return declarations;
}

// Collect all identifiers referenced in a file
function extractReferencedIdentifiers(ast) {
  const refs = new Set();

  traverse(ast, {
    Identifier(nodePath) {
      // Skip declaration sites — only count usage sites
      const parent = nodePath.parent;
      if (
        parent.type === "FunctionDeclaration" && parent.id === nodePath.node ||
        parent.type === "ClassDeclaration" && parent.id === nodePath.node ||
        parent.type === "VariableDeclarator" && parent.id === nodePath.node ||
        parent.type === "ImportSpecifier" ||
        parent.type === "ImportDefaultSpecifier" ||
        parent.type === "ImportNamespaceSpecifier" ||
        parent.type === "ExportSpecifier"
      ) {
        return;
      }
      // Skip property access names (obj.prop — skip prop)
      if (parent.type === "MemberExpression" && parent.property === nodePath.node && !parent.computed) {
        return;
      }
      refs.add(nodePath.node.name);
    },
    CallExpression(nodePath) {
      if (nodePath.node.callee.type === "Identifier") {
        refs.add(nodePath.node.callee.name);
      }
    },
  });

  return refs;
}

function resolveImport(source, fromFile, rootDir) {
  // Skip external packages
  if (!source.startsWith(".") && !source.startsWith("/")) {
    return null;
  }

  const dir = path.dirname(fromFile);
  let resolved = path.resolve(dir, source);

  // Try exact match, then with extensions, then as directory index
  for (const candidate of getCandidates(resolved)) {
    if (fs.existsSync(candidate)) {
      return path.relative(rootDir, candidate);
    }
  }

  return null;
}

function getCandidates(base) {
  const candidates = [base];
  for (const ext of EXTENSIONS) {
    candidates.push(base + ext);
  }
  // Directory index files
  for (const ext of EXTENSIONS) {
    candidates.push(path.join(base, "index" + ext));
  }
  return candidates;
}

// Parse HTML files for <script src="..."> references
function extractHtmlScriptRefs(filePath, rootDir) {
  const html = fs.readFileSync(filePath, "utf-8");
  const refs = [];
  const srcRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = srcRegex.exec(html)) !== null) {
    const src = match[1];
    // Skip external URLs
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("//")) continue;
    // Resolve relative to the HTML file
    const dir = path.dirname(filePath);
    const resolved = path.resolve(dir, src);
    if (fs.existsSync(resolved)) {
      refs.push(path.relative(rootDir, resolved));
    }
  }
  return refs;
}

async function analyzeCodebase(rootDir) {
  const ignorePattern = IGNORE_DIRS.map((d) => `**/${d}/**`);
  const patterns = ALL_EXTENSIONS.map((ext) => `**/*${ext}`);

  const files = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: rootDir,
      ignore: ignorePattern,
      absolute: false,
    });
    files.push(...matches);
  }

  // Deduplicate
  const uniqueFiles = [...new Set(files)];

  const fileData = {};

  // First pass: collect exports from all files
  for (const file of uniqueFiles) {
    const fullPath = path.join(rootDir, file);
    const ext = path.extname(file);

    // HTML files get special treatment
    if (ext === ".html" || ext === ".htm") {
      const code = fs.readFileSync(fullPath, "utf-8");
      const lines = code.split("\n").length;
      const scriptRefs = extractHtmlScriptRefs(fullPath, rootDir);
      fileData[file] = { exports: [], imports: [], lines, globals: [], referencedIds: new Set(), htmlScriptRefs: scriptRefs };
      continue;
    }

    const ast = parseFile(fullPath);
    if (!ast) {
      fileData[file] = { exports: [], imports: [], lines: 0 };
      continue;
    }

    const code = fs.readFileSync(fullPath, "utf-8");
    const lines = code.split("\n").length;
    const exports = extractExports(ast, fullPath);

    fileData[file] = { exports, imports: [], lines };
  }

  // Second pass: collect imports and global declarations (JS/TS only)
  for (const file of uniqueFiles) {
    const ext = path.extname(file);
    if (ext === ".html" || ext === ".htm") continue;

    const fullPath = path.join(rootDir, file);
    const ast = parseFile(fullPath);
    if (!ast) continue;

    const imports = extractImports(ast, fullPath, rootDir);
    fileData[file].imports = imports;
    fileData[file].globals = extractGlobalDeclarations(ast);
    fileData[file].referencedIds = extractReferencedIdentifiers(ast);
  }

  // Build graph
  const nodes = [];
  const edgeMap = {};

  for (const file of uniqueFiles) {
    const data = fileData[file];
    // Merge exports and globals for the tooltip (deduplicate)
    const allExports = [...data.exports];
    const exportNames = new Set(allExports.map((e) => e.name));
    for (const g of (data.globals || [])) {
      if (!exportNames.has(g.name)) allExports.push(g);
    }

    nodes.push({
      id: file,
      exports: allExports,
      lines: data.lines,
      folder: path.dirname(file),
      extension: path.extname(file),
      incomingCount: 0, // filled below
    });
  }

  // Build edges from explicit imports
  for (const file of uniqueFiles) {
    const data = fileData[file];
    for (const imp of data.imports) {
      if (!imp.resolved || !fileData[imp.resolved]) continue;

      const key = [file, imp.resolved].sort().join("|||");
      if (!edgeMap[key]) {
        edgeMap[key] = { source: file, target: imp.resolved, weight: 0, references: [] };
      }
      edgeMap[key].weight += imp.specifiers.length;
      edgeMap[key].references.push(
        ...imp.specifiers.map((s) => s.name)
      );
    }
  }

  // Build edges from HTML <script src="..."> references
  for (const file of uniqueFiles) {
    const data = fileData[file];
    if (!data.htmlScriptRefs) continue;
    for (const scriptFile of data.htmlScriptRefs) {
      if (!fileData[scriptFile]) continue;
      const key = [file, scriptFile].sort().join("|||");
      if (!edgeMap[key]) {
        edgeMap[key] = { source: file, target: scriptFile, weight: 0, references: [] };
      }
      edgeMap[key].weight += 1;
      edgeMap[key].references.push("script-src");
    }
  }

  const edges = Object.values(edgeMap);

  // Calculate incoming reference counts
  const incomingCounts = {};
  for (const file of uniqueFiles) {
    const data = fileData[file];
    // Count from explicit imports
    for (const imp of data.imports) {
      if (imp.resolved) {
        incomingCounts[imp.resolved] = (incomingCounts[imp.resolved] || 0) + 1;
      }
    }
  }
  for (const node of nodes) {
    node.incomingCount = incomingCounts[node.id] || 0;
  }

  // Collect unique folders for filtering
  const folders = [...new Set(nodes.map((n) => n.folder))].sort();
  const extensions = [...new Set(nodes.map((n) => n.extension))].sort();

  return { nodes, edges, folders, extensions };
}

// CLI mode
if (require.main === module) {
  const targetDir = process.argv[2] || process.cwd();
  console.log(`Analyzing codebase at: ${targetDir}`);
  analyzeCodebase(path.resolve(targetDir)).then((graph) => {
    console.log(
      `Found ${graph.nodes.length} files, ${graph.edges.length} connections`
    );
    fs.writeFileSync("graph.json", JSON.stringify(graph, null, 2));
    console.log("Graph written to graph.json");
  });
}

module.exports = { analyzeCodebase };
