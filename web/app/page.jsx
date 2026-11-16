import Link from "next/link";
import Brand from "./brand";
import HomeExample from "./home-example";
import PixelIcon from "./pixel-icon";
import SignalStory from "./signal-story";
import ProjectPipeline from "./project-pipeline";
import demo from "../public/demo.json";
import "./home.css";

const examples = [
  ["gateway", "API gateway"],
  ["runner", "CI runners"],
  ["registry", "Container registry"],
].map(([id, name]) => {
  const result = demo.recordings[id];
  return {
    id, name,
    alert: demo.samples.find(item => item.id === id).alert_text,
    vector: result.vector[0],
    precedent: result.precedent.find(item => item.via) || result.precedent[0],
  };
});

const gateway = demo.recordings.gateway;
const mirrorSample = demo.samples.find(item => item.id === "triple-mirrors");
const mirrorReplay = demo.triples[mirrorSample.id];
const signalCase = {
  id: "gateway",
  alert: demo.samples.find(item => item.id === "gateway"),
  match: gateway.vector[0],
  relationship: gateway.paths[0],
  precedent: gateway.precedent.find(item => item.id === gateway.paths[0].target),
  runbook: gateway.briefing.suggested_runbooks[0],
  vectorCount: gateway.vector.length,
};
const memoryCase = {
  sample: mirrorSample,
  relationship: mirrorReplay.edge,
  precedent: mirrorReplay.after.precedent.find(item => item.id === mirrorReplay.edge.target),
  rankAfter: mirrorReplay.after.precedent.findIndex(item => item.id === mirrorReplay.edge.target) + 1,
  beforeCount: mirrorReplay.before.precedent.length,
};

export default function Home() {
  return <div className="home">
    <a className="skip" href="#home-main">Skip to content</a>
    <header className="home-header home-wrap">
      <Brand />
      <nav aria-label="Home navigation">
        <a href="#relationships">Evidence</a><a href="#memory">Saved fixes</a><a href="#example">More alerts</a>
      </nav>
      <Link className="home-open" href="/analysis">Open console <PixelIcon name="next" /></Link>
    </header>
    <main id="home-main">
      <SignalStory incidentCase={signalCase} memoryCase={memoryCase} />

      <section className="home-example home-wrap" id="example" aria-labelledby="case-title">
        <div className="example-intro">
          <h2 id="case-title">Pick another<br />on-call alert.</h2>
          <p>Try a different service. Compare the closest text match with the incident Precedent reaches through a recorded relationship.</p>
        </div>
        <HomeExample cases={examples} />
      </section>

      <section className="home-project home-wrap" id="project" aria-labelledby="project-title">
        <div className="project-intro">
          <h2 id="project-title">Does the saved link help?</h2>
          <p>The replay tests what Precedent can find using only incidents that were already known at the time of each alert.</p>
          <Link className="signal-button" href="/analysis#learning">Open the replay report <PixelIcon name="next" /></Link>
        </div>
        <ProjectPipeline />
      </section>
    </main>
    <footer className="home-footer home-wrap">
      <Brand />
      <a href="https://www.streamlinehq.com/icons/pixel" target="_blank" rel="noreferrer">Pixel icons by Streamline</a>
      <Link href="/analysis">Analysis workspace</Link>
    </footer>
  </div>;
}
