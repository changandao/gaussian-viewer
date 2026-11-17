/**
 * On-screen controls:
 *  - MoveDial (bottom-left): joystick for forward/back/strafe.
 *  - HoldButton (bottom-right): press-and-hold buttons for up/down.
 *
 * Each control tracks its own pointerId, so several fingers can operate
 * different controls at the same time (e.g. move + ascend + look).
 */

const DEADZONE = 0.08;

export class MoveDial {
  /** Joystick vector in [-1, 1]; x = right, y = forward. */
  readonly move = { x: 0, y: 0 };

  private readonly knob: HTMLElement;
  private pointer: number | null = null;

  constructor(private readonly root: HTMLElement) {
    this.knob = root.querySelector<HTMLElement>("#dial-knob")!;

    root.addEventListener("pointerdown", this.onDown);
    root.addEventListener("pointermove", this.onMove);
    root.addEventListener("pointerup", this.onUp);
    root.addEventListener("pointercancel", this.onUp);
    root.addEventListener("lostpointercapture", this.onUp);
    root.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    if (this.pointer !== null) return;
    this.pointer = e.pointerId;
    this.root.setPointerCapture(e.pointerId);
    this.root.classList.add("moving");
    this.update(e);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId === this.pointer) this.update(e);
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    this.move.x = 0;
    this.move.y = 0;
    this.knob.style.transform = "";
    this.root.classList.remove("moving");
  };

  private update(e: PointerEvent) {
    const r = this.root.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    // Knob travel: up to the inner edge of the dial.
    const maxR = r.width * 0.33;
    const len = Math.hypot(dx, dy);
    const k = len > maxR ? maxR / len : 1;
    const kx = dx * k;
    const ky = dy * k;
    this.knob.style.transform = `translate(${kx}px, ${ky}px)`;

    const norm = Math.min(len / maxR, 1);
    const mag = norm < DEADZONE ? 0 : (norm - DEADZONE) / (1 - DEADZONE);
    // Quadratic response: fine control near center, full speed at the rim.
    const scale = norm > 0 ? (mag * mag) / norm : 0;
    this.move.x = (kx / maxR) * scale;
    this.move.y = (-ky / maxR) * scale;
  }
}

export class HoldButton {
  pressed = false;
  private pointer: number | null = null;

  constructor(private readonly el: HTMLElement) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.pointer !== null) return;
      this.pointer = e.pointerId;
      el.setPointerCapture(e.pointerId);
      this.set(true);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.pointer) return;
      this.pointer = null;
      this.set(false);
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private set(v: boolean) {
    this.pressed = v;
    this.el.classList.toggle("pressed", v);
  }
}
