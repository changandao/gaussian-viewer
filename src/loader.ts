import { unzip, type Unzipped } from "fflate";

export const SPLAT_EXTENSIONS = [".spz", ".ply", ".splat", ".ksplat", ".sog"];

export interface SplatFile {
  fileName: string;
  bytes: Uint8Array;
}

/** Camera pose in three.js convention (RUB: +X right, +Y up, camera looks down -Z). */
export interface CameraView {
  name: string;
  position: [number, number, number];
  /** [x, y, z, w] */
  quaternion: [number, number, number, number];
  /** Vertical field of view in degrees, if intrinsics are known. */
  fovY?: number;
}

export interface LoadedScene {
  name: string;
  splats: SplatFile[];
  views: CameraView[];
}

export type ProgressFn = (fraction: number | null, label: string) => void;

const lower = (s: string) => s.toLowerCase();
const isSplat = (name: string) => SPLAT_EXTENSIONS.some((ext) => lower(name).endsWith(ext));
const isZip = (name: string) => lower(name).endsWith(".zip");
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export async function loadFromFile(file: File, progress: ProgressFn): Promise<LoadedScene> {
  progress(null, `Reading ${file.name}…`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseBytes(file.name, bytes, progress);
}

export async function loadFromUrl(url: string, progress: ProgressFn): Promise<LoadedScene> {
  const name = baseName(new URL(url, location.href).pathname) || "scene";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;

  let bytes: Uint8Array;
  if (!res.body) {
    progress(null, `Downloading ${name}…`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const mb = (received / 1e6).toFixed(1);
      progress(total ? received / total : null, `Downloading ${name} · ${mb} MB`);
    }
    bytes = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.length;
    }
  }
  return parseBytes(name, bytes, progress);
}

async function parseBytes(name: string, bytes: Uint8Array, progress: ProgressFn): Promise<LoadedScene> {
  const zipMagic = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip(name) || zipMagic) {
    progress(null, "Unpacking zip…");
    return parseZip(name, bytes);
  }
  if (!isSplat(name)) {
    throw new Error(`Unsupported file type: ${name}`);
  }
  return { name, splats: [{ fileName: name, bytes }], views: [] };
}

function unzipAsync(bytes: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(
      bytes,
      // Only inflate what we actually need: metadata + splat payloads.
      { filter: (f) => lower(f.name).endsWith(".json") || isSplat(f.name) },
      (err, data) => (err ? reject(err) : resolve(data)),
    );
  });
}

/**
 * Supports generic zips that contain one or more splat files, and the
 * "viewfinder" export layout:
 *   export.json   -> { splats: [{ url }] }
 *   cameras.json  -> [{ imageAsset, camera: { intrinsics, extrinsics } }]
 *   scene.json    -> { frames: [...same as cameras.json...] }
 */
async function parseZip(name: string, bytes: Uint8Array): Promise<LoadedScene> {
  const files = await unzipAsync(bytes);
  // Strip a common top-level folder if the zip was created from a directory.
  const entries = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(files)) {
    if (path.endsWith("/")) continue;
    entries.set(path.replace(/^\.\//, ""), data);
  }
  const findEntry = (rel: string): [string, Uint8Array] | undefined => {
    const want = rel.replace(/^\.\//, "");
    for (const [p, d] of entries) {
      if (p === want || p.endsWith("/" + want)) return [p, d];
    }
    return undefined;
  };
  const readJson = (rel: string): unknown => {
    const hit = findEntry(rel);
    if (!hit) return undefined;
    try {
      return JSON.parse(new TextDecoder().decode(hit[1]));
    } catch {
      return undefined;
    }
  };

  // --- splats ---
  const splats: SplatFile[] = [];
  const exp = readJson("export.json") as { splats?: { url?: string }[] } | undefined;
  for (const s of exp?.splats ?? []) {
    if (!s.url) continue;
    const hit = findEntry(s.url);
    if (hit) splats.push({ fileName: baseName(hit[0]), bytes: hit[1] });
  }
  if (splats.length === 0) {
    const all = [...entries].filter(([p]) => isSplat(p)).sort(([a], [b]) => a.localeCompare(b));
    // Without a manifest, load only the first splat file to avoid overlaying LOD levels.
    if (all.length > 0) splats.push({ fileName: baseName(all[0][0]), bytes: all[0][1] });
  }
  if (splats.length === 0) throw new Error(`No splat file found in ${name}`);

  // --- camera views ---
  let frames = readJson("cameras.json") as unknown;
  if (!Array.isArray(frames)) {
    const scene = readJson("scene.json") as { frames?: unknown } | undefined;
    frames = scene?.frames;
  }
  const views = Array.isArray(frames) ? parseViewfinderFrames(frames) : [];

  return { name, splats, views };
}

interface VfFrame {
  imageAsset?: { url?: string };
  camera?: {
    intrinsics?: { fy?: number; height?: number };
    extrinsics?: {
      position?: number[];
      quaternion?: number[];
      coordinateSystem?: string;
    };
  };
}

function parseViewfinderFrames(frames: unknown[]): CameraView[] {
  const views: CameraView[] = [];
  const seen = new Set<string>();
  frames.forEach((raw, i) => {
    const f = raw as VfFrame;
    const ex = f.camera?.extrinsics;
    if (!ex?.position || !ex.quaternion || ex.position.length !== 3 || ex.quaternion.length !== 4) return;
    const cs = lower(ex.coordinateSystem ?? "rub");
    let q = ex.quaternion as [number, number, number, number];
    if (cs === "rdf") {
      // OpenCV camera (x right, y down, z forward) -> three.js camera: rotate 180° about local X.
      const [x, y, z, w] = q;
      q = [w, z, -y, -x];
    } else if (cs !== "rub") {
      return;
    }
    const key = [...ex.position, ...q].map((v) => v.toFixed(4)).join(",");
    if (seen.has(key)) return; // viewfinder exports often contain duplicate poses
    seen.add(key);

    const intr = f.camera?.intrinsics;
    const fovY =
      intr?.fy && intr.height ? (2 * Math.atan(intr.height / 2 / intr.fy) * 180) / Math.PI : undefined;
    const img = f.imageAsset?.url ? f.imageAsset.url.replace(/\.[^.]+$/, "") : `view ${i + 1}`;
    views.push({
      name: img,
      position: ex.position as [number, number, number],
      quaternion: q,
      fovY,
    });
  });
  return views;
}
