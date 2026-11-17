import * as THREE from "three";
import { GyroLook } from "./gyroLook";
import { HoldButton, MoveDial } from "./touchControls";

const MAX_PITCH = THREE.MathUtils.degToRad(89);
const KEY_YAW_RATE = THREE.MathUtils.degToRad(90); // rad/s
const KEY_PITCH_RATE = THREE.MathUtils.degToRad(60); // rad/s
const ACCEL = 10; // velocity smoothing (1/s)
const VERTICAL_SPEED_RATIO = 0.5;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * First-person "walk/fly" camera controller.
 *
 * Look: drag on the canvas (touch or mouse), arrow keys, or device IMU (gyro).
 * Move: joystick / WASD in the horizontal plane relative to the view heading,
 *       up/down buttons / E,Q along world +Y.
 */
export class FlyController {
  readonly position = new THREE.Vector3();
  /** Heading / pitch used when gyro is off. */
  yaw = 0;
  pitch = 0;
  /** Base translation speed in scene units per second. */
  baseSpeed = 1;
  /** Multiplier set from the UI. */
  speedFactor = 1;

  /** Extra yaw applied on top of the device orientation while gyro is on. */
  private gyroYawOffset = 0;
  private gyroNeedsAlign = false;

  private readonly velocity = new THREE.Vector3();
  private readonly keys = new Set<string>();
  private lookPointer: number | null = null;
  private lastLook = { x: 0, y: 0 };
  private wheelImpulse = 0;
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly tmpQ = new THREE.Quaternion();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly dial: MoveDial,
    private readonly up: HoldButton,
    private readonly down: HoldButton,
    private readonly gyro: GyroLook,
  ) {
    canvas.addEventListener("pointerdown", this.onLookDown);
    canvas.addEventListener("pointermove", this.onLookMove);
    canvas.addEventListener("pointerup", this.onLookUp);
    canvas.addEventListener("pointercancel", this.onLookUp);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  private get gyroActive(): boolean {
    return this.gyro.enabled && this.gyro.hasData;
  }

  setPose(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    this.position.copy(position);
    this.euler.setFromQuaternion(quaternion, "YXZ");
    this.yaw = this.euler.y;
    this.pitch = THREE.MathUtils.clamp(this.euler.x, -MAX_PITCH, MAX_PITCH);
    this.velocity.set(0, 0, 0);
    this.wheelImpulse = 0;
    // With gyro on, keep the device's pitch but adopt the new heading.
    if (this.gyro.enabled) this.gyroNeedsAlign = true;
    this.apply();
  }

  lookAt(position: THREE.Vector3, target: THREE.Vector3): void {
    const m = new THREE.Matrix4().lookAt(position, target, Y_AXIS);
    this.setPose(position, new THREE.Quaternion().setFromRotationMatrix(m));
  }

  /** Call after gyro.enable()/disable() so the view does not jump. */
  onGyroToggled(): void {
    if (this.gyro.enabled) {
      this.gyroNeedsAlign = true;
    } else {
      this.euler.setFromQuaternion(this.camera.quaternion, "YXZ");
      this.yaw = this.euler.y;
      this.pitch = THREE.MathUtils.clamp(this.euler.x, -MAX_PITCH, MAX_PITCH);
    }
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.1);

    // --- keyboard rotation ---
    let yawRate = 0;
    let pitchRate = 0;
    if (this.keys.has("ArrowLeft")) yawRate += 1;
    if (this.keys.has("ArrowRight")) yawRate -= 1;
    if (this.keys.has("ArrowUp")) pitchRate += 1;
    if (this.keys.has("ArrowDown")) pitchRate -= 1;
    this.addLook(yawRate * KEY_YAW_RATE * dt, pitchRate * KEY_PITCH_RATE * dt);

    // --- translation input (local: x = right, y = up, z = forward) ---
    let mx = this.dial.move.x;
    let mz = this.dial.move.y;
    let my = 0;
    if (this.keys.has("KeyW")) mz += 1;
    if (this.keys.has("KeyS")) mz -= 1;
    if (this.keys.has("KeyD")) mx += 1;
    if (this.keys.has("KeyA")) mx -= 1;
    if (this.up.pressed || this.keys.has("KeyE") || this.keys.has("Space")) my += 1;
    if (this.down.pressed || this.keys.has("KeyQ") || this.keys.has("ShiftLeft")) my -= 1;
    const horiz = Math.hypot(mx, mz);
    if (horiz > 1) {
      mx /= horiz;
      mz /= horiz;
    }

    // Heading of the current view projected on the ground plane.
    const heading = this.euler.setFromQuaternion(this.camera.quaternion, "YXZ").y;
    const speed = this.baseSpeed * this.speedFactor;
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
    const target = new THREE.Vector3(
      (-sin * mz + cos * mx) * speed,
      my * speed * VERTICAL_SPEED_RATIO,
      (-cos * mz - sin * mx) * speed,
    );
    const a = 1 - Math.exp(-ACCEL * dt);
    this.velocity.lerp(target, a);
    this.position.addScaledVector(this.velocity, dt);

    if (this.wheelImpulse !== 0) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const step = this.wheelImpulse * a;
      this.position.addScaledVector(fwd, step);
      this.wheelImpulse -= step;
      if (Math.abs(this.wheelImpulse) < 1e-4) this.wheelImpulse = 0;
    }

    this.apply();
  }

  private addLook(dYaw: number, dPitch: number) {
    if (this.gyroActive) {
      // Pitch comes from how the phone is held; only heading is adjustable.
      this.gyroYawOffset += dYaw;
    } else {
      this.yaw += dYaw;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
    }
  }

  private apply() {
    if (this.gyroActive) {
      if (this.gyroNeedsAlign) {
        // Choose the offset so the device's current heading maps to the stored yaw.
        const deviceYaw = this.euler.setFromQuaternion(this.gyro.quaternion, "YXZ").y;
        this.gyroYawOffset = this.yaw - deviceYaw;
        this.gyroNeedsAlign = false;
      }
      this.tmpQ.setFromAxisAngle(Y_AXIS, this.gyroYawOffset);
      this.camera.quaternion.multiplyQuaternions(this.tmpQ, this.gyro.quaternion);
    } else {
      this.euler.set(this.pitch, this.yaw, 0, "YXZ");
      this.camera.quaternion.setFromEuler(this.euler);
    }
    this.camera.position.copy(this.position);
  }

  // ---- drag-to-look on the canvas ("grab the world" style) ----
  private onLookDown = (e: PointerEvent) => {
    if (this.lookPointer !== null) return;
    this.lookPointer = e.pointerId;
    this.lastLook = { x: e.clientX, y: e.clientY };
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onLookMove = (e: PointerEvent) => {
    if (e.pointerId !== this.lookPointer) return;
    const dx = e.clientX - this.lastLook.x;
    const dy = e.clientY - this.lastLook.y;
    this.lastLook = { x: e.clientX, y: e.clientY };
    // Radians per pixel such that dragging the full height pans by the vertical FOV.
    const k = THREE.MathUtils.degToRad(this.camera.fov) / this.canvas.clientHeight;
    this.addLook(dx * k, dy * k);
  };

  private onLookUp = (e: PointerEvent) => {
    if (e.pointerId === this.lookPointer) this.lookPointer = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    this.wheelImpulse += -e.deltaY * unit * 0.002 * this.baseSpeed * this.speedFactor;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    this.keys.add(e.code);
  };
}
