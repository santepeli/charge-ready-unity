// Visibility check: the owner is never lost from view. At every station the owner stands right behind each parked car (and the bus
// where there is one), where the car covers them on screen; the pixels the owner changes there must be at least MIN of what they
// change standing in the open, so the silhouette shows through anything in front.
const { serve, launch, openGame } = require('./harness.cjs');

const PORT = 8159, MIN = 0.6;
const STATIONS = ['town', 'highway', 'airport', 'hotel', 'mall'];

(async () => {
  const server = serve(PORT), failures = [], errors = [];
  for (const station of STATIONS) {
    const browser = await launch();
    const page = await openGame(browser, PORT, 'sim', { viewport: { width: 390, height: 844 }, station, errors });
    await page.click('#startBtn');
    const res = await page.evaluate((noXray) => {
      const g = window.__cr, gl = g.renderer.getContext(), out = [];
      g.renderer.setPixelRatio(1);
      // Grow the station so every bay is open, then wait until cars stand in them.
      Object.assign(g.state, { bays: 4, served: 5, doneAt: 1 });
      for (let i = 0; i < 900 && g.openBays().filter((b) => b.car?.phase === 'charge').length < 2; i++) { g.update(0.05, { x: 0, y: 0 }); g.draw(0.05); }
      // Only the body counts: the ring on the ground and the marker over the head are hidden while measuring.
      const extras = g.player.g.children.filter((c) => c.geometry?.type === 'RingGeometry' || c.geometry?.type === 'ConeGeometry' || c.isSprite);
      extras.forEach((c) => { c.visible = false; });
      // The owner's shadow on the car would count as seeing them, so it is off while measuring.
      g.player.g.traverse((m) => { m.castShadow = false; });
      // VIS_NO_XRAY turns the silhouette off, to see this check fail without it.
      if (noXray) g.player.g.traverse((m) => { if (m.material?.depthFunc === 6) m.visible = false; });
      const { width: w, height: h } = g.renderer.domElement, a = new Uint8Array(w * h * 4), b = new Uint8Array(w * h * 4);
      // Pixels the owner changes on screen at their spot: one frame with them, one without.
      const footprint = () => {
        g.draw(0);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a);
        g.player.g.visible = false;
        g.renderer.render(g.player.g.parent, g.camera);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
        g.player.g.visible = true;
        let n = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++;
        return n;
      };
      const stand = (x, z) => { g.player.g.position.set(x, 0, z); g.player.g.rotation.y = 0; for (let i = 0; i < 30; i++) g.draw(0.05); };
      const cars = g.openBays().filter((b) => b.car?.phase === 'charge').map((b) => b.car.g);
      if (!cars.length) return { out: ['no parked car to hide behind'] };
      for (const car of cars) {
        // At each spot the yardstick is the same view with the car taken away; inside the body and just behind it the car covers the
        // most, and the worst spot counts.
        let share = Infinity, open = 0, hidden = 0;
        // The owner is solid against cars, so spots inside the body are skipped; the nearest reachable ones behind it count.
        for (const dz of [0, -0.8, -1.6, -2.4, -3.2]) {
          const q = g.player.g.position.set(car.position.x, 0, car.position.z + dz);
          g.solidPush(q);
          if (Math.abs(q.z - car.position.z - dz) + Math.abs(q.x - car.position.x) > 0.05) continue;
          stand(car.position.x, car.position.z + dz);
          car.visible = false;
          const o = footprint();
          car.visible = true;
          const h = footprint();
          if (h / o < share) [share, open, hidden] = [h / o, o, h];
        }
        if (share === Infinity) { out.push({ at: `${car.position.x.toFixed(1)},${car.position.z.toFixed(1)}`, open: 0, hidden: 0, share: 0 }); continue; }
        out.push({ at: `${car.position.x.toFixed(1)},${car.position.z.toFixed(1)}`, open, hidden, share });
      }
      return { out };
    }, Boolean(process.env.VIS_NO_XRAY));
    for (const r of res.out) {
      if (typeof r === 'string') { failures.push(`${station}: ${r}`); continue; }
      console.log(`${station} car ${r.at}: owner shows ${Math.round(r.share * 100)}% (${r.hidden}/${r.open} px)`);
      if (r.share < MIN) failures.push(`${station}: behind the car at ${r.at} the owner shows only ${Math.round(r.share * 100)}%`);
    }
    await browser.close();
  }
  server.close();
  if (errors.length) failures.push(...errors.map((e) => `page error: ${e}`));
  console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS visibility');
  process.exit(failures.length ? 1 : 0);
})();
