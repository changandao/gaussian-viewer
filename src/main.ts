import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { FlyController } from "./flyController";
import { FpsMeter } from "./fpsMeter";
import { GyroLook } from "./gyroLook";
import { loadFromFile, loadFromUrl, type CameraView, type LoadedScene } from "./loader";
import { HoldButton, MoveDial } from "./touchControls";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- three.js / spark setup ----------
const canvas = $<HTMLCanvasElement>("viewport");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0b0d10, 1);

const scene = new THREE.Scene();
const DEFAULT_FOV = 60;
const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.01, 1000);
const spark = new SparkRenderer({ renderer });
scene.add(spark);

/** Parent of all splat meshes, so the whole scene can be flipped at once. */
const world = new THREE.Group();
scene.add(world);

const dial = new MoveDial($("dial"));
const gyro = new GyroLook();
const controller = new FlyController(
  camera,
  canvas,
  dial,
  new HoldButton($("btn-up")),
  new HoldButton($("btn-down")),
  gyro,
);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

const timer = new THREE.Timer();
timer.connect(document);
const fpsMeter = new FpsMeter($("fps"));
renderer.setAnimationLoop((time) => {
  timer.update(time);
  controller.update(timer.getDelta());
  renderer.render(scene, camera);
  fpsMeter.tick(time);
});

// ---------- UI ----------
const statusEl = $("status");
const statusText = $("status-text");
const progressBar = $("progress-bar");
const emptyHint = $("empty-hint");
const viewSelect = $<HTMLSelectElement>("view-select");
const fileInput = $<HTMLInputElement>("file-input");
const flipBtn = $("btn-flip");

function setStatus(fraction: number | null, label: string) {
  statusEl.hidden = false;
  statusText.textContent = label;
  progressBar.style.width = fraction === null ? "100%" : `${Math.round(fraction * 100)}%`;
  progressBar.style.opacity = fraction === null ? "0.35" : "1";
}
function clearStatus() {
  statusEl.hidden = true;
}
function showError(err: unknown, prefix = "Failed to load") {
  console.error(err);
  setStatus(0, `${prefix}: ${err instanceof Error ? err.message : String(err)}`);
  setTimeout(clearStatus, 6000);
}

let views: CameraView[] = [];
let sceneBounds: THREE.Box3 | null = null;
let homeView: () => void = () => {};

function applyView(v: CameraView) {
  camera.fov = v.fovY ?? DEFAULT_FOV;
  camera.updateProjectionMatrix();
  const p = new THREE.Vector3(...v.position);
  const q = new THREE.Quaternion(...v.quaternion);
  // Views are expressed in the splat's frame; account for the world flip.
  p.applyMatrix4(world.matrixWorld);
  q.premultiply(world.quaternion);
  controller.setPose(p, q);
}

function computeDefaultHome() {
  if (!sceneBounds || sceneBounds.isEmpty()) {
    controller.lookAt(new THREE.Vector3(0, 0, 3), new THREE.Vector3());
    return;
  }
  const box = sceneBounds.clone().applyMatrix4(world.matrixWorld);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) * 0.5;
  camera.fov = DEFAULT_FOV;
  camera.updateProjectionMatrix();
  controller.lookAt(center.clone().add(new THREE.Vector3(0, r * 0.25, r * 1.4)), center);
}

/**
 * Axis-aligned bounds of splat centers between the 2nd and 98th percentile.
 * Far-away outliers (sky/background splats) otherwise blow up the box.
 */
function robustBounds(meshes: SplatMesh[]): THREE.Box3 {
  const MAX_SAMPLES = 200_000;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (const m of meshes) {
    const n = m.packedSplats?.numSplats ?? 0;
    const stride = Math.max(1, Math.ceil((n * meshes.length) / MAX_SAMPLES));
    m.forEachSplat((i, c) => {
      if (i % stride !== 0) return;
      xs.push(c.x);
      ys.push(c.y);
      zs.push(c.z);
    });
  }
  if (xs.length === 0) {
    const box = new THREE.Box3();
    for (const m of meshes) box.union(m.getBoundingBox(true));
    return box;
  }
  const pct = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  for (const a of [xs, ys, zs]) a.sort((u, v) => u - v);
  return new THREE.Box3(
    new THREE.Vector3(pct(xs, 0.02), pct(ys, 0.02), pct(zs, 0.02)),
    new THREE.Vector3(pct(xs, 0.98), pct(ys, 0.98), pct(zs, 0.98)),
  );
}

