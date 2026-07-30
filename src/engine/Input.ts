import type { SlotId } from '../game/weapons/Arsenal';

/**
 * Keyboard and mouse.
 *
 * Two details worth calling out:
 *
 * 1. Mouse deltas ACCUMULATE between reads. If two simulation steps run inside
 *    one frame, or a frame is dropped entirely, no input is silently lost.
 * 2. Losing pointer lock auto-pauses. Getting eaten because your cursor slipped
 *    onto the taskbar is the least interesting way for a run to end.
 */
export class Input {
  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();

  mouseDX = 0;
  mouseDY = 0;
  mouseLeft = false;
  mouseRight = false;
  private mouseLeftPressed = false;

  locked = false;
  /** Set when pointer lock is lost. The engine turns this into a pause. */
  lockLost = false;

  private readonly element: HTMLElement;
  private enabled = false;
  private readonly bound: Array<[EventTarget, string, EventListener]> = [];

  constructor(element: HTMLElement) {
    this.element = element;

    const on = (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn);
      this.bound.push([target, type, fn]);
    };

    on(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      // Space and arrows would scroll the page; F3 is ours for the perf overlay.
      if (ev.code === 'Space' || ev.code === 'ArrowUp' || ev.code === 'ArrowDown' || ev.code === 'F3') ev.preventDefault();
      if (ev.repeat) return;
      this.keys.add(ev.code);
      this.pressed.add(ev.code);
    });

    on(window, 'keyup', (e) => {
      this.keys.delete((e as KeyboardEvent).code);
    });

    // Losing window focus must clear held keys, or you come back to the tab
    // already sprinting into a wall.
    on(window, 'blur', () => {
      this.keys.clear();
      this.mouseLeft = false;
      this.mouseRight = false;
    });

    on(element, 'mousedown', (e) => {
      if (!this.enabled) return;
      const ev = e as MouseEvent;
      if (ev.button === 0) {
        this.mouseLeft = true;
        this.mouseLeftPressed = true;
      }
      if (ev.button === 2) this.mouseRight = true;
    });

    on(window, 'mouseup', (e) => {
      const ev = e as MouseEvent;
      if (ev.button === 0) this.mouseLeft = false;
      if (ev.button === 2) this.mouseRight = false;
    });

    on(element, 'contextmenu', (e) => e.preventDefault());

    on(window, 'mousemove', (e) => {
      if (!this.locked) return;
      const ev = e as MouseEvent;
      this.mouseDX += ev.movementX;
      this.mouseDY += ev.movementY;
    });

    on(document, 'pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.element;
      if (wasLocked && !this.locked) this.lockLost = true;
      if (!this.locked) {
        this.mouseLeft = false;
        this.mouseRight = false;
      }
    });
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) {
      this.keys.clear();
      this.pressed.clear();
      this.mouseLeft = false;
      this.mouseRight = false;
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
  }

  requestLock(): void {
    if (this.locked) return;
    // Browsers reject this outside a user gesture; every caller has one.
    const p = this.element.requestPointerLock() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** True once per physical press. Consumed on read. */
  justPressed(code: string): boolean {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  /** Consume the accumulated look delta. */
  takeLook(out: { x: number; y: number }): void {
    out.x = this.mouseDX;
    out.y = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  takeFirePressed(): boolean {
    const v = this.mouseLeftPressed;
    this.mouseLeftPressed = false;
    return v;
  }

  get moveX(): number {
    return (this.down('KeyD') ? 1 : 0) - (this.down('KeyA') ? 1 : 0);
  }

  get moveZ(): number {
    return (this.down('KeyW') ? 1 : 0) - (this.down('KeyS') ? 1 : 0);
  }

  get jump(): boolean {
    return this.down('Space');
  }

  get sprint(): boolean {
    return this.down('ShiftLeft') || this.down('ShiftRight');
  }

  get crouch(): boolean {
    return this.down('ControlLeft') || this.down('ControlRight') || this.down('KeyC');
  }

  get reloadPressed(): boolean {
    return this.justPressed('KeyR');
  }

  get meleePressed(): boolean {
    return this.justPressed('KeyV') || this.justPressed('KeyF');
  }

  get interact(): boolean {
    return this.down('KeyE');
  }

  get interactPressed(): boolean {
    return this.justPressed('KeyE');
  }

  get cycleWeapon(): boolean {
    return this.justPressed('KeyQ');
  }

  get switchTo(): SlotId | null {
    if (this.justPressed('Digit1')) return 'sidewinder';
    if (this.justPressed('Digit2')) return 'hornet';
    if (this.justPressed('Digit3')) return 'breaker';
    return null;
  }

  dispose(): void {
    for (const [target, type, fn] of this.bound) target.removeEventListener(type, fn);
    this.bound.length = 0;
  }
}
