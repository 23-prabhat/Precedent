"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Brand from "./brand";
import Evidence from "./evidence";
import "./analysis.css";
import PixelIcon from "./pixel-icon";
import { publicAsset } from "./public-asset";
import boot from "../public/demo.json";
import { offlineAnalysis, offlineMeter, saveOffline } from "./recorded";

const GraphView = dynamic(() => import("./graph-view"), { ssr: false, loading: () => <div className="panel empty">Loading graph…</div> });
const Learning = dynamic(() => import("./learning"), { ssr: false, loading: () => <div className="panel empty">Loading replay…</div> });
const views = [
  ["console", "Analysis"],
  ["graph", "Memory graph"],
  ["learning", "Replay report"],
];
const initial = boot.samples[0];
const staticDemo = process.env.NEXT_PUBLIC_PRECEDENT_STATIC_DEMO === "1";

async function request(path, payload) {
  if (staticDemo) throw new Error("This recorded demo runs without the API.");
  const res = await fetch(publicAsset(path), payload && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(typeof body.detail === "string" ? body.detail : res.status === 422 ? "Check the information you entered." : "The API is unavailable. Check that the backend is running.");
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function EngineStatus({ meter, recorded, liveConfigured, liveResult }) {
  const state = liveResult ? "Live query verified" : liveConfigured ? "Live settings present" :
    liveConfigured === false ? "Live connection unconfigured" : "Live connection unavailable";
  return <div className="engine-status">
    <div><span className="mode-dot" /><strong>{state}</strong></div>
    <dl><div><dt>Learned links</dt><dd>{meter.learned_edges ?? "—"}</dd></div>
      <div><dt>Confirmed hit rate</dt><dd>{meter.rolling_hit_rate == null ? "—" : Math.round(meter.rolling_hit_rate * 100) + "%"}</dd></div></dl>
    {recorded && <p>Recorded mode uses synthetic incidents and supports offline resolution recording.</p>}
  </div>;
}

function Resolve({ result, sample, text, onClose, onSave }) {
  const dialog = useRef(null);
  const [root, setRoot] = useState(sample?.root_cause || "");
  const [summary, setSummary] = useState(sample?.resolution_text || text);
  const candidates = [...new Map([...result.precedent, ...(result.resolution_candidates || [])].map(item => [item.id, item])).values()];
  const [helped, setHelped] = useState(sample?.withheld_id && candidates.some(item => item.id === sample.expected_precedent_id) ? [sample.expected_precedent_id] : []);
  const [fix, setFix] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const causes = [...new Set(["Config change", "Capacity", "Dependency", "Infrastructure", "Software bug", "Other",
    ...result.precedent.map(p => p.root_cause).filter(c => c !== "unlabeled"), ...(root ? [root] : [])])];

  useEffect(() => { dialog.current?.showModal(); }, []);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({ request_id: result.request_id, incident_text: summary, root_cause: root,
        helped_ids: helped, fix_ids: fix.trim() ? [fix.trim()] : [] });
    } catch (exception) { setError(exception.message); setSaving(false); }
  }

  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); if (!saving) onClose(); }} aria-labelledby="resolve-title">
    <form onSubmit={submit}>
      <div className="dialog-heading"><h2 id="resolve-title">Record resolution</h2><button type="button" className="icon-button" aria-label="Close" disabled={saving} onClick={onClose}><span aria-hidden="true">×</span></button></div><p className="muted">Confirm what helped so it can surface for a future alert.</p>
      <label>Resolution summary<textarea value={summary} rows={3} minLength={8} maxLength={24000} required onChange={e => setSummary(e.target.value)} /></label>
      <label>Root cause<select required value={root} onChange={e => setRoot(e.target.value)}><option value="">Select a cause</option>{causes.map(c => <option key={c}>{c}</option>)}</select></label>
      <fieldset><legend>Helpful precedents</legend>
        {candidates.length ? candidates.map(item => <label className="check-row" key={item.id}>
          <input type="checkbox" checked={helped.includes(item.id)} onChange={e => setHelped(old => e.target.checked ? [...old, item.id] : old.filter(id => id !== item.id))} />
          <span><strong>{item.id}</strong> {item.title}</span></label>) : <p className="muted">This analysis returned no precedents.</p>}
      </fieldset>
      <label>Fix reference <span className="muted">(optional)</span><input value={fix} maxLength={400} placeholder="Runbook ID or issue URL" onChange={e => setFix(e.target.value)} /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button className="button primary" disabled={saving}>{saving ? "Saving resolution…" : "Save resolution"}</button></div>
    </form>
  </dialog>;
}