function updateBaseSpeed() {
  if (!sceneBounds || sceneBounds.isEmpty()) return;
  const size = sceneBounds.getSize(new THREE.Vector3());
  // Roughly cross the scene diagonal in ~12 s (≈ walking pace for a room).
  controller.baseSpeed = THREE.MathUtils.clamp(size.length() / 12, 0.05, 50);
}

async function showScene(loaded: LoadedScene) {
  for (const child of [...world.children]) {
    world.remove(child);
    (child as SplatMesh).dispose?.();
  }
  sceneBounds = null;

  const meshes: SplatMesh[] = [];
  for (let i = 0; i < loaded.splats.length; i++) {
    const s = loaded.splats[i];
    setStatus(null, `Decoding ${s.fileName}${loaded.splats.length > 1 ? ` (${i + 1}/${loaded.splats.length})` : ""}…`);
    const mesh = new SplatMesh({ fileBytes: s.bytes, fileName: s.fileName });
    await mesh.initialized;
    world.add(mesh);
    meshes.push(mesh);
  }
  sceneBounds = robustBounds(meshes);
  updateBaseSpeed();
  const sz = sceneBounds.getSize(new THREE.Vector3());
  console.info(
    `scene extent (2-98%): ${sz.x.toFixed(2)} x ${sz.y.toFixed(2)} x ${sz.z.toFixed(2)}, ` +
      `base speed ${controller.baseSpeed.toFixed(2)}/s`,
  );

  views = loaded.views;
  viewSelect.innerHTML = "";
  viewSelect.hidden = views.length === 0;
  views.forEach((v, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = v.name;
    viewSelect.appendChild(opt);
  });

  homeView = views.length > 0 ? () => applyView(views[0]) : computeDefaultHome;
  viewSelect.value = "0";
  homeView();

  fpsMeter.setSplatCount(meshes.reduce((n, m) => n + (m.packedSplats?.numSplats ?? 0), 0));
  emptyHint.hidden = true;
  document.title = `${loaded.name} · Gaussian Viewer`;
  clearStatus();
}

async function load(task: Promise<LoadedScene>) {
  try {
    await showScene(await task);
  } catch (err) {
    showError(err);
  }
}

$("btn-open").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void load(loadFromFile(f, setStatus));
  fileInput.value = "";
});
$("btn-reset").addEventListener("click", () => homeView());
viewSelect.addEventListener("change", () => {
  const v = views[Number(viewSelect.value)];
  if (v) applyView(v);
  viewSelect.blur();
});

const speedInput = $<HTMLInputElement>("speed");
const applySpeed = () => (controller.speedFactor = Math.pow(2, Number(speedInput.value)));
speedInput.addEventListener("input", applySpeed);
applySpeed();

flipBtn.addEventListener("click", () => {
  // Rotate 180° about X: converts OpenCV-convention (y-down) splats to y-up.
  const flipped = world.quaternion.x === 0;
  world.quaternion.set(flipped ? 1 : 0, 0, 0, flipped ? 0 : 1);
  world.updateMatrixWorld(true);
  flipBtn.classList.toggle("active", flipped);
  homeView();
});

// Gyro (device IMU) look
const gyroBtn = $("btn-gyro");
gyroBtn.hidden = !GyroLook.isSupported();
gyroBtn.addEventListener("click", async () => {
  try {
    if (gyro.enabled) gyro.disable();
    else await gyro.enable();
  } catch (err) {
    showError(err, "Gyro unavailable");
  }
  controller.onGyroToggled();
  gyroBtn.classList.toggle("active", gyro.enabled);
});

// Drag & drop
const dropOverlay = $("drop-overlay");
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  dropOverlay.hidden = false;
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.hidden = true;
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  const f = e.dataTransfer?.files?.[0];
  if (f) void load(loadFromFile(f, setStatus));
});

// iOS Safari: block pinch-zoom gestures on the page.
document.addEventListener("gesturestart", (e) => e.preventDefault());

// ?url=<splat or zip> to load on startup
const initialUrl = new URLSearchParams(location.search).get("url");
if (initialUrl) void load(loadFromUrl(initialUrl, setStatus));
