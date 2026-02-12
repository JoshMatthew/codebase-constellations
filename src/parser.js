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

function conditionToString(node, sourceCode) {
  if (sourceCode && node.start != null && node.end != null) {
    // Extract just the first line of the condition, clean up whitespace
    let text = sourceCode.slice(node.start, node.end);
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > 40) text = text.slice(0, 37) + "...";
    return text;
  }
  return null;
}

function getEnclosingConditions(nodePath, sourceCode) {
  // Only return the INNERMOST condition (most specific/relevant)
  let scope = nodePath.parentPath;
  while (scope) {
    if (scope.node.type === "IfStatement") {
      const condText = conditionToString(scope.node.test, sourceCode);
      if (condText) {
        const callStart = nodePath.node.start;
        const callEnd = nodePath.node.end;
        const alt = scope.node.alternate;
        let branch = "if";
        if (alt && callStart >= alt.start && callEnd <= alt.end) {
          branch = "else";
        }
        return [{ condition: condText, branch }];
      }
    } else if (scope.node.type === "ConditionalExpression") {
      const condText = conditionToString(scope.node.test, sourceCode);
      if (condText) {
        const callStart = nodePath.node.start;
        const alt = scope.node.alternate;
        let branch = "?";
        if (alt && callStart >= alt.start) branch = ":";
        return [{ condition: condText, branch }];
      }
    }
    // Stop at function boundaries
    if (
      scope.node.type === "FunctionDeclaration" ||
      scope.node.type === "ArrowFunctionExpression" ||
      scope.node.type === "FunctionExpression" ||
      scope.node.type === "ClassMethod"
    ) break;
    scope = scope.parentPath;
  }
  return [];
}

