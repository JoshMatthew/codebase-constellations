const codeHeader = document.getElementById("code-header");
const codeFileName = document.getElementById("code-file-name");
const codeLineInfo = document.getElementById("code-line-info");
const codeContent = document.getElementById("code-content");
const codeEmpty = document.getElementById("code-empty");

let cachedFiles = {};

export async function showFile(filePath, startLine, endLine) {
  codeEmpty.style.display = "none";
  codeHeader.style.display = "flex";

  let content;
  if (cachedFiles[filePath]) {
    content = cachedFiles[filePath];
  } else {
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      content = data.content;
      cachedFiles[filePath] = content;
    } catch (err) {
      codeContent.innerHTML = `<pre style="padding:16px;color:#666">Could not load file: ${filePath}</pre>`;
      return;
    }
  }

  codeFileName.textContent = filePath;
  if (startLine && endLine) {
    codeLineInfo.textContent = `Lines ${startLine}-${endLine}`;
  } else {
    codeLineInfo.textContent = "";
  }

  const lines = content.split("\n");
  const ext = filePath.split(".").pop();
  const lang = ext === "ts" || ext === "tsx" ? "typescript" : "javascript";

  // Highlight the full code
  let highlighted;
  try {
    highlighted = hljs.highlight(content, { language: lang }).value;
  } catch {
    highlighted = escapeHtml(content);
  }

  // Split highlighted HTML by newlines (rough but works for line-by-line display)
  const highlightedLines = highlighted.split("\n");

  const lineHtml = highlightedLines.map((lineContent, i) => {
    const lineNum = i + 1;
    const isHighlighted = startLine && endLine && lineNum >= startLine && lineNum <= endLine;
    return `<span class="code-line${isHighlighted ? " highlighted" : ""}" id="line-${lineNum}"><span class="line-num">${lineNum}</span>${lineContent || " "}</span>`;
  }).join("\n");

  codeContent.innerHTML = `<pre><code>${lineHtml}</code></pre>`;

  // Scroll to the highlighted region
  if (startLine) {
    requestAnimationFrame(() => {
      const target = document.getElementById(`line-${Math.max(1, startLine - 3)}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }
}

export function clearCodePanel() {
  codeHeader.style.display = "none";
  codeContent.innerHTML = "";
  codeEmpty.style.display = "block";
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
