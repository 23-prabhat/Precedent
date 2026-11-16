"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

export default function HomeExample({ cases }) {
  const [chosen, setChosen] = useState(cases[0].id);
  const example = cases.find(item => item.id === chosen);
  const reduced = useReducedMotion();

  return <div className="case-study">
    <div className="case-top">
      <div className="case-options" role="group" aria-label="Choose an incident example">
        {cases.map(item => <button key={item.id} type="button" aria-pressed={chosen === item.id} onClick={() => setChosen(item.id)}>
          {item.name}
          {chosen === item.id && <motion.span className="case-indicator" layoutId={reduced ? undefined : "example-indicator"} />}
        </button>)}
      </div>
      <span>Synthetic example</span>
    </div>
    <div className="case-content" aria-live="polite">
      <motion.div key={chosen} initial={reduced || chosen === cases[0].id ? false : { opacity: .35, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .22 }}>
      <dl className="case-alert"><dt>Alert</dt><dd>{example.alert}</dd></dl>
      <div className="case-results">
        <article><span>Closest text match</span><h3>{example.vector.title}</h3><p>{example.vector.id} / {example.vector.services[0]}</p></article>
        <article className="case-linked"><span>Prior incident in the graph</span><h3>{example.precedent.title}</h3><p>{example.precedent.why}</p></article>
      </div>
      <div className="case-foot">
        <span>{example.precedent.via ? `${example.precedent.via} ↔ ${example.precedent.id}` : example.precedent.id}</span>
        <Link href={`/analysis#sample=${example.id}`}>Open this example</Link>
      </div>
      </motion.div>
    </div>
  </div>;
}
