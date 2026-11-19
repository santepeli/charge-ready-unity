// View check, as a player's eye sees it on a phone. After a first walk, standing still eases the camera into the owner's own view:
// a wide lens (fov at least FOV_MIN) from behind the owner, who stays low and left of centre, seen over the right shoulder, and does not fill it; the first
// step brings the play view back (its fov and its angle from above). With nothing in front of the owner the see-through copy must not
// draw over them. Runs in real time on three screens, the Claude app's shorter phone view included.
const { serve, launch, openGame } = require('./harness.cjs');

const PORT = 8173, FOV_MIN = 55, TALL_MAX = 0.4, TINT = 0.01;
const SCREENS = [{ width: 390, height: 844 }, { width: 390, height: 700 }, { width: 844, height: 390 }];

(async () => {
  const server = serve(PORT), failures = [], rows = [], errors = [];
  for (const viewport of SCREENS) {
    const browser = await launch();
    // `probe` is the game exactly as a player gets it (opening flight, idle behaviour), with read access for the test.
    const page = await openGame(browser, PORT, 'probe', { viewport, errors });
    await page.click('#startBtn');
    await page.waitForTimeout(6000);
    // Ground area in view (screen corners cast onto the ground) and where the owner sits on screen.
    const view = () => page.evaluate(async () => {
      const THREE = await import('three'), g = window.__cr, rc = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = (x, y) => { rc.setFromCamera(new THREE.Vector2(x, y), g.camera); return rc.ray.intersectPlane(plane, new THREE.Vector3()); };
      const c = [hit(-1, -1), hit(1, -1), hit(1, 1), hit(-1, 1)];
      const area = c.every(Boolean) ? Math.abs(c.reduce((s, p, i) => { const q = c[(i + 1) % 4]; return s + p.x * q.z - q.x * p.z; }, 0)) / 2 : 0;
      const v = g.player.g.position.clone().setY(1).project(g.camera), feet = g.player.g.position.clone().project(g.camera);
      const head = g.player.g.position.clone().setY(g.size(g.player.g).y).project(g.camera);
      const d = g.camera.position.clone().sub(g.player.g.position);
      return { area, fov: g.camera.fov, pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180 / Math.PI, sx: v.x, sy: v.y, tall: (head.y - feet.y) / 2, eye: g.eye(), visible: g.player.g.visible };
    });
    // A short walk first, as a player starts; then hands off the screen.
    const walk = async (ms) => { const cx = viewport.width / 2, cy = viewport.height / 2; await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 60, cy, { steps: 5 }); await page.waitForTimeout(ms); await page.mouse.up(); };
    await walk(800);
    await page.waitForTimeout(400);
    const before = await view();
    // The game's own clock decides; a slow test browser runs it slower than the wall clock.
    await page.waitForFunction(() => window.__cr.eye() >= 0.99, null, { timeout: 30000 }).catch(() => {});
    const after = await view();
    const name = `${viewport.width}x${viewport.height}`;
    rows.push(`${name}: eye view ${after.eye.toFixed(2)}, fov ${after.fov.toFixed(0)}°, camera ${after.pitch.toFixed(0)}° above the owner (play ${before.pitch.toFixed(0)}°), owner ${Math.round(after.tall * 100)}% of the screen tall at ${after.sx.toFixed(2)},${after.sy.toFixed(2)}`);
    if (after.eye < 0.99) failures.push(`${name}: standing still did not reach the eye view`);
    if (after.fov < FOV_MIN) failures.push(`${name}: the eye view is not wide (fov ${after.fov.toFixed(0)}°)`);
    if (after.tall > TALL_MAX) failures.push(`${name}: in the eye view the owner fills ${Math.round(after.tall * 100)}% of the screen height`);
    if (!after.visible || after.sx > 0.05 || after.sx < -0.75 || after.sy > 0.1 || after.sy < -0.95) failures.push(`${name}: the owner is not low and left of centre in the eye view (${after.sx.toFixed(2)},${after.sy.toFixed(2)})`);
    // A plain tap, with no drag, also brings the play view back.
    await page.mouse.click(viewport.width / 2, viewport.height / 2);
    if (!(await page.waitForFunction(() => window.__cr.eye() === 0, null, { timeout: 10000 }).catch(() => null))) failures.push(`${name}: a tap did not leave the eye view`);
    await page.waitForFunction(() => window.__cr.eye() >= 0.99, null, { timeout: 30000 }).catch(() => {});
    await walk(600);
    await page.waitForFunction(() => window.__cr.eye() === 0, null, { timeout: 10000 }).catch(() => {});
    const back = await view();
    if (back.eye > 0 || Math.abs(back.pitch - before.pitch) > 2 || Math.abs(back.fov - before.fov) > 0.5) failures.push(`${name}: a step did not bring the play view back (camera ${back.pitch.toFixed(0)}° high, fov ${back.fov.toFixed(0)}°)`);

    // With nothing in front, the frame with the tint and the frame without it must match on the owner.
    const tint = await page.evaluate(() => {
      const g = window.__cr, gl = g.renderer.getContext(), { width: w, height: h } = g.renderer.domElement;
      const a = new Uint8Array(w * h * 4), b = new Uint8Array(w * h * 4), ghosts = [];
      g.player.g.traverse((m) => { if (m.material?.depthFunc === 6) ghosts.push(m); });
      g.draw(0); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a);
      ghosts.forEach((m) => { m.visible = false; });
      g.renderer.render(g.player.g.parent, g.camera); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
      ghosts.forEach((m) => { m.visible = true; });
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) diff++;
      // The owner's own size on screen is the yardstick.
      g.player.g.visible = false; g.renderer.render(g.player.g.parent, g.camera); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); g.player.g.visible = true;
      let own = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) own++;
      return { diff, own, ghosts: ghosts.length };
    });
    rows.push(`${name}: tint over the owner in the open ${tint.diff} px of ${tint.own} (${tint.ghosts} tint meshes)`);
    if (tint.diff > tint.own * TINT) failures.push(`${name}: with nothing in front, the tint still changes ${tint.diff} of the owner's ${tint.own} px`);
    await browser.close();
  }
  server.close();
  console.log(rows.join('\n'));
  failures.push(...errors.map((e) => `page error: ${e}`));
  console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS view');
  process.exit(failures.length ? 1 : 0);
})();
