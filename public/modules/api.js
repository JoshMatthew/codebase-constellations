export async function analyzeCodebase(targetPath) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: targetPath }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export async function fetchCachedGraph() {
  const res = await fetch("/api/graph");
  if (!res.ok) return null;
  return res.json();
}
