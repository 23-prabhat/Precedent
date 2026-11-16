import demo from "../public/demo.json";

const key = "precedent-recorded-v1";

function saved() {
  try { return JSON.parse(sessionStorage.getItem(key)) || {}; }
  catch { return {}; }
}

export function offlineAnalysis(sample) {
  const triple = demo.triples[sample.id];
  if (!triple) return demo.recordings[sample.id];
  const isResolved = Boolean(saved()[sample.id]);
  const data = isResolved ? triple.after : triple.before;
  const prior = triple.after.precedent.find(item => item.id === sample.expected_precedent_id);
  return { ...data, request_id: "recording/" + sample.id, resolution_candidates: [prior] };
}

export function saveOffline(sample, helped) {
  const triple = demo.triples[sample.id];
  if (!triple || !helped.includes(sample.expected_precedent_id)) {
    throw new Error("The saved learning demo requires its earlier precedent. Connect the API to save a different resolution.");
  }
  const state = saved();
  const edge = triple.edge;
  state[sample.id] = true;
  sessionStorage.setItem(key, JSON.stringify(state));
  return { incident_id: edge.source, edges_added: [edge], feedback_sent: false };
}

export function offlineMeter() {
  const ids = Object.keys(saved());
  return { learned_edges: offlineGraph("all").learned_edges.length, rolling_hit_rate: ids.length ? 1 : null };
}

export function offlineGraph(id) {
  const edgesByPair = new Map(demo.graph.edges.map(edge => [edge.source + "/" + edge.target, edge]));
  for (const sample of Object.keys(saved())) {
    const edge = demo.triples[sample]?.edge;
    if (edge) edgesByPair.set(edge.source + "/" + edge.target, { ...edge, kind: "learned" });
  }
  const edges = [...edgesByPair.values()];
  if (id === "all") return { nodes: demo.graph.nodes, edges, learned_edges: edges.filter(e => e.kind === "learned") };
  const found = new Set([id]);
  for (let i = 0; i < 2; i++) {
    const adjacent = new Set();
    for (const edge of edges) {
      if (found.has(edge.source)) adjacent.add(edge.target);
      if (found.has(edge.target)) adjacent.add(edge.source);
    }
    for (const next of adjacent) found.add(next);
  }
  const scoped = edges.filter(e => found.has(e.source) && found.has(e.target));
  return { nodes: demo.graph.nodes.filter(node => found.has(node.id)), edges: scoped, learned_edges: scoped.filter(e => e.kind === "learned") };
}
