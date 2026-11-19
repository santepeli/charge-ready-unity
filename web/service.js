// Second-city services on the bottom strip: tire shop, repair garage and tow truck.
// Flagged charging customers drive down the service lane after charging, turn onto the strip's top street (right to left),
// drive through their bay and leave by the bottom street (left to right); the tow truck brings broken-down cars to the garage.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { city } from './economy.js';
import { buildTireShop, buildGarage, buildTowDepot, buildTowTruck, buildCar } from './models.js';

const SV = CONFIG.service, U = SV.upgrades, RD = CONFIG.road, IM = CONFIG.economy.incomeMultiplier;
const v3 = ([x, z]) => new THREE.Vector3(x, 0, z);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const ENTRY = [RD.serviceLane, SV.streetZ];
const OUT = [[13.6, SV.backZ], [RD.inLane, SV.backZ + 2], [RD.inLane, RD.exitZ]];
const [TX, TZ] = SV.tire.bayAt, LIFTS = SV.repair.lifts, GARAGE_X = (LIFTS[0][0] + LIFTS[1][0]) / 2;
// Tire line: the second car waits on the street right of the bay, clear of a car turning onto the first lift; the first drives in.
const TIRE_ROUTE = [ENTRY, [TX + 2.2, SV.streetZ], [TX, SV.streetZ], [TX, TZ]].map(v3), TIRE_SLOT = [3, 1];
// Cars waiting for a free lift stand on the street right of the garage; the tow truck drops its car there too.
const GARAGE_WAIT = [LIFTS[1][0] + 2.9, SV.streetZ];
const KINDS = ['tire', 'repair', 'tow'];

