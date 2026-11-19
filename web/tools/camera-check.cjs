// Camera check, played like a real player on every station and screen: the opening lands on the player, and walking a full tour of the
// lot (every corner, every stage pad, back to the start) the player never leaves the middle box of the screen, the view never jumps,
// and a pad the player stands beside is shown whole.
const { serve, launch, openGame } = require('./harness.cjs');

const { SIZES } = require('./hud-list.cjs');
const PORT = 8143;
const STATIONS = ['town', 'highway', 'airport', 'hotel', 'mall'];
const only = process.env.CAM_ONLY?.split(',');

(async () => {
  const server = serve(PORT), failures = [], errors = [];
  for (const station of STATIONS) for (const [width, height] of SIZES) {
    if (only && !only.includes(`${station}:${width}x${height}`)) continue;
    // A fresh browser per case: long tours in one browser made later pages load slowly.
    const browser = await launch();
    let page;
    try { page = await openGame(browser, PORT, 'sim', { viewport: { width, height }, station, errors }); } catch (e) { failures.push(`${station} ${width}x${height}: game did not load (${errors.slice(-2).join(' | ') || e.message.split('\n')[0]})`); await browser.close(); continue; }
    await page.click('#startBtn');
    if (process.env.CAM_DBG) await page.evaluate(() => { window.CAMDBG = 1; });
    const res = await page.evaluate(async () => {
      const T = await import('three'), { CONFIG } = await import('./config.js'), g = window.__cr, KP = CONFIG.keepPlayer, out = [];
      // Fewer pixels make drawing fast; the screen shape and the camera stay the same.
      g.renderer.setPixelRatio(0.05);
      const ndc = (p) => p.clone().project(g.camera);
      const tag = (p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`;
      // Opening: the camera swoop ends with the player in the middle box.
      for (let i = 0; i < 70; i++) g.draw(0.05);
      const o = ndc(g.player.g.position);
      if (Math.abs(o.x) > KP.x + 0.02 || Math.abs(o.y) > KP.y + 0.02) out.push(`after the opening the player is at ${o.x.toFixed(2)},${o.y.toFixed(2)} on screen`);
      // A mid-game station: the stats bar and a grown camera, as a player who has been here a while sees it.
      Object.assign(g.state, { served: 1, cash: 40, doneAt: 1 });
      let worst = 0, worstAt = '', jump = 0, jumpAt = '', last = null, frames = 0;
      const check = () => {
        const p = g.player.g.position;
        // The glide into and out of the owner's own view is a change of view, checked by the View check.
        if (g.shotOn() || g.eye() > 0) { last = null; return; }
        // At the lot's edge the box widens to edgeView.box so the view can lean out over the scenery.
        const e = g.edgeNear(), B = CONFIG.world.edgeView.box, v = ndc(p), off = Math.max(Math.abs(v.x) - (KP.x + (B - KP.x) * e), Math.abs(v.y) - (KP.y + (B - KP.y) * e));
        if (off > worst) { worst = off; worstAt = tag(p); }
        // A jump is the view moving more in one frame than the player walked: last frame's spot, seen now, against where it was.
        if (last) {
          const was = ndc(last.pos), d = Math.hypot(was.x - last.v.x, was.y - last.v.y) - Math.hypot(v.x - was.x, v.y - was.y);
          if (window.CAMDBG && d > 0.04) out.push(`jump ${d.toFixed(2)} at ${tag(p)} frame ${frames} cam ${tag(g.camera.position)} y ${g.camera.position.y.toFixed(1)}`);
          if (d > jump) { jump = d; jumpAt = tag(p); }
        }
        last = { pos: p.clone(), v };
        frames++;
      };
      const walk = (tx, tz) => {
        for (let i = 0; i < 160; i++) {
          const p = g.player.g.position, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
          if (d < 0.3) break;
          g.update(0.05, { x: dx / d, y: dz / d });
          g.draw(0.05);
          check();
        }
      };
      // A tour of the lot as far as the player can walk: every corner, the middle, beside every pad, back to the start.
      const tour = (label) => {
        const [x0, x1, z0] = CONFIG.world.bounds, z1 = Math.min(CONFIG.world.bounds[3], g.reach()), spawn = g.player.g.position.clone();
        const pads = g.stagePads().filter(([, z, sz]) => z - sz / 2 <= g.reach());
        for (const [tx, tz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [(x0 + x1) / 2, (z0 + z1) / 2]]) walk(tx, tz);
        for (const [px, pz, ps] of pads) {
          walk(px + (px > 0 ? -1 : 1) * (ps / 2 + 1), Math.min(pz, g.reach()));
          // Standing still beside a pad, facing it, the camera settles and shows the whole pad.
          g.player.g.rotation.y = Math.atan2(px - g.player.g.position.x, 0);
          // A director's look (a new build, a VIP) plays out first, as it would for a player waiting there.
          for (let i = 0; i < 30 || (g.shotOn() && i < 200); i++) { g.update(0.05, { x: 0, y: 0 }); g.draw(0.05); check(); }
          const h = ps / 2, cut = [[-h, -h], [h, -h], [-h, h], [h, h]].map(([a, b]) => ndc(new T.Vector3(px + a, 0, pz + b))).filter((v) => Math.abs(v.x) > 1 || Math.abs(v.y) > 1).length;
          if (cut) out.push(`${label}: standing beside the pad at ${px.toFixed(1)},${pz.toFixed(1)}, ${cut} corner(s) are off screen${window.CAMDBG ? ` (player at ${tag(g.player.g.position)}, reach ${g.reach()}, shot ${g.shotOn()})` : ''}`);
        }
        walk(spawn.x, spawn.z);
      };
      tour('early');
      // Late game: every stage pad bought one by one by standing on it, so the lot is at its full size, then the tour again.
      for (let n = 0; n < 40 && g.currentPad(); n++) {
        g.state.cash = g.padLeft() + 1;
        walk(g.padMesh.position.x, g.padMesh.position.z);
        for (let i = 0; i < 40 && g.state.cash > 1; i++) { g.update(0.05, { x: 0, y: 0 }); g.draw(0.05); }
      }
      g.state.cash = 40;
      tour('late');
      if (worst > 0.02) out.push(`player left the middle box by ${worst.toFixed(2)} at ${worstAt}`);
      if (jump > 0.07) out.push(`camera jumped ${jump.toFixed(2)} screen units in one frame at ${jumpAt}`);
      return { out, frames, jump: +jump.toFixed(3), worst: +worst.toFixed(3) };
    });
    res.out.forEach((m) => failures.push(`${station} ${width}x${height}: ${m}`));
    if (process.env.CAM_LOG) console.log(station, `${width}x${height}`, res.frames, 'frames, max jump', res.jump, 'max off', res.worst);
    await browser.close();
  }
  server.close();
  if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : `PASS (opening, full lot tour, pads shown whole; ${STATIONS.join(', ')}; ${SIZES.map((s) => s.join('x')).join(', ')})`);
  process.exitCode = failures.length ? 1 : 0;
})();
