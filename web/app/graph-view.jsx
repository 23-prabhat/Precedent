"use client";

import { useEffect, useMemo, useState } from "react";
import { BaseEdge, Controls, Handle, Position, ReactFlow, getBezierPath, getStraightPath } from "@xyflow/react";
import { useReducedMotion } from "motion/react";
import "@xyflow/react/dist/style.css";
import { offlineGraph } from "./recorded";
import PixelIcon from "./pixel-icon";

const causes = {
  "config change": ["Config change", "#b6a0dc"],
  capacity: ["Capacity", "#dfb46c"],
  dependency: ["Dependency", "#80c5bb"],
  runbook: ["Fix / runbook", "#bba699"],
  other: ["Other", "#adadb8"],
};
const edgeLabels = { auto: "Auto-extracted", declared: "Declared", learned: "Learned", match: "Text match" };
const sides = Object.values(Position);
const category = node => node.doc_type === "runbook" ? "runbook" : (node.root_cause || "").toLowerCase().replaceAll("-", " ");

function GraphNode({ data, selected }) {
  const [label, color] = causes[category(data)] || causes.other;
  return <div className={"graph-node evidence-node" + (selected ? " selected" : "")} style={{ "--cause": color }}>
    {sides.flatMap(side => ["source", "target"].map(type => <Handle key={type + side} id={type + side} type={type} position={side} isConnectable={false} />))}
    <div><strong>{data.id === "alert-query" ? "Alert" : data.id}</strong><span>{data.title}</span></div>
    <i title={label} />
  </div>;
}
function GraphEdge({ data, ...props }) {
  const [path] = data.tree ? getBezierPath(props) : getStraightPath(props);
  return <>
    <BaseEdge id={props.id} path={path} style={props.style} interactionWidth={20} />
    {data.kind === "learned" && !data.reduced && <circle r="3.8" fill="#ffd2b1" pointerEvents="none"><animateMotion path={path} dur="2.3s" repeatCount="indefinite" /></circle>}
  </>;
}
const nodeTypes = { precedent: GraphNode };
const edgeTypes = { evidence: GraphEdge };

function snapshots(graph) {
  return [...new Set([...graph.nodes.map(node => node.date), ...graph.edges.map(edge => edge.confirmed_at?.slice(0, 10))].filter(Boolean))].sort();
}

function historyAt(graph, date) {
  const nodes = graph.nodes.filter(node => !date || !node.date || node.date <= date);
  const ids = new Set(nodes.map(node => node.id));
  const edges = graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) &&
    (!date || !edge.confirmed_at || edge.confirmed_at.slice(0, 10) <= date));
  return { nodes, edges };
}

function radialPositions(nodes, focus, edges, narrow) {
  const connected = new Set(edges.flatMap(edge => edge.source === focus ? [edge.target] : edge.target === focus ? [edge.source] : []));
  const order = nodes.filter(node => node.id !== focus).sort((a, b) => Number(connected.has(b.id)) - Number(connected.has(a.id)));
  const positions = new Map([[focus, { x: 0, y: 0 }]]);
  let offset = 0;
  for (let ring = 1; offset < order.length; ring++) {
    const count = Math.min(order.length - offset, ring * 10);
    for (let index = 0; index < count; index++) {
      const angle = -Math.PI / 2 + 2 * Math.PI * index / count;
      positions.set(order[offset + index].id, { x: Math.cos(angle) * (narrow ? 170 : 365) * ring, y: Math.sin(angle) * (narrow ? 173 : 220) * ring });
    }
    offset += count;
  }
  return positions;
}

function treeLayout(nodes, edges, analysis, alert, narrow) {
  if (!analysis) return { nodes: [], edges: [], positions: new Map() };
  const ids = new Set(nodes.map(node => node.id));
  const matchIds = new Set(analysis.vector.map(item => item.id).filter(id => ids.has(id)));
  const pathKeys = new Set((analysis.paths || []).map(edge => [edge.source, edge.target].sort().join("/")));
  const connected = edges.filter(edge => pathKeys.has([edge.source, edge.target].sort().join("/")) && edge.kind !== "auto");
  const targetIds = new Set(connected.flatMap(edge => [edge.source, edge.target]).filter(id => !matchIds.has(id)));
  const fixes = edges.filter(edge => edge.type === "REFERENCES_FIX" && (matchIds.has(edge.source) || targetIds.has(edge.source)));
  const fixIds = new Set(fixes.map(edge => edge.target));
  const query = { id: "alert-query", title: alert || "Analyzed alert", doc_type: "alert" };
  const selected = [[query], nodes.filter(node => matchIds.has(node.id)), nodes.filter(node => targetIds.has(node.id)), nodes.filter(node => fixIds.has(node.id))];
  const positions = new Map(selected.flatMap((col, x) => col.map((node, y) => [node.id, { x: x * (narrow ? 119 : 245), y: (y - (col.length - 1) / 2) * (narrow ? 57 : 86) }])));
  return { nodes: selected.flat(), edges: [...connected, ...fixes, ...[...matchIds].map(id => ({
    source: query.id, target: id, type: "TEXT_MATCH", kind: "match", reason: "Returned in the vector results for this alert.",
  }))], positions };
}