// The game passes state, scene, once, book, earn, its car stepper `drive`, `toTraffic`, `label` for tags, `sound`, `fx` for sparks
// `staff(pos)` to place a worker and `toast` for a one-line tip.
export function createService({ state, scene, once, book, earn, drive, toTraffic, label, sound, fx, staff, toast }) {
  const shop = buildTireShop(), garage = buildGarage(LIFTS.map(([x, z]) => [x - GARAGE_X, z])), depot = buildTowDepot();
  shop.position.copy(v3(SV.tire.bayAt));
  garage.position.copy(v3([GARAGE_X, LIFTS[0][1]]));
  depot.position.copy(v3(SV.tow.depotAt));
  const buildings = { tire: shop, repair: garage, tow: depot };
  const spots = Object.fromEntries(KINDS.map((k) => [k, { zone: v3(SV[k].cashAt), cashPos: v3(SV[k].cashAt), size: SV.cashZone, cash: 0, bills: [] }]));
  const tireLine = [], repairLine = [], lifts = LIFTS.map(() => null), trucks = [], calls = [];
  const tireTag = label(), liftTags = LIFTS.map(() => label());
  let incoming = { tire: 0, repair: 0 }, fitter = null, nextCall = 0;

  const owned = (k) => Boolean(state.service?.[k]);
  const lvl = (k) => state.levels[k] ?? 0;
  const liftCount = () => 1 + lvl('secondLift');
  const tireSec = () => SV.tire.jobSec * U.tire.tireSpeed.factor ** lvl('tireSpeed');
  const pay = (k, base, line, at, mult = 1, prefix) => {
    const amount = Math.round(base * IM ** lvl(line) * city.income * mult);
    earn(spots[k], amount, at, prefix);
    book(k, amount);
    return amount;
  };

  function show() {
    for (const k of KINDS) {
      if (!owned(k) || buildings[k].parent) continue;
      scene.add(buildings[k]);
      spots[k].cash = state.service[k].cash;
    }
    while (owned('tow') && trucks.length < 1 + lvl('towTrucks')) {
      const g = buildTowTruck(), tag = label();
      g.position.copy(v3(SV.tow.depotAt));
      g.rotation.y = -Math.PI / 2;
      g.userData.truck = trucks.length;
      scene.add(g, tag);
      trucks.push({ g, tag, path: [], phase: 'idle', t: 0, call: null, car: null });
    }
    if (owned('tire') && lvl('tireFitter') && !fitter) fitter = staff(v3([SV.tire.zone[0], SV.tire.zone[1]]));
  }
  function open(k) {
    state.service ??= {};
    state.service[k] = { cash: 0 };
    Object.keys(U[k]).forEach((u) => { state.levels[u] = 0; });
    show();
  }

  // Charging customers with a flat tire or a fault: true when their shop is open and has room, so the bay sends them down here.
  function accept(car) {
    const k = car.fix;
    if (!k || !owned(k)) return false;
    const busy = k === 'tire' ? tireLine.length + incoming.tire >= TIRE_SLOT.length : repairLine.length + incoming.repair > liftCount();
    if (busy) return false;
    incoming[k]++;
    return true;
  }
  function take(car) {
    incoming[car.fix]--;
    if (car.fix === 'tire') tireLine.push({ car, k: 0, t: 0 });
    else { car.path = [v3(ENTRY), v3(GARAGE_WAIT)]; repairLine.push({ car, lift: null, t: 0 }); }
  }

  // The player (or the hired fitter) swaps the tire of the car in the bay while standing on the tire spot; true while working.
  function tireWork(pos, dt, byPlayer) {
    const front = tireLine[0];
    if (!front || front.k <= TIRE_SLOT[0]) return false;
    const z = SV.tire.zone, half = SV.tire.zoneSize;
    if (byPlayer && (Math.abs(pos.x - z[0]) > half[0] / 2 || Math.abs(pos.z - z[1]) > half[1] / 2)) return false;
    front.t += dt;
    if (byPlayer) sound('tool');
    if (front.t < (byPlayer ? tireSec() : SV.tire.fitterSec)) return true;
    // A car that came from the garage finishes a full service and pays the full-service bonus.
    pay('tire', SV.tire.price, 'tirePrice', front.car.g.position, front.car.full ? SV.fullMult : 1, front.car.full ? '⭐FULL ' : undefined);
    if (front.car.full) once('fullservice');
    once('tire1');
    tireLine.shift();
    toTraffic({ g: front.car.g, path: [[TX, SV.backZ], ...OUT].map(v3) });
    return true;
  }

  function updateTire(dt) {
    // Ordered by how far each car got, as at the wash, so no car waits behind one it already passed.
    tireLine.sort((a, b) => b.k - a.k);
    tireLine.forEach((e, i) => {
      if (e.k > TIRE_SLOT[i]) return;
      e.car.path = [TIRE_ROUTE[e.k]];
      if (drive(e.car, dt)) e.k++;
    });
    if (fitter) tireWork(null, dt, false);
    const front = tireLine[0], waiting = front && front.k > TIRE_SLOT[0];
    tireTag.visible = Boolean(waiting);
    if (waiting) {
      tireTag.position.copy(front.car.g.position).setY(CONFIG.sizes.tagHeight);
      tireTag.userData.set(SV.tire.label, Math.min(front.t / tireSec(), 1));
    }
  }

  function updateRepair(dt) {
    for (const e of repairLine) {
      // A waiting car takes the first free lift and drives in from the street.
      if (e.lift === null && !e.car.path.length) {
        const free = lifts.findIndex((l, i) => !l && i < liftCount());
        if (free >= 0) { lifts[free] = e; e.lift = free; e.car.path = [v3([LIFTS[free][0], SV.streetZ]), v3(LIFTS[free])]; }
      }
      if (e.car.path.length) { drive(e.car, dt); continue; }
      if (e.lift === null) continue;
      const platform = garage.userData.platforms[e.lift], need = SV.repair.jobSec * U.repair.repairSpeed.factor ** lvl('repairSpeed');
      e.t += dt;
      const y = SV.repair.liftY * Math.min(e.t, need - e.t, 1);
      e.car.g.position.y = platform.position.y = Math.max(y, 0);
      fx(e.car.g.position.clone().setY(1.2), dt);
      if (e.t < need) continue;
      pay('repair', SV.repair.price, 'repairPrice', e.car.g.position);
      once('repair1');
      lifts[e.lift] = null;
      e.done = true;
      e.car.g.position.y = platform.position.y = 0;
      // Full service: some repaired cars also get their tires done when the tire bay has room.
      if (owned('tire') && Math.random() < SV.fullShare && tireLine.length + incoming.tire < TIRE_SLOT.length) { e.car.full = true; tireLine.push({ car: e.car, k: 0, t: 0 }); }
      else toTraffic({ g: e.car.g, path: [[LIFTS[e.lift][0], SV.backZ], ...OUT].map(v3) });
    }
    for (let i = repairLine.length - 1; i >= 0; i--) if (repairLine[i].done) repairLine.splice(i, 1);
    lifts.forEach((e, i) => {
      const tag = liftTags[i];
      tag.visible = Boolean(e && !e.car.path.length);
      if (tag.visible) { tag.position.copy(e.car.g.position).setY(CONFIG.sizes.tagHeight + 0.7); tag.userData.set(SV.repair.label, Math.min(e.t / (SV.repair.jobSec * U.repair.repairSpeed.factor ** lvl('repairSpeed')), 1)); }
    });
  }

  function updateTow(dt) {
    if ((nextCall -= dt) <= 0 && calls.length < 2) {
      nextCall = rand(...SV.tow.callEverySec);
      calls.push({ km: rand(...SV.tow.km), left: SV.tow.callPatienceSec });
      if (!state.service.tow.seen) { state.service.tow.seen = true; sound('alert'); }
      if (!state.seen.towTip) { once('towTip'); toast('🚛 A car broke down on Route 9! Tap the tow truck: it brings the car to your garage for repair'); }
    }
    for (let i = calls.length - 1; i >= 0; i--) if ((calls[i].left -= dt) <= 0) calls.splice(i, 1);
    for (const t of trucks) {
      if (t.phase === 'out' && drive(t, dt)) Object.assign(t, { phase: 'away', t: 0 }), (t.g.visible = false);
      else if (t.phase === 'away' && (t.t += dt) >= t.call.km * 2 / (SV.tow.kmPerSec * U.tow.towSpeed.factor ** lvl('towSpeed'))) {
        // Back from the call with the broken-down car hooked behind.
        t.car = buildCar(CONFIG.kit.cars[Math.floor(Math.random() * CONFIG.kit.cars.length)]);
        t.g.userData.hook.add(t.car);
        t.g.position.copy(v3([RD.outLane, RD.exitZ]));
        Object.assign(t, { phase: 'back', path: [v3([RD.outLane, SV.streetZ]), v3(GARAGE_WAIT)] });
        t.g.visible = true;
      } else if (t.phase === 'back' && drive(t, dt)) {
        // Drop the car at the garage, take the tow fee and drive home round the strip.
        scene.attach(t.car);
        t.car.rotation.z = 0;
        t.car.position.y = 0;
        repairLine.push({ car: { g: t.car, path: [] }, lift: null, t: 0 });
        pay('tow', SV.tow.fee, 'towFee', t.g.position);
        once('tow1');
        Object.assign(t, { phase: 'home', car: null, path: [[SV.turnX, SV.streetZ], [SV.turnX, SV.backZ], [SV.tow.depotAt[0], SV.backZ], SV.tow.depotAt].map(v3) });
      } else if (t.phase === 'home' && drive(t, dt)) t.phase = 'idle';
      // An idle truck asks for a tap; one bringing a car in says where it goes.
      t.tag.visible = (t.phase === 'idle' && calls.length > 0) || t.phase === 'back';
      if (t.tag.visible) { t.tag.position.copy(t.g.position).setY(CONFIG.sizes.tagHeight + 0.4); t.tag.userData.set(t.phase === 'back' ? '🔧 To garage' : '👆 Tap'); }
    }
  }

  function update(dt) {
    if (!KINDS.some(owned)) return;
    show();
    if (owned('tire')) updateTire(dt);
    if (owned('repair')) updateRepair(dt);
    if (owned('tow')) updateTow(dt);
    for (const k of KINDS) if (owned(k)) state.service[k].cash = spots[k].cash;
  }

  // A tapped idle truck drives out to the oldest breakdown call; false when it cannot go.
  function tapTruck(i) {
    const t = trucks[i];
    if (!t || t.phase !== 'idle' || !calls.length) return false;
    Object.assign(t, { phase: 'out', call: calls.shift(), path: [[SV.tow.depotAt[0], SV.backZ], ...OUT.slice(0, 2), [RD.inLane, RD.exitZ]].map(v3) });
    once('towout');
    return true;
  }

  // Where the player is needed next on the strip, as [position, hint], or null.
  function goal() {
    if (owned('tire') && !fitter && tireLine[0]?.k > TIRE_SLOT[0]) return [v3([SV.tire.zone[0], SV.tire.zone[1]]), 'Swap the flat tire'];
    const idle = trucks.find((t) => t.phase === 'idle');
    if (idle && calls.length) return [idle.g.position, 'A car broke down! Tap the tow truck'];
    return null;
  }

  const cashSpots = () => KINDS.filter(owned).map((k) => spots[k]);
  return { buildings, owned, open, show, update, accept, take, tireWork, tapTruck, goal, cashSpots, truckMeshes: () => trucks.map((t) => t.g), entry: v3(ENTRY), calls: () => calls, lines: () => ({ tire: tireLine.length, repair: repairLine.length }) };
}
