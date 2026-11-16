"use client";

import { useEffect, useMemo, useState } from "react";
import { Controls, Handle, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import demo from "../public/demo.json";
import { offlineGraph } from "./recorded";

const causeColors = { "config change": "config", capacity: "capacity", dependency: "dependency" };

function category(data) {
  if (data.doc_type !== "incident") return data.doc_type;
  const label = data.root_cause.toLowerCase().replaceAll("-", " ");
  if (!label || label === "unlabeled") return "incident";
  const hue = Array.from(label).reduce((value, letter) => (value * 31 + letter.charCodeAt(0)) >>> 0, 0);
  return causeColors[label] || ["rose", "blue", "green", "amber", "purple"][hue % 5];
}

function GraphNode({ data, selected }) {
  return <div className={"graph-node " + category(data) + (selected ? " selected" : "")}>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <div><strong>{data.id}</strong><span>{data.title}</span></div>
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </div>;
}
const nodeTypes = { precedent: GraphNode };

function arrangement(graph, focus, visible) {
  const adjacency = new Map();
  const chosen = graph.nodes.find(node => node.id === focus) || graph.nodes.find(node => node.id === "INC-142") || graph.nodes[0];
  for (const edge of graph.edges) {
    if (!visible[edge.kind]) continue;
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.source).push(edge.target);
    adjacency.get(edge.target).push(edge.source);
  }
  const neighbors = new Set(adjacency.get(chosen?.id));
  const columns = [[], [], [], []];
  graph.nodes.forEach(node => {
    columns[node.id === chosen?.id ? 0 : neighbors.has(node.id) ? 1 : node.doc_type === "runbook" ? 3 : 2].push(node);
  });
  const nodes = columns.flatMap((column, i) => column.map((node, j) => ({
    id: node.id, type: "precedent", data: node,
    position: { x: i * 242, y: j * 84 - (column.length - 1) * 42 }, draggable: false,
    ariaLabel: node.id + ", " + node.title,
  })));
  const colors = { learned: "#ff6a1a", declared: "#c59272", auto: "#86766b" };
  const edges = graph.edges.filter(e => visible[e.kind]).map((edge, i) => ({
    ...edge, id: edge.source + "/" + edge.target + "/" + i, data: edge,
    ariaLabel: edge.type + ". " + edge.reason,
    style: { stroke: colors[edge.kind], strokeWidth: edge.kind === "learned" ? 3 : 1.5,
      strokeDasharray: edge.kind === "declared" ? "6 4" : undefined },
  }));
  return { nodes, edges };
}

export default function GraphView({ id, recorded, request, onConsole }) {
  const [graph, setGraph] = useState(recorded && id === "all" ? demo.graph : null);
  const [selection, setSelection] = useState(null);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState({ auto: true, declared: true, learned: true });
  const [focus, setFocus] = useState(id);

  useEffect(() => { setFocus(id); setSelection(null); }, [id]);
  useEffect(() => {
    let active = true;
    setError("");
    setGraph(recorded && focus === "all" ? demo.graph : null);
    request("/api/graph/" + encodeURIComponent(focus) + "?recorded=" + recorded)
      .then(data => { if (active) setGraph(data); })
      .catch(e => {
        if (!active) return;
        const cached = recorded ? offlineGraph(focus) : null;
        if (cached?.nodes.length) setGraph(cached);
        else setError(e.message);
      });
    return () => { active = false; };
  }, [focus, recorded, request]);

  const flow = useMemo(() => graph ? arrangement(graph, focus, visible) : null, [graph, focus, visible]);
  const label = { auto: "Auto-extracted", declared: "Declared", learned: "Learned" };
  const activeNode = graph?.nodes.find(node => node.id === selection?.node);
  const activeEdge = selection?.edge;
  return <>
    <header className="page-heading"><div><h1>Memory graph</h1><p>Inspect the relationships behind each incident precedent.</p></div>
      <button className="button" onClick={onConsole}>Back to console</button></header>
    <section className="panel graph-panel">
      <header className="graph-toolbar"><div className="graph-title"><h2>{focus === "all" ? "Incident relationships" : focus}</h2></div>
        <div className="legend" aria-label="Edge filters">{Object.keys(label).map(key => <label key={key}><input type="checkbox" checked={visible[key]}
          onChange={e => setVisible(prev => ({ ...prev, [key]: e.target.checked }))} /><i className={key} />{label[key]}</label>)}
          {focus !== "all" && <button className="text-button" onClick={() => { setFocus("all"); setSelection(null); }}>Full graph</button>}</div>
      </header>
      {error ? <div className="empty error" role="alert">{error}</div> : flow?.nodes.length ?
        <div className="graph-canvas"><ReactFlow colorMode="dark" key={focus + recorded + flow.nodes.length} nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes}
          fitView fitViewOptions={{ padding: .25, maxZoom: 1.18 }} minZoom={.12} maxZoom={2.2} nodesConnectable={false} elementsSelectable
          onNodeClick={(_, node) => setSelection({ node: node.id })} onEdgeClick={(_, edge) => setSelection({ edge: edge.data })}
          onPaneClick={() => setSelection(null)}><Controls showInteractive={false} /></ReactFlow></div>
        : <div className="empty">{graph ? "No graph sources are available yet." : "Loading incident relationships…"}</div>}
    </section>
    {(activeNode || activeEdge) && <section className="panel briefing">

      <div><h3>{activeEdge ? activeEdge.type.replaceAll("_", " ").toLowerCase() : activeNode.title}</h3>
        <p>{activeEdge ? activeEdge.reason : activeNode.description}</p>
        {activeNode?.root_cause && activeNode.root_cause !== "unlabeled" && <p>Root cause class · {activeNode.root_cause}</p>}
        {activeNode?.url && <a className="text-button" href={activeNode.url} target="_blank" rel="noreferrer">Open source</a>}
        {activeNode && activeNode.id !== focus && activeNode.doc_type !== "entity" && <button className="text-button" onClick={() => { setFocus(activeNode.id); setSelection(null); }}>Focus neighborhood</button>}
      </div>
    </section>}
    {flow?.edges.length > 0 && <section className="graph-relationships"><h2>Relationship evidence</h2><div className="panel relation-list">
      {flow.edges.filter(edge => edge.kind === "learned").map(edge => <button className="relation-row" key={edge.id} onClick={() => setSelection({ edge: edge.data })}>
        <span><strong>{edge.source} → {edge.target}</strong><small>{edge.data.reason}</small></span><span className="learned-tag">{label[edge.kind]}</span></button>)}
      {!flow.edges.some(edge => edge.kind === "learned") && <p className="empty small">No learned relationships in this view.</p>}
    </div></section>}
  </>;
}
