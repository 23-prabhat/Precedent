"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import PixelIcon from "./pixel-icon";

export default function ProjectPipeline() {
  const pipeline = useRef(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: pipeline, offset: ["start .85", "end .57"] });
  const trace = useTransform(scrollYProgress, [0, 1], [.02, 1]);

  return <div className="pipeline-wrap" ref={pipeline}>
    <div className="pipeline-trace" aria-hidden="true"><motion.span style={{ scaleY: reduced ? 1 : trace }} /></div>
    <dl className="project-pipeline">
      <div><dt><PixelIcon name="search" /> Vector baseline</dt><dd>Rank historical incidents by how closely their descriptions match the alert.</dd></div>
      <div><dt><PixelIcon name="link" /> Graph evidence</dt><dd>Check whether existing relationships surface useful incidents beyond the text matches.</dd></div>
      <div><dt><PixelIcon name="report" /> Time-ordered replay</dt><dd>Score each batch of alerts before its resolutions can influence later searches.</dd></div>
    </dl>
  </div>;
}
