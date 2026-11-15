// Input CINDERQUAY — keyboard, mouse and pointer lock. Plain browser APIs
// only. Look deltas accumulate while locked and are drained by takeLook();
// discrete actions (reload, weapon slots, grenade, buy) go through an
// edge-triggered queue so main.js sees each press exactly once.

const TRACKED = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'Space', 'ControlLeft', 'KeyC',
  'KeyR', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'KeyG', 'KeyE', 'KeyB', 'Tab',
]);

export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = {
    keys,
    locked: false,
    firing: false,
    scoped: false,
    lookX: 0,
    lookY: 0,
  };

  function onKeyDown(event) {
    if (!TRACKED.has(event.code)) return;
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
    // Edge queue: only the first keydown of a held key counts.
    if (!keys.has(event.code)) pressed.add(event.code);
    keys.add(event.code);
  }

  function onKeyUp(event) {
    keys.delete(event.code);
    pressed.delete(event.code);
  }

  function onBlur() {
    keys.clear();
    pressed.clear();
    state.firing = false;
    state.scoped = false;
    state.lookX = 0;
    state.lookY = 0;
  }

  function onMouseMove(event) {
    if (!state.locked) return;
    state.lookX += event.movementX || 0;
    state.lookY += event.movementY || 0;
  }

  function onMouseDown(event) {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.scoped = true;
  }

  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.scoped = false;
  }

  function onLockChangeInner() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      pressed.clear();
      state.firing = false;
      state.scoped = false;
      state.lookX = 0;
      state.lookY = 0;
    }
    if (typeof onLockChange === 'function') {
      try { onLockChange(state.locked); } catch (e) { /* no-op */ }
    }
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLockChangeInner);
  canvas.addEventListener('contextmenu', onContextMenu);

  return {
    state,

    requestLock() {
      try {
        const p = canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => { /* no-op */ });
      } catch (e) { /* no-op */ }
    },

    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },

    consumePressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },

    isDown(code) {
      return keys.has(code);
    },
  };
}
