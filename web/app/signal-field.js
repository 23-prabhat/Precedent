import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, Line, LineBasicMaterial,
  PerspectiveCamera, Points, Scene, ShaderMaterial, Vector3, WebGLRenderer,
} from "three";

const clamp = value => Math.max(0, Math.min(1, value));
const mix = (a, b, amount) => a + (b - a) * amount;
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const causeTints = {
  "Config change": [.66, .53, .87],
  Capacity: [.94, .65, .31],
  Dependency: [.38, .76, .71],
};
const neutral = [.68, .64, .61];
const orange = [1, .42, .14];
const warning = [1, .69, .22];

function makeSamples(history) {
  let seed = 121509;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const words = [[-2.1, -.15], [.25, 2.35], [.15, -2.25]];
  const fixes = { "Config change": [2.45, .88], Capacity: [-2.42, 1.55], Dependency: [-1.5, -2.05] };
  return history.map(incident => {
    const angle = random() * Math.PI * 2;
    const spread = .24 + Math.sqrt(random()) * 1.45;
    const x = Math.cos(angle) * spread, y = Math.sin(angle) * spread * .72;
    const wording = words[incident.wording];
    const cause = fixes[incident.cause] || [0, 0];
    return {
      id: incident.id,
      wording: [wording[0] + x, wording[1] + y, random() * 2.4 - 1.2],
      fix: [cause[0] + x * .83, cause[1] + y * .83, random() * 1.9 - .95],
      tint: causeTints[incident.cause] || neutral,
      size: 8 + random() * 4,
    };
  });
}

const nodes = [
  { name: "query", vector: [-3.05, -.62, .55], graph: [-3.30, -1.26, .65] },
  { name: "source", vector: [-2.0, .45, .42], graph: [1.05, .35, .5] },
  { name: "target", vector: [3.3, .88, -.45], graph: [2.72, 1.43, .33] },
  { name: "resolved", vector: [-2.4, -.65, .6], graph: [-2.4, -.65, .6] },
  { name: "remembered", vector: [3.45, 1.2, -.5], graph: [2.55, .82, 1.05] },
];

const vertex = `
  attribute float pointSize;
  attribute vec3 tint;
  attribute float intensity;
  varying vec3 vTint;
  varying float vIntensity;
  uniform float pixelRatio;
  void main() {
    vTint = tint;
    vIntensity = intensity;
    vec4 positionInView = modelViewMatrix * vec4(position, 1.);
    gl_Position = projectionMatrix * positionInView;
    gl_PointSize = clamp(pointSize * pixelRatio * (16. / -positionInView.z), 1., 54.);
  }
`;
const fragment = `
  varying vec3 vTint;
  varying float vIntensity;
  void main() {
    float r = length(gl_PointCoord - .5) * 2.;
    float glow = pow(max(0., 1. - r), 2.1);
    float core = 1. - smoothstep(.07, .43, r);
    vec3 color = vTint;
    color = mix(color, vec3(1., .93, .76), core * .6);
    gl_FragColor = vec4(color, (glow * .89 + core * .45) * vIntensity);
  }
`;

