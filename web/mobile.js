// Mobile charging service: stranded EVs call in on a mini map, vans drive out from the depot, charge them and bring back the fee.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { rescuePay } from './economy.js';
import { buildDepot, buildVan } from './models.js';

const MB = CONFIG.mobile, U = MB.upgrades;
const v3 = ([x, z]) => new THREE.Vector3(x, 0, z);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// The game passes its state, scene, `once` event logger, `alert` (sound plus optional hint text), `book` for the ledger and `label` for tags.
export function createMobile({ state, scene, once, alert, book, label, blocked }) {
  const depot = buildDepot(), vanMeshes = MB.vanSlots.map(() => buildVan()), vanTags = MB.vanSlots.map(() => label());
  depot.position.copy(v3(MB.depotAt));
  depot.rotation.y = MB.depotTurn;
  vanMeshes.forEach((m, i) => { m.position.copy(v3(MB.vanSlots[i])); m.rotation.y = MB.vanTurn; m.userData.van = i; });
  // Route a van drives in the lot: out of its slot onto the road and away, or back from the road into the slot; null x means the slot's x.
  const route = (pts, i) => pts.map(([x, z]) => v3([x ?? MB.vanSlots[i][0], z ?? MB.vanSlots[i][1]]));
  // Moves a van mesh along its lot route; true once the route is done.
  function roll(m, path, dt) {
    const t = path[0], dx = t.x - m.position.x, dz = t.z - m.position.z, d = Math.hypot(dx, dz), step = MB.lotSpeed * dt;
    // The van model's nose points to -z, so this turns it to face where it drives.
    const was = m.rotation.y;
    if (d > 0) m.rotation.y = Math.atan2(-dx, -dz);
    if (d > 0 && blocked(m, dx / d, dz / d, dt, m.userData, d, was)) { m.rotation.y = was; return false; }
    if (d <= step) { m.position.copy(t); path.shift(); } else { m.position.x += dx / d * step; m.position.z += dz / d * step; }
    return path.length === 0;
  }
  // Cash pile in front of the depot, walked over like the bay and table piles.
  const spot = { zone: v3(MB.cashAt), cashPos: v3(MB.cashAt), size: MB.cashZone, cash: 0, bills: [] };
  let vans = [], calls = [], nextCall = 0, callId = 0;

  const owned = () => Boolean(state.mobile);
  const lvl = (k) => state.levels[k] ?? 0;
  const speed = () => MB.vanKmPerSec * U.vanSpeed.factor ** lvl('vanSpeed');
  const capacity = () => MB.jobsPerCharge + U.vanBattery.step * lvl('vanBattery');

  // Brings the depot and its vans into the world; vans list grows with the More Vans level.
  function show() {
    if (!owned()) return;
    if (!depot.parent) { scene.add(depot); vanMeshes.forEach((m) => scene.add(m)); vanTags.forEach((t) => scene.add(t)); spot.cash = state.mobile.cash; }
    while (vans.length < 1 + lvl('vans')) vans.push({ phase: 'idle', x: 0, y: 0, call: null, t: 0, energy: capacity(), recharge: 0, lot: [] });
    // A van is seen while parked or while driving through the lot; out on the map it is only a dot.
    vanMeshes.forEach((m, i) => { m.visible = i < vans.length && (vans[i].phase === 'idle' || vans[i].lot.length > 0); });
  }

  function open() {
    state.mobile = { cash: 0, earned: 0, jobs: 0, missed: 0, rescued: 0 };
    Object.keys(U).forEach((k) => { state.levels[k] = 0; });
    show();
    nextCall = 0;
  }

  // Sends a van (the given one, or the first idle one with charge left) to a call; it drives out of the depot first. False when none can go.
  function dispatch(id, chosen) {
    const ready = (v) => v?.phase === 'idle' && v.energy >= 1 && v.lot.length === 0;
    const call = calls.find((c) => c.id === id && !c.van), van = chosen ? (ready(chosen) ? chosen : null) : vans.find(ready);
    if (!call || !van) return false;
    Object.assign(van, { phase: 'out', call, t: 0, lot: route(MB.exitRoute, vans.indexOf(van)) });
    call.van = van;
    once('dispatch');
    return true;
  }

  // Moves a van toward (x, y) in km; true on arrival.
  function travel(van, x, y, dt) {
    const dx = x - van.x, dy = y - van.y, d = Math.hypot(dx, dy), step = speed() * dt;
    if (d <= step) { van.x = x; van.y = y; return true; }
    van.x += dx / d * step;
    van.y += dy / d * step;
    return false;
  }

  function update(dt) {
    if (!owned()) return;
    show();
    if ((nextCall -= dt) <= 0 && calls.length < MB.maxCalls) {
      const a = rand(0, Math.PI * 2), km = rand(MB.minKm, MB.maxKm);
      calls.push({ id: ++callId, x: Math.cos(a) * km, y: Math.sin(a) * km, km, pay: rescuePay(km), left: MB.callPatienceSec, van: null });
      nextCall = rand(...MB.callEverySec);
      alert(callId === 1 ? 'Stranded EV! Tap the map to send a van' : null);
    }
    calls = calls.filter((c) => {
      if (c.van || (c.left -= dt) > 0) return true;
      state.mobile.missed++;
      once('callmissed');
      return false;
    });
    if (lvl('dispatcher')) calls.filter((c) => !c.van).sort((a, b) => a.km - b.km).forEach((c) => dispatch(c.id));

    for (const van of vans) {
      if (van.phase === 'out' && travel(van, van.call.x, van.call.y, dt)) Object.assign(van, { phase: 'onsite', t: 0 });
      else if (van.phase === 'onsite' && (van.t += dt) >= MB.onSiteSec) {
        // A rescued driver gets enough charge to reach the station and becomes a customer there.
        const pay = van.call.pay, fee = Math.round(MB.feeBase + MB.feePerKm * van.call.km);
        spot.cash += pay;
        book('mobile', fee);
        book('fuel', fee - pay);
        Object.assign(state.mobile, { earned: state.mobile.earned + pay, jobs: state.mobile.jobs + 1, rescued: state.mobile.rescued + (van.call.divert ? 0 : 1) });
        state.earned += pay;
        calls = calls.filter((c) => c !== van.call);
        Object.assign(van, { phase: 'back', call: null, energy: van.energy - 1 });
        once('rescue');
      } else if (van.phase === 'back' && travel(van, 0, 0, dt)) {
        // Home again: the van comes in from the road and parks in its slot.
        const i = vans.indexOf(van);
        van.phase = 'idle';
        van.lot = route(MB.returnRoute, i);
        vanMeshes[i].position.copy(van.lot.shift());
      }
      else if (van.phase === 'idle' && van.energy < capacity() && (van.recharge += dt) >= MB.rechargeSec) Object.assign(van, { energy: van.energy + 1, recharge: 0 });
    }
    vans.forEach((van, i) => {
      if (van.lot.length) roll(vanMeshes[i], van.lot, dt);
      // Parked vans with charge show a tap hint while EVs are waiting.
      const tag = vanTags[i], canGo = van.phase === 'idle' && !van.lot.length;
      tag.visible = canGo && calls.some((c) => !c.van);
      if (tag.visible) { tag.userData.set(van.energy >= 1 ? '👆 Tap' : '🔋'); tag.position.copy(vanMeshes[i].position).setY(MB.tagHeight); }
    });
    state.mobile.cash = spot.cash;
  }

  // A tapped van in the lot goes to the nearest waiting EV; returns false when it cannot go.
  function tapVan(i) {
    const open = calls.filter((c) => !c.van).sort((a, b) => a.km - b.km)[0];
    return Boolean(open) && dispatch(open.id, vans[i]);
  }

  // Sends idle vans to cars waiting in the station queue; returns how many went.
  function divert(max) {
    let n = 0;
    while (n < max && vans.some((v) => v.phase === 'idle' && v.energy >= 1)) {
      const a = rand(0, Math.PI * 2), km = CONFIG.traffic.divertKm;
      calls.push({ id: ++callId, x: Math.cos(a) * km, y: Math.sin(a) * km, km, pay: rescuePay(km), left: Infinity, van: null, divert: true });
      dispatch(callId);
      n++;
    }
    return n;
  }

  // Takes one rescued driver for the next free bay, so rescues turn into station customers.
  function takeRescued() {
    if (!owned() || state.mobile.rescued <= 0) return false;
    state.mobile.rescued--;
    return true;
  }

  // Draws the round map: roads, distance rings, station, calls (pulsing) and vans with their routes.
  function drawMap(ctx, size, time, big) {
    const C = MB.map, r = size / 2, k = r / MB.maxKm, px = (x) => r + x * k, py = (y) => r + y * k;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath(); ctx.arc(r, r, r, 0, Math.PI * 2); ctx.fillStyle = C.ground; ctx.fill(); ctx.clip();
    ctx.strokeStyle = C.road; ctx.lineWidth = big ? 4 : 2;
    ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(r, size); ctx.moveTo(0, r * 0.7); ctx.lineTo(size, r * 1.2); ctx.stroke();
    ctx.strokeStyle = C.ring; ctx.lineWidth = 1;
    for (const km of C.ringsKm) { ctx.beginPath(); ctx.arc(r, r, km * k, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = C.station; ctx.beginPath(); ctx.arc(r, r, big ? 8 : 4, 0, Math.PI * 2); ctx.fill();
    for (const c of calls) {
      const pulse = c.van ? 1 : (1 + Math.sin(time * C.pulse)) / 2;
      ctx.fillStyle = C.call; ctx.globalAlpha = 0.4 + 0.6 * pulse;
      ctx.beginPath(); ctx.arc(px(c.x), py(c.y), (big ? 9 : 4) * (1 + pulse * 0.3), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      if (big) { ctx.fillStyle = C.text; ctx.font = '700 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${c.km.toFixed(1)} km · $${c.pay}`, px(c.x), py(c.y) - 14); }
    }
    for (const v of vans) {
      if (v.phase === 'idle') continue;
      ctx.strokeStyle = C.van; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(px(v.x), py(v.y));
      ctx.lineTo(v.call ? px(v.call.x) : r, v.call ? py(v.call.y) : r); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.van; ctx.beginPath(); ctx.arc(px(v.x), py(v.y), big ? 7 : 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Map tap in pixels: dispatch to the nearest open call within tapKm.
  function tap(x, y, size) {
    const k = size / 2 / MB.maxKm, kmX = (x - size / 2) / k, kmY = (y - size / 2) / k;
    const near = calls.filter((c) => !c.van).map((c) => [c, Math.hypot(c.x - kmX, c.y - kmY)]).filter(([, d]) => d < MB.tapKm).sort((a, b) => a[1] - b[1])[0];
    return near ? dispatch(near[0].id) : false;
  }

  const status = () => ({ calls: calls.filter((c) => !c.van).length, idle: vans.filter((v) => v.phase === 'idle' && v.energy >= 1).length });

  return { depot, owned, open, show, update, dispatch, divert, tapVan, vanMeshes, drawMap, tap, takeRescued, status, spot, calls: () => calls };
}
