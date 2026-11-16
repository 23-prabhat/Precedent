"use client";

import PixelIcon from "./pixel-icon";

function EvidenceCard({ item, onGraph, onDetail }) {
  return <article className="evidence-card">
    <div className="evidence-source">
      <span className="incident-id">{item.id}</span>
      {item.services[0] && <span>{item.services[0]}</span>}
      {item.score != null && <span className="evidence-score" title="Cosine similarity">{item.score.toFixed(2)} similarity</span>}
    </div>
    <h3><button onClick={() => onDetail(item)}>{item.title}</button></h3>
    <p>{item.via ? item.why : item.description}</p>
    {item.via && <button className="text-button" onClick={() => onGraph(item.via)}><PixelIcon name="link" size={14} /> Via {item.via}</button>}
  </article>;
}

function FeaturedEvidence({ item, edge, onGraph, onDetail }) {
  return <article className="featured-evidence">
    <div className="evidence-source">
      <span className="featured-caption"><PixelIcon name="link" size={15} /> Connected precedent</span>
      {item.services[0] && <span>{item.services[0]}</span>}
    </div>
    <h3><button onClick={() => onDetail(item)}>{item.title}</button></h3>
    <p>{item.why}</p>
    <div className="featured-path">
      <span title="Source incident">{item.via}</span>
      <span className="featured-edge"><i />{edge?.type && <span>{edge.type}</span>}<i /></span>
      <span title="Connected incident">{item.id}</span>
      <button onClick={() => onGraph(item.via)}>Inspect relationship</button>
    </div>
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

export default function Evidence({ result, method, setMethod, pending, recorded, onGraph, onDetail }) {
  const graph = method === "precedent";
  const rows = graph ? result.precedent : result.vector;
  const featured = graph ? rows.find(item => item.via) : null;
  const other = rows.filter(item => item !== featured);
  const edge = featured && result.paths?.find(path => path.source === featured.via && path.target === featured.id);
  const mode = recorded ? "Synthetic example" : "Live HydraDB query";

  return <section className="evidence-pane" aria-busy={pending} aria-labelledby="evidence-heading">
    <div className="evidence-toolbar">
      <div><h2 id="evidence-heading">Incident evidence</h2><p>{mode}{!recorded && result.latency_ms != null ? " / " + result.latency_ms + " ms" : ""}</p></div>
      <div className="evidence-methods" role="group" aria-label="Retrieval method">
        <button aria-pressed={graph} onClick={() => setMethod("precedent")}>Graph evidence</button>
        <button aria-pressed={!graph} onClick={() => setMethod("vector")}>Vector baseline</button>
      </div>
    </div>
    {featured && <FeaturedEvidence item={featured} edge={edge} onGraph={onGraph} onDetail={onDetail} />}
    {graph && <EvidenceBrief data={result.briefing} onDetail={onDetail} results={result.precedent} runbooks={result.runbooks} />}
    {other.length > 0 && <div className="other-evidence">
      <div className="other-heading"><h3>{graph ? "More incident leads" : "Similar incidents"}</h3><span>{other.length} {other.length === 1 ? "incident" : "incidents"}</span></div>
      {other.map(item => <EvidenceCard key={item.id} item={item} onGraph={onGraph} onDetail={onDetail} />)}
    </div>}
    {!rows.length && <p className="evidence-empty">No matching incidents surfaced for this alert.</p>}
    {graph && result.runbooks?.length > 0 && <details className="evidence-runbooks">
      <summary>{result.runbooks.length} referenced runbook{result.runbooks.length === 1 ? "" : "s"}</summary>
      {result.runbooks.map(book => <button className="text-button" key={book.id} onClick={() => onDetail(book)}>{book.title}</button>)}
    </details>}
    <p className="evidence-budget">{result.tokens[method]?.toLocaleString() ?? "—"} {recorded ? "approximate " : ""}context tokens</p>
  </section>;
}
