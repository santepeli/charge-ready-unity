// Sight check: the owner must look like themselves wherever they stand, and nothing may blink as they walk. At every station, with
// every building open and cars in the bays, the owner stands on a grid over the whole lot; each spot is drawn twice, the game as the
// player sees it and the owner alone, and the owner's pixels must keep their own colours (a flat tint or a solid roof fails).
// Then the owner walks across the lot row by row and no object may fade back in and out within blinkSec.
const { serve, launch, openGame } = require('./harness.cjs');

const PORT = Number(process.env.PORT) || 8183, STEP = 1.2, MIN_TRUE = 0.6, BLINK_SEC = 0.6;
const STATIONS = process.env.SIGHT_ONLY?.split(',') ?? ['town', 'highway', 'airport', 'hotel', 'mall'];

(async () => {
  const server = serve(PORT), failures = [], errors = [];
  for (const station of STATIONS) {
    const browser = await launch();
    const page = await openGame(browser, PORT, 'probe', { viewport: { width: 390, height: 844 }, station, errors });
    await page.click('#startBtn', { force: true });
    const res = await page.evaluate(async ([STEP, MIN_TRUE, BLINK_SEC]) => {
      const T = await import('three'), { CONFIG } = await import('./config.js'), g = window.__cr, out = [];
      g.renderer.setPixelRatio(1);
      // Shadows are left out of both drawings, so a roof's shadow on the owner is not mistaken for a tint.
      g.renderer.shadowMap.enabled = false;
      const scene = g.player.g.parent;
      scene.traverse((o) => [o.material].flat().forEach((m) => m && (m.needsUpdate = true)));
      // Every building open and cars in the bays, as a grown station looks.
      Object.assign(g.state, { served: 1, cash: 40, doneAt: 1 });
      for (const open of [() => g.mobile.open(), () => g.wash.open?.(), ...['tire', 'repair', 'tow'].map((k) => () => g.service.open?.(k))]) try { open(); } catch {}
      for (let i = 0; i < 1200; i++) { g.update(0.05, { x: 0, y: 0 }); if (i % 20 === 0) g.draw(0.05); }
      const w = innerWidth, h = innerHeight, rt = new T.WebGLRenderTarget(w, h, { stencilBuffer: true }), A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
      const grab = (buf) => { g.renderer.setRenderTarget(rt); g.renderer.render(scene, g.camera); g.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf); g.renderer.setRenderTarget(null); };
      const KEY = new T.Color(1, 0, 1);
      const alone = () => {
        const hidden = scene.children.filter((o) => o !== g.player.g && !o.isLight && o.visible), bg = scene.background, fog = scene.fog;
        hidden.forEach((o) => { o.visible = false; });
        scene.background = KEY; scene.fog = null;
        grab(B);
        hidden.forEach((o) => { o.visible = true; });
        scene.background = bg; scene.fog = fog;
      };
      const [x0, x1, z0, z1] = CONFIG.world.bounds, zEnd = Math.min(z1, g.reach());
      // One pass over the lot: each spot's share of the owner's own look; the over-shoulder view shows the owner on about 7% of the
      // screen, so an owner on over a tenth means the camera broke.
      const sweep = (step, mode) => {
        const rows = [];
        // On a build pad its price stays on top by design, so the player can read it; those spots are left out.
        const pads = g.stagePads(), onPad = (x, z) => pads.some(([px, pz, size]) => Math.abs(x - px) <= size / 2 && Math.abs(z - pz) <= size / 2);
        for (let z = z0 + 0.6; z <= zEnd - 0.4; z += step) for (let x = x0 + 0.6; x <= x1 - 0.4; x += step) {
          if (onPad(x, z)) continue;
          g.player.g.position.set(x, 0, z);
          // Spots inside a car, a building or a machine cannot be reached: the owner is solid against them.
          g.solidPush(g.player.g.position);
          if (Math.hypot(g.player.g.position.x - x, g.player.g.position.z - z) > 0.05) continue;
          for (let i = 0; i < 6; i++) g.draw(0.05);
          grab(A);
          alone();
          let n = 0, ok = 0;
          for (let i = 0; i < A.length; i += 4) {
            if (B[i] > 240 && B[i + 1] < 15 && B[i + 2] > 240) continue;
            n++;
            if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) < 70) ok++;
          }
          if (n > w * h * 0.1) out.push(`${mode}: the owner covers ${Math.round(n / (w * h) * 100)}% of the screen at ${x.toFixed(1)},${z.toFixed(1)}`);
          else if (n > 40) rows.push([ok / n, `${x.toFixed(1)},${z.toFixed(1)}`]);
        }
        rows.sort((a, b) => a[0] - b[0]);
        for (const [share, at] of rows.filter(([s]) => s < MIN_TRUE).slice(0, 4)) out.push(`${mode}: owner at ${at} keeps only ${Math.round(share * 100)}% of their own look`);
        return `${mode} worst ${rows[0] ? `${Math.round(rows[0][0] * 100)}% at ${rows[0][1]}` : 'none'} of ${rows.length}`;
      };
      const info = [sweep(STEP, 'play view')];
      // Walk the lot row by row; an object that is faded, clears and fades again within BLINK_SEC blinks.
      const clearAt = new Map();
      let t = 0, blinks = 0, blinkAt = '';
      for (let z = z0 + 1; z <= zEnd - 1; z += 2) {
        g.player.g.position.set(x0 + 0.6, 0, z);
        for (let k = 0; k < 400 && g.player.g.position.x < x1 - 0.6; k++) {
          g.update(0.05, { x: 1, y: 0 });
          g.draw(0.05);
          t += 0.05;
          const now = new Set(g.faded?.() ?? []);
          for (const o of now) if (clearAt.has(o)) { if (t - clearAt.get(o) < BLINK_SEC) { blinks++; blinkAt = `${g.player.g.position.x.toFixed(1)},${z.toFixed(1)}`; } clearAt.delete(o); }
          for (const o of g.__lastFaded ?? []) if (!now.has(o)) clearAt.set(o, t);
          g.__lastFaded = now;
        }
      }
      if (blinks) out.push(`${blinks} blink(s) while walking, last near ${blinkAt}`);
      // Standing still brings the lower eye view, where walls and roofs come in front more easily.
      for (let i = 0; i < 120 && g.eye() < 1; i++) { g.update(0.05, { x: 0, y: 0 }); g.draw(0.05); }
      info.push(g.eye() < 1 ? 'eye view not reached' : sweep(STEP * 2, 'eye view'));
      return { out, info: info.join(', ') };
    }, [STEP, MIN_TRUE, BLINK_SEC]);
    console.log(`info: ${station}: ${res.info}`);
    failures.push(...res.out.map((f) => `${station}: ${f}`));
    await browser.close();
  }
  server.close();
  failures.push(...errors.map((e) => `page error: ${e}`));
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'PASS (the owner keeps their own look everywhere on the lot, nothing blinks)');
  process.exit(failures.length ? 1 : 0);
})();