function extractSymbols(ast, filePath, relFile, sourceCode) {
  const symbols = [];
  const calls = [];

  traverse(ast, {
    FunctionDeclaration(nodePath) {
      if (!nodePath.node.id) return;
      const params = (nodePath.node.params || []).map(p => {
        if (p.type === "Identifier") return p.name;
        if (p.type === "AssignmentPattern" && p.left.type === "Identifier") return p.left.name;
        return "...";
      });
      symbols.push({
        id: `${relFile}::${nodePath.node.id.name}`,
        name: nodePath.node.id.name,
        type: "function",
        file: relFile,
        startLine: nodePath.node.loc?.start.line || 0,
        endLine: nodePath.node.loc?.end.line || 0,
        params,
        exported: nodePath.parent.type === "ExportNamedDeclaration" || nodePath.parent.type === "ExportDefaultDeclaration",
      });
    },

    ArrowFunctionExpression(nodePath) {
      if (nodePath.parent.type !== "VariableDeclarator" || !nodePath.parent.id?.name) return;
      const name = nodePath.parent.id.name;
      const grandParent = nodePath.parentPath?.parent;
      const params = (nodePath.node.params || []).map(p => {
        if (p.type === "Identifier") return p.name;
        if (p.type === "AssignmentPattern" && p.left.type === "Identifier") return p.left.name;
        return "...";
      });
      symbols.push({
        id: `${relFile}::${name}`,
        name,
        type: "function",
        file: relFile,
        startLine: nodePath.node.loc?.start.line || 0,
        endLine: nodePath.node.loc?.end.line || 0,
        params,
        exported: grandParent?.type === "ExportNamedDeclaration",
      });
    },

    ClassDeclaration(nodePath) {
      if (!nodePath.node.id) return;
      const className = nodePath.node.id.name;
      const methods = [];
      for (const member of nodePath.node.body.body) {
        if (member.type === "ClassMethod" && member.key?.name) {
          methods.push(member.key.name);
          const params = (member.params || []).map(p => {
            if (p.type === "Identifier") return p.name;
            if (p.type === "AssignmentPattern" && p.left.type === "Identifier") return p.left.name;
            if (p.type === "RestElement" && p.argument.type === "Identifier") return `...${p.argument.name}`;
            return "...";
          });
          symbols.push({
            id: `${relFile}::${className}.${member.key.name}`,
            name: `${className}.${member.key.name}`,
            type: "method",
            file: relFile,
            startLine: member.loc?.start.line || 0,
            endLine: member.loc?.end.line || 0,
            parent: `${relFile}::${className}`,
            params,
          });
        }
      }
      symbols.push({
        id: `${relFile}::${className}`,
        name: className,
        type: "class",
        file: relFile,
        startLine: nodePath.node.loc?.start.line || 0,
        endLine: nodePath.node.loc?.end.line || 0,
        methods,
        superClass: nodePath.node.superClass?.name || null,
        exported: nodePath.parent.type === "ExportNamedDeclaration" || nodePath.parent.type === "ExportDefaultDeclaration",
      });
    },

    VariableDeclaration(nodePath) {
      if (nodePath.parent.type !== "Program" && nodePath.parent.type !== "ExportNamedDeclaration") return;
      for (const d of nodePath.node.declarations) {
        if (!d.id?.name) continue;
        if (d.id.name.length < 2) continue;
        // Skip require() calls — those are imports, not symbols
        if (d.init?.type === "CallExpression" && d.init.callee?.name === "require") continue;
        // Skip arrow functions — handled above
        if (d.init?.type === "ArrowFunctionExpression") continue;
        // Skip function expressions — handled separately
        if (d.init?.type === "FunctionExpression") continue;
        symbols.push({
          id: `${relFile}::${d.id.name}`,
          name: d.id.name,
          type: "variable",
          file: relFile,
          startLine: d.loc?.start.line || nodePath.node.loc?.start.line || 0,
          endLine: d.loc?.end.line || nodePath.node.loc?.end.line || 0,
          exported: nodePath.parent.type === "ExportNamedDeclaration",
        });
      }
    },

    TSTypeAliasDeclaration(nodePath) {
      if (!nodePath.node.id) return;
      symbols.push({
        id: `${relFile}::${nodePath.node.id.name}`,
        name: nodePath.node.id.name,
        type: "type",
        file: relFile,
        startLine: nodePath.node.loc?.start.line || 0,
        endLine: nodePath.node.loc?.end.line || 0,
        exported: nodePath.parent.type === "ExportNamedDeclaration",
      });
    },

    TSInterfaceDeclaration(nodePath) {
      if (!nodePath.node.id) return;
      symbols.push({
        id: `${relFile}::${nodePath.node.id.name}`,
        name: nodePath.node.id.name,
        type: "interface",
        file: relFile,
        startLine: nodePath.node.loc?.start.line || 0,
        endLine: nodePath.node.loc?.end.line || 0,
        exported: nodePath.parent.type === "ExportNamedDeclaration",
      });
    },

    CallExpression(nodePath) {
      const callee = nodePath.node.callee;
      let calledName = null;
      let objectName = null;
      if (callee.type === "Identifier") {
        calledName = callee.name;
      } else if (callee.type === "MemberExpression" && callee.property?.name) {
        calledName = callee.property.name;
        if (callee.object.type === "Identifier") {
          objectName = callee.object.name;
        }
      }
      if (!calledName || calledName === "require") return;

      // Extract enclosing if-conditions
      const conditions = getEnclosingConditions(nodePath, sourceCode);

      // Find the enclosing function
      let scope = nodePath;
      while (scope) {
        if (scope.node.type === "FunctionDeclaration" && scope.node.id) {
          calls.push({ caller: scope.node.id.name, callee: calledName, objectName, conditions, line: nodePath.node.loc?.start.line || 0 });
          break;
        }
        if (scope.node.type === "ArrowFunctionExpression" || scope.node.type === "FunctionExpression") {
          if (scope.parent?.type === "VariableDeclarator" && scope.parent.id?.name) {
            calls.push({ caller: scope.parent.id.name, callee: calledName, objectName, conditions, line: nodePath.node.loc?.start.line || 0 });
            break;
          }
        }
        if (scope.node.type === "ClassMethod" && scope.node.key?.name) {
          let classScope = scope.parentPath;
          while (classScope && classScope.node.type !== "ClassDeclaration") classScope = classScope.parentPath;
          const className = classScope?.node?.id?.name;
          if (className) {
            calls.push({ caller: `${className}.${scope.node.key.name}`, callee: calledName, objectName, conditions, line: nodePath.node.loc?.start.line || 0 });
          }
          break;
        }
        scope = scope.parentPath;
      }
    },
  });

  return { symbols, calls };
}

