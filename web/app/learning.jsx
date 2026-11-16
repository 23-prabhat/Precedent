"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import results from "../public/results.json";
import baseline from "../../data/gitlab-baseline.json";

const labels = { A: "Vector", B: "HydraDB flat", C: "Auto graph", "C+": "Declared graph", D: "Precedent", random: "Random", prior: "Label prior" };
const criteria = [
  "Over the last three batches, Precedent exceeds declared graph on reachable nDCG@5, with the paired bootstrap 95% CI above zero.",
  "Precedent exceeds vector search on hard-subset nDCG@5 over the same batches.",
  "On the full reachable subset, Precedent trails vector search by at most the paired CI half-width.",
  "Precedent matches vector search at a lower context token budget or exceeds it at the same budget.",
];
const n = value => value == null ? "—" : value.toFixed(3);
const percentage = value => value == null ? "—" : (value * 100).toFixed(1) + "%";
const delta = value => value == null ? "—" : (value > 0 ? "+" : "") + n(value);
const arms = results.manifest.arms;
const overview = results.summary.D;
const baselineOverview = baseline.summary.A;
const chart = results.series.map(({ batch, paired_delta: interval }) => ({
  batch, delta: interval?.[0], band: interval?.slice(1),
}));

function ProofStatus() {
  const hosted = baseline.manifest.provenance === "gitlab-live";
  return <section className="panel report proof-panel">
    <header className="report-head"><div><h2>Proof status</h2><p>Pre-registered Track 1 criteria · hosted GitLab run</p></div></header>
    <ol className="criteria">{criteria.map((label, index) => {
      const met = hosted ? baseline.criteria[index]?.met : null;
      const status = met == null ? "Pending" : met ? "Met" : "Not met";
      return <li key={label}><span>{label}</span><strong className="proof-chip" data-status={status}>{status}</strong></li>;
    })}</ol>
  </section>;
}

function BaselineBars() {
  const baselineArms = [["random", "Random"], ["A", "MiniLM / FAISS"], ["prior", "Label prior"]];
  const max = Math.max(...baselineArms.map(([key]) => baseline.summary[key].ndcg));
  return <section className="panel report baseline-panel">
    <header className="report-head"><div><h2>GitLab baseline</h2><p>Public incident history · {baselineOverview.n} scored · {baselineOverview.reachable_n} reachable · reachable nDCG@5</p></div></header>
    <ul className="baseline-bars">
      {baselineArms.map(([key, label]) => <li key={key}><span>{label}</span><div aria-hidden="true"><i style={{ width: baseline.summary[key].ndcg / max * 100 + "%" }} /></div><strong>{n(baseline.summary[key].ndcg)}</strong></li>)}
      {["B", "C", "C+", "D"].map(arm => <li className="pending-arm" key={arm}><span>{labels[arm]}</span><div>Hosted run pending</div></li>)}
    </ul>
  </section>;
}

export default function Learning() {
  return <>
    <header className="page-heading replay-heading"><div><h1>Replay report</h1><p>Score each alert against the history available when it fired.</p></div></header>
    <ProofStatus />
    <BaselineBars />
    <section className="panel report">
      <header className="report-head"><div><h2>Precedent vs. vector by batch</h2><p>Synthetic replay · Δ reachable nDCG@5 · paired bootstrap 95% CI</p></div></header>
      <div className="chart" role="img" aria-label="Synthetic paired score differences against vector search. Exact differences and 95 percent confidence intervals follow the chart.">
        <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart} margin={{ top: 12, right: 16, bottom: 5, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#362a22" />
          <XAxis dataKey="batch" tickLine={false} axisLine={false} tickFormatter={value => "Batch " + value} tick={{ fill: "#c6b3a6", fontSize: 11 }} />
          <YAxis domain={["auto", "auto"]} width={45} tickLine={false} axisLine={false} tickFormatter={value => value.toFixed(2)} tick={{ fill: "#c6b3a6", fontSize: 11 }} />
          <ReferenceLine y={0} stroke="#b5a99e" strokeDasharray="4 4" />
          <Tooltip contentStyle={{ background: "#1c1815", borderColor: "#514039", color: "#faf7f2" }} labelStyle={{ color: "#faf7f2" }} labelFormatter={value => "Batch " + value} formatter={(value, key) => Array.isArray(value) ? [value.map(delta).join(" to "), "95% CI"] : [delta(value), "Δ vs. vector"]} />
          <Area dataKey="band" stroke="none" fill="#ff6a1a" fillOpacity={.22} isAnimationActive={false} />
          <Line dataKey="delta" type="linear" stroke="#ff6a1a" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
        </ComposedChart></ResponsiveContainer>
      </div>
      <details className="batch-details"><summary>Exact paired differences</summary>
        <div className="scroll-table"><table><thead><tr><th>Batch</th><th>Δ vs. vector</th><th>Paired 95% CI</th></tr></thead><tbody>
          {chart.map(row => <tr key={row.batch}><th scope="row">{row.batch}</th><td>{delta(row.delta)}</td><td>{row.band?.map(delta).join(" to ") || "—"}</td></tr>)}
        </tbody></table></div>
      </details>
    </section>
    <section className="panel report"><header className="report-head"><div><h2>Ablation results</h2><p>All scored batches · {overview.n} alerts · {overview.reachable_n} reachable</p></div></header>
      <div className="scroll-table"><table><thead><tr><th>Retrieval arm</th><th>Reachable nDCG@5</th><th>Hard nDCG@5</th><th>Cross-service hit</th><th>Fix recall</th><th>Context tokens</th><th>Latency p50 / p95</th></tr></thead>
        <tbody>{arms.map(arm => { const x = results.summary[arm]; return <tr key={arm} className={arm === "D" ? "highlight" : ""}>
          <th scope="row"><span className="arm-code">{arm}</span> {labels[arm]}</th><td>{n(x.ndcg)}</td><td>{n(x.hard_ndcg)}</td><td>{percentage(x.reachable_cross_hit)}</td>
          <td>{percentage(x.reachable_fix_recall)}</td><td>{x.reachable_tokens == null ? "—" : Math.round(x.reachable_tokens)}</td><td>—</td></tr>; })}</tbody></table></div>
      <div className="table-note">Reachable share {percentage(overview.reachable)}. Reachable ceiling {n(overview.reachable_ceiling)}. All-alert ceiling {n(overview.ceiling)}.</div>
      <details className="batch-details"><summary>Per-batch values and confidence intervals</summary>
        <div className="scroll-table"><table><thead><tr><th>Batch</th><th>Arm</th><th>Scored</th><th>Reachable</th><th>Hard</th><th>nDCG@5</th><th>95% CI</th></tr></thead>
          <tbody>{results.series.flatMap(batch => arms.map(arm => {
            const item = batch.arms[arm]; const interval = item.ci;
            return <tr key={batch.batch + arm}><th scope="row">{batch.batch}</th><td>{labels[arm]}</td><td>{item.n}</td><td>{item.reachable_n}</td>
              <td>{item.hard_n}</td><td>{n(item.ndcg)}</td><td>{interval ? n(interval[1]) + " to " + n(interval[2]) : "—"}</td></tr>;
          }))}</tbody></table></div>
      </details>
    </section>

    <section className="panel briefing"><div><h3>Reproduce the synthetic replay</h3><p>Run <code>make eval</code> from the repository root to rebuild the report from the bundled SQLite cache.</p></div></section>
  </>;
}
