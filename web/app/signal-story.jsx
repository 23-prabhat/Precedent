"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import PixelIcon from "./pixel-icon";

const chapters = [
  ["signal", "The alert"],
  ["how", "Find similar incidents"],
  ["relationships", "Inspect the evidence"],
  ["memory", "See what a saved fix changes"],
];

function SplitLine({ children, delay = 0 }) {
  const reduced = useReducedMotion();
  return <span className="split-line" aria-hidden="true">
    {children.split(" ").map((word, i) => <span className="split-word" key={i}>
      <motion.span initial={reduced ? false : { y: "104%", opacity: 0 }}
        animate={{ y: "0%", opacity: 1 }}
        transition={reduced ? { duration: 0 } : { duration: .95, delay: delay + i * .075, ease: [.16, 1, .3, 1] }}>
        {word}
      </motion.span>{" "}
    </span>)}
  </span>;
}

function ScrollPhrase({ children, progress }) {
  const reduced = useReducedMotion();
  const right = useTransform(progress, [.11, .31], [0, 100]);
  const mask = useTransform(right, value => `inset(0 ${100 - value}% 0 0)`);
  return <span className="scroll-phrase">
    <span>{children}</span>
    <motion.span aria-hidden="true" style={{ clipPath: reduced ? "none" : mask }}>{children}</motion.span>
  </span>;
}

