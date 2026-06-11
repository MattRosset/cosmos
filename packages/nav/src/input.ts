/** DOM input state for the v1 flight controller (§5.3). */

export interface InputState {
  readonly forward: boolean;
  readonly back: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
  readonly speedBoost: boolean;
  readonly speedSlow: boolean;
  /** Accumulated pointer delta since last consume (pixels). */
  readonly lookDeltaX: number;
  readonly lookDeltaY: number;
}

export interface InputHandler {
  readonly state: InputState;
  attach(el: HTMLElement): () => void;
  /** Move in-progress pointer delta into lookDelta for this frame. */
  accumulatePointerDelta(): void;
  /** Call once per frame after reading look deltas. */
  consumeLookDelta(): void;
}

const POINTER_DEADZONE_PX = 2;

export function createInputHandler(): InputHandler {
  const keys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    up: false,
    down: false,
    speedBoost: false,
    speedSlow: false,
  };

  let lookDeltaX = 0;
  let lookDeltaY = 0;

  let pointerDown = false;
  let pointerCaptured = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragActive = false;
  let pendingDx = 0;
  let pendingDy = 0;

  const inputState: InputState = {
    get forward() {
      return keys.forward;
    },
    get back() {
      return keys.back;
    },
    get left() {
      return keys.left;
    },
    get right() {
      return keys.right;
    },
    get up() {
      return keys.up;
    },
    get down() {
      return keys.down;
    },
    get speedBoost() {
      return keys.speedBoost;
    },
    get speedSlow() {
      return keys.speedSlow;
    },
    get lookDeltaX() {
      return lookDeltaX;
    },
    get lookDeltaY() {
      return lookDeltaY;
    },
  };

  function setKey(code: string, down: boolean): void {
    switch (code) {
      case 'KeyW':
        keys.forward = down;
        break;
      case 'KeyS':
        keys.back = down;
        break;
      case 'KeyA':
        keys.left = down;
        break;
      case 'KeyD':
        keys.right = down;
        break;
      case 'KeyR':
        keys.up = down;
        break;
      case 'KeyF':
        keys.down = down;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.speedBoost = down;
        break;
      case 'ControlLeft':
      case 'ControlRight':
        keys.speedSlow = down;
        break;
      default:
        break;
    }
  }

  function onKeyDown(ev: KeyboardEvent): void {
    setKey(ev.code, true);
  }

  function onKeyUp(ev: KeyboardEvent): void {
    setKey(ev.code, false);
  }

  function onBlur(): void {
    keys.forward = false;
    keys.back = false;
    keys.left = false;
    keys.right = false;
    keys.up = false;
    keys.down = false;
    keys.speedBoost = false;
    keys.speedSlow = false;
    pointerDown = false;
    dragActive = false;
    pendingDx = 0;
    pendingDy = 0;
  }

  function onPointerDown(ev: PointerEvent): void {
    pointerDown = true;
    dragActive = false;
    dragStartX = ev.clientX;
    dragStartY = ev.clientY;
    pendingDx = 0;
    pendingDy = 0;
    const target = ev.currentTarget;
    if (target instanceof HTMLElement && !pointerCaptured) {
      target.setPointerCapture(ev.pointerId);
      pointerCaptured = true;
    }
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!pointerDown) return;
    const totalDx = ev.clientX - dragStartX;
    const totalDy = ev.clientY - dragStartY;
    if (!dragActive) {
      if (Math.hypot(totalDx, totalDy) < POINTER_DEADZONE_PX) return;
      dragActive = true;
    }
    pendingDx = totalDx;
    pendingDy = totalDy;
  }

  function onPointerUp(ev: PointerEvent): void {
    if (dragActive) {
      lookDeltaX += pendingDx;
      lookDeltaY += pendingDy;
    }
    pointerDown = false;
    dragActive = false;
    pendingDx = 0;
    pendingDy = 0;
    const target = ev.currentTarget;
    if (target instanceof HTMLElement && pointerCaptured) {
      target.releasePointerCapture(ev.pointerId);
      pointerCaptured = false;
    }
  }

  return {
    state: inputState,
    attach(el: HTMLElement): () => void {
      el.addEventListener('keydown', onKeyDown);
      el.addEventListener('keyup', onKeyUp);
      el.addEventListener('blur', onBlur);
      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointercancel', onPointerUp);
      if (!el.hasAttribute('tabindex')) {
        el.tabIndex = 0;
      }
      return () => {
        el.removeEventListener('keydown', onKeyDown);
        el.removeEventListener('keyup', onKeyUp);
        el.removeEventListener('blur', onBlur);
        el.removeEventListener('pointerdown', onPointerDown);
        el.removeEventListener('pointermove', onPointerMove);
        el.removeEventListener('pointerup', onPointerUp);
        el.removeEventListener('pointercancel', onPointerUp);
        onBlur();
      };
    },
    accumulatePointerDelta(): void {
      if (pointerDown && dragActive) {
        lookDeltaX += pendingDx;
        lookDeltaY += pendingDy;
        dragStartX += pendingDx;
        dragStartY += pendingDy;
        pendingDx = 0;
        pendingDy = 0;
      }
    },
    consumeLookDelta(): void {
      lookDeltaX = 0;
      lookDeltaY = 0;
    },
  };
}
