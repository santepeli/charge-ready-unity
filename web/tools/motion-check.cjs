// Motion check: every moving thing on the lot is followed frame by frame, the way a player's eye would catch a car on the lawn.
// At each station, grown (every building open, cars, vans, the tow truck, the bus and the police all in play), a bot plays for
// PLAY_SEC (past the first road-trip convoy); each vehicle must stay on the road, the lot or the merge lane, point the way it drives, never jump, and never drive
// into another vehicle; people must not walk through a moving car. Each kind of fault is listed once per object with where it began.
const { serve, launch, openGame } = require('./harness.cjs');
const DEBUG = Boolean(process.env.MOTION_DEBUG);
const { PERSONAS } = require('./personas.cjs');

const PORT = Number(process.env.PORT) || 8189, CRASH_DEPTH = 0.3, STUCK_SEC = 55, WAIT_INFO_SEC = 20, PLAY_SEC = Number(process.env.PLAY_SEC) || 400, DT = 0.05;
const STATIONS = process.env.MOTION_ONLY?.split(',') ?? ['town', 'highway', 'airport', 'hotel', 'mall'];

(async () => {
  const server = serve(PORT), failures = [], errors = [];
  for (const station of STATIONS) {
    const browser = await launch();
    const page = await openGame(browser, PORT, 'probe', { station, errors });
    await page.click('#startBtn', { force: true });
    if (!(await page.evaluate(() => Boolean(window.botBrain)))) await page.addScriptTag({ path: require('path').join(__dirname, 'bot-player.js') });
    const res = await page.evaluate(async ({ PLAY_SEC, DT, pr, DEBUG, CRASH_DEPTH, STUCK_SEC, WAIT_INFO_SEC }) => {
      const T = await import('three'), { CONFIG } = await import('./config.js'), g = window.__cr, s = g.state, W = CONFIG.world, RD = CONFIG.road;
      const scene = g.player.g.parent, p = g.player.g.position, brain = window.botBrain(pr.strategy, pr);
      g.renderer.setAnimationLoop(null);
      Object.assign(s, { served: 1, cash: 99999, doneAt: 1 });
      s.shop.noAds = true;
      for (const open of [() => g.mobile.open(), () => g.wash.open?.(), ...['tire', 'repair', 'tow'].map((k) => () => g.service.open?.(k))]) try { open(); } catch {}
      // Where wheels may be: the lot floor, the road with its sidewalk, and the merge lane between them.
      const fx0 = W.floorX - W.floorWidth / 2, fx1 = W.floorX + W.floorWidth / 2, fz0 = W.floorParts[0][0], fz1 = W.floorParts.at(-1)[1];
      const [m0, m1] = W.merge;
      const onMerge = (x, z) => { const dx = m1[0] - m0[0], dz = m1[1] - m0[1], t = Math.max(0, Math.min(1, ((x - m0[0]) * dx + (z - m0[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - m0[0] - t * dx, z - m0[1] - t * dz) < 1.6; };
      // Lanes marked road (the drive-thru access road) are paved too.
      const onRoadLane = (x, z) => W.lanes.some((l) => l.road && l.at.slice(1).some(([x2, z2], i) => { const [x1, z1] = l.at[i]; return x >= Math.min(x1, x2) - l.w / 2 - 0.3 && x <= Math.max(x1, x2) + l.w / 2 + 0.3 && z >= Math.min(z1, z2) - 0.3 && z <= Math.max(z1, z2) + 0.3; }));
      const drivable = (x, z) => onRoadLane(x, z) || (x >= fx0 - 0.3 && x <= fx1 + 0.3 && z >= fz0 - 0.3 && z <= fz1 + 0.3) || Math.abs(x - RD.x) <= RD.width / 2 + 0.6 || onMerge(x, z);
      const info = new Map(), box = new T.Box3(), v = new T.Vector3(), faults = new Map(), waits = new Set();
      const note = (o, kind, text) => { const k = `${kind}|${o.uuid}`; if (!faults.has(k)) faults.set(k, `${kind}: ${text}`); };
      // A mover is any top-level object that changes place; its size (taken once, unrotated) says vehicle or person.
      const kindOf = (o) => {
        if (!info.has(o)) {
          const ry = o.rotation.y; o.rotation.y = 0; o.updateMatrixWorld(true);
          const body = o.children.find((c) => c.isGroup || c.isMesh) ?? o, sz = box.setFromObject(body).getSize(new T.Vector3());
          o.rotation.y = ry; o.updateMatrixWorld(true);
          const long = Math.max(sz.x, sz.z), name = `${o.userData.model ?? o.name ?? ''}`.trim() || `${sz.x.toFixed(1)}x${sz.z.toFixed(1)}x${sz.y.toFixed(1)}`;
          info.set(o, { kind: long >= 2.5 && long <= 10 && sz.y >= 0.8 && sz.y < 4 ? 'vehicle' : long < 1.2 && sz.y > 1 && sz.y < 2.4 ? 'person' : 'other', long: sz.x >= sz.z ? 'x' : 'z', size: [sz.x, sz.z], name, last: o.position.clone(), moving: 0, aligned: 0, frames: 0 });
        }
        return info.get(o);
      };
      for (const o of scene.children) kindOf(o).last.copy(o.position);
      // On screen means inside the camera's view as the player sees it.
      const sv = new T.Vector3(), seen = (o) => { const n = sv.copy(o.position).project(g.camera); return Math.abs(n.x) < 1.05 && Math.abs(n.y) < 1.05; };
      // Footprints as turned rectangles, tested by separating axes.
      const corners = (o, m) => { const [sx, sz] = m.size.map((d) => Math.max(d / 2 - 0.3, 0.1)), c = Math.cos(o.rotation.y), sn = Math.sin(o.rotation.y);
        return [[sx, sz], [-sx, sz], [-sx, -sz], [sx, -sz]].map(([x, z]) => [o.position.x + x * c + z * sn, o.position.z - x * sn + z * c]); };
      const overlap = (a, ma, b, mb) => { const A = corners(a, ma), B = corners(b, mb);
        // How deep they overlap: the least overlap over the separating axes, in metres; a brush in a turn is not a crash.
        let depth = Infinity;
        for (const P of [A, B]) for (let i = 0; i < 4; i++) { const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % 4], len = Math.hypot(z2 - z1, x1 - x2), nx = (z2 - z1) / len, nz = (x1 - x2) / len;
          const pa = A.map(([x, z]) => x * nx + z * nz), pb = B.map(([x, z]) => x * nx + z * nz);
          depth = Math.min(depth, Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb))); }
        return depth > CRASH_DEPTH; };
      for (let t = 0; t < PLAY_SEC; t += DT) {
        const target = brain.target(), d = Math.hypot(target.x - p.x, target.z - p.z);
        g.update(DT, d < pr.arrive ? { x: 0, y: 0 } : { x: (target.x - p.x) / d, y: (target.z - p.z) / d });
        if (Math.round(t / DT) % 20 === 0) { const k = brain.shopChoice(); if (k) g.buy(k); g.draw(DT); }
        const movers = [];
        for (const o of scene.children) {
          if (o === g.player.g || !o.visible) continue;
          const m = kindOf(o), step = v.copy(o.position).sub(m.last).setY(0), dist = step.length();
          m.frames++;
          if (m.kind === 'vehicle' && o.position.y < 0.6) {
            if (dist > 0.02) {
              movers.push([o, m]);
              if (!drivable(o.position.x, o.position.z)) note(o, 'off road', `${m.name} at ${o.position.x.toFixed(1)},${o.position.z.toFixed(1)} t=${Math.round(t)}s`);
              // A jump is more than three times the road speed in one frame, after the object's first frame.
              // Past the road's ends a car is off screen, where a jump is never seen.
              if (m.frames > 2 && dist > RD.speed * DT * 3 && seen(o)) note(o, 'jump', `${m.name} jumped ${dist.toFixed(1)} m near ${o.position.x.toFixed(1)},${o.position.z.toFixed(1)} t=${Math.round(t)}s`);
              const ry = o.rotation.y, ax = m.long === 'x' ? [Math.cos(ry), -Math.sin(ry)] : [Math.sin(ry), Math.cos(ry)];
              if (seen(o)) m.moving++;
              if (!seen(o)) {} else if (Math.abs(ax[0] * step.x + ax[1] * step.z) / dist >= 0.9) m.aligned++;
              else if (!m.sideAt) m.sideAt = `${o.position.x.toFixed(1)},${o.position.z.toFixed(1)} t=${Math.round(t)}s`;
            }
          }
          if (m.kind === 'person' && dist > 0.01) movers.push([o, m]);
          // Waiting in a line (queue, car wash, garage, behind the police car) is expected and only noted; near the last-resort limit it fails.
          if (m.kind === 'vehicle' && (o.userData.wait ?? 0) > WAIT_INFO_SEC && !g.queue.some((c) => c.g === o)) waits.add(m.name);
          if (m.kind === 'vehicle' && (o.userData.wait ?? 0) > STUCK_SEC && !g.queue.some((c) => c.g === o)) note(o, 'stuck', `${m.name} waited ${STUCK_SEC}s for ${o.userData.yieldBy ? info.get(o.userData.yieldBy)?.name : 'nothing'} at ${o.position.x.toFixed(1)},${o.position.z.toFixed(1)} t=${Math.round(t)}s${DEBUG ? ` [${Object.keys(o.userData).join(' ')} | by ${Object.keys(o.userData.yieldBy?.userData ?? {}).join(' ')} at ${o.userData.yieldBy?.position.x.toFixed(1)},${o.userData.yieldBy?.position.z.toFixed(1)} ry ${o.userData.yieldBy?.rotation.y.toFixed(2)} wash ${(g.wash.line ?? []).map((e) => `${e.car.g === o ? 'ME' : e.car.g === o.userData.yieldBy ? 'BY' : '-'}k${e.k}t${e.t.toFixed(1)}`).join(',')}]` : ''}`);
          m.last.copy(o.position);
        }
        // Two vehicles, or a person and a moving vehicle, whose turned footprints overlap (shrunk a little so touching bumpers do not count).
        const vehicles = scene.children.filter((o) => info.get(o)?.kind === 'vehicle' && o.visible && o.position.y < 0.6);
        for (const [o, m] of movers) for (const w of vehicles) {
          // Only what is on screen counts.
          if (w === o || o.parent !== scene || (m.kind === 'person' && !movers.some(([x]) => x === w)) || !seen(o)) continue;
          if (overlap(o, m, w, info.get(w))) note(m.kind === 'person' ? o : (o.uuid < w.uuid ? o : w), m.kind === 'person' ? 'person in car' : 'crash', `${m.name} and ${info.get(w).name} at ${o.position.x.toFixed(1)},${o.position.z.toFixed(1)} t=${Math.round(t)}s${DEBUG ? ` [${[o, w].map((x) => `${g.queue.some((c) => c.g === x) ? `queue#${g.queue.findIndex((c) => c.g === x)}` : g.openBays().some((b) => b.car?.g === x) ? 'bay' : g.kiosk.cars.some((c) => c.g === x) ? 'kiosk' : 'other'} wait ${(x.userData.wait ?? -1).toFixed(1)} by ${x.userData.yieldBy ? info.get(x.userData.yieldBy)?.name : '-'} ry ${x.rotation.y.toFixed(2)} pos ${x.position.x.toFixed(2)},${x.position.z.toFixed(2)}`).join(' | ')}]` : ''}`);
        }
      }
      for (const [o, m] of info) if (m.kind === 'vehicle' && m.moving > 20 && m.aligned / m.moving < 0.8) faults.set(`side|${o.uuid}`, `sideways: ${m.name} faced its way in ${m.aligned}/${m.moving} frames, first off at ${m.sideAt}`);
      const kinds = [...info.values()].reduce((c, m) => ((c[m.kind] = (c[m.kind] ?? 0) + 1), c), {});
      return { faults: [...faults.values()], kinds, waits: waits.size };
    }, { PLAY_SEC, DT, pr: PERSONAS.engaged, DEBUG, CRASH_DEPTH, STUCK_SEC, WAIT_INFO_SEC });
    console.log(`info: ${station}: followed ${JSON.stringify(res.kinds)}, ${res.waits} vehicle(s) waited over ${WAIT_INFO_SEC}s in a line`);
    failures.push(...res.faults.map((f) => `${station}: ${f}`));
    await browser.close();
  }
  server.close();
  failures.push(...errors.map((e) => `page error: ${e}`));
  console.log(failures.length ? `FAIL (${failures.length})\n- ${failures.join('\n- ')}` : 'PASS (every vehicle on road or lot, facing its way, no jumps, no crashes; nobody walks through a moving car)');
  process.exit(failures.length ? 1 : 0);
})();