function sideBetween(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? Position.Left : Position.Right) : (dy < 0 ? Position.Top : Position.Bottom);
}
function arrangement(graph, focus, visible, tree, analysis, alert, reduced, narrow) {
  const edges = graph.edges.filter(edge => visible[edge.kind]);
  const center = graph.nodes.find(node => node.id === focus) || graph.nodes.find(node => node.id === "INC-142") || graph.nodes[0];
  const view = tree ? treeLayout(graph.nodes, edges, analysis, alert, narrow)
    : { ...graph, edges, positions: radialPositions(graph.nodes, center?.id, edges, narrow) };

  const nodes = view.nodes.map(node => ({
    id: node.id, type: "precedent", data: node, position: view.positions.get(node.id), draggable: false,
    ariaLabel: node.id + ", " + node.title,
  }));
  const colors = { learned: "#ff6a1a", declared: "#c59272", auto: "#86766b", match: "#bdb0a8" };
  return { nodes, center, edges: view.edges.filter(edge => view.positions.has(edge.source) && view.positions.has(edge.target)).map((edge, index) => {
    const a = view.positions.get(edge.source), b = view.positions.get(edge.target);
    return { ...edge, id: edge.source + "/" + edge.target + "/" + index, type: "evidence", data: { ...edge, tree, reduced },
      sourceHandle: "source" + (tree ? Position.Right : sideBetween(a, b)),
      targetHandle: "target" + (tree ? Position.Left : sideBetween(b, a)),
      ariaLabel: edge.type + ". " + edge.reason,
      style: { stroke: colors[edge.kind], strokeWidth: edge.kind === "learned" ? 3 : 1,
        strokeDasharray: edge.kind === "declared" ? "7 5" : undefined },
    };
  }) };
}

