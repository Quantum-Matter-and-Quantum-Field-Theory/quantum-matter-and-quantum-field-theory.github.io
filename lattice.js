import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

const container = document.querySelector(".hero-visual");
const canvas = container?.querySelector(".lattice-canvas");

if (container && canvas) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.set(0, 3.8, 8.2);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const torus = new THREE.Group();
  torus.scale.setScalar(1.08);
  torus.position.set(0, 0.16, 0);
  torus.rotation.y = 0.18;
  scene.add(torus);
  scene.add(new THREE.AmbientLight(0xffffff, 2.1));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(-3, 6, 5);
  scene.add(keyLight);

  const majorRadius = 1.62;
  const minorRadius = 0.68;
  const majorCells = 16;
  const minorCells = 8;
  const disposable = [];

  function torusPosition(majorAngle, minorAngle, offset = 0) {
    const ringRadius = majorRadius + (minorRadius + offset) * Math.cos(minorAngle);
    return new THREE.Vector3(
      ringRadius * Math.cos(majorAngle),
      (minorRadius + offset) * Math.sin(minorAngle),
      ringRadius * Math.sin(majorAngle),
    );
  }

  function addSurfacePatch(majorStart, majorEnd, minorStart, minorEnd, material) {
    const majorSteps = 6;
    const minorSteps = 6;
    const positions = [];
    const indices = [];
    for (let minorStep = 0; minorStep <= minorSteps; minorStep += 1) {
      const minorAngle = THREE.MathUtils.lerp(minorStart, minorEnd, minorStep / minorSteps);
      for (let majorStep = 0; majorStep <= majorSteps; majorStep += 1) {
        const majorAngle = THREE.MathUtils.lerp(majorStart, majorEnd, majorStep / majorSteps);
        positions.push(...torusPosition(majorAngle, minorAngle, 0.012).toArray());
      }
    }
    for (let row = 0; row < minorSteps; row += 1) {
      for (let column = 0; column < majorSteps; column += 1) {
        const current = row * (majorSteps + 1) + column;
        const nextRow = current + majorSteps + 1;
        indices.push(current, current + 1, nextRow, current + 1, nextRow + 1, nextRow);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    disposable.push(geometry, material);
    torus.add(new THREE.Mesh(geometry, material));
  }

  function addCurve(points, color, radius, segments = 48) {
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.12);
    const geometry = new THREE.TubeGeometry(curve, segments, radius, 6, false);
    const material = new THREE.MeshBasicMaterial({ color });
    disposable.push(geometry, material);
    torus.add(new THREE.Mesh(geometry, material));
  }
  function addPath(pointAt, color, radius, divisions) {
    const points = Array.from({ length: divisions + 1 }, (_, index) => pointAt(index / divisions));
    addCurve(points, color, radius, divisions * 2);
  }

  function makeLabel(text, color) {
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 256;
    labelCanvas.height = 96;
    const context = labelCanvas.getContext("2d");
    context.font = "bold 68px Georgia, serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = color;
    context.fillText(text, 128, 48);

    const texture = new THREE.CanvasTexture(labelCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.82, 0.32, 1);
    sprite.renderOrder = 5;
    disposable.push(texture, material);
    torus.add(sprite);
    return sprite;
  }

  const surfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0xc8c8c8,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  disposable.push(surfaceMaterial);

  const surfaceGeometry = new THREE.BufferGeometry();
  const surfacePositions = [];
  const surfaceIndices = [];
  const surfaceMajorSteps = 96;
  const surfaceMinorSteps = 48;
  for (let minorStep = 0; minorStep <= surfaceMinorSteps; minorStep += 1) {
    const minorAngle = (minorStep / surfaceMinorSteps) * Math.PI * 2;
    for (let majorStep = 0; majorStep <= surfaceMajorSteps; majorStep += 1) {
      const majorAngle = (majorStep / surfaceMajorSteps) * Math.PI * 2;
      surfacePositions.push(...torusPosition(majorAngle, minorAngle).toArray());
    }
  }
  for (let minorStep = 0; minorStep < surfaceMinorSteps; minorStep += 1) {
    for (let majorStep = 0; majorStep < surfaceMajorSteps; majorStep += 1) {
      const current = minorStep * (surfaceMajorSteps + 1) + majorStep;
      const nextRow = current + surfaceMajorSteps + 1;
      surfaceIndices.push(current, current + 1, nextRow, current + 1, nextRow + 1, nextRow);
    }
  }
  surfaceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(surfacePositions, 3));
  surfaceGeometry.setIndex(surfaceIndices);
  surfaceGeometry.computeVertexNormals();
  disposable.push(surfaceGeometry);
  torus.add(new THREE.Mesh(surfaceGeometry, surfaceMaterial));

  const latticeMaterial = new THREE.MeshBasicMaterial({ color: 0x343434 });
  disposable.push(latticeMaterial);
  for (let minorIndex = 0; minorIndex < minorCells; minorIndex += 1) {
    const minorAngle = (minorIndex / minorCells) * Math.PI * 2;
    const points = Array.from({ length: 97 }, (_, index) =>
      torusPosition((index / 96) * Math.PI * 2, minorAngle, 0.014));
    const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false), 96, 0.008, 5, false);
    disposable.push(geometry);
    torus.add(new THREE.Mesh(geometry, latticeMaterial));
  }
  for (let majorIndex = 0; majorIndex < majorCells; majorIndex += 1) {
    const majorAngle = (majorIndex / majorCells) * Math.PI * 2;
    const points = Array.from({ length: 49 }, (_, index) =>
      torusPosition(majorAngle, (index / 48) * Math.PI * 2, 0.014));
    const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false), 48, 0.008, 5, false);
    disposable.push(geometry);
    torus.add(new THREE.Mesh(geometry, latticeMaterial));
  }

  const vertexGeometry = new THREE.SphereGeometry(0.043, 10, 8);
  const vertexMaterial = new THREE.MeshBasicMaterial({ color: 0x17191b });
  disposable.push(vertexGeometry, vertexMaterial);
  for (let majorIndex = 0; majorIndex < majorCells; majorIndex += 1) {
    for (let minorIndex = 0; minorIndex < minorCells; minorIndex += 1) {
      const point = torusPosition(
        (majorIndex / majorCells) * Math.PI * 2,
        (minorIndex / minorCells) * Math.PI * 2,
        0.025,
      );
      const vertex = new THREE.Mesh(vertexGeometry, vertexMaterial);
      vertex.position.copy(point);
      torus.add(vertex);
    }
  }

  const red = 0xf13b43;
  const blue = 0x00a9e8;
  addPath((fraction) => torusPosition(fraction * Math.PI * 2, 0.58, 0.04), red, 0.018, 96);
  addPath((fraction) => torusPosition(fraction * Math.PI * 2, 0.86, 0.045), blue, 0.018, 96);

  const plaquetteMajorIndex = 4;
  const plaquetteMinorIndex = 0;
  const plaquetteMajorStart = (plaquetteMajorIndex / majorCells) * Math.PI * 2;
  const plaquetteMinorStart = (plaquetteMinorIndex / minorCells) * Math.PI * 2;
  const cellMajorWidth = (Math.PI * 2) / majorCells;
  const cellMinorWidth = (Math.PI * 2) / minorCells;
  const plaquetteMaterial = new THREE.MeshBasicMaterial({
    color: red,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  addSurfacePatch(
    plaquetteMajorStart,
    plaquetteMajorStart + cellMajorWidth,
    plaquetteMinorStart,
    plaquetteMinorStart + cellMinorWidth,
    plaquetteMaterial,
  );
  const plaquetteLabel = makeLabel("Z", "#17191b");
  plaquetteLabel.scale.set(0.72, 0.42, 1);
  plaquetteLabel.position.copy(torusPosition(
    plaquetteMajorStart + cellMajorWidth * 0.5,
    plaquetteMinorStart + cellMinorWidth * 0.5,
    0.06,
  ));
  const starMajorIndex = 6;
  const starMinorIndex = 1;
  const starMajor = (starMajorIndex / majorCells) * Math.PI * 2;
  const starMinor = (starMinorIndex / minorCells) * Math.PI * 2;
  const starCenter = torusPosition(starMajor, starMinor, 0.04);
  const starEdges = [
    [torusPosition(starMajor - cellMajorWidth, starMinor, 0.045), starCenter],
    [starCenter, torusPosition(starMajor + cellMajorWidth, starMinor, 0.045)],
    [torusPosition(starMajor, starMinor - cellMinorWidth, 0.045), starCenter],
    [starCenter, torusPosition(starMajor, starMinor + cellMinorWidth, 0.045)],
  ];
  starEdges.forEach(([start, end]) => addCurve([start, end], blue, 0.026, 8));
  const starMaterial = new THREE.MeshBasicMaterial({ color: blue });
  const starVertex = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), starMaterial);
  disposable.push(starVertex.geometry, starMaterial);
  starVertex.position.copy(starCenter);
  torus.add(starVertex);
  const starLabel = makeLabel("X", "#17191b");
  starLabel.scale.set(0.72, 0.42, 1);
  starLabel.position.copy(starCenter).add(new THREE.Vector3(0.2, 0.13, 0.14));

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
  resize();

  window.addEventListener("pagehide", () => {
    resizeObserver.disconnect();
    disposable.forEach((resource) => resource.dispose());
    renderer.dispose();
  }, { once: true });
}