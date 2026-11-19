// Fixed joystick at the bottom of the screen driven by a drag anywhere, plus WASD and arrow keys on desktop.
// Like other idle arcade games: a small dead zone, full speed from `full` of the radius, and the drag's origin trails the finger
// once it is past the radius, so pulling the thumb back turns the owner round at once. Drags may start on any of `surfaces`.
export function createInput(surfaces, radius, { dead, full, tapSlop }) {
  const base = document.getElementById('joy'), knob = base.firstElementChild;
  const keys = new Set();
  let id = null, ox = 0, oy = 0, sx = 0, sy = 0, dragged = false, vec = { x: 0, y: 0 };
  base.style.width = base.style.height = `${radius * 2}px`;

  const down = (e) => {
    if (id !== null) return;
    id = e.pointerId; ox = sx = e.clientX; oy = sy = e.clientY; dragged = false;
    e.currentTarget.setPointerCapture?.(id);
    base.classList.add('active');
  };
  const move = (e) => {
    if (e.pointerId !== id) return;
    dragged ||= Math.hypot(e.clientX - sx, e.clientY - sy) > tapSlop;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const d = Math.hypot(dx, dy);
    if (d > radius) { ox += dx * (1 - radius / d); oy += dy * (1 - radius / d); dx = e.clientX - ox; dy = e.clientY - oy; }
    const r = Math.min(d, radius), m = r <= dead * radius ? 0 : Math.min(1, (r - dead * radius) / ((full - dead) * radius));
    vec = r ? { x: dx / Math.hypot(dx, dy) * m, y: dy / Math.hypot(dx, dy) * m } : { x: 0, y: 0 };
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null; vec = { x: 0, y: 0 };
    base.classList.remove('active'); knob.style.transform = '';
    // A drag that began on a message card must not also count as a tap on it.
    if (dragged) {
      const swallow = (c) => c.stopPropagation();
      addEventListener('click', swallow, true);
      setTimeout(() => removeEventListener('click', swallow, true));
    }
  };
  for (const s of surfaces) {
    s.addEventListener('pointerdown', down);
    s.addEventListener('pointermove', move);
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
  }
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));

  const key = (...codes) => codes.some((c) => keys.has(c));
  return () => {
    if (id !== null) return vec;
    const x = key('KeyD', 'ArrowRight') - key('KeyA', 'ArrowLeft'), y = key('KeyS', 'ArrowDown') - key('KeyW', 'ArrowUp');
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  };
}
