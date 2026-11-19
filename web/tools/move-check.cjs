// Movement check against the idle arcade standard (Pizza Ready and its kind). Real pointer events go to the game at 60 frames a
// second of game time: the owner starts and stops at once, a shaky thumb does not move them, a short drag already runs, pulling the
// thumb back turns them round at once, turns are quick but not a snap, diagonals are no faster, a second finger is ignored, a
// cancelled touch stops them, and a drag that starts on a message card still steers.
const { serve, launch, openGame } = require('./harness.cjs');

const PORT = 8165;
// Limits from the genre, in frames at 60 fps: start and stop within 2 frames, a half-radius drag at 90% speed or more, reversal
// within 9 frames (0.15 s), a 180 degree turn in 3 to 12 frames (0.05 to 0.2 s), a 4 px wobble moves under 0.05 units.
const LIM = { startF: 2, stopSlide: 0.05, halfShare: 0.9, reverseF: 9, turnMinF: 3, turnMaxF: 12, wobble: 0.05, diagonal: 1.05 };

(async () => {
  const server = serve(PORT), browser = await launch(), errors = [];
  const page = await openGame(browser, PORT, 'sim', { viewport: { width: 390, height: 844 }, errors });
  await page.click('#startBtn');
  await page.waitForTimeout(1500);
  const res = await page.evaluate(async (LIM) => {
    const { CONFIG } = await import('./config.js'), g = window.__cr, P = g.player.g, [x0, x1, z0, z1] = CONFIG.world.bounds;
    const R = CONFIG.joystick.radius, SPEED = CONFIG.gameplay.playerSpeed, canvas = document.querySelector('canvas'), X = 195, Y = 620;
    const rows = [], fail = [];
    const check = (name, ok, value) => { rows.push(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${value}`); if (!ok) fail.push(`${name}: ${value}`); };
    const ev = (type, x, y, id = 1, el = canvas) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: id === 1, pointerType: 'touch' }));
    const frame = (n = 1) => { for (let i = 0; i < n; i++) { g.update(1 / 60, g.readInput()); g.draw(1 / 60); } };
    const centre = () => { P.position.set((x0 + x1) / 2, 0, Math.min((z0 + z1) / 2, 4)); P.rotation.y = 0; };
    const at = () => ({ x: P.position.x, z: P.position.z });
    const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const yawGap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const speed = (dx, dy) => {
      centre(); ev('pointerdown', X, Y); ev('pointermove', X + dx, Y + dy); frame(10);
      const a = at(); frame(30); const s = dist(at(), a) / 0.5;
      ev('pointerup', X + dx, Y + dy); frame(2);
      return s;
    };

    // Start and stop.
    centre(); let a = at();
    ev('pointerdown', X, Y); ev('pointermove', X + R, Y);
    let f = 0; while (f < 30 && dist(at(), a) < 0.001) { frame(); f++; }
    check('start', f <= LIM.startF, `${f} frames`);
    frame(20); ev('pointerup', X + R, Y); frame(1); a = at(); frame(20);
    check('slide after release', dist(at(), a) <= LIM.stopSlide, `${dist(at(), a).toFixed(3)} units`);

    // Speeds.
    const full = speed(R * 1.5, 0), half = speed(R * 0.5, 0), diag = speed(R, R);
    check('full drag speed', Math.abs(full - SPEED) / SPEED < 0.05, `${full.toFixed(2)} u/s (config ${SPEED})`);
    check('half-radius drag speed', half / full >= LIM.halfShare, `${Math.round(half / full * 100)}% of full`);
    check('diagonal no faster', diag / full <= LIM.diagonal, `${Math.round(diag / full * 100)}% of straight`);

    // A resting thumb that wobbles by 4 px.
    centre(); a = at(); ev('pointerdown', X, Y);
    for (let i = 0; i < 20; i++) { ev('pointermove', X + (i % 2 ? 4 : -4), Y + (i % 3 ? 3 : -3)); frame(); }
    check('4 px wobble', dist(at(), a) <= LIM.wobble, `${dist(at(), a).toFixed(3)} units`);
    ev('pointerup', X, Y); frame(2);

    // The thumb goes far right, then comes back by a bit more than the radius: the owner must head left at once (a joystick whose
    // origin stays put would keep running right).
    centre(); ev('pointerdown', X, Y);
    let fx = X;
    for (let dx = 20; dx <= R * 3; dx += 20) { fx = X + dx; ev('pointermove', fx, Y); frame(); }
    frame(10);
    ev('pointermove', fx - R * 1.3, Y);
    f = 0; let last = at().x;
    while (f < 60) { frame(); f++; if (at().x < last - 0.001) break; last = at().x; }
    check('reverse with the thumb', f <= LIM.reverseF, f >= 60 ? 'never turned back' : `${f} frames`);
    ev('pointerup', X, Y); frame(2);

    // Turn round: frames until facing the other way.
    centre(); ev('pointerdown', X, Y); ev('pointermove', X + R, Y); frame(15); ev('pointerup', X + R, Y); frame(2);
    const yaw0 = P.rotation.y; ev('pointerdown', X, Y); ev('pointermove', X - R, Y);
    f = 0; while (f < 60 && yawGap(P.rotation.y, yaw0) < Math.PI * 0.9) { frame(); f++; }
    check('180 degree turn', f <= LIM.turnMaxF, `${f} frames`);
    check('turn is not a snap', f >= LIM.turnMinF, `${f} frames`);
    ev('pointerup', X - R, Y); frame(2);

    // A second finger is ignored; a cancelled touch stops.
    centre(); ev('pointerdown', X, Y); ev('pointermove', X + R, Y); frame(15);
    ev('pointerdown', 100, 300, 2); ev('pointermove', 100, 200, 2); frame(15);
    check('second finger ignored', yawGap(P.rotation.y, Math.PI / 2) < 0.2, `facing ${Math.round(P.rotation.y * 180 / Math.PI)} deg`);
    ev('pointercancel', X + R, Y); ev('pointerup', 100, 200, 2); frame(1); a = at(); frame(20);
    check('cancelled touch stops', dist(at(), a) <= LIM.stopSlide, `${dist(at(), a).toFixed(3)} units`);

    // A drag that starts on a message card steers like one on the ground.
    const toast = document.getElementById('toast');
    toast.textContent = 'Test message'; toast.hidden = false;
    const r = toast.getBoundingClientRect(), tx = r.left + r.width / 2, ty = r.top + r.height / 2;
    centre(); a = at();
    ev('pointerdown', tx, ty, 1, toast); ev('pointermove', tx + R, ty, 1, toast); frame(20);
    check('drag starting on a message card', dist(at(), a) > 1, `${dist(at(), a).toFixed(2)} units moved`);
    ev('pointerup', tx + R, ty, 1, toast); frame(2);
    toast.hidden = true;

    rows.push(`info top speed ${full.toFixed(1)} u/s`);
    return { rows, fail };
  }, LIM);
  await browser.close();
  server.close();
  console.log(res.rows.join('\n'));
  const failures = [...res.fail, ...errors.map((e) => `page error: ${e}`)];
  console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS movement');
  process.exit(failures.length ? 1 : 0);
})();
