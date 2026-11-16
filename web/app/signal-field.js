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

function makeSamples(count) {
  let seed = 121509;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => {
    const diffuse = i % 7 === 0;
    const radius = .25 + Math.pow(random(), diffuse ? .55 : 1.22) * 6.15;
    const arm = (i % 3) * 2.094 + radius * .91;
    const angle = diffuse ? random() * Math.PI * 2 : arm + (random() + random() - 1) * (.26 + radius * .085);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * .69;
    const center = [[-.75, -.04], [2.58, -1.53], [-2.44, 1.82], [2.7, 1.47], [-3.15, -1.45]][i % 5];
    const cluster = (random() + random()) * (i % 5 === 0 ? 1.18 : .74);
    const bearing = random() * Math.PI * 2;
    return {
      spiral: [x, y, (random() - .5) * (diffuse ? 2.9 : .6) + y * .29],
      cluster: [center[0] + Math.cos(bearing) * cluster, center[1] + Math.sin(bearing) * cluster, (random() - .5) * 2.7],
      angle: random() * Math.PI * 2,
      radius: 1.9 + random() * 3.9,
      heat: random(),
      light: (.22 + random() * .78) * (diffuse ? .43 : 1),
      size: .68 + Math.pow(random(), 2.7) * 2.55,
    };
  });
}

const nodes = [
  { name: "query", vector: [-1.82, -.60, .6], graph: [-3.30, -1.26, .65] },
  { name: "source", vector: [-.33, .28, .28], graph: [-.65, .26, .5] },
  { name: "target", vector: [2.61, 1.18, -.45], graph: [2.72, 1.43, .33] },
  { name: "resolved", vector: [-2.4, -.65, .6], graph: [-2.4, -.65, .6] },
  { name: "remembered", vector: [3.45, 1.2, -.5], graph: [2.55, .82, 1.05] },
];

const vertex = `
  attribute float pointSize;
  attribute float heat;
  attribute float intensity;
  varying float vHeat;
  varying float vIntensity;
  uniform float pixelRatio;
  void main() {
    vHeat = heat;
    vIntensity = intensity;
    vec4 positionInView = modelViewMatrix * vec4(position, 1.);
    gl_Position = projectionMatrix * positionInView;
    gl_PointSize = clamp(pointSize * pixelRatio * (16. / -positionInView.z), 1., 54.);
  }
`;
const fragment = `
  varying float vHeat;
  varying float vIntensity;
  void main() {
    float r = length(gl_PointCoord - .5) * 2.;
    float glow = pow(max(0., 1. - r), 2.1);
    float core = 1. - smoothstep(.07, .43, r);
    vec3 color = mix(vec3(.48, .64, .73), vec3(1., .38, .09), vHeat);
    color = mix(color, vec3(1., .93, .76), core * .6);
    gl_FragColor = vec4(color, (glow * .89 + core * .45) * vIntensity);
  }
`;