export default function GraphView({ id, analysis, alert, recorded, request, onConsole }) {
  const [graph, setGraph] = useState(null);
  const [selection, setSelection] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState({ auto: true, declared: true, learned: true });
  const [focus, setFocus] = useState(id);
  const [batch, setBatch] = useState(null);
  const [tree, setTree] = useState(false);
  const reduced = useReducedMotion();
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 560px)").matches);

  useEffect(() => {
    const media = matchMedia("(max-width: 560px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => { setFocus(id); setSelection(null); }, [id]);
  useEffect(() => {
    let active = true;
    setError("");
    setBatch(null);
    setGraph(recorded ? offlineGraph(focus) : null);
    request("/api/graph/" + encodeURIComponent(focus) + "?recorded=" + recorded)
      .then(data => { if (active) setGraph(data); })
      .catch(e => { if (active && !recorded) setError(e.message); });
    return () => { active = false; };
  }, [focus, recorded, request]);

  const dates = useMemo(() => graph ? snapshots(graph) : [], [graph]);
  const latest = Math.max(0, dates.length - 1);
  const current = Math.min(batch ?? latest, latest);
  const flow = useMemo(() => graph ? arrangement(historyAt(graph, dates[current]), focus, visible, tree, analysis, alert, reduced, narrow)
    : null, [graph, dates, current, focus, visible, tree, analysis, alert, reduced, narrow]);
  const activeNode = graph?.nodes.find(node => node.id === selection?.node);
  const activeEdge = selection?.edge;

  function changeView(next) {
    setTree(next);
    setHovered(null);
    setSelection(null);
    if (next) setFocus("all");
  }
  return <>
    <header className="page-heading graph-header"><div><h1>Memory graph</h1><p>{recorded ? "Recorded demo · synthetic. " : ""}Follow the relationship from a familiar symptom to a confirmed fix.</p></div>
      <button className="button" onClick={onConsole}>Back to console</button></header>
    <section className="graph-panel graph-bleed">
      <header className="graph-toolbar">
        <div className="graph-controls"><div className="evidence-methods" role="group" aria-label="Graph layout">
          <button aria-pressed={!tree} onClick={() => changeView(false)}>Graph</button>
          <button aria-pressed={tree} onClick={() => changeView(true)}>Path tree</button>
        </div>
        {dates.length > 1 && <label className="graph-scrubber"><span>Batch {current} / {latest} · {dates[current]}</span><input aria-label="Graph batch" type="range" min="0" max={latest} value={current}
          onChange={e => { setBatch(Number(e.target.value)); setHovered(null); setSelection(null); }} /></label>}</div>
        <div className="legend" aria-label="Edge filters">{Object.entries(edgeLabels).filter(([key]) => key !== "match").map(([key, label]) => <label key={key}>
          <input type="checkbox" checked={visible[key]} onChange={e => { setVisible(prev => ({ ...prev, [key]: e.target.checked })); setHovered(null); setSelection(null); }} /><i className={key} />{label}</label>)}</div>
      </header>
      <div className="graph-context"><div className="cause-legend" aria-label="Root cause legend">{Object.values(causes).map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}</div>
        {tree ? <div className="tree-stages"><span>Alert</span><span>Text matches</span><span>Precedents</span><span>Fixes</span></div>
          : <div className="graph-focus"><label>Center on <select value={flow?.center?.id ?? ""} onChange={e => { setFocus(e.target.value); setSelection(null); setHovered(null); }}>
            {!flow?.center && <option value="">Choose incident</option>}
            {graph?.nodes.map(node => <option key={node.id} value={node.id}>{node.id}</option>)}
          </select></label>{focus !== "all" && <button className="text-button" onClick={() => { setFocus("all"); setSelection(null); }}>Full graph</button>}</div>}
      </div>
      {error ? <div className="empty error" role="alert">{error}</div> : flow?.nodes.length ?
        <div className="graph-canvas"><ReactFlow colorMode="dark" key={focus + tree + narrow + current + flow.nodes.length} nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          fitView fitViewOptions={{ padding: .17, maxZoom: 1.15 }} minZoom={.12} maxZoom={2.35} nodesConnectable={false} elementsSelectable
          onNodeClick={(_, node) => setSelection({ node: node.id })} onEdgeClick={(_, edge) => setSelection({ edge: edge.data })}
          onEdgeMouseEnter={(_, edge) => setHovered(edge.data)} onEdgeMouseLeave={() => setHovered(null)}
          onPaneClick={() => setSelection(null)}><Controls showInteractive={false} /></ReactFlow>
          {hovered && <aside className="graph-hover"><strong>{hovered.type}</strong><p>{hovered.reason}</p></aside>}
        </div> : <div className="empty">{tree ? "Analyze an alert to view its path tree." : graph ? "No graph sources are available yet." : "Loading incident relationships…"}</div>}
    </section>
    {(activeNode || activeEdge) && <section className="panel briefing"><div><h3>{activeEdge ? activeEdge.type.replaceAll("_", " ") : activeNode.title}</h3>
      <p>{activeEdge ? activeEdge.reason : activeNode.description}</p>
      {activeNode?.root_cause && activeNode.root_cause !== "unlabeled" && <p>Root cause class · {activeNode.root_cause}</p>}
      {activeNode?.url && <a className="text-button" href={activeNode.url} target="_blank" rel="noreferrer">Open source</a>}
      {activeNode && activeNode.id !== focus && activeNode.doc_type !== "entity" && <button className="text-button" onClick={() => { setFocus(activeNode.id); setTree(false); setSelection(null); }}>Focus neighborhood</button>}
    </div></section>}
    {flow?.edges.length > 0 && <section className="graph-relationships"><h2>Relationship evidence</h2><div className="panel relation-list">
      {flow.edges.filter(edge => edge.kind === "learned").map(edge => <button className="relation-row" key={edge.id} onClick={() => setSelection({ edge: edge.data })}>
        <span><strong><PixelIcon name="link" size={13} /> {edge.source} → {edge.target}</strong><small>{edge.data.reason}</small></span><span className="learned-tag">Learned</span></button>)}
      {!flow.edges.some(edge => edge.kind === "learned") && <p className="empty small">No learned relationships in this batch.</p>}
    </div></section>}
  </>;
}