export default function SignalStory({ incidentCase, memoryCase }) {
  const { alert, match, relationship, precedent, runbook, vectorCount } = incidentCase;
  const region = useRef(null);
  const stage = useRef(null);
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [compare, setCompare] = useState("graph");
  const [showSaved, setShowSaved] = useState(false);
  const compareValue = useMotionValue(1);
  const savedValue = useMotionValue(0);
  const comparison = useSpring(compareValue, { stiffness: 135, damping: 27 });
  const savedLink = useSpring(savedValue, { stiffness: 135, damping: 27 });
  const { scrollYProgress } = useScroll({ target: region, offset: ["start start", "end end"] });
  const travel = useSpring(scrollYProgress, { stiffness: 155, damping: 30, restDelta: .0004 });
  const progress = reduced ? scrollYProgress : travel;
  const tilt = useTransform(progress, [.39, .58, .76, .89], [9, 0, 0, -7]);
  const linkLength = useTransform(progress, [.44, .63], [0, 1]);

  useMotionValueEvent(scrollYProgress, "change", value => {
    setActive(Math.min(3, Math.max(0, Math.round(value * 3))));
  });

  useEffect(() => {
    let disposed = false;
    let destroy;
    const element = stage.current;
    import("./signal-field").then(({ mountField }) => {
      if (!disposed) destroy = mountField(element, progress, reduced ? compareValue : comparison, reduced ? savedValue : savedLink);
    }).catch(() => {
      if (!disposed) element.dataset.renderer = "static";
    });
    return () => {
      disposed = true;
      destroy?.();
    };
  }, [progress, compareValue, comparison, reduced, savedValue, savedLink]);

  function selectMethod(mode) {
    setCompare(mode);
    compareValue.set(mode === "graph" ? 1 : 0);
  }

  function selectReplay(next) {
    setShowSaved(next);
    savedValue.set(Number(next));
  }

  return <section className="signal-story" ref={region} aria-label="From alert to incident memory">
    <div className="signal-stage" ref={stage} aria-hidden="true">
      <div className="signal-poster" />
      <canvas />
      <div className="field-label" data-point="query">{alert.title}</div>
      <div className="field-label" data-point="source">{relationship.source} <span>{match.services[0]}</span></div>
      <div className="field-label" data-point="target">{relationship.target} <span>{precedent.services[0]}</span></div>
      <div className="field-label" data-point="resolved">{memoryCase.relationship.source} <span>Repository mirrors</span></div>
      <div className="field-label" data-point="remembered">{memoryCase.relationship.target} <span>{memoryCase.precedent.services[0]}</span></div>
    </div>

    <nav className="signal-index" aria-label="Story chapters">
      {chapters.map(([id, label], i) => <a key={id} href={`#${id}`} aria-label={label} aria-current={active === i ? "location" : undefined}>
        <span aria-hidden="true" />
      </a>)}
    </nav>

    <div className="signal-scenes">
      <div className="signal-scene signal-hero" id="signal">
        <div className="scene-inner home-wrap">
          <div className="scene-copy">
            <h1 aria-label="Find the fix. Keep the proof."><SplitLine>Find the fix.</SplitLine><SplitLine delay={.14}>Keep the proof.</SplitLine></h1>
            <p>Precedent is incident memory for on-call engineers. Start with an alert, see which past fixes the evidence points to, and save what worked for the next responder.</p>
            <div className="signal-actions">
              <a className="signal-button" href="#how">Follow this alert <PixelIcon name="next" /></a>
              <Link className="signal-link" href={`/analysis#sample=${incidentCase.id}`}>Open alert in console <PixelIcon name="next" /></Link>
            </div>
          </div>
          <figure className="signal-intake">
            <span className="intake-code">HTTP <strong>503</strong></span>
            <figcaption><strong>API gateway alert</strong><span>Multiple regions · Unstable health checks</span></figcaption>
          </figure>
          <div className="hero-foot"><span><i /> Recorded synthetic incident</span><span>Illustrative projection</span></div>
        </div>
      </div>

      <article className="signal-scene signal-vector" id="how">
        <div className="scene-inner home-wrap">
          <div className="scene-copy">
            <h2><ScrollPhrase progress={progress}>Find an alert</ScrollPhrase><br />that sounds alike.</h2>
            <p>Precedent uses the symptoms to find similar incident reports. The first lead is another gateway outage with intermittent 503s.</p>
            <div className="scene-evidence">
              <span><PixelIcon name="search" /> Closest text match <strong>{match.id}</strong></span>
              <h3>{match.title}</h3>
            </div>
          </div>
        </div>
      </article>

      <article className="signal-scene signal-graph" id="relationships">
        <div className="scene-inner home-wrap">
          <div className="scene-copy">
            <motion.h2 style={{ x: reduced ? 0 : tilt }}>See why the<br />fix is relevant.</motion.h2>
            <p>Precedent follows a responder-confirmed link from the gateway match to a registry failure.</p>
            <div className="retrieval-switch" role="group" aria-label="Compare retrieval on the incident field">
              <button type="button" aria-pressed={compare === "vector"} onClick={() => selectMethod("vector")}>Vector only</button>
              <button type="button" aria-pressed={compare === "graph"} onClick={() => selectMethod("graph")}>HydraDB graph</button>
            </div>
            <div className="scene-result" aria-live="polite">
              <div className="scene-route">
                <strong>{relationship.source}</strong>
                <span className="scene-route-track">
                  <motion.span style={{ scaleX: reduced ? 1 : linkLength }} />
                  <span>{compare === "graph" ? relationship.type : "Text match"}</span>
                </span>
                {compare === "graph" && <strong>{relationship.target}</strong>}
              </div>
              <h3>{compare === "graph" ? precedent.title : match.title}</h3>
              <p>{compare === "graph"
                ? relationship.reason
                : `${relationship.target} is outside the top ${vectorCount} vector results.`}</p>
              {compare === "graph" && <p className="scene-check"><strong>Suggested check</strong> {runbook.why}</p>}
            </div>
          </div>
        </div>
      </article>

      <article className="signal-scene signal-memory" id="memory">
        <div className="scene-inner home-wrap">
          <div className="scene-copy">
            <h2>Save what<br />actually worked.</h2>
            <p>Once the incident is resolved, record the confirmed cause and choose the past incident that helped. See what that changes for a repository mirror alert.</p>
            <div className="retrieval-switch" role="group" aria-label="Compare retrieval before and after recording">
              <button type="button" aria-pressed={!showSaved} onClick={() => selectReplay(false)}>Before recording</button>
              <button type="button" aria-pressed={showSaved} onClick={() => selectReplay(true)}>After recording</button>
            </div>
            <div className="scene-result memory-result" aria-live="polite">
              {showSaved ? <>
                <h3>{memoryCase.precedent.title}</h3>
                <p><code>{memoryCase.relationship.target}</code> now ranks #{memoryCase.rankAfter}, linked from the resolved mirror incident <code>{memoryCase.relationship.source}</code>.</p>
              </> : <>
                <h3>The helpful incident is missing.</h3>
                <p><code>{memoryCase.relationship.target}</code> is outside the top {memoryCase.beforeCount} results for the mirror alert.</p>
              </>}
            </div>
            <Link className="signal-link" href={`/analysis#sample=${memoryCase.sample.id}`}>Record a fix in the console <PixelIcon name="next" /></Link>
          </div>
        </div>
      </article>
    </div>
  </section>;
}