export function mountField(element, scroll, comparison, memory) {
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
  const particles = makeSamples(coarse ? 1550 : 3150);
  const total = particles.length + nodes.length + 1;
  const points = new Float32Array(total * 3);
  const sizes = new Float32Array(total);
  const heat = new Float32Array(total);
  const light = new Float32Array(total);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(points, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute("pointSize", new BufferAttribute(sizes, 1).setUsage(DynamicDrawUsage));
  geometry.setAttribute("heat", new BufferAttribute(heat, 1).setUsage(DynamicDrawUsage));
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

  function project(values, offset = 0) {
    return projected.fromArray(values, offset).applyMatrix4(world.matrixWorld).project(camera);
  }

  function fillLink(link, from, to, length, lift, opacity) {
    const a = (particles.length + from) * 3;
    const b = (particles.length + to) * 3;
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
      const radius = Math.max(.5, sizes[i] * .43);
      const x = (vec.x * .5 + .5) * width;
      const y = (.5 - vec.y * .5) * height;
      context.globalAlpha = light[i] * (i < particles.length ? .83 : .22);
      context.fillStyle = heat[i] > .62 ? "#fe8150" : heat[i] > .33 ? "#d9bca5" : "#aec9df";
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
    const drift = flat ? 0 : time * .00021;
    const vector = smooth(.035, .30, p);
    const orbit = smooth(.75, .99, p);
    const graph = smooth(.42, .65, p) * comparison.get() * (1 - orbit);
    const learned = orbit * clamp(memory.get());
    const fovHeight = 2 * camera.position.z * Math.tan(Math.PI * camera.fov / 360);
    const centerX = narrow ? .5 : mix(mix(.704, .275, vector), .685, smooth(.37, .64, p));
    const vertical = narrow ? mix(.70, .68, vector) : mix(.50, .47, orbit);
    const zoom = Math.min(mix(1.3, 1.04, vector), Math.max(.32, width / height * (narrow ? .79 : 1.01)));
    world.scale.setScalar(zoom);
    world.position.set((centerX - .5) * fovHeight * camera.aspect, (.5 - vertical) * fovHeight, 0);
    tilt.x = mix(tilt.x, flat ? 0 : pointer.x, .09);
    tilt.y = mix(tilt.y, flat ? 0 : pointer.y, .09);
    world.rotation.set(tilt.y * .19, tilt.x * .27, mix(-.24 + drift * .23, 0, vector));
    world.updateMatrixWorld();
    camera.updateMatrixWorld();

    particles.forEach((star, i) => {
      const offset = i * 3;
      const angle = star.angle + drift * .75;
      const halo = Math.sin(angle) * star.radius * .66;
      points[offset] = mix(mix(star.spiral[0], star.cluster[0], vector), Math.cos(angle) * star.radius, orbit * .91);
      points[offset + 1] = mix(mix(star.spiral[1], star.cluster[1], vector), halo, orbit * .91);
      points[offset + 2] = mix(mix(star.spiral[2], star.cluster[2], vector), Math.sin(angle) * 2.2, orbit * .91);
      sizes[i] = star.size * mix(3.08, 2.55, vector);
      heat[i] = mix(.29 + star.heat * .68, star.heat * .7, vector * (1 - orbit));
      light[i] = star.light * (1 - .34 * graph) * (.87 + .13 * Math.sin(star.angle + drift * 5));
    });

    const visibility = smooth(.13, .26, p);
    nodes.forEach((node, i) => {
      const index = particles.length + i;
      const position = index * 3;
      for (let axis = 0; axis < 3; axis++) points[position + axis] = mix(node.vector[axis], node.graph[axis], i >= 3 ? learned : graph);
      heat[index] = i >= 2 ? .98 : .6;
      sizes[index] = i >= 2 ? 48 : 33;
      const labelOpacity = [visibility * (1 - orbit), visibility * (1 - orbit), graph, orbit, learned][i];
      light[index] = labelOpacity + (i === 2 ? visibility * (1 - orbit) * .19 * (1 - graph) : 0);
      const vec = project(points, position);
      labels[i].style.left = `${(vec.x * .5 + .5) * 100}%`;
      labels[i].style.top = `${(.5 - vec.y * .5) * 100}%`;
      labels[i].style.opacity = String(labelOpacity);
    });

    fillLink(recall, 0, 1, 1, .1, visibility * (1 - orbit) * .5);
    fillLink(bridge, 1, 2, graph, .56, graph);
    fillLink(writeback, 3, 4, learned, .42, learned);
    const pulse = total - 1;
    const pulseOffset = Math.floor((flat ? .76 : drift % 1) * bridgeSegments) * 3;
    const trail = orbit > .45 ? writeback : bridge;
    for (let axis = 0; axis < 3; axis++) points[pulse * 3 + axis] = trail.data[pulseOffset + axis];
    sizes[pulse] = 36;
    heat[pulse] = .98;
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
