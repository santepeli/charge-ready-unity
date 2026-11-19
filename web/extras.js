// Expansions a complete station can build for extra income: Moto Park, Mini Mart and Air & Glass (CONFIG.extras).
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { city } from './economy.js';
import { buildMotoPark, buildMart, buildAirPost, buildScooter, buildPerson, stepPerson } from './models.js';

const EX = CONFIG.extras, RD = CONFIG.road;
const v3 = ([x, z]) => new THREE.Vector3(x, 0, z);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const near = (a, b, [w, d]) => Math.abs(a.x - b.x) <= w / 2 && Math.abs(a.z - b.z) <= d / 2;

// The game passes state, scene, the station, its money helpers (earn, book), the car stepper `drive`, `label` for tags,
// the player, `charging()` (cars plugged in now), `sound` and `tally` for goal counts.
export function createExtras({ state, scene, station, earn, book, drive, label, player, charging, sound, tally }) {
  const at = station.extras ?? {}, kinds = EX.order.filter((k) => at[k]);
  const centre = (k) => v3(at[k]), offset = (k, [dx, dz]) => centre(k).add(new THREE.Vector3(dx, 0, dz));
  const lvl = (k) => state.levels[k] ?? 0, U = (k) => EX[k].upgrades;
  const slots = () => EX.moto.spots + lvl('motoSlots'), stockMax = () => EX.mart.stock + lvl('martShelf') * U('mart').martShelf.step;
  const buildings = { moto: buildMotoPark(EX.moto.spots + U('moto').motoSlots.maxLevel, EX.moto.gap), mart: buildMart(station.machine), air: buildAirPost() };
  // The clerk and the attendant stand at their buildings once hired.
  const clerk = buildPerson(CONFIG.colors.drivers[1], true), attendant = buildPerson(CONFIG.colors.siren, true);
  kinds.forEach((k) => buildings[k].position.copy(centre(k)));
  const spots = Object.fromEntries(kinds.map((k) => [k, { zone: offset(k, EX[k].cashAt), cashPos: offset(k, EX[k].cashAt), size: EX.cashZone, cash: 0, bills: [] }]));
  const owned = (k) => Boolean(state.extras?.[k]);
  const pay = (k, base, where) => {
    const amount = Math.round(base * city.income);
    earn(spots[k], amount, where);
    book(k, amount);
    tally(k);
  };
  let motoT = EX.moto.everySec[0], martT = EX.mart.everySec[0], airT = EX.air.everySec[0], tool = false;
  const scooters = [], shoppers = [], asks = [], toolTag = label();

  function show() {
    for (const k of kinds) {
      if (!owned(k)) continue;
      Object.keys(U(k)).forEach((u) => { state.levels[u] ??= 0; });
      if (!buildings[k].parent) { scene.add(buildings[k]); spots[k].cash = state.extras[k].cash ?? 0; }
    }
    buildings.moto.userData.setSlots(slots());
    if (owned('mart') && lvl('martClerk') && !clerk.parent) { clerk.position.copy(offset('mart', EX.mart.clerkAt)); scene.add(clerk); }
    if (owned('air') && lvl('airAttendant') && !attendant.parent) { attendant.position.copy(offset('air', EX.air.attendantAt)); scene.add(attendant); }
  }
  function open(k) {
    state.extras ??= {};
    state.extras[k] = k === 'mart' ? { cash: 0, stock: stockMax() } : { cash: 0 };
    show();
  }
  // Moto slots run left to right across the park; a scooter takes the first free one.
  const all = EX.moto.spots + U('moto').motoSlots.maxLevel, slot = (i) => offset('moto', [(i - (all - 1) / 2) * EX.moto.gap, 0.2]);
  function updateMoto(dt) {
    if ((motoT -= dt) <= 0) {
      motoT = rand(...EX.moto.everySec);
      const free = [...Array(slots()).keys()].find((i) => !scooters.some((s) => s.i === i));
      if (free !== undefined) {
        const s = { i: free, g: buildScooter(EX.moto.colors[free % EX.moto.colors.length]), phase: 'in', t: 0 }, p = slot(free), lane = centre('moto').z + EX.moto.laneZ;
        s.g.position.set(RD.inLane, 0, RD.spawnZ);
        s.path = [v3([RD.inLane, lane]), v3([p.x, lane]), p];
        scene.add(s.g);
        scooters.push(s);
      }
    }
    for (const s of [...scooters]) {
      if (s.phase === 'charge') {
        if ((s.t += dt) < EX.moto.chargeSec * U('moto').motoFast.factor ** lvl('motoFast')) continue;
        pay('moto', EX.moto.fee, s.g.position);
        const lane = centre('moto').z + EX.moto.laneZ;
        Object.assign(s, { phase: 'out', path: [v3([s.g.position.x, lane]), v3([RD.outLane, lane]), v3([RD.outLane, RD.exitZ])] });
      } else if (drive(s, dt)) {
        if (s.phase === 'in') s.phase = 'charge';
        else { scene.remove(s.g); scooters.splice(scooters.indexOf(s), 1); }
      }
    }
  }
  // A shopper walks from a charging car to the shelf, buys one item if any is left, then walks back and goes.
  function walk(p, to, dt) {
    const d = to.clone().sub(p.g.position), len = d.length(), step = EX.mart.walk * dt;
    stepPerson(p.g, 1, dt);
    if (len <= step) { p.g.position.copy(to); return true; }
    p.g.position.addScaledVector(d, step / len);
    p.g.rotation.y = Math.atan2(d.x, d.z);
    return false;
  }
  function updateMart(dt) {
    const m = state.extras.mart, shelf = offset('mart', EX.mart.shelfZone), max = stockMax();
    // The player restocks at full pace on the shelf; a hired clerk keeps topping up at a quarter of it.
    const pace = (near(player.g.position, shelf, EX.mart.zoneSize) ? 1 : 0) + (lvl('martClerk') ? EX.mart.clerkShare : 0);
    m.stock = Math.min(max, m.stock + EX.mart.restockPerSec * pace * dt);
    buildings.mart.userData.setStock(m.stock / max);
    const cars = charging();
    if ((martT -= dt) <= 0 && cars.length) {
      martT = rand(...EX.mart.everySec);
      const from = cars[Math.floor(Math.random() * cars.length)].g.position.clone();
      const g = buildPerson(CONFIG.colors.drivers[Math.floor(Math.random() * CONFIG.colors.drivers.length)]);
      g.position.copy(from);
      scene.add(g);
      shoppers.push({ g, home: from, to: offset('mart', [-0.6, 0.6]), back: false });
    }
    for (const s of [...shoppers]) {
      if (!walk(s, s.back ? s.home : s.to, dt)) continue;
      if (s.back) { scene.remove(s.g); shoppers.splice(shoppers.indexOf(s), 1); continue; }
      if (m.stock >= 1) { m.stock -= 1; pay('mart', EX.mart.price, s.g.position); sound('cash'); }
      s.back = true;
    }
  }
  // Air & Glass: asks hang over charging cars; the post hands the player one tool, which finishes the nearest ask.
  function updateAir(dt) {
    const post = centre('air'), cars = charging();
    if (near(player.g.position, post, EX.air.zoneSize)) tool = true;
    if ((airT -= dt) <= 0) {
      airT = rand(...EX.air.everySec);
      const car = cars.find((c) => !asks.some((a) => a.car === c));
      if (car) { const tag = label(); scene.add(tag); asks.push({ car, tag, left: EX.air.waitSec, icon: Math.random() < 0.5 ? '💨' : '🧽' }); }
    }
    for (const a of [...asks]) {
      a.tag.position.copy(a.car.g.position).setY(3.2);
      a.tag.userData.set(`${a.icon} ${Math.ceil(a.left)}s`);
      const done = tool && player.g.position.distanceTo(a.car.g.position) <= EX.air.reach;
      const helped = lvl('airAttendant') && a.left <= EX.air.waitSec - EX.air.attendantSec;
      if (done || helped) { pay('air', EX.air.fee * (1 + lvl('airPrice') * U('air').airPrice.step), a.car.g.position); sound('cash'); }
      if (done) tool = false;
      if (done || helped || (a.left -= dt) <= 0 || a.car.phase !== 'charge') { scene.remove(a.tag); asks.splice(asks.indexOf(a), 1); }
    }
    toolTag.visible = tool;
    if (tool) { toolTag.position.copy(player.g.position).setY(3); toolTag.userData.set('🧽💨'); if (!toolTag.parent) scene.add(toolTag); }
  }
  function update(dt) {
    if (owned('moto')) updateMoto(dt);
    if (owned('mart')) updateMart(dt);
    if (owned('air')) updateAir(dt);
    for (const k of kinds) if (owned(k)) state.extras[k].cash = spots[k].cash;
  }
  // Where the guide arrow should point: an empty mart shelf, or a waiting ask once the player holds the tool.
  function goal() {
    if (owned('mart') && state.extras.mart.stock < 1) return [offset('mart', EX.mart.shelfZone), `Restock the Mini Mart: ${EX.mart.goods[station.id]}`];
    if (asks.length) return tool ? [asks[0].car.g.position, `Bring the tool to the car ${asks[0].icon}`] : [centre('air'), 'Grab the tool at Air & Glass'];
    return null;
  }
  const inRow = () => kinds.some((k) => at[k][1] > CONFIG.world.floorParts.at(-1)[0]);
  const rowOpen = () => kinds.some((k) => owned(k) && at[k][1] > CONFIG.world.floorParts.at(-1)[0]);
  const upgrades = () => Object.assign({}, ...kinds.filter(owned).map(U));
  return { kinds, buildings, owned, open, show, update, goal, inRow, rowOpen, upgrades, cashSpots: () => kinds.filter(owned).map((k) => spots[k]) };
}