async function analyzeSymbols(rootDir) {
  const ignorePattern = IGNORE_DIRS.map((d) => `**/${d}/**`);
  const patterns = EXTENSIONS.map((ext) => `**/*${ext}`);

  const files = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { cwd: rootDir, ignore: ignorePattern, absolute: false });
    files.push(...matches);
  }
  const uniqueFiles = [...new Set(files)];

  const allSymbols = [];
  const allEdges = [];
  const fileImports = {}; // file -> [{localName, importedName, fromFile}]

  // First pass: extract symbols from every file
  for (const file of uniqueFiles) {
    const fullPath = path.join(rootDir, file);
    const ast = parseFile(fullPath);
    if (!ast) continue;

    const sourceCode = fs.readFileSync(fullPath, "utf-8");
    const { symbols, calls } = extractSymbols(ast, fullPath, file, sourceCode);
    allSymbols.push(...symbols);

    // Build intra-file call edges
    const symbolNames = new Map(symbols.map(s => [s.name, s.id]));
    // Also index method symbols by just the method name for fuzzy matching
    const methodsByName = new Map();
    for (const s of symbols) {
      if (s.type === "method" && s.name.includes(".")) {
        const methodName = s.name.split(".").pop();
        if (!methodsByName.has(methodName)) methodsByName.set(methodName, []);
        methodsByName.get(methodName).push(s);
      }
    }
    for (const call of calls) {
      const callerId = symbolNames.get(call.caller);
      if (!callerId) continue;
      // Try exact name match first
      let calleeId = symbolNames.get(call.callee);
      // If no direct match and it was a method call, try matching class methods
      if (!calleeId && call.objectName) {
        // Try ClassName.method (if objectName maps to a known class or its instance)
        const candidates = methodsByName.get(call.callee) || [];
        if (candidates.length === 1) {
          calleeId = candidates[0].id;
        } else if (candidates.length > 1) {
          // If objectName matches a class name (e.g. Player.method), prefer that
          const exact = candidates.find(c => c.name === `${call.objectName}.${call.callee}`);
          if (exact) calleeId = exact.id;
          else calleeId = candidates[0].id; // best guess
        }
      }
      if (callerId && calleeId && callerId !== calleeId) {
        const edge = { source: callerId, target: calleeId, type: "calls" };
        if (call.conditions && call.conditions.length > 0) {
          edge.conditions = call.conditions;
        }
        allEdges.push(edge);
      }
    }

    // Extract imports for cross-file resolution
    const imports = extractImports(ast, fullPath, rootDir);
    fileImports[file] = [];
    for (const imp of imports) {
      if (!imp.resolved) continue;
      for (const spec of imp.specifiers) {
        fileImports[file].push({
          localName: spec.name,
          importedName: spec.type === "default" ? "default" : spec.name,
          fromFile: imp.resolved,
        });
      }
    }
  }

  // Build a lookup: file -> symbolName -> symbolId
  const symbolByFile = {};
  for (const sym of allSymbols) {
    if (!symbolByFile[sym.file]) symbolByFile[sym.file] = {};
    symbolByFile[sym.file][sym.name] = sym.id;
  }

  // Second pass: cross-file edges (imports link)
  for (const file of uniqueFiles) {
    const imports = fileImports[file] || [];
    for (const imp of imports) {
      const targetLookup = symbolByFile[imp.fromFile];
      if (!targetLookup) continue;
      // Try to find the imported symbol in the target file
      const targetId = targetLookup[imp.importedName] || targetLookup[imp.localName];
      if (!targetId) continue;
      // Find any symbol in current file that uses this import (link file-level for now)
      allEdges.push({ source: `${file}::${imp.localName}`, target: targetId, type: "imports" });
    }

    // Also build cross-file call edges using import mappings
    const fullPath = path.join(rootDir, file);
    const ast = parseFile(fullPath);
    if (!ast) continue;
    const sourceCode = fs.readFileSync(fullPath, "utf-8");
    const { calls } = extractSymbols(ast, fullPath, file, sourceCode);
    const localImportMap = {};
    for (const imp of imports) {
      localImportMap[imp.localName] = imp;
    }
    for (const call of calls) {
      const callerSymbols = symbolByFile[file];
      const callerId = callerSymbols?.[call.caller];
      if (!callerId) continue;

      const conds = (call.conditions && call.conditions.length > 0) ? call.conditions : undefined;
      if (localImportMap[call.callee]) {
        // Direct imported function call: e.g. import { foo } from './bar'; foo()
        const imp = localImportMap[call.callee];
        const targetLookup = symbolByFile[imp.fromFile];
        if (!targetLookup) continue;
        const targetId = targetLookup[imp.importedName] || targetLookup[imp.localName];
        if (targetId) {
          const edge = { source: callerId, target: targetId, type: "calls" };
          if (conds) edge.conditions = conds;
          allEdges.push(edge);
        }
      } else if (call.objectName && localImportMap[call.objectName]) {
        // Method call on an imported object: e.g. import player from './player'; player.draw()
        const imp = localImportMap[call.objectName];
        const targetLookup = symbolByFile[imp.fromFile];
        if (!targetLookup) continue;
        const targetId = targetLookup[`${imp.importedName}.${call.callee}`]
          || targetLookup[`${imp.localName}.${call.callee}`]
          || targetLookup[call.callee];
        if (targetId) {
          const edge = { source: callerId, target: targetId, type: "calls" };
          if (conds) edge.conditions = conds;
          allEdges.push(edge);
        }
      } else if (call.objectName) {
        // Method call on a non-imported object — try to find matching methods across all files
        for (const targetFile of Object.keys(symbolByFile)) {
          const targetLookup = symbolByFile[targetFile];
          for (const symName of Object.keys(targetLookup)) {
            if (symName.endsWith(`.${call.callee}`) && symName.includes(".")) {
              const targetId = targetLookup[symName];
              if (targetId && targetId !== callerId) {
                const edge = { source: callerId, target: targetId, type: "calls" };
                if (conds) edge.conditions = conds;
                allEdges.push(edge);
              }
            }
          }
        }
      }
    }
  }

  // Deduplicate edges (merge conditions from duplicate edges)
  const edgeMap2 = new Map();
  for (const edge of allEdges) {
    const key = `${edge.source}|${edge.target}|${edge.type}`;
    if (!edgeMap2.has(key)) {
      edgeMap2.set(key, { ...edge });
    } else if (edge.conditions) {
      const existing = edgeMap2.get(key);
      if (!existing.conditions) existing.conditions = [];
      // Add new conditions that aren't already present
      for (const c of edge.conditions) {
        if (!existing.conditions.some(ec => ec.condition === c.condition && ec.branch === c.branch)) {
          existing.conditions.push(c);
        }
      }
    }
  }
  const dedupedEdges = [...edgeMap2.values()];

  // Only include symbols that actually exist (filter out phantom import refs)
  const symbolIds = new Set(allSymbols.map(s => s.id));
  const validEdges = dedupedEdges.filter(e => symbolIds.has(e.source) && symbolIds.has(e.target));

  return { symbols: allSymbols, edges: validEdges, files: uniqueFiles };
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

module.exports = { analyzeCodebase, analyzeSymbols };
