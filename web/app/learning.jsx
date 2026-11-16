"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, ErrorBar, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import demoResults from "../public/results.json";

const labels = { A: "Vector", B: "HydraDB flat", C: "Auto graph", "C+": "Declared graph", D: "Precedent", random: "Random", prior: "Label prior" };
const colors = { A: "#ded0c4", B: "#c2a67c", C: "#aa8acd", "C+": "#91b6c2", D: "#ff6a1a", random: "#9c8b84", prior: "#dca286" };
const n = value => value == null ? "—" : value.toFixed(3);
const percentage = value => value == null ? "—" : (value * 100).toFixed(1) + "%";

export default function Learning({ recorded, request }) {
  const [results, setResults] = useState(recorded ? demoResults : null);
  const [error, setError] = useState("");
  const [hard, setHard] = useState(false);
  const [ci, setCi] = useState(true);
  const [visible, setVisible] = useState(["A", "B", "C", "C+", "D"]);

  useEffect(() => {
    let active = true;
    setError("");
    setResults(recorded ? demoResults : null);
    if (!recorded) request("/api/metrics?recorded=false").then(data => { if (active) setResults(data); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [recorded, request]);

  if (!results) return <><header className="page-heading"><div><h1>Replay report</h1><p>Walk-forward evaluation against prior incident history.</p></div></header>
    <div className={error ? "panel empty error" : "panel empty"} role={error ? "alert" : "status"}>{error || "Loading replay results…"}</div></>;

  const arms = results.manifest.arms;
  const plotted = visible.filter(arm => arms.includes(arm));
  const field = hard ? "hard_ndcg" : "ndcg";
  const chart = results.series.map(batch => {
    const row = { batch: "Batch " + batch.batch };
    for (const arm of plotted) {
      const entry = batch.arms[arm];
      const interval = hard ? entry.hard_ci : entry.ci;
      row[arm] = entry[field];
      if (interval) row[arm + "_ci"] = [Math.max(0, interval[0] - interval[1]), Math.max(0, interval[2] - interval[0])];
    }
    return row;
  });
  const recordedData = results.manifest.provenance === "synthetic";
  const baselineOnly = results.manifest.provenance === "gitlab-baseline";
  const overview = results.summary.D || results.summary.A;
  return <>
    <header className="page-heading"><div><h1>Replay report</h1><p>Walk-forward evaluation against prior incident history.</p></div>
      <div className="mode-badge"><span />{recordedData ? "Synthetic replay" : baselineOnly ? "GitLab baseline" : "GitLab replay"}</div></header>
    <div className="report-notice">{recordedData ? "Synthetic results exercise the replay. Live success criteria are pending." : baselineOnly ? "MiniLM and FAISS on public GitLab data. Hosted HydraDB comparisons are pending." : "Incidents are scored before their batch becomes eligible for ingestion."}</div>
    <section className="panel report">
      <header className="report-head"><div><h2>Retrieval quality by batch</h2><p>{hard ? "Hard subset" : "Reachable incidents"} · nDCG@5</p></div>
        <div className="report-controls"><label><input type="checkbox" checked={hard} onChange={e => setHard(e.target.checked)} /> Hard subset</label>
          <label><input type="checkbox" checked={ci} onChange={e => setCi(e.target.checked)} /> 95% CI</label></div></header>
      {chart.some(row => plotted.some(arm => row[arm] != null)) ? <div className="chart" role="img" aria-label="Line chart of nDCG at five by replay batch. Values are also available in the ablation table.">
        <ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ top: 13, right: 17, bottom: 6, left: -9 }}>
          <CartesianGrid vertical={false} stroke="#362a22" /><XAxis dataKey="batch" tickLine={false} axisLine={false} tick={{ fill: "#c6b3a6", fontSize: 12 }} />
          <YAxis domain={[0, 1]} tickLine={false} axisLine={false} tick={{ fill: "#c6b3a6", fontSize: 12 }} />
          <Tooltip contentStyle={{ background: "#1c1815", borderColor: "#514039", color: "#faf7f2" }} labelStyle={{ color: "#faf7f2" }} formatter={(value, arm) => [n(value), labels[arm] || arm]} />
          {plotted.map(arm => <Line key={arm} dataKey={arm} type="linear" stroke={colors[arm]} strokeWidth={arm === "D" ? 3 : 1.6}
            dot={{ r: arm === "D" ? 3 : 2 }} isAnimationActive={false}>
            {ci && <ErrorBar isAnimationActive={false} dataKey={arm + "_ci"} width={3} stroke={colors[arm]} strokeWidth={1} />}
          </Line>)}
        </LineChart></ResponsiveContainer></div> : <p className="empty">No scores for the selected arms and subset.</p>}
      <div className="chart-legend">{arms.map(arm => <button type="button" key={arm} className="method" aria-pressed={plotted.includes(arm)}
        onClick={() => setVisible(old => old.includes(arm) ? old.filter(key => key !== arm) : [...old, arm])}><i style={{ background: colors[arm] }} />{labels[arm]}</button>)}</div>
    </section>
    <section className="panel report"><header className="report-head"><div><h2>Ablation results</h2><p>All scored batches · {overview.n} alerts · {overview.reachable_n} reachable</p></div></header>
      <div className="scroll-table"><table><thead><tr><th>Retrieval arm</th><th>Reachable nDCG@5</th><th>Hard nDCG@5</th><th>Cross-service hit</th><th>Fix recall</th><th>Context tokens</th><th>Latency p50 / p95</th></tr></thead>
        <tbody>{arms.map(arm => { const x = results.summary[arm]; return <tr key={arm} className={arm === "D" ? "highlight" : ""}>
          <th scope="row"><span className="arm-code">{arm}</span> {labels[arm]}</th><td>{n(x.ndcg)}</td><td>{n(x.hard_ndcg)}</td><td>{percentage(x.reachable_cross_hit)}</td>
          <td>{percentage(x.reachable_fix_recall)}</td><td>{x.reachable_tokens == null ? "—" : Math.round(x.reachable_tokens)}</td><td>{recordedData ? "—" : x.p50 + " / " + x.p95 + " ms"}</td></tr>; })}</tbody></table></div>
      <div className="table-note">Reachable share {percentage(overview.reachable)}. Reachable ceiling {n(overview.reachable_ceiling)}. All-alert ceiling {n(overview.ceiling)}.</div>
      <details className="batch-details"><summary>Per-batch values and confidence intervals</summary>
        <div className="scroll-table"><table><thead><tr><th>Batch</th><th>Arm</th><th>Scored</th><th>Reachable</th><th>Hard</th><th>nDCG@5</th><th>95% CI</th></tr></thead>
          <tbody>{results.series.flatMap(batch => arms.map(arm => {
            const item = batch.arms[arm]; const interval = hard ? item.hard_ci : item.ci;
            return <tr key={batch.batch + arm}><th scope="row">{batch.batch}</th><td>{labels[arm]}</td><td>{item.n}</td><td>{item.reachable_n}</td>
              <td>{item.hard_n}</td><td>{n(item[field])}</td><td>{interval ? n(interval[1]) + " to " + n(interval[2]) : "—"}</td></tr>;
          }))}</tbody></table></div>
      </details>
    </section>
    <section className="panel report"><header className="report-head"><div><h2>Pre-registered criteria</h2><p>Primary comparisons use the last three batches.</p></div></header>
      <ul className="criteria">{results.criteria.map(item => {
        const status = recordedData ? null : item.met;
        return <li key={item.label}><span>{item.label}</span><strong>{status == null ? "Pending" : status ? "Met" : "Not met"}</strong></li>;
      })}</ul>
      <div className="table-note">Paired differences, 95% CI {Object.keys(results.differences).length ? Object.entries(results.differences).map(([key, x]) => x ? key + " " + n(x[0]) + " [" + n(x[1]) + ", " + n(x[2]) + "]" : key + " unavailable").join(" · ") : "pending"}</div>
    </section>
    <section className="panel briefing"><div><h3>Reproduce this report</h3><p>Run <code>{recordedData ? "make eval" : baselineOnly ? "make eval-cache ARGS=--baseline-only" : "make eval-cache"}</code> from the repository root to rebuild the report from the SQLite cache.</p>
      <small className="muted">{results.manifest.model} · {results.manifest.policy} · seed {results.manifest.seed}</small></div></section>
  </>;
}
