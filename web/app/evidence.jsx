"use client";

import PixelIcon from "./pixel-icon";

function Similarity({ score }) {
  if (!Number.isFinite(score)) return null;
  return <div className="similarity-score">
    <span>Text similarity <strong>{score.toFixed(2)}</strong></span>
    <meter min={-1} max={1} value={score} aria-label="Text similarity" />
  </div>;
}

function Ranking({ title, rows, opposite, scores, fixed, graph, onDetail }) {
  return <section className={"rank-panel" + (graph ? " is-precedent" : "")}>
    <h3><PixelIcon name={graph ? "link" : "search"} /> {title}</h3>
    {rows.length ? <ol>{rows.map((item, i) => {
      const previous = opposite.findIndex(lead => lead.id === item.id);
      const from = graph ? previous : i;
      const to = graph ? i : previous;
      const movement = from < 0 ? `Outside top 5 ↑ #${to + 1}`
        : to < 0 ? `#${from + 1} ↓ Outside top 5`
        : `#${from + 1} ${from === to ? "→" : from > to ? "↑" : "↓"} #${to + 1}`;
      return <li key={item.id} className={fixed.has(item.id) ? "has-fix" : ""}>
        <div className="rank-meta"><span>#{i + 1} <b>{item.id}</b></span><span>{movement}</span></div>
        <button className="rank-title" onClick={() => onDetail(item)}>{item.title}</button>
        <Similarity score={item.score ?? scores.get(item.id)} />
        <span className="fix-badge" data-confirmed={fixed.has(item.id)}>{fixed.has(item.id) ? "Confirmed fix" : "Unconfirmed in this search"}</span>
      </li>;
    })}</ol> : <p className="empty">No incidents returned.</p>}
  </section>;
}

function FeaturedEvidence({ item, edge, onGraph, onDetail }) {
  return <article className="featured-evidence">
    <div className="evidence-source"><span className="featured-caption"><PixelIcon name="link" size={15} /> {edge.type === "SAME_FIX_AS" ? "Confirmed fix path" : "Connected precedent"}</span>
      {item.services[0] && <span>{item.services[0]}</span>}</div>
    <h3><button onClick={() => onDetail(item)}>{item.title}</button></h3>
    <p>{edge.reason}</p>
    <div className="mini-path" aria-label={`Alert matches ${edge.source}, then ${edge.type} connects to ${edge.target}`}>
      <span><i /><small>Query</small><strong>Alert</strong></span>
      <span><i /><small>Text match</small><strong>{edge.source}</strong></span>
      <span><i /><small>{edge.type}</small><strong>{edge.target}</strong></span>
    </div>
    <button className="text-button inspect-fix" onClick={() => onGraph(edge.source)}>Inspect relationship <PixelIcon name="next" size={14} /></button>
  </article>;
}

function EvidenceBrief({ data, onDetail, results, runbooks }) {
  const classification = data?.likely_root_cause_classes[0];
  if (!data || data.abstain) return <aside className="evidence-brief">
    <h3>No clear precedent yet</h3><p>Add an affected service, error code, or symptom to narrow the search.</p>
  </aside>;

  const ids = new Set([...data.precedents.map(item => item.id), ...(classification?.evidence_ids || [])]);
  const sources = [...ids].map(id => results.find(item => item.id === id)).filter(Boolean);
  const books = data.suggested_runbooks.map(book => runbooks?.find(item => item.id === book.id)).filter(Boolean);
  return <aside className="evidence-brief">
    <h3>What to check first</h3>
    {classification && <p><strong>Check for {classification.label.toLowerCase()}.</strong> {data.check_first[0]}</p>}
    {!classification && data.precedents.map(item => <p key={item.id}>{item.why_relevant}</p>)}
    {data.check_first.slice(classification ? 1 : 0).map(check => <p key={check}>{check}</p>)}
    {(sources.length > 0 || books.length > 0) && <div className="evidence-citations">
      {[...sources, ...books].map(item => <button key={item.id} className="text-button" onClick={() => onDetail(item)}>
        {item.doc_type === "runbook" ? item.title : item.id}
      </button>)}
    </div>}
  </aside>;
}

export default function Evidence({ result, pending, recorded, onGraph, onDetail }) {
  const vector = result.vector.slice(0, 5);
  const precedent = result.precedent.slice(0, 5);
  const scores = new Map(result.vector.map(item => [item.id, item.score]));
  const paths = result.paths || [];
  const fixed = new Set(paths.filter(edge => edge.type === "SAME_FIX_AS").map(edge => edge.target));
  const featured = paths.find(edge => fixed.has(edge.target)) || paths[0];
  const featuredItem = featured && precedent.find(item => item.id === featured.target);

  return <section className="evidence-pane" aria-busy={pending} aria-labelledby="evidence-heading">
    <div className="evidence-toolbar">
      <div><h2 id="evidence-heading">Incident evidence</h2><p>{recorded ? "Recorded demo · synthetic" : "Live HydraDB query"}</p></div>
    </div>
    {featuredItem && <FeaturedEvidence item={featuredItem} edge={featured} onGraph={onGraph} onDetail={onDetail} />}
    <div className="rank-compare" aria-label="Top five retrieval comparison">
      <Ranking title="Vector top 5" rows={vector} opposite={precedent} scores={scores} fixed={fixed} onDetail={onDetail} />
      <Ranking title="Precedent top 5" rows={precedent} opposite={vector} scores={scores} fixed={fixed} graph onDetail={onDetail} />
    </div>
    <EvidenceBrief data={result.briefing} onDetail={onDetail} results={precedent} runbooks={result.runbooks} />
    {result.runbooks?.length > 0 && <details className="evidence-runbooks">
      <summary>{result.runbooks.length} referenced runbook{result.runbooks.length === 1 ? "" : "s"}</summary>
      {result.runbooks.map(book => <button className="text-button" key={book.id} onClick={() => onDetail(book)}>{book.title}</button>)}
    </details>}
  </section>;
}
