/**
 * Small FPS / frame-time readout. Click it to collapse to a compact chip;
 * the collapsed state is remembered per browser.
 *
 * Note: FPS is the displayed frame rate, capped by the screen refresh rate.
 */

const UPDATE_INTERVAL_MS = 500;
const STORAGE_KEY = "gv.fps.collapsed";

export class FpsMeter {
  private frames = 0;
  private windowStart = performance.now();
  private readonly fpsEl: HTMLElement;
  private readonly msEl: HTMLElement;
  private readonly splatsEl: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.fpsEl = root.querySelector<HTMLElement>(".fps-value")!;
    this.msEl = root.querySelector<HTMLElement>(".fps-ms")!;
    this.splatsEl = root.querySelector<HTMLElement>(".fps-splats")!;

    this.setCollapsed(readCollapsed());
    root.addEventListener("click", () => {
      const collapsed = !root.classList.contains("collapsed");
      this.setCollapsed(collapsed);
      try {
        localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
      } catch {
        /* storage unavailable (private mode etc.) */
      }
    });
  }

  /** Call once per rendered frame. */
  tick(now = performance.now()): void {
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed < UPDATE_INTERVAL_MS) return;

    const fps = (this.frames * 1000) / elapsed;
    const ms = elapsed / this.frames;
    this.fpsEl.textContent = fps.toFixed(0);
    this.msEl.textContent = `${ms.toFixed(1)} ms`;
    this.root.dataset.level = fps >= 50 ? "good" : fps >= 30 ? "ok" : "bad";

    this.frames = 0;
    this.windowStart = now;
  }

  setSplatCount(n: number): void {
    this.splatsEl.textContent = n > 0 ? `· ${formatCount(n)} splats` : "";
  }

  private setCollapsed(collapsed: boolean) {
    this.root.classList.toggle("collapsed", collapsed);
    this.root.title = collapsed ? "Show frame rate" : "Hide frame rate";
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}