export function mountField(element, scroll, comparison, memory, history, ids, lookalikes) {
  let canvas = element.querySelector("canvas");
  // Keep the React-owned canvas replaceable if the driver fails after creating a context.
  const originalCanvas = canvas;
  let renderer;
  let context;
  function useCanvasFallback() {
    if (canvas === originalCanvas) {
      canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      originalCanvas.hidden = true;
      element.append(canvas);
    }
    context = canvas.getContext("2d");
    element.dataset.renderer = context ? "canvas" : "static";
  }

  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
    renderer.setClearColor(0, 0);
    element.dataset.renderer = "webgl";
  } catch {
    useCanvasFallback();
  }

  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, .1, 100);
  camera.position.z = 15;
  const world = new Group();
  scene.add(world);
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const coarse = matchMedia("(pointer: coarse)").matches;
  const particles = makeSamples(history);
  const indexById = new Map(particles.map((point, i) => [point.id, i]));
  const markerIndices = [particles.length, ...ids.map(id => indexById.get(id))];
  const total = particles.length + 2;
  const crosses = lookalikes.map(id => [indexById.get(id), element.querySelector(`[data-lookalike="${id}"]`)]);
  const points = new Float32Array(total * 3);
  const sizes = new Float32Array(total);
  const tint = new Float32Array(total * 3);
  const light = new Float32Array(total);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(points, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute("pointSize", new BufferAttribute(sizes, 1).setUsage(DynamicDrawUsage));
  geometry.setAttribute("tint", new BufferAttribute(tint, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute("intensity", new BufferAttribute(light, 1).setUsage(DynamicDrawUsage));
  const material = new ShaderMaterial({
    vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false,
    blending: AdditiveBlending, uniforms: { pixelRatio: { value: 1 } },
  });
  const cloud = new Points(geometry, material);
  cloud.frustumCulled = false;
  world.add(cloud);
  const bridgeSegments = 62;

  function makeLink(color, fallbackColor) {
    const data = new Float32Array((bridgeSegments + 1) * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(data, 3).setUsage(DynamicDrawUsage));
    const material = new LineBasicMaterial({ color, transparent: true, depthWrite: false });
    const line = new Line(geometry, material);
    line.frustumCulled = false;
    world.add(line);
    return { data, geometry, material, fallbackColor };
  }
  const recall = makeLink(0xa4a6ab, "#b4b7bd");
  const bridge = makeLink(0xff864d, "#ff864d");
  const writeback = makeLink(0xffb47e, "#ffb47e");
  const links = [recall, bridge, writeback];
  const labels = nodes.map(node => element.querySelector(`[data-point="${node.name}"]`));
  const projected = new Vector3();
  const pointer = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0 };
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let running = false;
  let visible = false;
  let frame = 0;
  let startTime;

  function project(values, offset = 0) {
    return projected.fromArray(values, offset).applyMatrix4(world.matrixWorld).project(camera);
  }

  function fillLink(link, from, to, length, lift, opacity) {
    const a = markerIndices[from] * 3;
    const b = markerIndices[to] * 3;
    for (let i = 0; i <= bridgeSegments; i++) {
      const t = i / bridgeSegments * length;
      const bend = Math.sin(t * Math.PI);
      link.data[i * 3] = mix(points[a], points[b], t);
      link.data[i * 3 + 1] = mix(points[a + 1], points[b + 1], t) + bend * lift;
      link.data[i * 3 + 2] = mix(points[a + 2], points[b + 2], t) + bend * .35;
    }
    link.geometry.attributes.position.needsUpdate = true;
    link.material.opacity = opacity;
  }

  function drawCanvas() {
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    links.forEach(link => {
      context.beginPath();
      for (let j = 0; j <= bridgeSegments; j++) {
        const vec = project(link.data, j * 3);
        const x = (vec.x * .5 + .5) * width;
        const y = (.5 - vec.y * .5) * height;
        if (j === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.globalAlpha = link.material.opacity;
      context.strokeStyle = link.fallbackColor;
      context.stroke();
    });
    for (let i = 0; i < total; i++) {
      if (light[i] < .035) continue;
      const vec = project(points, i * 3);
      if (Math.abs(vec.x) > 1.06 || Math.abs(vec.y) > 1.06) continue;
      const radius = Math.max(1.2, sizes[i] * .26);
      const x = (vec.x * .5 + .5) * width;
      const y = (.5 - vec.y * .5) * height;
      context.globalAlpha = light[i] * (i < particles.length ? .83 : .22);
      context.fillStyle = `rgb(${tint[i * 3] * 255} ${tint[i * 3 + 1] * 255} ${tint[i * 3 + 2] * 255})`;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      if (i >= particles.length) {
        context.globalAlpha = light[i];
        context.fillStyle = "#fff0d4";
        context.beginPath();
        context.arc(x, y, Math.min(3, radius), 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = 1;
  }

  function render(time) {
    frame = 0;
    const p = scroll.get();
    const flat = media.matches;
    const narrow = width < 780;
    startTime ??= time;
    const elapsed = time - startTime;
    const drift = flat ? 0 : elapsed * .00055;
    const intro = flat ? 1 : smooth(800, 1500, elapsed);
    const vector = smooth(.035, .30, p);
    const orbit = smooth(.75, .99, p);
    const graph = Math.max((1 - smooth(.07, .22, p)) * intro, smooth(.20, .34, p) * comparison.get()) * (1 - orbit);
    const learned = orbit * clamp(memory.get());
    const fovHeight = 2 * camera.position.z * Math.tan(Math.PI * camera.fov / 360);
    const centerX = narrow ? .5 : mix(mix(.747, .275, vector), .685, smooth(.37, .64, p));
    const vertical = narrow ? mix(.60, .74, vector) : mix(.50, .47, orbit);
    const zoom = Math.min(mix(1.3, 1.04, vector), Math.max(.32, width / height * (narrow ? .79 : 1.01)));
    world.scale.setScalar(zoom);
    world.position.set((centerX - .5) * fovHeight * camera.aspect, (.5 - vertical) * fovHeight, 0);
    tilt.x = mix(tilt.x, flat ? 0 : pointer.x, .09);
    tilt.y = mix(tilt.y, flat ? 0 : pointer.y, .09);
    world.rotation.set(tilt.y * .19, tilt.x * .27, 0);
    world.updateMatrixWorld();
    camera.updateMatrixWorld();

    particles.forEach((star, i) => {
      const offset = i * 3;
      for (let axis = 0; axis < 3; axis++) {
        points[offset + axis] = mix(star.wording[axis], star.fix[axis], vector);
        tint[offset + axis] = mix(neutral[axis], star.tint[axis], vector);
      }
      sizes[i] = star.size;
      light[i] = mix(.72, .39, orbit);
    });

    const highlighted = [1 - orbit, 1 - orbit, graph, orbit, learned];
    nodes.forEach((node, i) => {
      const index = markerIndices[i];
      const position = index * 3;
      if (highlighted[i] > .002) {
        const pathProgress = i >= 3 ? learned : i === 2 ? graph : vector;
        for (let axis = 0; axis < 3; axis++) {
          points[position + axis] = mix(i === 0 ? node.vector[axis] : points[position + axis],
            mix(node.vector[axis], node.graph[axis], pathProgress), highlighted[i]);
        }
        tint.set(i >= 2 ? orange : neutral, position);
        sizes[index] = 25;
        light[index] = Math.max(highlighted[i], i === 0 ? 0 : .72);
        if (i === 0) light[index] = highlighted[i];
      }
      const vec = project(points, position);
      labels[i].style.left = `${(vec.x * .5 + .5) * 100}%`;
      labels[i].style.top = `${(.5 - vec.y * .5) * 100}%`;
      labels[i].style.opacity = String(highlighted[i]);
    });

    const mark = (1 - vector) * (flat ? .72 : smooth(160, 480, elapsed) * (1 - .42 * intro + Math.sin(drift * 9) * .15));
    crosses.forEach(([index, label]) => {
      if (mark > .05) tint.set(warning, index * 3);
      const vec = project(points, index * 3);
      label.style.left = `${(vec.x * .5 + .5) * 100}%`;
      label.style.top = `${(.5 - vec.y * .5) * 100}%`;
      label.style.opacity = String(mark);
    });

    fillLink(recall, 0, 1, 1, .1, (1 - orbit) * .53);
    fillLink(bridge, 1, 2, graph, .56, graph);
    fillLink(writeback, 3, 4, learned, .42, learned);
    const pulse = total - 1;
    const pulseOffset = Math.floor((flat ? .76 : drift % 1) * bridgeSegments) * 3;
    const trail = orbit > .45 ? writeback : bridge;
    for (let axis = 0; axis < 3; axis++) points[pulse * 3 + axis] = trail.data[pulseOffset + axis];
    sizes[pulse] = 36;
    tint.set(orange, pulse * 3);
    light[pulse] = flat ? 0 : orbit > .45 ? learned : graph;
    for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
    if (renderer && !renderer.getContext().isContextLost()) renderer.render(scene, camera);
    else drawCanvas();
    if (running && !flat) frame = requestAnimationFrame(render);
  }

  function schedule() {
    if (!frame && visible && !document.hidden) frame = requestAnimationFrame(render);
  }

  function resize() {
    width = Math.max(1, element.clientWidth);
    height = Math.max(1, element.clientHeight);
    pixelRatio = Math.min(devicePixelRatio || 1, coarse ? 1.25 : 1.55);
    material.uniforms.pixelRatio.value = pixelRatio;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer?.setPixelRatio(pixelRatio);
    renderer?.setSize(width, height, false);
    if (context) {
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
    }
    schedule();
  }

  function updateActivity() {
    running = visible && !document.hidden;
    if (running) schedule();
    else {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  function onPointer(event) {
    pointer.x = event.clientX / width * 2 - 1;
    pointer.y = event.clientY / window.innerHeight * 2 - 1;
  }

  function onContextLost(event) {
    event.preventDefault();
    useCanvasFallback();
    resize();
  }

  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    updateActivity();
  });
  const sizeObserver = new ResizeObserver(resize);
  const unsubscribeScroll = scroll.on("change", schedule);
  const unsubscribeComparison = comparison.on("change", schedule);
  const unsubscribeMemory = memory.on("change", schedule);
  observer.observe(element);
  sizeObserver.observe(element);
  document.addEventListener("visibilitychange", updateActivity);
  media.addEventListener("change", schedule);
  if (!coarse) window.addEventListener("pointermove", onPointer, { passive: true });
  originalCanvas.addEventListener("webglcontextlost", onContextLost);
  resize();

  return () => {
    cancelAnimationFrame(frame);
    unsubscribeScroll();
    unsubscribeComparison();
    unsubscribeMemory();
    observer.disconnect();
    sizeObserver.disconnect();
    document.removeEventListener("visibilitychange", updateActivity);
    media.removeEventListener("change", schedule);
    window.removeEventListener("pointermove", onPointer);
    originalCanvas.removeEventListener("webglcontextlost", onContextLost);
    geometry.dispose();
    material.dispose();
    for (const link of links) {
      link.geometry.dispose();
      link.material.dispose();
    }
    renderer?.dispose();
    if (canvas !== originalCanvas) canvas.remove();
    originalCanvas.hidden = false;
  };
}
