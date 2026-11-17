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

## Input formats

- `.spz`, `.ply`, `.splat`, `.ksplat`, `.sog`
- `.zip` containing splats. Viewfinder exports are understood: `export.json` selects the splat,
  `cameras.json` / `scene.json` provide capture views (dropdown in the toolbar; the first view is the start pose).

Load via the **Open** button, drag & drop, or `?url=<file>`.

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