function Details({ item, onClose, onGraph }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); onClose(); }} aria-labelledby="detail-title">
    <div className="dialog-heading"><span className="incident-id">{item.id}</span><button className="icon-button" aria-label="Close" onClick={onClose}><span aria-hidden="true">×</span></button></div>
    <h2 id="detail-title">{item.title}</h2><p className="muted">{item.services.join(", ")}{item.date ? " / " + item.date : ""}</p>
    <p>{item.description}</p><p>{item.why}</p>
    <div className="dialog-actions">{item.url && <a className="button" href={item.url} target="_blank" rel="noreferrer">Open source <PixelIcon name="next" /></a>}
      <button className="button primary" onClick={() => { onClose(); onGraph(item.id); }}>Open graph</button></div>
  </dialog>;
}

export default function Workbench() {
  const [view, setView] = useState("console");
  const [method, setMethod] = useState("precedent");
  const [recorded, setRecorded] = useState(true);
  const [liveConfigured, setLiveConfigured] = useState(null);
  const [sample, setSample] = useState(initial);
  const [liveSamples, setLiveSamples] = useState([]);
  const [text, setText] = useState(initial.alert_text);
  const [result, setResult] = useState(boot.analysis);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [details, setDetails] = useState(null);
  const [status, setStatus] = useState(null);
  const [meter, setMeter] = useState(boot.meter);
  const [graphId, setGraphId] = useState("all");
  const [resolved, setResolved] = useState(false);
  const form = useRef(null);

  useEffect(() => {
    let active = true;
    if (!recorded) request("/api/samples?recorded=false").then(data => {
      if (active) setLiveSamples(data);
    }).catch(() => {});
    request("/api/memory?recorded=" + recorded).then(data => { if (active) setMeter(data); }).catch(() => {
      if (active && recorded) setMeter(offlineMeter());
    });
    return () => { active = false; };
  }, [recorded]);

  useEffect(() => {
    let active = true;
    request("/api/health").then(data => {
      if (active) setLiveConfigured(Boolean(data.live_configured));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function readRoute() {
      const fragment = window.location.hash.slice(1);
      if (fragment === "learning" || fragment === "graph") {
        setView(fragment);
      } else if (fragment.startsWith("sample=")) {
        const chosen = boot.samples.find(item => item.id === fragment.slice(7));
        if (!chosen) return;
        const recording = boot.recordings[chosen.id] || boot.triples[chosen.id]?.before;
        if (!recording) return;
        setView("console");
        setRecorded(true);
        setSample(chosen);
        setText(chosen.alert_text);
        setResult(recording);
      } else if (fragment === "") {
        setView("console");
      }
    }
    readRoute();
    window.addEventListener("hashchange", readRoute);
    return () => window.removeEventListener("hashchange", readRoute);
  }, []);

  function navigate(next, id = "all") {
    if (next === "graph") setGraphId(id);
    setView(next);
    window.history.replaceState(null, "", next === "console" ? window.location.pathname : "#" + next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function toggle() {
    const next = !recorded;
    setRecorded(next);
    setMethod("precedent");
    setMeter(next ? boot.meter : {});
    setError("");
    setStatus(null);
    setResolved(false);
    setSample(next ? initial : null);
    setText(next ? initial.alert_text : "");
    setResult(next ? boot.analysis : null);
  }

  const examples = recorded ? boot.samples : liveSamples;

  function pick(e) {
    const chosen = examples.find(item => item.id === e.target.value);
    setSample(chosen);
    setMethod("precedent");
    setText(chosen?.alert_text || "");
    setError("");
    setStatus(null);
    setResult(null);
    setResolved(false);
  }

  async function run(e) {
    e?.preventDefault();
    if (pending || text.trim().length < 3) return null;
    setPending(true);
    setMethod("precedent");
    setError("");
    setResolved(false);
    try {
      const data = await request("/api/analyze", { alert_text: text.trim(), recorded, sample_id: sample?.id });
      setResult(data);
      return data;
    } catch (exception) {
      if (recorded && sample?.alert_text === text.trim() && (!exception.status || exception.status === 404 || exception.status >= 500)) {
        const data = offlineAnalysis(sample);
        setResult(data);
        return data;
      }
      setError(exception.message);
      return null;
    }
    finally { setPending(false); }
  }

  async function startResolve() {
    const available = result?.request_id ? result : await run();
    if (available?.request_id) setModal(true);
    else if (available) setError("Connect the API to save this resolution, or try a recorded learning demo.");
  }

  async function save(payload) {
    const offline = payload.request_id.startsWith("recording/");
    const output = offline ? saveOffline(sample, payload.helped_ids) : await request("/api/resolve", payload);
    setModal(false);
    setResolved(true);
    setStatus(output);
    if (offline) setMeter(offlineMeter());
    else request("/api/memory?recorded=" + recorded).then(setMeter).catch(() => {});
  }

  const analyzed = Boolean(result);
  const canResolve = analyzed && !resolved && !pending;
  return <div className="app-shell">
    <a className="skip" href="#main">Skip to content</a>
    <div className="stage">
      <header className="workspace-bar">
        <div className="workspace-bar-inner">
          <Brand />
          <nav aria-label="Workspace">
            {views.map(([key, name]) => <button key={key} className={view === key ? "nav active" : "nav"}
              aria-current={view === key ? "page" : undefined} onClick={() => navigate(key)}><PixelIcon name={{console:"search",graph:"link",learning:"report"}[key]} size={14} />{name}</button>)}
          </nav>
              {staticDemo ? <span className="mode-switch"><span className="mode-dot" />Recorded demo</span>
                : <label className="mode-switch"><input type="checkbox" checked={recorded} disabled={pending || modal} onChange={toggle} /><span className="switch-track" /><span>Recorded results</span></label>}
        </div>
      </header>
      <main id="main" className="main">
        {view === "console" && <>
          <header className="analysis-intro">
            <h1>Incident analysis</h1>
            <p>Investigate a new alert with evidence from earlier incidents.</p>
          </header>
          <div className="analysis-workspace">
            <div className="analysis-input">
              <section className="alert-panel" aria-labelledby="alert-title">
                <form ref={form} onSubmit={run}>
                  <div className="alert-head"><div><h2 id="alert-title"><PixelIcon name="alert" size={19} /> {staticDemo ? "Choose an alert" : "Describe the alert"}</h2><p>{staticDemo ? "Explore a recorded sample. A running API can analyze new alerts." : "Include the affected service, error code, or what users experienced."}</p></div></div>
                  <label htmlFor="symptoms" className="sr-only">Alert symptoms</label>
                  <textarea id="symptoms" value={text} placeholder={staticDemo ? "Choose a sample alert…" : "Paste your alert symptoms…"} maxLength={12000} readOnly={pending || staticDemo}
                    onChange={e => { setText(e.target.value); setSample(null); setResult(null); setResolved(false); setStatus(null); }}
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.current?.requestSubmit(); } }} />
                  {examples.length > 0 && <div className="sample-select"><select aria-label="Load a sample alert" value={sample?.id || ""} disabled={pending} onChange={pick}>
                    <option value="">Choose a sample</option>{examples.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><span className="select-caret" aria-hidden="true" /></div>}
                  <div className="composer-actions">
                    <button className="button primary" disabled={pending || text.trim().length < 3}>{pending ? "Analyzing…" : "Analyze alert"} <PixelIcon name="next" size={14} /></button>
                    <kbd>Ctrl / ⌘ + Enter</kbd>
                  </div>
                  {sample?.note && <p className="composer-note">{sample.note}</p>}
                </form>
              </section>
              {error && <p className="error banner" role="alert">{error}</p>}
              {status && <div className="success banner" role="status"><PixelIcon name="check" /> Resolution saved. {status.edges_added.length} {status.edges_added.length === 1 ? "edge" : "edges"} added. <button className="text-button" onClick={() => navigate("graph", status.incident_id)}>View graph <PixelIcon name="next" size={14} /></button><button className="icon-button dismiss" aria-label="Dismiss confirmation" onClick={() => setStatus(null)}><span aria-hidden="true">×</span></button></div>}
            </div>
            {analyzed ? <Evidence result={result} method={method} setMethod={setMethod} pending={pending} recorded={recorded}
              onGraph={id => navigate("graph", id)} onDetail={setDetails} />
              : <section className="evidence-pane evidence-placeholder">
                <h2>Incident evidence</h2>
                <p role={pending ? "status" : undefined}>{pending ? "Comparing the alert with incident history…" : "Analyze an alert to see related incidents and inspect why they surfaced."}</p>
              </section>}
            <div className="analysis-followup">
              {canResolve && <section className="resolution-prompt">
                <div><h2>Have a confirmed fix?</h2><p>Save what helped so a future responder can find it.</p></div>
                <button className="button" onClick={startResolve}>Record resolution</button>
              </section>}
              <EngineStatus meter={meter} recorded={recorded} liveConfigured={liveConfigured} liveResult={analyzed && !recorded} />
            </div>
          </div>
        </>}
        {view === "graph" && <GraphView id={graphId} recorded={recorded} request={request} onConsole={() => navigate("console")} />}
        {view === "learning" && <Learning recorded={recorded} request={request} />}
      </main>
      <footer className="app-footer">
        <span>Precedent</span>
        <nav aria-label="Workspace footer">
          <a href="https://www.streamlinehq.com/icons/pixel" target="_blank" rel="noreferrer">Pixel icons by Streamline</a>
          <a href="https://docs.hydradb.com/" target="_blank" rel="noreferrer">HydraDB docs <PixelIcon name="next" size={12} /></a>
        </nav>
      </footer>
    </div>
    {modal && result && <Resolve result={result} sample={sample} text={text} onClose={() => setModal(false)} onSave={save} />}
    {details && <Details item={details} onClose={() => setDetails(null)} onGraph={id => navigate("graph", id)} />}
  </div>;
}
