import * as THREE from "three";

/**
 * Device-orientation (IMU) look controls.
 *
 * Converts W3C DeviceOrientation angles (alpha/beta/gamma, Z-X'-Y'' intrinsic)
 * plus the current screen rotation into a camera quaternion in a Y-up world
 * (same math as the classic three.js DeviceOrientationControls).
 */

interface IOSDeviceOrientationEvent {
  requestPermission?: () => Promise<"granted" | "denied">;
}

const ZEE = new THREE.Vector3(0, 0, 1);
// Device frame (screen facing up) -> camera looking out the back of the device.
const Q_BACK = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

export class GyroLook {
  /** Latest device orientation as a camera quaternion, or null if no data yet. */
  readonly quaternion = new THREE.Quaternion();
  hasData = false;
  enabled = false;

  private readonly euler = new THREE.Euler();
  private readonly q0 = new THREE.Quaternion();

  static isSupported(): boolean {
    return typeof window !== "undefined" && "DeviceOrientationEvent" in window && navigator.maxTouchPoints > 0;
  }

  /** Must be called from a user gesture (iOS permission prompt). */
  async enable(): Promise<void> {
    if (!window.isSecureContext) {
      throw new Error("Gyro needs HTTPS (secure context)");
    }
    const ctor = DeviceOrientationEvent as unknown as IOSDeviceOrientationEvent;
    if (typeof ctor.requestPermission === "function") {
      const res = await ctor.requestPermission();
      if (res !== "granted") throw new Error("Motion sensor permission denied");
    }
    this.hasData = false;
    window.addEventListener("deviceorientation", this.onOrientation);
    this.enabled = true;
  }

  disable(): void {
    window.removeEventListener("deviceorientation", this.onOrientation);
    this.enabled = false;
    this.hasData = false;
  }

  private onOrientation = (e: DeviceOrientationEvent) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    const d = THREE.MathUtils.DEG2RAD;
    const orient = (screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0) * d;
    this.euler.set(e.beta * d, e.alpha * d, -e.gamma * d, "YXZ");
    this.quaternion.setFromEuler(this.euler);
    this.quaternion.multiply(Q_BACK);
    this.quaternion.multiply(this.q0.setFromAxisAngle(ZEE, -orient));
    this.hasData = true;
  };
}
