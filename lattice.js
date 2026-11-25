import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

const container = document.querySelector(".hero-visual");
const canvas = container?.querySelector(".lattice-canvas");

if (container && canvas) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(0, 2.4, 6.6);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);

  const torus = new THREE.Group();
  scene.add(torus);
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(-2, 5, 6);
  scene.add(keyLight);

  const majorSegments = 48;
  const minorSegments = 12;
  const majorRadius = 1.62;
  const minorRadius = 0.68;
  const bondMaterial = new THREE.MeshStandardMaterial({
    color: 0x73c9f3,
    transparent: true,
    opacity: 0.55,
    emissive: 0x12394d,
    emissiveIntensity: 0.12,
    roughness: 0.55,
  });
  const lineGeometries = [];

  function torusPosition(majorAngle, minorAngle) {
    const ringRadius = majorRadius + minorRadius * Math.cos(minorAngle);
    return new THREE.Vector3(
      ringRadius * Math.cos(majorAngle),
      minorRadius * Math.sin(minorAngle),
      ringRadius * Math.sin(majorAngle),
    );
  }

  function addLatticeLine(points, segments) {
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.15);
    const geometry = new THREE.TubeGeometry(curve, segments, 0.009, 6, false);
    lineGeometries.push(geometry);
    torus.add(new THREE.Mesh(geometry, bondMaterial));
  }

  const majorLineSegments = majorSegments * 2;
  for (let minorIndex = 0; minorIndex < minorSegments; minorIndex += 1) {
    const minorAngle = (minorIndex / minorSegments) * Math.PI * 2;
    const points = Array.from({ length: majorSegments + 1 }, (_, index) => {
      const majorAngle = (index / majorSegments) * Math.PI * 2;
      return torusPosition(majorAngle, minorAngle);
    });
    addLatticeLine(points, majorLineSegments);
  }

  for (let majorIndex = 0; majorIndex < majorSegments; majorIndex += 1) {
    const majorAngle = (majorIndex / majorSegments) * Math.PI * 2;
    const points = Array.from({ length: minorSegments + 1 }, (_, index) => {
      const minorAngle = (index / minorSegments) * Math.PI * 2;
      return torusPosition(majorAngle, minorAngle);
    });
    addLatticeLine(points, minorSegments * 3);
  }

  function updateAccent() {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    bondMaterial.color.set(accent);
    renderer.render(scene, camera);
  }

  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    renderer.render(scene, camera);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const themeObserver = new MutationObserver(updateAccent);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let animationFrame;
  let previousTime = 0;

  function animate(time) {
    animationFrame = requestAnimationFrame(animate);
    if (time - previousTime < 32) return;
    previousTime = time;
    if (!reducedMotion.matches) {
      torus.rotation.y += 0.0012;
      torus.rotation.x = Math.sin(time * 0.0002) * 0.025;
    }
    renderer.render(scene, camera);
  }

  updateAccent();
  resize();
  animationFrame = requestAnimationFrame(animate);

  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    themeObserver.disconnect();
    bondMaterial.dispose();
    lineGeometries.forEach((geometry) => geometry.dispose());
    renderer.dispose();
  }, { once: true });
}