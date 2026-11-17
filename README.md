# Gaussian Viewer

Cross-device (desktop / phone / tablet) web viewer for 3D Gaussian Splatting scenes,
built on [three.js](https://threejs.org) + [Spark](https://sparkjs.dev).

## Run

Node.js is provided by [pixi](https://pixi.sh); no global install needed.

```bash
pixi run dev       # HTTPS dev server on https://localhost:5173 (also exposed on LAN)
pixi run build     # static build in dist/
pixi run preview   # serve dist/ over HTTPS
```

Test scene (served directly from the project root in dev mode):

```
https://localhost:5173/?url=/viewfinder-2026-11-17-10-03-12.zip
```

### Phone / tablet

1. Connect the device to the same network and open `https://<this-machine-ip>:5173/?url=/viewfinder-2026-11-17-10-03-12.zip`.
2. The dev certificate is self-signed: accept the browser warning once.
   HTTPS is required for the gyro (DeviceOrientation API).

## Loading any Gaussian splat

Supported: `.spz`, `.ply`, `.splat`, `.ksplat`, `.sog`, and `.zip` packs containing one of them.

### 1. Local file (nothing is uploaded)

Open the site (deployed or local), then either

- click **Open** and pick a file (on phones/tablets this opens the Files / Downloads picker), or
- drag & drop the file onto the page (desktop).

The file is decoded in the browser only. This is the easiest way to look at a private scene
on any device: send the file to the device (AirDrop, chat, network drive) and open it there.

### 2. By URL: `?url=<file>`

```
https://changandao.github.io/gaussian-viewer/?url=<file>
```

- Relative path → file deployed on the same site, e.g. `?url=scenes/garden.spz`.
- Absolute URL → any host, e.g. `?url=https://example.com/garden.spz`. The host must
  - serve the **raw file** (a direct download link, not an HTML share page),
  - use **HTTPS**,
  - allow cross-origin requests (`Access-Control-Allow-Origin`). `raw.githubusercontent.com`
    and Hugging Face file URLs do; most cloud-drive share links do not.
- If the URL itself contains `?` or `&`, URL-encode it (`encodeURIComponent`).

### 3. Local dev server

Put the file in the project root and open `https://localhost:5173/?url=/<file>` after `pixi run dev`.

### Format notes

- **PLY from the original 3DGS / COLMAP pipeline** uses OpenCV axes (Y down) and appears upside down:
  press **Flip**.
- **Zip packs**: if `export.json` (`{"splats":[{"url":"path/in/zip.spz"}]}`) is present, the listed
  splats are loaded; otherwise the first splat file (alphabetical) is used.
  Optional `cameras.json` adds capture views to the toolbar dropdown (first view = start pose):
  ```json
  [{ "imageAsset": { "url": "view-1.png" },
     "camera": {
       "intrinsics": { "fy": 646.8, "height": 720 },
       "extrinsics": { "position": [x, y, z], "quaternion": [qx, qy, qz, qw], "coordinateSystem": "rub" } } }]
  ```
  `coordinateSystem` is `rub` (three.js / OpenGL camera) or `rdf` (OpenCV camera).
  Without cameras the start view frames the scene bounds.
- Prefer `.spz`: it is ~10× smaller than `.ply` for the same scene.

## Controls

| Action | Touch | Desktop |
|---|---|---|
| Move forward / back / strafe | Joystick (bottom-left) | Joystick or `W A S D` |
| Look around | Drag on screen | Mouse drag, arrow keys |
| Up / down | ▲ / ▼ (bottom-right, hold) | ▲ / ▼, `E` / `Q` |
| Gyro look | **Gyro** button (tilt the device; dragging still adjusts heading) | – |
| Dolly | – | Mouse wheel |

Toolbar: **Reset** returns to the start view, **Speed** scales movement (0.25×–4×),
**Flip** rotates the scene 180° about X for OpenCV-convention (Y-down) PLY files.

## Deploy (GitHub Pages, scenes kept out of this repo)

The site itself (viewer code) is public. Scene files live in a **separate private repository**
and are copied into the Pages build under an unlisted path by `.github/workflows/deploy.yml`.

> Note: anything deployed to GitHub Pages is publicly reachable by URL. The unlisted path only
> keeps scenes from being discoverable (plus `noindex` / `robots.txt`); it is not access control.

1. **Slim scene pack** (drops photos/depth maps, keeps splats + cameras):
   ```bash
   pixi run slim-scene viewfinder-XXXX.zip ../gaussian_viewer_scenes/office.zip
   ```
2. **Private scenes repo** `<owner>/gaussian-viewer-scenes`: commit the `*.zip` / `*.spz` files at the repo root.
3. **Fine-grained PAT**: repository access = only the scenes repo, permission *Contents: Read-only*.
4. In this repo → *Settings → Secrets and variables → Actions*:
   - `SCENES_TOKEN` = the PAT
   - `SCENE_PATH` = a random string, e.g. `openssl rand -hex 12`
   - (optional variable `SCENES_REPO` if the scenes repo has a different name)
5. *Settings → Pages → Source*: **GitHub Actions**.
6. Push to `main` (or run the workflow manually). Share:
   ```
   https://<owner>.github.io/gaussian-viewer/?url=s/<SCENE_PATH>/office.zip
   ```

Adding / removing private scenes is described in the scenes repo README.
Pushing to the scenes repo does **not** redeploy the site: run this repo's
*Deploy to GitHub Pages* workflow manually afterwards (*Actions → Run workflow*).

## Public scenes

For scenes that may be public, skip the private repo. Two options:

**A. Ship with the site** (simplest links). Put the file in `public/scenes/` of this repo.
Splat/zip files are git-ignored by default, so add them with `-f`:

```bash
cp garden.spz public/scenes/
git add -f public/scenes/garden.spz
git commit -m "Add garden scene" && git push      # push triggers the deploy
```

Link: `https://changandao.github.io/gaussian-viewer/?url=scenes/garden.spz`

**B. Separate public repo** (keeps this repo small). Commit the file to a public repo, e.g.
`changandao/gaussian-viewer-public-scenes`, and load it through `raw.githubusercontent.com`
(CORS-enabled, no redeploy needed):

```
https://changandao.github.io/gaussian-viewer/?url=https://raw.githubusercontent.com/changandao/gaussian-viewer-public-scenes/main/garden.spz
```

GitHub rejects files over 100 MB; use `.spz` or a slim zip (`pixi run slim-scene`) to stay below.
