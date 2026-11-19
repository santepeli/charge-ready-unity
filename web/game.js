import * as THREE from 'three';
import { CONFIG } from './config.js';
import { upgradeCost, chargeFee, capacity, chargeTime, padCost, offlineEarnings, fineFor, city, setCity } from './economy.js';
import { createInput } from './input.js';
import { createTelemetry } from './telemetry.js';
import { createAds } from './ads.js';
import { buildGenerator, buildRivalVan, worldSize, mat, paintedMat, tileTexture, buildDecorStages, buildCar, buildCharger, buildCafe, kitGeometry, buildTable, buildPerson, stepPerson, buildDecor, buildPolice, buildOfficer, buildOffice, buildKiosk, buildCupMaterials, buildBillMaterials, buildTieIcon, buildCoinIcon, buildFloorTile, buildPowerup, buildBus, foodGeometry, buildLimo, buildStationDecor, buildMachine, buildStationFrame } from './models.js';
import { createAudio } from './audio.js';
import { createMobile } from './mobile.js';
import { createWash } from './wash.js';
import { createExtras } from './extras.js';
import { createService } from './service.js';
import { createAirport } from './airport.js';

const { gameplay: G, world: W, sizes: S, colors: COL, render: R, label: L, save: SV, feel: F, road: RD, engage: E, traffic: T, staff: ST, coffee: CF } = CONFIG;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const v3 = ([x, z]) => new THREE.Vector3(x, 0, z);
const inside = (p, c, [w, d]) => Math.abs(p.x - c.x) < w / 2 && Math.abs(p.z - c.z) < d / 2;
const Z = S.zones;

// Save state lives in localStorage and survives reloads.
const fresh = () => ({
  cash: CONFIG.economy.startCash, bays: 1, pad: 0, padPaid: 0, worker: false, served: 0, earned: 0, playSec: 0, doneAt: null, runId: Date.now().toString(36),
  levels: { tariff: 0, capacity: 0, speed: 0 }, bayCash: [], tableCash: [], seen: {}, ratings: [], spawned: 0, mission: { i: 0, progress: 0 }, jams: 0, policeVisits: 0, fines: 0, lost: 0, cups: 0, cityIntro: false, topSec: 0, office: false, accounting: false, ledger: {}, chainBox: 0, coffee: false, coffeeCash: 0, daily: { last: '', streak: 0 }, rival: { wins: 0 }, album: [], regulars: {}, shop: { noAds: false, starter: false, offered: false }, settings: { sound: true, vibrate: true }, savedAt: Date.now(), version: SV.version,
});
// The save is one object: the wallet and player-wide keys at the top, each station's build under stations[id], and the active station.
const GLOBAL = ['cash', 'settings', 'daily', 'seen', 'savedAt', 'notice', 'shop', 'album', 'regulars'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const SERVICE_UP = Object.values(CONFIG.service.upgrades).flatMap(Object.keys);
// Each step upgrades a save from the version before it; a save that cannot be read is backed up, never silently dropped.
const MIGRATE = {
  2: (s) => ({ ...s, cityDone: undefined }), // v3 has seven stages, so an old 'complete' flag is cleared.
  // v4 splits the flat save into the town and, if the player owns any of its services, the highway that now holds them.
  3: (s) => {
    const town = omit(s, [...GLOBAL, 'version', 'city', 'service', 'cityDone']), owned = s.service && Object.keys(s.service).length;
    town.levels = omit(s.levels ?? {}, SERVICE_UP);
    const stations = { town };
    if (owned) stations.highway = { service: s.service, levels: pick(s.levels ?? {}, SERVICE_UP), cityIntro: true };
    return { ...pick(s, GLOBAL), version: 4, active: 'town', stations };
  },
  // v5: a highway that got the moved shops starts with the town's charging and diner build, and the player is told once where the shops went.
  4: (s) => {
    const town = s.stations.town, hw = s.stations.highway;
    if (!town || !hw?.service || hw.doneAt != null) return { ...s, version: 5 };
    const base = pick(town, ['pad', 'bays', 'worker', 'office', 'accounting', 'doneAt', 'served']);
    return { ...s, version: 5, notice: 'moved', stations: { ...s.stations, highway: { ...hw, ...base, levels: { ...pick(town.levels ?? {}, Object.keys(CONFIG.upgrades)), ...hw.levels } } } };
  },
};
function load() {
  let raw = null;
  try { raw = localStorage.getItem(SV.key); } catch { return [fresh(), {}]; }
  if (!raw) return [fresh(), {}];
  try {
    let s = JSON.parse(raw);
    for (let v = s.version ?? 2; v < SV.version; v++) s = MIGRATE[v](s);
    const active = STATION_IDS.includes(s.active) ? s.active : STATION_IDS[0];
    // Upgrade levels merge key by key, so a station block that only carries some lines still starts the base lines at 0.
    const block = s.stations[active] ?? {}, base = fresh();
    return [{ ...base, ...block, levels: { ...base.levels, ...block.levels }, ...pick(s, GLOBAL), version: SV.version }, { ...s, active }];
  } catch {
    try { localStorage.setItem(`${SV.key}-backup-${Date.now()}`, raw); } catch { /* storage full */ }
    return [fresh(), {}];
  }
}
const STATION_IDS = CONFIG.stations.map((st) => st.id);
// Test modes: `?bot` hands the simulation to a script, `?sim&warp=N` keeps real input but runs N fixed steps per frame.
const params = new URLSearchParams(location.search), BOT = params.has('bot'), SIM = params.has('sim'), WARP = Number(params.get('warp')) || 1;
const botLog = [];
const [state, saved] = load();
// The other stations' builds stay in `chain`; the one being played lives in `state`.
const chain = { active: saved.active ?? STATION_IDS[0], stations: saved.stations ?? {} };
const STATION = CONFIG.stations.find((st) => st.id === chain.active);
// Stage 1 is charging and the diner; the station's own stages follow in its listed order, each once the one before is complete.
const PAD_OF = STATION.stages;
const AP = CONFIG.airport;
const PART = { solar: () => [airport.owned('solar'), AP.solar.upgrades], lounge: () => [airport.owned('lounge'), AP.lounge.upgrades], coffee: () => [state.coffee, CF.upgrades], depot: () => [mobile.owned(), CONFIG.mobile.upgrades], wash: () => [wash.owned(), CONFIG.wash.upgrades], ...Object.fromEntries(['tire', 'repair', 'tow'].map((k) => [k, () => [service.owned(k), SVC.upgrades[k]]])) };
const stageParts = () => PAD_OF.map((k) => PART[k]());
const stageKeys = ['charge', ...PAD_OF], stageName = (n) => CONFIG.stageInfo[stageKeys[n - 1]][0], stageIcon = (n) => CONFIG.stageInfo[stageKeys[n - 1]][1];
// Writes the whole chain: the wallet and player-wide keys on top, the played station's build under its id.
const chainJson = (s) => JSON.stringify({ ...pick(s, GLOBAL), version: SV.version, active: chain.active, stations: { ...chain.stations, [chain.active]: omit(s, [...GLOBAL, 'version']) } });
const writeSave = (s) => localStorage.setItem(SV.key, chainJson(s));
// Seconds played over the whole chain, the yardstick for which of two saves is further along.
const playedIn = (saved) => Object.values(saved?.stations ?? {}).reduce((t, st) => t + (st.playSec ?? 0), 0);
const BACKUP = `${SV.key}-backup`, readBackup = () => { try { return JSON.parse(localStorage.getItem(BACKUP)); } catch { return null; } };
let backupPlayed = playedIn(readBackup()), backupAt = state.playSec;
// Frame counter feeds the average fps reported with each telemetry write.
const perf = { frames: 0, sec: 0, fps: () => Math.round(perf.frames / Math.max(perf.sec, Number.EPSILON)) };
const track = BOT || SIM ? { milestone: (name) => botLog.push([name, Math.round(state.playSec)]) } : createTelemetry(state, perf.fps);
// Logs a run event only the first time it happens.
// The starter pack pays its cash at this station's prices; any purchase is saved at once. Bots skip ads unless ?ads asks for the real cards.
const AD = CONFIG.ads, ads = createAds(state.shop, { skip: (BOT || SIM) && !params.has('ads'), track: track.milestone, onBuy: (key) => {
  if (key === 'starter') { const cash = Math.round(AD.shop.starter.cash * CONFIG.economy.costMultiplier ** STATION.level); state.cash += cash; book('bonus', cash); flyCoins(player.g.position, cash); audio.play('cash'); }
  renderSettings();
  save();
} });
const once = (name) => { if (!state.seen[name]) { state.seen[name] = true; track.milestone(name); } };
let resetting = false;
const sessionStart = state.playSec;
function save() {
  if (resetting) return;
  state.savedAt = Date.now();
  state.bayCash = bays.map((b) => b.cash);
  state.tableCash = bays.map((b) => b.table.cash);
  if (state.mobile) state.mobile.cash = mobile.spot.cash;
  state.coffeeCash = kiosk.cash;
  // The away rate is the station's real income per second, measured once this session has a full window of play.
  if (state.playSec - sessionStart >= ST.accounting.windowSec) state.rate = perSec(RATE_KINDS);
  try { writeSave(state); } catch { /* storage blocked, play continues unsaved */ }
  // The backup only moves forward: a save wiped by accident never overwrites the copy that still holds the real progress.
  if (state.playSec - backupAt < SV.backupSec) return;
  backupAt = state.playSec;
  const json = chainJson(state), played = playedIn(JSON.parse(json));
  if (played < backupPlayed) return;
  try { localStorage.setItem(BACKUP, json); backupPlayed = played; } catch { /* storage full */ }
}
// On start, a backup clearly ahead of the save (a wiped or broken save) is offered back.
function offerRestore() {
  const backup = readBackup(), now = playedIn(JSON.parse(chainJson(state)));
  if (!backup || playedIn(backup) - now < SV.restoreGapSec) return;
  const min = (s) => Math.round(s / 60);
  $('restoreText').textContent = `A backup with ${min(playedIn(backup))} min of play was found; this game has ${min(now)} min. Restore the backup?`;
  $('restore').hidden = false;
  $('restoreNo').onclick = () => { $('restore').hidden = true; backupPlayed = 0; };
  $('restoreYes').onclick = () => { resetting = true; localStorage.setItem(SV.key, JSON.stringify(backup)); location.reload(); };
}

// Renderer, camera and lights.
const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
// A fixed resolution from settings, or the automatic range when the player picks Auto.
const fixedRatio = () => R.quality[state.settings.quality ?? R.qualityDefault] ?? null;
const startRatio = () => Math.min(devicePixelRatio, fixedRatio() ?? R.maxPixelRatio);
renderer.setPixelRatio(startRatio());
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Shadows are redrawn every few frames instead of every frame, which saves most of the shadow cost on phones; bot screenshots draw them every time.
renderer.shadowMap.autoUpdate = BOT;
document.getElementById('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
setCity(STATION.level);
scene.background = new THREE.Color(STATION.ground);
const camera = new THREE.PerspectiveCamera(R.fov, 1, R.near, R.far);
const hemi = new THREE.HemisphereLight(COL.lightSky, COL.lightGround, R.hemi);
scene.add(hemi);
const sun = new THREE.DirectionalLight(COL.sun, R.sun);
sun.position.set(...R.sunPos);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(R.shadowMap);
Object.assign(sun.shadow.camera, { left: -R.shadowExtent, right: R.shadowExtent, top: R.shadowExtent, bottom: -R.shadowExtent });
sun.shadow.bias = R.shadowBias;
scene.add(sun);
buildDecor(scene, STATION.ground, STATION.decor);
const audio = createAudio(() => state.settings.sound);
const buzz = () => { if (state.settings.vibrate) try { navigator.vibrate?.(CONFIG.vibrateMs); } catch { /* not allowed here */ } };

const box = (s, c) => new THREE.Mesh(new THREE.BoxGeometry(...s), mat(c));
const FOOD = STATION.food, { geo: mealGeo, mat: mealMat } = foodGeometry(FOOD.model, S.meal.kit, FOOD.tint);
const billGeo = new THREE.BoxGeometry(...S.bill), billMat = buildBillMaterials();

// Sprite with canvas text, optionally led by a battery gauge at pct (0-1); redraws only on change.
// A hot dog drawn with the food's tint colours and a thick dark outline, readable at label size.
const DRAWN_FOOD = FOOD.model === 'hotDog' && FOOD.tint;
function drawHotDog(ctx, cx, cy, size) {
  const t = FOOD.tint, bar = (y, w, h, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(cx - w / 2, cy + y - h / 2, w, h, h / 2); ctx.fill(); ctx.stroke(); };
  ctx.save();
  Object.assign(ctx, { lineWidth: size * 0.09, strokeStyle: COL.labelStroke, lineJoin: 'round' });
  bar(size * 0.16, size * 0.86, size * 0.3, t.brown);
  bar(0, size, size * 0.26, t.red);
  bar(-size * 0.17, size * 0.82, size * 0.22, t.brownLight);
  Object.assign(ctx, { strokeStyle: t.yellow, lineWidth: size * 0.07, lineCap: 'round' });
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) ctx.lineTo(cx - size * 0.36 + i * size * 0.09, cy + (i % 2 ? -1 : 1) * size * 0.045);
  ctx.stroke();
  ctx.restore();
}
function label() {
  const c = document.createElement('canvas');
  c.width = L.w; c.height = L.h;
  const ctx = c.getContext('2d'), tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(S.labelScale * L.w / L.h, S.labelScale, 1);
  let last = null;
  sprite.userData.set = (text, pct, color = COL.labelText) => {
    const key = `${text}|${pct === undefined ? '' : Math.round(pct * 100)}|${color}`;
    if (key === last) return;
    last = key;
    sprite.userData.text = text;
    ctx.clearRect(0, 0, L.w, L.h);
    let x = L.w / 2;
    if (pct !== undefined) {
      const [gx, gy, gw, gh] = L.gauge, color = pct < L.gaugeLow ? COL.gaugeLow : pct < L.gaugeMid ? COL.gaugeMid : COL.gaugeHigh;
      Object.assign(ctx, { fillStyle: COL.labelStroke, lineJoin: 'round' });
      ctx.fillRect(gx, gy, gw, gh);
      ctx.fillRect(gx + gw, gy + gh / 4, L.stroke, gh / 2);
      ctx.fillStyle = color;
      ctx.fillRect(gx + L.stroke / 2, gy + L.stroke / 2, (gw - L.stroke) * Math.max(pct, L.gaugeMin), gh - L.stroke);
      x = (gx + gw + L.w) / 2 + L.stroke;
    }
    Object.assign(ctx, { font: L.font, textAlign: 'center', textBaseline: 'middle', lineJoin: 'round', lineWidth: L.stroke, strokeStyle: COL.labelStroke, fillStyle: color });
    const room = 2 * (L.w - x), parts = DRAWN_FOOD ? text.split(FOOD.icon) : [text];
    if (parts.length === 1) {
      ctx.strokeText(text, x, L.h / 2, room);
      ctx.fillText(text, x, L.h / 2, room);
    } else {
      // The food emoji is too pale on a phone, so it is drawn by hand between the text pieces, all scaled to fit the room.
      const icon = L.h * 0.95, widths = parts.map((t) => ctx.measureText(t).width), full = widths.reduce((a, w) => a + w, 0) + icon * (parts.length - 1);
      const k = Math.min(1, room / full);
      ctx.save();
      ctx.translate(x - full * k / 2, L.h / 2);
      ctx.scale(k, k);
      ctx.textAlign = 'left';
      let at = 0;
      parts.forEach((t, i) => {
        ctx.strokeText(t, at, 0);
        ctx.fillText(t, at, 0);
        at += widths[i];
        if (i < parts.length - 1) { drawHotDog(ctx, at + icon / 2, 0, icon); at += icon; }
      });
      ctx.restore();
    }
    tex.needsUpdate = true;
  };
  scene.add(sprite);
  return sprite;
}

// Height of a geometry, used to stack items on top of each other.
const heightOf = (geo) => { if (!geo.boundingBox) geo.computeBoundingBox(); return geo.boundingBox.max.y - geo.boundingBox.min.y; };
// Keeps `list` at n meshes under parent, stacked upward or, with `cols`, laid out in rows on a counter.
function syncStack(list, n, parent, base, geo, material, cols = 0) {
  while (list.length < n) { const m = new THREE.Mesh(geo, material); parent.add(m); list.push(m); }
  while (list.length > n) parent.remove(list.pop());
  list.forEach((m, i) => (cols
    ? m.position.set(base[0] + (i % cols) * S.meal.gap, base[1], base[2] + Math.floor(i / cols) * S.meal.gap)
    : m.position.set(base[0], base[1] + i * heightOf(geo), base[2])));
}

// The owner's stack marks the stencil like the owner, so their see-through copy never paints over what they carry.
const ownStackMats = new Map();
const ownStackMat = (mat) => Array.isArray(mat) ? mat.map(ownStackMat) : ownStackMats.get(mat) ?? ownStackMats.set(mat, Object.assign(mat.clone(), { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp })).get(mat);
// An actor's carried stack, one mesh per item in pickup order, rebuilt only when what it shows changes.
function syncItems(a) {
  const shown = a.items.slice(0, a.carry - a.incoming), key = shown.join();
  if (key === a.stackKey) return;
  a.stackKey = key;
  a.stack.forEach((m) => a.stackRoot.remove(m));
  let y = 0;
  a.stack = shown.map((type) => {
    const { geo, mat } = type === 'main' ? { geo: mealGeo, mat: mealMat } : sideGeo[type], m = new THREE.Mesh(geo, a === player ? ownStackMat(mat) : mat);
    m.position.y = y;
    y += heightOf(geo);
    a.stackRoot.add(m);
    return m;
  });
}

// The lot is paved strip by strip as the business grows; lanes and crossings appear with the stage that needs them.
const paved = [];
const flat = (w, d, color, x, z, y) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), typeof color === 'string' ? new THREE.MeshLambertMaterial({ color }) : color);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
};
W.floorParts.forEach(([z0, z1, when]) => {
  const d = z1 - z0, m = flat(W.floorWidth, d, paintedMat(tileTexture(STATION.floor, 64, false, [W.floorWidth / W.floorTile, d / W.floorTile])), W.floorX, (z0 + z1) / 2, 0);
  paved.push({ m, when });
});
// Lane strips and their dashes are tinted toward the station's floor, so the paths read without crowding the lot.
const LL = W.laneLook, toFloor = (c) => `#${new THREE.Color(STATION.floor[0]).lerp(new THREE.Color(c), LL.mix).getHexString()}`;
const laneColor = toFloor(COL.lane), dashColor = toFloor(COL.laneLine);
// A road lane (the drive-thru access road off the lot) is asphalt with white dashes like the main road.
W.lanes.forEach(({ at, w, when, road }) => {
  const g = new THREE.Group(), strip = road ? COL.road : laneColor, dash = road ? COL.roadLine : dashColor;
  at.forEach(([x, z], i) => {
    g.add(flat(w, w, strip, x, z, 0.004));
    const next = at[i + 1];
    if (!next) return;
    const [nx, nz] = next, len = Math.hypot(nx - x, nz - z), along = nx !== x;
    g.add(flat(along ? len : w, along ? w : len, strip, (x + nx) / 2, (z + nz) / 2, 0.004));
    // Dashed guide line down the middle of the lane.
    const [dl, dw] = LL.dash;
    for (let s = LL.step / 2; s < len - 0.3; s += LL.step) {
      const t = s / len;
      g.add(flat(along ? dl : dw, along ? dw : dl, dash, x + (nx - x) * t, z + (nz - z) * t, 0.008));
    }
  });
  paved.push({ m: g, when });
});
W.crossings.forEach(([[x, z], when]) => {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) g.add(flat(1.3, 0.2, COL.laneLine, x, z - 0.6 + i * 0.4, 0.012));
  paved.push({ m: g, when });
});
// Unpaved strips show as a construction site until their stage is bought.
const GH = CONFIG.ghost, lots = [];
{
  const barGeo = new THREE.BoxGeometry(...GH.barrier), barMat = [mat(COL.tow), mat(COL.laneLine)];
  W.floorParts.filter(([, , when]) => when).forEach(([z0, z1, when]) => {
    const g = new THREE.Group();
    g.add(flat(W.floorWidth, z1 - z0, GH.lot, W.floorX, (z0 + z1) / 2, 0));
    for (let x = W.floorX - W.floorWidth / 2 + 1, i = 0; x < W.floorX + W.floorWidth / 2; x += GH.barrierGap, i++) {
      const b = new THREE.Mesh(barGeo, barMat[i % 2]);
      b.position.set(x, GH.barrier[1] / 2, z0 + 0.3);
      g.add(b);
    }
    scene.add(g);
    lots.push({ g, when });
  });
}
// Shows each paved piece once its stage is bought, with a pop; the player may step just past the paving to reach the next pad.
let reachZ = W.bounds[3];
function pave() {
  // A station without vans paves the depot strip as a walkway with the office, so its later strips stay in reach.
  const open = { office: !!manager, depot: PAD_OF.includes('depot') ? mobile.owned() : !!manager, coffee: state.coffee, wash: wash.owned(), tire: service.owned('tire') || extras.rowOpen() };
  // The bottom strip belongs to this station when it builds services or expansions there.
  const row = PAD_OF.includes('tire') || extras.inRow();
  for (const p of paved) {
    const on = !p.when || open[p.when];
    if (on && !p.m.parent) { scene.add(p.m); if (p.when) pop(p.m); }
  }
  for (const l of lots) l.g.visible = !open[l.when] && (l.when !== 'tire' || row);
  // The player may step past the paving only when a strip this station still builds lies below; otherwise the lot ends at the paving.
  const built = W.floorParts.filter(([, , when]) => !when || open[when]), last = Math.max(...built.map(([, z1]) => z1));
  const more = W.floorParts.some(([z0, , when]) => z0 >= last && when && !open[when] && (when !== 'tire' || row));
  reachZ = Math.min(W.bounds[3], last + (more ? W.reach : W.edge));
}

// Translucent floor rectangle that marks exactly where an interaction triggers.
function zoneMesh(center, size, color) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(...size), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: Z.opacity }));
  m.rotation.x = -Math.PI / 2;
  m.position.copy(center).setY(Z.lift);
  return m;
}

// Café: the espresso machine fills cups that drivers order while their car charges.
const cafe = { pos: v3(W.cafe), stock: 0, timer: 0, stack: [] };
cafe.zone = cafe.pos.clone().add(v3(Z.cafe.offset));
scene.add(zoneMesh(cafe.zone, Z.cafe.size, COL.zoneCafe));
// Side machines: the station's two side products, the first pads after stage 1 is done; each makes items onto its counter.
const SD = CONFIG.side, SIDES = STATION.sides;
const sideGeo = SIDES.map((s) => foodGeometry(s.model, S.meal.kit));
const machines = SIDES.map((side, i) => {
  const m = buildMachine(side, STATION.machine), pos = v3(SD.at[i]);
  m.position.copy(pos);
  return { side, i, m, pos, zone: pos.clone().add(v3([0, SD.zoneOffset])), stock: 0, timer: 0, stack: [], top: m.userData.top };
});
const sideOwned = (i) => Boolean(state.sides?.[i]);
function showSides() {
  for (const mc of machines) if (sideOwned(mc.i) && !mc.m.parent) { scene.add(mc.m, zoneMesh(mc.zone, SD.zone, COL.zoneCafe)); pop(mc.m); }
}
function openSide(i) {
  state.sides ??= [];
  state.sides[i] = true;
  showSides();
}
function produceSides(dt) {
  for (const mc of machines) {
    if (!sideOwned(mc.i)) continue;
    if (mc.stock < SD.max && (mc.timer += dt) >= SD.sec) { mc.timer = 0; mc.stock++; }
    syncStack(mc.stack, mc.stock, mc.top, [-S.meal.gap, S.meal.h / 2, 0], sideGeo[mc.i].geo, sideGeo[mc.i].mat, 3);
  }
}
const cafeModel = buildCafe(FOOD), cafeTop = cafeModel.userData.top;
cafeModel.position.copy(cafe.pos);
scene.add(cafeModel);

// Each free bay waits a slightly different time, so drivers take tables in no fixed order.
const spawnWait = () => G.carSpawnSec * (0.7 + 0.6 * Math.random());

const bays = W.bays.map((p, i) => {
  const pos = v3(p), group = new THREE.Group(), zone = pos.clone().add(v3(Z.bay.offset));
  const charger = buildCharger();
  charger.position.copy(pos);
  group.add(zoneMesh(zone, Z.bay.size, COL.zoneBay), charger);
  const tag = label();
  const spot = pos.clone().add(v3(W.carOffset));
  // Each bay has its own patio table where its driver eats while the car charges.
  const tPos = v3(W.tables[i]), tableModel = buildTable(), table = { zone: tPos, seat: tPos.clone().add(v3(S.table.seat)), cashPos: tPos.clone().add(v3(S.table.cash)), cash: 0, bills: [], tag: label() };
  tableModel.position.copy(tPos);
  table.tag.position.copy(tPos).setY(S.tagHeight);
  group.add(zoneMesh(tPos, S.table.zone, COL.zoneTable), tableModel);
  scene.add(group);
  // Cars turn off the road onto the entry lane, drive down into the bay, then roll out onto the exit lane and back to the road.
  const pathIn = [v3([RD.inLane, W.entryZ]), v3([spot.x, W.entryZ]), spot];
  const pathOut = [v3([spot.x, W.exitZ]), v3([RD.serviceLane, W.exitZ]), ...W.merge.map(v3), v3([RD.inLane, RD.exitZ])];
  return { pos, zone, group, charger, tag, spot, door: spot.clone().add(v3(S.table.door)), table, pathIn, pathOut, cashPos: pos.clone().add(v3(W.cashOffset)), car: null, wait: spawnWait(), pull: 0, cash: 0, bills: [] };
});
const openBays = () => bays.slice(0, state.bays);
// Every pile of money the player can walk over: bays and their tables.
// Mobile charging service, opened after Station 1 through the depot pad.
// Books: every dollar in or out is recorded by kind; the accountant reads income rates from the last minute.
const recent = [];
function book(kind, amount) {
  if (!amount) return;
  // Rescues and tows count toward the station goals as they are paid.
  if (kind === 'mobile' || kind === 'tow') tally(kind);
  state.ledger[kind] = (state.ledger[kind] ?? 0) + amount;
  recent.push([state.playSec, kind, amount]);
}
// Income per second over the accounting window for the given kinds.
function perSec(kinds) {
  const from = state.playSec - ST.accounting.windowSec;
  while (recent.length && recent[0][0] < from) recent.shift();
  return recent.filter(([, k]) => kinds.includes(k)).reduce((a, [, , v]) => a + v, 0) / Math.min(ST.accounting.windowSec, Math.max(state.playSec, 1));
}
const mobile = createMobile({ state, scene, once, book, label, blocked, alert: (text) => { audio.play('alert'); if (text) toast(text, E.bannerMs * 2); } });
const wash = createWash({ state, scene, once, book, earn, drive, toTraffic: (c) => traffic.push(c), fx: (p, dt) => maybeEmit(p, FX.foam, dt) });
const SVC = CONFIG.service;
const service = createService({ state, scene, once, book, earn, drive, label, toTraffic: (c) => traffic.push(c), sound: (n) => audio.play(n), fx: (p, dt) => maybeEmit(p, FX.spark, dt), staff: (pos) => makeActor(COL.worker, pos), toast: (t) => toast(t, F.toastMs * 2) });
const airport = createAirport({ state, scene, planes: STATION.planes, ready: () => state.bays >= 2, land: (plane, phase) => {
  if (phase === 'approach') { look(plane, CONFIG.airport.landSec + 0.6, CONFIG.airport.planeZoom); audio.play('horn'); return; }
  // Every few flights a VIP is on board, and for a while more travelers leave their car with the valet.
  landings++;
  if (landings % CHN.flightEvery === 0) forceVip = true;
  valetBoostUntil = state.playSec + CHN.valetBoostSec;
  for (let i = 0; i < CONFIG.airport.landWave; i++) queue.push(makeCar('queue'));
  toast('✈️ Flight landed! Travelers are on their way');
  once('landing');
} });
const stationDecor = buildStationDecor(STATION.decor);
scene.add(stationDecor, buildStationFrame(STATION));
const cashSpots = () => [...openBays().flatMap((b) => [b, b.table]), ...(mobile.owned() ? [mobile.spot] : []), ...(wash.owned() ? [wash.spot] : []), ...service.cashSpots(), ...extras.cashSpots(), ...(state.coffee ? [kiosk] : [])];

function makeActor(color, pos) {
  const g = buildPerson(color, true);
  const stackRoot = new THREE.Group();
  stackRoot.position.set(...S.carryBase);
  g.add(stackRoot);
  g.position.copy(pos);
  scene.add(g);
  pop(g);
  // items lists what the actor carries in pickup order: 'main' for the station's food or a side machine's index.
  return { g, stackRoot, carry: 0, incoming: 0, items: [], stack: [], stackKey: '', timer: 0, pace: 0, lean: 0, tag: label() };
}

// World position of the slot above an actor's visible stack.
const stackTop = (a) => a.stackRoot.localToWorld(new THREE.Vector3(0, (a.carry - a.incoming) * S.meal.h, 0));

// Visual-only flights: a mesh arcs to a moving target, then runs `done`; negative delay staggers it.
const flights = [];
function fly(geo, material, from, target, done, delay = 0) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(from);
  mesh.visible = delay === 0;
  scene.add(mesh);
  flights.push({ mesh, from: from.clone(), target, t: -delay / F.flySec, done });
}
function updateFlights(dt) {
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i];
    f.t = Math.min(f.t + dt / F.flySec, 1);
    if (f.t < 0) continue;
    f.mesh.visible = true;
    f.mesh.position.lerpVectors(f.from, f.target(), f.t).y += Math.sin(f.t * Math.PI) * F.flyArc;
    if (f.t === 1) { scene.remove(f.mesh); flights.splice(i, 1); f.done?.(); }
  }
}

// Particles from an fx preset; each shrinks away over its life.
// Particles are soft round sprites drawn in one call: a small shader sizes them by distance and fades them out.
const FX = CONFIG.fx, particles = [];
const pGeo = new THREE.BufferGeometry(), pPos = new Float32Array(FX.max * 3), pCol = new Float32Array(FX.max * 3), pSize = new Float32Array(FX.max), pAlpha = new Float32Array(FX.max);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
pGeo.setAttribute('alpha', new THREE.BufferAttribute(pAlpha, 1));
const particleCloud = new THREE.Points(pGeo, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, vertexColors: true,
  uniforms: { scale: { value: 1 } },
  vertexShader: 'attribute float size; attribute float alpha; varying vec3 vColor; varying float vAlpha; uniform float scale; void main() { vColor = color; vAlpha = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'varying vec3 vColor; varying float vAlpha; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(mix(vec3(1.0), vColor, smoothstep(0.0, 0.25, d)), vAlpha * smoothstep(0.5, 0.3, d)); }',
}));
particleCloud.frustumCulled = false;
scene.add(particleCloud);
const tint = new THREE.Color();
function emit(at, fx, scale = 1) {
  const count = Math.min(fx.count * scale, FX.max - particles.length);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2, r = fx.speed * Math.random();
    particles.push({ p: at.clone(), fx, c: tint.set(fx.colors[i % fx.colors.length]).toArray(), v: new THREE.Vector3(Math.cos(a) * r, fx.up * (1 + Math.random()) / 2, Math.sin(a) * r), t: 0 });
  }
}
// Continuous effects fire on average once per fx.every seconds.
const maybeEmit = (at, fx, dt) => { if (Math.random() < dt / fx.every) emit(at, fx); };
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i];
    q.v.y -= q.fx.gravity * dt;
    q.p.addScaledVector(q.v, dt);
    if ((q.t += dt) > q.fx.life) particles.splice(i, 1);
  }
  particles.forEach((q, i) => {
    const k = 1 - q.t / q.fx.life;
    q.p.toArray(pPos, i * 3);
    pCol.set(q.c, i * 3);
    pSize[i] = q.fx.size * FX.spriteScale * (0.5 + k / 2);
    pAlpha[i] = Math.min(1, k * 2);
  });
  pGeo.setDrawRange(0, particles.length);
  for (const key of ['position', 'color', 'size', 'alpha']) pGeo.attributes[key].needsUpdate = true;
}

// Scale-in with overshoot for anything that appears, ending at the size the object already had.
const pops = [];
// A pop already running is left alone, so a second pop never takes its half-grown size as the final one.
function pop(obj) { if (pops.some((p) => p.obj === obj)) return; pops.push({ obj, t: 0, to: obj.scale.x }); obj.scale.setScalar(0); }
function updatePops(dt) {
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i], k = Math.min((p.t += dt / F.popSec), 1) - 1, c = F.popOvershoot;
    p.obj.scale.setScalar(p.to * (1 + (c + 1) * k ** 3 + c * k ** 2));
    if (k === 0) pops.splice(i, 1);
  }
}
const player = makeActor(COL.player, v3(W.playerSpawn));
// Behind anything that is not faded the owner shows through in their own colours at reduced opacity. The owner marks the pixels
// where they are seen in the stencil, so the see-through copy draws only where something stands in front.
const FADE = CONFIG.fade, ownMeshes = [];
player.g.traverse((m) => { if (m.isMesh) ownMeshes.push(m); });
for (const m of ownMeshes) {
  // Clothes are the meshes in the owner's colour; the outfit setting repaints them.
  m.userData.outfit = m.material.color?.getHexString() === new THREE.Color(COL.player).getHexString();
  m.material = m.material.clone();
  Object.assign(m.material, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
  if (m.material.side === THREE.BackSide) continue;
  const ghost = new THREE.Mesh(m.geometry, Object.assign(m.material.clone(), { transparent: true, opacity: FADE.ghost, depthFunc: THREE.GreaterDepth, depthWrite: false,
    stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.KeepStencilOp }));
  ghost.renderOrder = 5;
  m.userData.ghost = ghost;
  m.add(ghost);
}

// Floating markers (a charger's battery icon) between the camera and the owner fade while the owner is behind them; solid things
// never fade or get cut, since the owner cannot walk into them, and the owner's own see-through copy shows behind a tall one.
const fadeRay = new THREE.Raycaster(), faded = new Map(), fadeCopies = new Map(), fadeRoots = new Map();
fadeRay.camera = camera;
let fadeFrame = 0, fadeDt = 0;
const ownedByPlayer = (o) => { for (; o; o = o.parent) if (o === player.g) return true; return false; };
const fadeCopy = (m) => {
  if (Array.isArray(m)) return m.map(fadeCopy);
  if (!fadeCopies.has(m)) fadeCopies.set(m, Object.assign(m.clone(), { transparent: true, opacity: FADE.opacity * (m.opacity ?? 1), depthWrite: false }));
  return fadeCopies.get(m);
};
// The largest ancestor no longer than maxSize: a whole car or booth, never the whole station decor.
const fadeRoot = (mesh) => {
  if (!fadeRoots.has(mesh)) {
    let root = mesh;
    for (let o = mesh.parent; o && o !== scene; o = o.parent) if (new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).length() <= FADE.maxSize) root = o;
    fadeRoots.set(mesh, root);
  }
  return fadeRoots.get(mesh);
};
const fadeOn = (root) => root.traverse((m) => {
  if (!m.isSprite || m.userData.fade) return;
  m.userData.fade = m.material;
  m.material = fadeCopy(m.material);
});
const fadeOff = (root) => root.traverse((m) => {
  if (!m.userData.fade) return;
  m.material = m.userData.fade;
  delete m.userData.fade;
});
function fadeOccluders(frameDt) {
  fadeDt += frameDt;
  if (++fadeFrame % FADE.every) return;
  const dt = fadeDt;
  fadeDt = 0;
  const hits = new Set(), dir = new THREE.Vector3(), side = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
  // Rays to the owner's middle and both edges, so a thin post covering one side fades too.
  for (const y of FADE.heights) for (const k of [-1, 0, 1]) {
    const target = player.g.position.clone().setY(y).addScaledVector(side, k * FADE.spread);
    fadeRay.set(camera.position, dir.copy(target).sub(camera.position).normalize());
    fadeRay.far = camera.position.distanceTo(target) - 0.3;
    for (const h of fadeRay.intersectObject(scene, true)) {
      const m = h.object;
      if (m.isSprite && m.visible && !ownedByPlayer(m)) hits.add(fadeRoot(m));
    }
  }
  for (const root of hits) { if (!faded.has(root)) fadeOn(root); faded.set(root, FADE.holdSec); }
  for (const [root, left] of faded) if (!hits.has(root)) {
    if (left - dt > 0) faded.set(root, left - dt);
    else { fadeOff(root); faded.delete(root); }
  }
}
const EX = CONFIG.extras;
const extras = createExtras({ state, scene, station: STATION, earn, book, drive, label, player, charging: () => openBays().filter((b) => b.car?.phase === 'charge').map((b) => b.car), sound: (n) => audio.play(n), tally });
// The owner is the same size as everyone else and stands out by a bright pulsing ring.
const playerRing = new THREE.Mesh(new THREE.RingGeometry(FX.ring.inner * 0.5, FX.ring.outer * 0.5, 32), new THREE.MeshBasicMaterial({ color: COL.pad, transparent: true }));
playerRing.rotation.x = -Math.PI / 2;
playerRing.position.y = 0.05;
player.g.add(playerRing);
// Small bobbing marker over the owner's head says "this is you".
const playerMark = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), new THREE.MeshBasicMaterial({ color: COL.player }));
playerMark.rotation.x = Math.PI;
player.g.add(playerMark);
let worker = null;
const PU = CONFIG.powerup, power = { kind: null, left: 0, item: null, life: 0, next: PU.firstSec };
const boosted = (kind) => (power.kind === kind ? PU.factor : 1);
const capOf = (actor) => (actor === player ? Math.round(capacity(state.levels.capacity) * boosted('carry')) : G.workerCap);
// Food fills the tray up to capOf; drinks and sides ride on top with their own room (CONFIG.side.carry), so a full tray never blocks a drink.
const mains = (actor) => actor.items.filter((t) => t === 'main').length;
const sideRoom = (actor) => actor.items.length - mains(actor) < SD.carry;

// Moves an actor along (dx, dz) and faces it that way.
function step(actor, dx, dz, speed, dt) {
  const p = actor.g.position, [x0, x1, z0, z1] = W.bounds;
  p.x = THREE.MathUtils.clamp(p.x + dx * speed * dt, x0, x1);
  p.z = THREE.MathUtils.clamp(p.z + dz * speed * dt, z0, Math.min(z1, reachZ));
  if (actor === player) solidPush(p);
  // Turns are quick but eased, so a reversal swings round over a few frames instead of snapping.
  actor.g.rotation.y += angleDiff(Math.atan2(dx, dz), actor.g.rotation.y) * Math.min(1, dt * G.turnRate);
  actor.pace = Math.hypot(dx, dz);
}

// Each car remembers its model for the album.
const KIT = CONFIG.kit, randomCar = () => { const model = KIT.cars[Math.floor(Math.random() * (KIT.cars.length - 1))], g = buildCar(model); g.userData.model = model; return g; };
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Moves a car toward its next waypoint at road speed and steers it smoothly; true once the path is done.
// Vehicles never drive into each other: one waits while its next step would touch another's body. When waits close a circle (two
// or more waiting on each other) the one heading least straight at its blocker goes first, a tie by id, so the lot never locks;
// a vehicle stuck longer than yieldSec behind one that is not waiting at all goes on as a last resort.
const vehicles = new Set(), extent = new WeakMap();
// Half length and half width of a vehicle's body as built, unturned; a roof sign or tag wider than the body does not count.
const extentOf = (g) => {
  if (!extent.has(g)) {
    const ry = g.rotation.y;
    g.rotation.y = 0; g.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(g.children.find((c) => c.isGroup || c.isMesh) ?? g).getSize(new THREE.Vector3());
    g.rotation.y = ry; g.updateMatrixWorld(true);
    extent.set(g, [size.x / 2, size.z / 2]);
  }
  return extent.get(g);
};
// Footprint corners at a given spot, a little inside the body so touching bumpers do not count.
const footprint = (g, x, z, ry = g.rotation.y) => {
  const [hx, hz] = extentOf(g).map((h) => Math.max(h - RD.yieldInset, 0.1)), c = Math.cos(ry), sn = Math.sin(ry);
  return [[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]].map(([a, b]) => [x + a * c + b * sn, z - a * sn + b * c]);
};
// How deep two turned rectangles overlap, in metres along the axis that separates them best; 0 when apart.
const depthOf = (A, B) => {
  let depth = Infinity;
  for (const P of [A, B]) for (let i = 0; i < 4; i++) {
    const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % 4], len = Math.hypot(z2 - z1, x1 - x2), nx = (z2 - z1) / len, nz = (x1 - x2) / len;
    const pa = A.map(([x, z]) => x * nx + z * nz), pb = B.map(([x, z]) => x * nx + z * nz);
    depth = Math.min(depth, Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)));
  }
  return Math.max(depth, 0);
};
// The look ahead never reaches past where the vehicle is going, so a car pulls right up to its queue spot.
// The step is judged against where the vehicle stands now with its heading before this frame's turn, so a swinging tail counts too.
function blocked(g, ux, uz, dt, who, left = Infinity, was = g.rotation.y) {
  vehicles.add(g);
  const p = g.position, ahead = Math.min(RD.yieldStep, left), next = footprint(g, p.x + ux * ahead, p.z + uz * ahead), now = footprint(g, p.x, p.z, was);
  for (const o of vehicles) {
    if (o === g) continue;
    if (!o.parent || !o.visible) { vehicles.delete(o); continue; }
    // A step that would touch, or press deeper into one already touching (a car spawned on another), waits.
    const rx = o.position.x - p.x, rz = o.position.z - p.z, body = rx * rx + rz * rz < 100 && footprint(o, o.position.x, o.position.z);
    if (!body || depthOf(next, body) <= depthOf(now, body) + 1e-3) continue;
    const ring = [o];
    for (let x = o.userData.yieldBy; x && ring.length < 7 && !ring.includes(x); x = x.userData.yieldBy) ring.push(x);
    if (ring.at(-1).userData.yieldBy === g || ring.includes(g)) {
      // Two waiting on each other: the one heading less straight at the other goes. In a longer ring the oldest vehicle goes,
      // a rule every member agrees on, so the ring always opens.
      const at = rx * ux + rz * uz, [ox, oz] = o.userData.yieldDir, back = -(rx * ox + rz * oz), cycle = ring.slice(0, ring.indexOf(g) + 1 || undefined);
      if (cycle.length <= 2 ? at < back - 0.01 || (Math.abs(at - back) <= 0.01 && g.id > o.id) : g.id < Math.min(...cycle.filter((v) => v !== g).map((v) => v.id))) continue;
    }
    g.userData.yieldBy = o;
    g.userData.yieldDir = [ux, uz];
    who.wait = g.userData.wait = (who.wait ?? 0) + dt;
    return who.wait < RD.yieldSec || Boolean(o.userData.yieldBy);
  }
  g.userData.yieldBy = null;
  who.wait = g.userData.wait = 0;
  return false;
}
// A car still parked in its bay pulls out only once the exit lane is clear: nothing near its mouth, and nothing on the stretch it is
// about to drive that is heading toward it. Most cars drive right to the road; cars bound for the wash drive left and give way, so
// they also wait while any bay on their way has a car pulling out. Once moving a car carries on.
const laneBusy = (car, bay) => {
  if (car.g.position.distanceTo(bay.spot) >= RD.exitMouth) return false;
  const x = car.g.position.x, to = (car.path[1] ?? car.path[0]).x, way = Math.sign(to - x) || 1;
  if (way < 0 && openBays().some((b) => b !== bay && b.car?.phase === 'leave' && b.car.g.position.x < x && b.car.g.position.x > to - RD.exitClear)) return true;
  return [...vehicles].some((o) => {
    if (o === car.g || !o.parent || !o.visible || Math.abs(o.position.z - W.exitZ) > RD.exitClear) return false;
    if (Math.hypot(o.position.x - x, o.position.z - W.exitZ) < RD.exitClear) return true;
    const ahead = (o.position.x - x) * way, toward = -Math.cos(o.rotation.y) * way < 0;
    return ahead > 0 && ahead < Math.abs(to - x) + RD.exitClear && toward;
  });
};
// Cars, buildings and machines are solid to the owner, as in every idle arcade: the owner slides along their edge instead of walking
// into them, and touching the edge is enough to plug a car in or take what a machine holds. Each solid is a turned rectangle.
const solidBox = new WeakMap();
const solidOf = (o) => {
  if (!solidBox.has(o)) {
    const ry = o.rotation.y;
    o.rotation.y = 0; o.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3()).sub(o.position), size = b.getSize(new THREE.Vector3());
    o.rotation.y = ry; o.updateMatrixWorld(true);
    solidBox.set(o, { c, hx: size.x / 2, hz: size.z / 2 });
  }
  return solidBox.get(o);
};
const buildingsSolid = () => [mobile.depot, wash.building, kioskModel, ...machines.map((m) => m.m)];
function solidPush(p) {
  const r = G.ownerRadius;
  for (const o of [...vehicles, ...buildingsSolid()]) {
    if (!o?.parent || !o.visible) continue;
    // Into the object's own frame, out along the shallowest side, and back.
    const { c, hx, hz } = vehicles.has(o) ? { c: new THREE.Vector3(), hx: extentOf(o)[0], hz: extentOf(o)[1] } : solidOf(o);
    const cos = Math.cos(o.rotation.y), sin = Math.sin(o.rotation.y), cx = o.position.x + c.x * cos + c.z * sin, cz = o.position.z - c.x * sin + c.z * cos;
    const rx = p.x - cx, rz = p.z - cz, lx = rx * cos - rz * sin, lz = rx * sin + rz * cos, ox = hx + r - Math.abs(lx), oz = hz + r - Math.abs(lz);
    if (ox <= 0 || oz <= 0) continue;
    const nx = ox < oz ? lx + Math.sign(lx || 1) * ox : lx, nz = ox < oz ? lz : lz + Math.sign(lz || 1) * oz;
    p.x = cx + nx * cos + nz * sin;
    p.z = cz - nx * sin + nz * cos;
  }
}
// A bay or its cash pile counts as reached from the edge of the parked car.
const touchBay = (size) => size.map((d) => d + 2 * Z.bay.touch);
function drive(car, dt) {
  const p = car.g.position, t = car.path[0], dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz), stepLen = RD.speed * dt;
  // The turn is part of the step: a car that must wait keeps its heading, so its tail never swings into a neighbour.
  const was = car.g.rotation.y;
  if (d > 0) car.g.rotation.y += angleDiff(Math.atan2(dz, -dx), was) * Math.min(dt * RD.turnRate, 1);
  if (d > 0 && blocked(car.g, dx / d, dz / d, dt, car, d, was)) { car.g.rotation.y = was; return false; }
  // Like a driver, a car slows in a sharp turn until its nose points the way it goes, so it never slides sideways into a bay.
  const ry = car.g.rotation.y, facing = d > 0 ? (-Math.cos(ry) * dx + Math.sin(ry) * dz) / d : 1, step = stepLen * Math.max(facing, RD.turnSlow);
  if (d <= step) { p.copy(t); car.path.shift(); }
  else { p.x += dx / d * step; p.z += dz / d * step; }
  return car.path.length === 0;
}

// Cars on the road that no bay owns: passing traffic and customers driving away.
const traffic = [];
let trafficTimer = 0;
function updateTraffic(dt) {
  // A passing car appears only once the last one has cleared its spot, never on top of it.
  const room = ![...vehicles].some((o) => o.parent && Math.hypot(o.position.x - RD.outLane, o.position.z - RD.exitZ) < RD.spawnRoom);
  if ((trafficTimer -= dt) <= 0 && room) {
    trafficTimer = RD.trafficEverySec;
    const g = randomCar();
    g.position.set(RD.outLane, 0, RD.exitZ);
    g.rotation.y = Math.atan2(-1, 0);
    scene.add(g);
    traffic.push({ g, path: [new THREE.Vector3(RD.outLane, 0, RD.spawnZ)] });
  }
  for (let i = traffic.length - 1; i >= 0; i--) {
    // A car turning back onto the far lane waits until nothing is coming up behind it there, as a driver checks the mirror.
    const t = traffic[i], p = t.g.position;
    if (t.merge && [...vehicles].some((o) => o !== t.g && o.parent && Math.abs(o.position.x - RD.outLane) < 1 && o.position.z > p.z - 1 && o.position.z < p.z + RD.mergeLook)) continue;
    t.merge = false;
    if (drive(t, dt)) { scene.remove(traffic[i].g); traffic.splice(i, 1); }
  }
}

// E-bus: when one is due, two neighbouring bays are held free; once both are empty the bus parks across them.
const BUS = CONFIG.bus;
let busDue = BUS.firstSec, busPair = null;
function updateBus(dt) {
  if (!STATION.bus || state.bays < 2) return;
  // A bus is only waited for while the queue is short; a growing queue gives the held bays back to cars.
  if (busPair && queue.length >= T.jamAt - 1) { busPair.forEach((b) => { b.held = false; }); busPair = null; busDue = BUS.retrySec; }
  if (!busPair && !bays.some((b) => b.car?.bus) && queue.length < 2 && (busDue -= dt) <= 0) {
    const i = Math.floor(Math.random() * (state.bays - 1));
    busPair = [bays[i], bays[i + 1]];
    busPair.forEach((b) => { b.held = true; });
  }
  if (busPair && busPair.every((b) => !b.car)) {
    busPair.forEach((b) => { b.held = false; });
    parkBus(...busPair);
    busPair = null;
    busDue = rand(...BUS.everySec);
  }
}
function parkBus(bay, next) {
  const dx = (next.spot.x - bay.spot.x) / 2, car = makeCar('arrive', true);
  next.blockedBy = bay;
  car.blocks = next;
  bay.car = Object.assign(car, { phase: 'arrive', t: 0, path: bay.pathIn.map((p, i) => (i ? p.clone().setX(p.x + dx) : p.clone())) });
  once('bus');
  rosa(STORY.bus);
  if (!state.seen.busintro) toast('🚌 An e-bus! It takes two bays and pays five times the fee');
  once('busintro');
}

// Rush hour: at stations with it, once stage 1 is done, a wave of cars comes now and then; burgers pay more and the police stay away.
const RUSH = { ...CONFIG.rush, ...(typeof STATION.rush === 'object' ? STATION.rush : {}) }, rush = { on: false, left: 0, next: RUSH.firstSec, boost: false };
// ×2 doubles the rush pay once per wave; it stands where the publisher build shows a rewarded ad.
const rushMult = () => RUSH.mealMult * (rush.boost ? 2 : 1);
const rushPace = () => (rush.on ? 1 / RUSH.spawnFactor : 1);
// A mall driver back at the car still shops until the stay (a share of the charge time) is over.
const shopping = (car, full) => Boolean(STATION.stay) && car.back && !car.bus && (car.full ?? 0) < full * STATION.stay;
const nightNow = () => Boolean(RUSH.night) && !rush.on && state.doneAt !== null && rush.next <= RUSH.night;
let nightK = 0;
const skyCalm = new THREE.Color(COL.lightSky), skyRush = new THREE.Color(RUSH.sky), skyNight = new THREE.Color(RUSH.nightSky);
function updateRush(dt) {
  if (!STATION.rush || state.doneAt === null) return;
  if (rush.on && (rush.left -= dt) <= 0) {
    // The rush closes with a summary: what it earned and whether the police stayed away.
    const earned = total(RATE_KINDS) - rush.from, clean = state.fines === rush.fines;
    Object.assign(rush, { on: false, next: rand(...RUSH.everySec), warned: false });
    stageUp(0, RUSH.over, RUSH.icon, `+$${Math.round(earned)}`, clean ? 'No fines! Great teamwork.' : 'A fine slipped through. Order Extra Hand next time.');
    if (clean) tally('rushClean');
  } else if (!rush.on && !rush.warned && rush.next <= CHN.warnSec) {
    rush.warned = true;
    rosa(STORY[RUSH.soon]);
  } else if (!rush.on && (rush.next -= dt) <= 0) {
    Object.assign(rush, { on: true, left: RUSH.durSec, boost: false, from: total(RATE_KINDS), fines: state.fines });
    $('rushDouble').hidden = false;
    for (let i = 0; i < RUSH.waveCars; i++) queue.push(makeCar('queue'));
    audio.play('horn');
    once('rush');
  }
  hemi.color.lerp(rush.on ? skyRush : nightNow() ? skyNight : skyCalm, Math.min(dt * 2, 1));
  // Before a hotel's morning rush comes the night: the light dims, windows glow and more guests hand their car to the valet.
  if (nightNow()) valetBoostUntil = state.playSec + 1;
  nightK += ((nightNow() ? RUSH.darken : 0) - nightK) * Math.min(dt, 1);
  hemi.intensity = R.hemi * (1 - nightK);
  sun.intensity = R.sun * (1 - nightK);
  stationDecor.userData.night?.(RUSH.darken ? nightK / RUSH.darken : 0);
  stationDecor.userData.sale?.(rush.on);
}

// Story and station goals: Rosa's one-line cards, goal tallies, and the station's checklist with cash rewards.
const STORY = CONFIG.story, CHN = CONFIG.chains, GOALS = STATION.goals;
let nextRegular = false, landings = 0, forceVip = false, valetBoostUntil = 0, goalsOpen = false;
const rosa = (line) => toast(`👵 Rosa: ${line}`, E.bannerMs * 2);
function tally(type) {
  state.goalCount ??= {};
  state.goalCount[type] = (state.goalCount[type] ?? 0) + 1;
  dailyTick(/^side\d$/.test(type) ? 'sides' : type);
}
// Daily tasks: `pick` tasks drawn by the date, the same all day; each pays when done and the goals sheet lists them under Today.
const DY = CONFIG.daily, today = () => new Date().toLocaleDateString('en-CA');
function dailyTasks() {
  const day = today();
  if (state.daily.tasks?.day !== day) {
    const seed = [...day].reduce((a, c) => a * 31 + c.charCodeAt(0), 7), pool = [...DY.tasks];
    const list = Array.from({ length: DY.pick }, (_, i) => pool.splice((seed + i * 13) % pool.length, 1)[0]).map((t) => ({ kind: t.kind, n: 0 }));
    state.daily.tasks = { day, list };
  }
  return state.daily.tasks.list;
}
function dailyTick(kind) {
  for (const t of dailyTasks()) {
    const def = DY.tasks.find((d) => d.kind === t.kind);
    if (t.kind !== kind || t.n >= def.goal) continue;
    if (++t.n < def.goal) continue;
    const pay = Math.round(chargeFee(state.levels.tariff) * def.fees);
    state.cash += pay;
    book('bonus', pay);
    flyCoins(player.g.position, pay);
    audio.play('complete');
    toast(`✅ Daily task done: ${def.text} +$${pay}${dailyTasks().every((x) => x.n >= DY.tasks.find((d) => d.kind === x.kind).goal) ? ' · all 3 done today!' : ''}`);
  }
}
const OPENED = { coffee: () => state.coffee, wash: () => wash.owned(), tire: () => service.owned('tire'), tow: () => service.owned('tow'), solar: () => airport.owned('solar'), lounge: () => airport.owned('lounge') };
// How far a goal is: opened buildings count 1, the rating is its value, washes come from the wash's own count, the rest from tallies.
function goalValue(g) {
  if (g.type.startsWith('open:')) return OPENED[g.type.slice(5)]() ? 1 : 0;
  // The rating goal only counts once enough cars have rated the station, so a fresh 5.0 does not pay out at once.
  if (g.type === 'rating') return state.served >= CHN.ratingAfter ? rating() : 0;
  if (g.type === 'wash') return state.wash?.washed ?? 0;
  return state.goalCount?.[g.type] ?? 0;
}
// Checked once a second: a met goal pays its reward (at the station's price level) and the next one shows; the last one brings Rosa's line.
function updateGoals() {
  state.goalDone ??= [];
  GOALS.forEach((g, i) => {
    if (state.goalDone[i] || goalValue(g) < g.goal) return;
    state.goalDone[i] = true;
    const pay = Math.round(g.reward * city.income);
    state.cash += pay;
    book('bonus', pay);
    celebrate(`📋 Goal done: ${g.text}! +$${pay}`);
    track.milestone(`goal_${STATION.id}_${i}`);
    if (state.goalDone.filter(Boolean).length === GOALS.length) rosa(STORY.goalsDone[STATION.id]);
  });
}
function renderGoals() {
  const day = dailyTasks().map((t) => { const d = DY.tasks.find((x) => x.kind === t.kind), done = t.n >= d.goal; return `<div class="${done ? 'ok' : ''}">${done ? '✔' : '☀️'} ${d.text}<span>${done ? '' : `${t.n}/${d.goal} · `}$${Math.round(chargeFee(state.levels.tariff) * d.fees)}</span></div>`; });
  $('goalRows').innerHTML = ['<h3>Today</h3>', ...day, '<h3>This station</h3>'].join('') + GOALS.map((g, i) => {
    const v = goalValue(g), done = state.goalDone?.[i], shown = g.type === 'rating' ? v.toFixed(1) : Math.min(v, g.goal);
    return `<div class="${done ? 'ok' : ''}">${done ? '✔' : '▢'} ${g.text}<span>${done ? '' : `${shown}/${g.goal} · `}$${Math.round(g.reward * city.income)}</span></div>`;
  }).join('');
}

// Camera director: a big moment pulls the camera to it for a few seconds, one at a time, then it glides back to the player.
const DIR = CONFIG.director, shot = { at: null, left: 0, back: 0, queue: [] }, camFocus = new THREE.Vector3(), glideFrom = new THREE.Vector3();
let camZoom = 1;
const bottomRay = new THREE.Raycaster(), SCREEN_BOTTOM = new THREE.Vector2(0, -1), GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), bottomHit = new THREE.Vector3();
// `at` is a point, or an object the camera follows while it moves (a landing plane).
function look(at, sec, zoom = DIR.lookZoom) {
  if (BOT) return;
  shot.queue.push([at.isObject3D ? at : at.clone(), sec, zoom]);
  if (!shot.at) nextShot();
}
function nextShot() {
  const n = shot.queue.shift();
  if (n) Object.assign(shot, { at: n[0], left: n[1], zoom: n[2] });
}

// VIP arrival: a red carpet unrolls from the limo to the table, cameras flash along it and the camera takes a short look.
const VS = CONFIG.vipShow, VALET = CONFIG.airport.valet;
const carpetMat = new THREE.MeshBasicMaterial({ color: COL.carpet }), carpetEdge = new THREE.MeshBasicMaterial({ color: COL.gold });
function rollCarpet(bay, car) {
  const from = bay.door, to = bay.table.seat, len = from.distanceTo(to), w = VS.carpetW + VS.widthPerLevel * (state.levels.redCarpet ?? 0), g = new THREE.Group();
  [[carpetEdge, w + 0.16, 0.02], [carpetMat, w, 0.025]].forEach(([m, width, y]) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(len, width), m);
    p.rotation.x = -Math.PI / 2;
    p.position.y = y;
    g.add(p);
  });
  g.position.copy(from).lerp(to, 0.5);
  g.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
  g.scale.x = 0.01;
  scene.add(g);
  Object.assign(car, { carpet: g, unroll: 0, flash: 0 });
  look(car.g.position, DIR.vipSec);
}
function updateCarpet(car, dt) {
  car.carpet.scale.x = Math.min((car.unroll += dt) / VS.unrollSec, 1);
  if ((car.flash += dt) < VS.flashEvery) return;
  car.flash = 0;
  emit(car.carpet.position.clone().add(v3([(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3])).setY(1.4), FX.flash);
}

// VIP look and the trail of bills a VIP driver drops on the way back to the car.
const VIP = E.vip, vipRingGeo = new THREE.RingGeometry(1.5, 1.75, 40), vipRingMat = new THREE.MeshBasicMaterial({ color: VIP.ring, transparent: true, opacity: 0.85 });
const vipBills = [];
let lastVip = -Infinity;
const vipBillValue = () => Math.max(1, Math.round(chargeFee(state.levels.tariff) * VIP.billShare));
function dropVipBill(at) {
  // A floating, spinning banknote over a small gold ring, so the trail stands apart from the cash piles.
  const m = new THREE.Group(), bill = new THREE.Mesh(billGeo, billMat), ring = new THREE.Mesh(vipRingGeo, vipRingMat);
  bill.scale.setScalar(2.4);
  ring.scale.setScalar(0.32);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  m.add(bill, ring);
  m.position.copy(at).setY(0);
  scene.add(m);
  vipBills.push({ m, bill, life: VIP.lifeSec, t: Math.random() * 6 });
}
function updateVipBills(dt) {
  for (let i = vipBills.length - 1; i >= 0; i--) {
    const b = vipBills[i], p = b.m.position;
    b.bill.rotation.y += dt * 2;
    b.bill.position.y = 0.45 + Math.sin((b.t += dt) * 4) * 0.12;
    maybeEmit(p.clone().setY(0.5), FX.vip, dt);
    const picked = Math.hypot(player.g.position.x - p.x, player.g.position.z - p.z) < VIP.pickRadius;
    if (picked) {
      const amount = vipBillValue();
      state.cash += amount;
      book('tip', amount);
      floatText(p, `+$${amount}`, COL.bill);
      flyCoins(p, amount);
      audio.play('cash');
      once('viptrail');
    }
    if (picked || (b.life -= dt) <= 0) { scene.remove(b.m); vipBills.splice(i, 1); }
  }
}

// Low-battery driver coming down the in-lane.

// Gold repaints only the car's paint: the texture colour most of the body's vertices sample is the paint, and only texels near it
// turn gold at their own brightness, so glass, tyres and lights keep their colours.
const goldColor = new THREE.Color(CONFIG.golden.color), paintOf = new Map();
function bodyPaint(mesh) {
  const map = mesh.material.map, img = map?.image, uv = mesh.geometry.attributes.uv;
  if (!img || !uv) return null;
  if (!paintOf.has(img)) paintOf.set(img, new Map());
  const cache = paintOf.get(img);
  if (cache.has(mesh.geometry)) return cache.get(mesh.geometry);
  const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
  c.width = img.width; c.height = img.height;
  x.drawImage(img, 0, 0);
  const px = x.getImageData(0, 0, c.width, c.height).data, count = new Map(), pos = mesh.geometry.attributes.position, idx = mesh.geometry.index;
  const at = (n) => idx ? idx.getX(n) : n, va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  // Each triangle votes for the colour at its centre with its area, so the big body panels outweigh small dark trim.
  for (let t = 0; t < (idx ? idx.count : pos.count); t += 3) {
    const [a, b, d] = [at(t), at(t + 1), at(t + 2)], area = vb.fromBufferAttribute(pos, b).sub(va.fromBufferAttribute(pos, a)).cross(vc.fromBufferAttribute(pos, d).sub(va)).length();
    const u = (uv.getX(a) + uv.getX(b) + uv.getX(d)) / 3, v = (uv.getY(a) + uv.getY(b) + uv.getY(d)) / 3;
    const k = (Math.min(c.height - 1, Math.max(0, Math.floor((map.flipY ? 1 - v : v) * c.height))) * c.width + Math.min(c.width - 1, Math.max(0, Math.floor(u * c.width)))) * 4;
    // Greys (glass, tyres, trim) never vote; coloured texels vote by hue bucket.
    const r = px[k], gr = px[k + 1], bl = px[k + 2], hi = Math.max(r, gr, bl), lo = Math.min(r, gr, bl);
    if (hi < 40 || (hi - lo) / hi < 0.25) continue;
    const hue = Math.round(new THREE.Color(r / 255, gr / 255, bl / 255).getHSL({}).h * 24) % 24, e = count.get(hue) ?? { area: 0, r: 0, g: 0, b: 0 };
    Object.assign(e, { area: e.area + area, r: e.r + r * area, g: e.g + gr * area, b: e.b + bl * area });
    count.set(hue, e);
  }
  const top = [...count.values()].sort((a, b) => b.area - a.area)[0];
  const paint = top ? new THREE.Color().setRGB(top.r / top.area / 255, top.g / top.area / 255, top.b / top.area / 255, THREE.SRGBColorSpace) : null;
  cache.set(mesh.geometry, paint);
  return paint;
}
function goldPaint(mesh) {
  const m = mesh.material.clone(), paint = bodyPaint(mesh);
  if (!paint) return mesh.material;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { gold: { value: goldColor }, paint: { value: paint } });
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 gold;\nuniform vec3 paint;').replace('#include <map_fragment>', `#include <map_fragment>
      float hi = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)), lo = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b)), ph = max(paint.r, max(paint.g, paint.b));
      float near = (1.0 - smoothstep(0.12, 0.25, distance(diffuseColor.rgb / max(hi, 0.001), paint / max(ph, 0.001)))) * smoothstep(0.15, 0.3, (hi - lo) / max(hi, 0.001));
      diffuseColor.rgb = mix(diffuseColor.rgb, gold * clamp(hi / max(ph, 0.001), 0.5, 1.3), near);`);
  };
  m.customProgramCacheKey = () => `goldPaint${paint.getHexString()}`;
  return m;
}
function makeCar(phase, bus = false) {
  // VIP cars arrive irregularly but reproducibly so bot runs stay comparable.
  const vip = !bus && ((++state.spawned >= E.vipFirstCar && (state.spawned * 37) % 100 < (STATION.vip?.chance ?? E.vipChance) * 100 && state.playSec - lastVip >= (STATION.vip?.gapSec ?? VIP.gapSec) - airport.vipGapCut()) || forceVip);
  if (vip) forceVip = false;
  const g = bus ? buildBus() : vip ? buildLimo(KIT.vip) : randomCar(), [lo, hi] = G.carStartCharge;
  if (vip) {
    // Gold ring under the car and a crown over it, so a VIP reads at a glance.
    lastVip = state.playSec;
    const ring = new THREE.Mesh(vipRingGeo, vipRingMat), crown = label();
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    crown.userData.set('👑 VIP');
    crown.position.y = S.carRoof + 1;
    g.add(ring, crown);
    audio.play('vip');
    if (!state.seen.vipintro) toast('👑 A VIP is here! Serve fast and follow the money trail');
    once('vipintro');
  }
  g.position.set(RD.inLane, 0, RD.spawnZ);
  // Out of sight up the road, a new arrival lines up behind any car still at the spawn point instead of appearing on top of it.
  while ([...vehicles].some((o) => o.parent && Math.abs(o.position.x - RD.inLane) < 1 && Math.abs(o.position.z - g.position.z) < CONFIG.traffic.gap)) g.position.z -= CONFIG.traffic.gap;
  g.rotation.y = Math.atan2(1, 0);
  scene.add(g);
  // Counted at once, so the next car of a convoy lines up behind this one.
  vehicles.add(g);
  // At stations with valet some drivers leave the car and fly; never a bus or a VIP, and never the last bay that would earn now:
  // with every bay holding a car whose owner is away, no money would come in until the first flight returned.
  // A named regular now and then: a face the player gets to know, who pays as a regular.
  const who = !bus && !vip && !nextRegular && Math.random() < RG.chance ? RG.people[state.spawned % RG.people.length] : null;
  const regular = !bus && !vip && (nextRegular || Boolean(who));
  if (regular) nextRegular = false;
  const valetRoom = openBays().filter((b) => b.car?.valet).length < openBays().length - 1;
  const valet = Boolean(STATION.valet) && valetRoom && !bus && !vip && !regular && Math.random() < VALET.share * (state.playSec < valetBoostUntil ? CHN.valetBoost : 1);
  // Now and then a golden car: gold paint and a glow, worth a lot more.
  const golden = !bus && !vip && !who && Math.random() < CONFIG.golden.chance;
  if (golden) g.traverse((o) => { if (o.isMesh && o.material.side !== THREE.BackSide) o.material = goldPaint(o); });
  return { g, vip, bus, valet, regular, who, golden, phase, fix: bus || valet ? null : fixFor(), t: 0, path: [], start: lo + Math.random() * (hi - lo), driver: null, back: false, idle: 0, wait: 0 };
}
// In later cities some drivers also need a tire or a repair; their car shows it and drives down to that shop after charging.
function fixFor() {
  const r = Math.random();
  return r < 0.25 && service.owned('tire') ? 'tire' : r > 0.8 && service.owned('repair') ? 'repair' : null;
}
// Car turns into the bay and waits to be plugged in.
const toBay = (bay, car) => { bay.car = Object.assign(car, { phase: 'arrive', t: 0, path: [...bay.pathIn] }); };

// Extra drivers wait on the in-lane for a free bay, front first; a long queue jams the road.
const queue = [], queueTag = label(), copTag = label();
// Red-blue light that sweeps the lot while the police are here.
const copLight = new THREE.PointLight(COL.siren, T.police.light, T.police.lightRange);
copLight.visible = false;
scene.add(copLight);
let pressure = 0, jamT = 0, jammed = false, cop = null, holdT = 0;
// A real fix during a jam (more staff, faster staff, a new charger, vans on the queue) holds the police off for a while; a patrol already on its way turns back.
function holdPolice(what) {
  if (!jammed && cop?.phase !== 'in') return;
  holdT = T.holdSec;
  jamT = 0;
  if (cop?.phase === 'in') Object.assign(cop, { phase: 'out', path: [v3([RD.outLane, RD.spawnZ])] });
  toast(`${what} The police hold off for ${T.holdSec}s`, E.bannerMs * 2);
  once('policehold');
}
const slot = (i) => new THREE.Vector3(RD.inLane, 0, T.frontZ - i * T.gap);
// Car leaves the queue with a U-turn back up the road.
function turnAway(car) {
  queue.splice(queue.indexOf(car), 1);
  const z = car.g.position.z;
  // A car still lined up past the road's end turns back away from the lot, never against the passing traffic.
  traffic.push({ g: car.g, merge: true, path: [v3([RD.outLane, z + 1]), v3([RD.outLane, Math.min(RD.spawnZ, z - 4)])] });
}
function updateQueue(dt) {
  // Slow service builds pressure: every second a car waits for a plug or a driver waits for food, more drivers line up behind.
  const stalled = openBays().filter((b) => b.car?.phase === 'plug' || ordering(b)).length;
  if (state.bays >= T.fromBays && (pressure += stalled * dt) >= T.stallSecPerCar) { pressure = 0; queue.push(makeCar('queue')); }
  for (const car of [...queue]) {
    // Drivers who waited too long give up and leave a bad rating.
    if ((car.wait += dt) < T.patienceSec) continue;
    turnAway(car);
    // A driver who gave up in the queue never ate badly, so the review is middling.
    rate(E.ratingScores.left);
    state.lost++;
    once('queueleft');
  }
  queue.forEach((car, i) => { const at = slot(i); if (car.g.position.distanceToSquared(at) > 1e-4) { car.path = [at]; drive(car, dt); } });

  // The jam clears only once the queue is clearly shorter, so it does not flicker on and off.
  const now = queue.length >= T.jamAt || (jammed && queue.length > T.jamAt - 2);
  if (now && !jammed) {
    state.jams++;
    once('jam');
    audio.play('alert');
    toast(state.jams === 1 ? 'Traffic jam! Serve cars faster or the police will come' : 'Traffic jam! Clear it before the police fine you', E.bannerMs * 2);
  }
  jammed = now;
  if (!jammed) jamT = 0;
  else {
    if ((holdT -= dt) <= 0 && !rush.on) jamT += dt;
    if (jamT >= T.jamSec && !cop) callPolice();
  }
  queueTag.visible = queue.length >= 2;
  if (queueTag.visible) {
    queueTag.position.copy(queue[0].g.position).setY(S.tagHeight);
    queueTag.userData.set(jammed ? `⛔ ${Math.max(Math.ceil(T.jamSec - jamT), 0)}s` : `🚗×${queue.length}`);
  }
}

// Regulars: every giftEvery-th visit of a named regular leaves a gift.
const RG = CONFIG.regulars, AL = CONFIG.album, ALBUM = [...KIT.cars.slice(0, -1), 'limo', 'bus'];
function regularVisit(who, at) {
  const n = state.regulars[who.name] = (state.regulars[who.name] ?? 0) + 1;
  if (n % RG.giftEvery) return;
  const gift = Math.round(chargeFee(state.levels.tariff) * RG.giftFees);
  state.cash += gift;
  book('bonus', gift);
  flyCoins(at, gift);
  toast(`${who.icon} ${who.name} left you a thank-you gift: +$${gift} (visit ${n})`);
}
// Car album: a model served for the first time goes in, pays a little, and a full album pays big.
function albumAdd(model, at) {
  if (!model || state.album.includes(model)) return;
  state.album.push(model);
  const full = ALBUM.every((m) => state.album.includes(m)), pay = Math.round(chargeFee(state.levels.tariff) * (full ? AL.fullFees : AL.firstFees));
  state.cash += pay;
  book('bonus', pay);
  emit(at.clone().setY(1.5), FX.gold, 2);
  toast(full ? `📒 Car album complete! +$${pay}` : `📒 New car in your album (${state.album.length}/${ALBUM.length}) +$${pay}`);
  renderAlbum();
}
const renderAlbum = () => { $('albumText').textContent = `${'🚗'.repeat(state.album.length)}${'▫️'.repeat(ALBUM.length - state.album.length)} ${state.album.length}/${ALBUM.length}`; };

// Storm: rain falls around the owner, the light dims, lightning flashes, and drivers caught in it rush in and pay a storm rate.
const SM = CONFIG.storm, storm = { on: false, left: 0, next: SM.firstSec, car: 0, flash: 0 };
// Each raindrop is a short streak: two points, the second a little higher.
const rainGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SM.rain * 6), 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#cfe2ff', transparent: true, opacity: 0.75, depthWrite: false }));
rain.visible = false;
rain.frustumCulled = false;
scene.add(rain);
const lightBase = [hemi.intensity, sun.intensity];
function updateStorm(dt) {
  if (!storm.on) {
    if (state.playSec < storm.next || cop || rush.on || grid.out) return;
    Object.assign(storm, { on: true, left: SM.sec, car: SM.carEverySec, flash: 1 });
    const pos = rainGeo.attributes.position;
    for (let i = 0; i < SM.rain; i++) { const x = (Math.random() - 0.5) * 30, y = Math.random() * 14, z = (Math.random() - 0.5) * 30; pos.setXYZ(2 * i, x, y, z); pos.setXYZ(2 * i + 1, x + 0.08, y + 0.7, z); }
    rain.visible = true;
    holdT = Math.max(holdT, SM.sec);
    toast(`⛈️ Storm! Drivers rush in to charge, each pays ×${SM.feeMult}`, E.bannerMs * 2);
    track.milestone('storm');
  }
  const k = Math.min(1, (SM.sec - storm.left) / 2, storm.left / 2);
  hemi.intensity = lightBase[0] * (1 - (1 - SM.dim) * k);
  sun.intensity = lightBase[1] * (1 - (1 - SM.dim) * k);
  rain.position.set(player.g.position.x, 0, player.g.position.z);
  const pos = rainGeo.attributes.position;
  for (let i = 0; i < SM.rain; i++) { let y = pos.getY(2 * i) - 18 * dt; if (y < 0) y += 14; pos.setY(2 * i, y); pos.setY(2 * i + 1, y + 0.7); }
  pos.needsUpdate = true;
  if ((storm.car -= dt) <= 0) { storm.car = SM.carEverySec; queue.push(makeCar('queue')); }
  if ((storm.flash -= dt) <= 0) { storm.flash = SM.flashSec[0] + Math.random() * (SM.flashSec[1] - SM.flashSec[0]); const f = $('flash'); f.hidden = true; void f.offsetWidth; f.hidden = false; audio.play('alert'); }
  if ((storm.left -= dt) > 0) return;
  Object.assign(storm, { on: false, next: state.playSec + SM.everySec[0] + Math.random() * (SM.everySec[1] - SM.everySec[0]) });
  rain.visible = false;
  $('flash').hidden = true;
  [hemi.intensity, sun.intensity] = lightBase;
  toast('🌤️ The storm passed. Nice work!');
}

// Blackout: the chargers go dark; the owner runs to the generator and stands on it to bring the grid back. A hero job no worker does.
const BO = CONFIG.blackout, grid = { out: false, t: 0, hold: 0, next: BO.firstSec, gen: null };
const genTag = label();
genTag.visible = false;
scene.add(genTag);
function updateBlackout(dt) {
  if (!grid.out) {
    if (state.playSec < grid.next || cop || storm.on || rival || !openBays().some((b) => b.car)) return;
    const [x0, x1, z0, z1] = W.bounds, p = player.g.position;
    const at = v3([THREE.MathUtils.clamp(p.x - BO.away, x0 + 1, x1 - 1), THREE.MathUtils.clamp(p.z, z0 + 1, Math.min(z1, reachZ) - 1)]);
    // Never inside a parked car or a building, where the owner could not stand on it.
    solidPush(at);
    grid.gen = buildGenerator();
    grid.gen.position.copy(at);
    scene.add(grid.gen, Object.assign(zoneMesh(grid.gen.position, [1.6, 1.6], COL.loss), { name: 'genZone' }));
    pop(grid.gen);
    Object.assign(grid, { out: true, t: 0, hold: 0 });
    openBays().forEach((b) => b.charger.userData.setOn(false));
    genTag.visible = true;
    audio.play('alert');
    toast('🔌 Blackout! Run to the generator and stand on it to bring the grid back', E.bannerMs * 2);
    track.milestone('blackout');
    return;
  }
  grid.t += dt;
  const on = inside(player.g.position, grid.gen.position, [1.6, 1.6]);
  grid.hold = on ? grid.hold + dt : 0;
  genTag.position.copy(grid.gen.position).setY(S.tagHeight + 0.6);
  grid.gen.userData.blink(state.playSec);
  genTag.userData.set(on ? '⚡ Restarting…' : '⚡ Restart the generator!', on ? grid.hold / BO.holdSec : undefined, COL.loss);
  if (grid.hold < BO.holdSec && grid.t < BO.autoSec) return;
  const fixed = grid.hold >= BO.holdSec;
  if (fixed) {
    const pay = Math.round(chargeFee(state.levels.tariff) * BO.fixFees);
    state.cash += pay;
    book('bonus', pay);
    flyCoins(grid.gen.position, pay);
    emit(grid.gen.position.clone().setY(1.5), FX.confetti, 2);
    audio.play('complete');
    celebrate(`⚡ Power back on! +$${pay}`);
  } else toast('⚡ The grid came back on by itself.');
  scene.remove(grid.gen, scene.getObjectByName('genZone'));
  openBays().forEach((b) => b.charger.userData.setOn(Boolean(b.car && b.car.phase === 'charge')));
  genTag.visible = false;
  Object.assign(grid, { out: false, gen: null, next: state.playSec + BO.everySec[0] + Math.random() * (BO.everySec[1] - BO.everySec[0]) });
}
const festDay = () => CONFIG.fest.days.includes(new Date().getDay());

let winterTwinkle = null;
// Winter lights: in the winter months a string of coloured bulbs hangs along the top of the lot and twinkles.
if (CONFIG.winterMonths.includes(new Date().getMonth())) {
  const [x0, x1, z0] = W.bounds, bulbs = [], colors = [COL.siren, COL.pad, COL.battery, COL.action];
  for (let x = x0; x <= x1; x += 0.7) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: colors[bulbs.length % 4] }));
    b.position.set(x, 2.6 + Math.sin((x - x0) / (x1 - x0) * Math.PI * 6) * 0.25, z0 - 0.6);
    scene.add(b);
    bulbs.push(b);
  }
  winterTwinkle = (t) => bulbs.forEach((b, i) => { b.visible = (Math.floor(t * 3) + i) % 4 !== 0; });
}

// Road-trip convoy: a group of cars rolls in together, each paying double, with the police holding off while the queue swells.
const CV = CONFIG.convoy;
const convoy = { next: CV.firstSec };
function updateConvoy() {
  if (state.playSec < convoy.next || cop || rival || rush.on) return;
  convoy.next = state.playSec + CV.everySec[0] + Math.random() * (CV.everySec[1] - CV.everySec[0]);
  const cars = Array.from({ length: CV.cars }, () => Object.assign(makeCar('queue'), { convoy: true }));
  queue.push(...cars);
  holdT = Math.max(holdT, T.holdSec);
  look(cars[0].g, DIR.vipSec);
  audio.play('alert');
  toast(`🚐 Road-trip convoy! ${CV.cars} cars at once, each pays ×${CV.feeMult}`, E.bannerMs * 2);
  track.milestone('convoy');
}

// VoltMart, the rival: a van pulls onto the lot-side shoulder level with the owner and dares them to serve `need` cars before it can poach them.
// Winning sends it off with a bonus; three wins at a station and VoltMart gives up on it for good. Losing costs only the round.
const RV = CONFIG.rival, rivalTag = label();
let rival = null, rivalNext = RV.firstSec;
scene.add(rivalTag);
function updateRival(dt) {
  rivalTag.visible = Boolean(rival);
  $('rivalBar').hidden = rival?.phase !== 'dare';
  if (!rival) {
    if (state.rival.wins >= RV.giveUp || cop || shot.at || rush.on || airport.nextIn() !== null || nightNow() || state.playSec < rivalNext || !openBays().some((b) => b.car)) return;
    const [, , z0, z1] = W.bounds, z = THREE.MathUtils.clamp(player.g.position.z, z0 + 2, Math.min(z1, reachZ) - 2);
    const g = buildRivalVan();
    g.position.set(RD.inLane, 0, RD.spawnZ);
    g.rotation.y = Math.atan2(1, 0);
    scene.add(g);
    rival = { g, phase: 'in', t: 0, served: state.served, path: [v3([RD.inLane, z - 3]), v3([RD.serviceLane, z])] };
    look(g, DIR.policeSec);
    audio.play('alert');
    rosa(`VoltMart is poaching our drivers! Serve ${RV.need} cars in ${RV.challengeSec}s to send them packing.`);
    return;
  }
  rival.t += dt;
  const got = state.served - rival.served, left = Math.max(0, Math.ceil(RV.challengeSec - rival.t));
  rivalTag.position.copy(rival.g.position).setY(S.tagHeight + 0.8);
  if (rival.phase === 'in') { rivalTag.userData.set('⚡ VoltMart'); if (drive(rival, dt)) Object.assign(rival, { phase: 'dare', t: 0 }); return; }
  if (rival.phase === 'dare') {
    rivalTag.userData.set('⚡ VoltMart', 1 - rival.t / RV.challengeSec, COL.rivalSign);
    $('rivalBar').textContent = `⚡ VoltMart dare · You ${got}/${RV.need} · ${left}s`;
    if (got >= RV.need) rivalBeaten();
    else if (rival.t >= RV.challengeSec) { toast('😤 VoltMart took a driver this time. Next round!'); rivalLeave(); }
    return;
  }
  if (drive(rival, dt)) { scene.remove(rival.g); rival = null; rivalNext = state.playSec + RV.everySec[0] + Math.random() * (RV.everySec[1] - RV.everySec[0]); }
}
function rivalLeave() {
  const p = rival.g.position;
  Object.assign(rival, { phase: 'out', path: [v3([RD.outLane, p.z - 2]), v3([RD.outLane, RD.spawnZ])] });
}
function rivalBeaten() {
  state.rival.wins++;
  const out = state.rival.wins >= RV.giveUp, pay = Math.round(chargeFee(state.levels.tariff) * (out ? RV.giveUpFees : RV.winFees));
  state.cash += pay;
  book('bonus', pay);
  flyCoins(rival.g.position, pay);
  emit(rival.g.position.clone().setY(1.5), FX.confetti, 2);
  audio.play('complete');
  celebrate(out ? `🏆 VoltMart gave up on ${STATION.name}! +$${pay}` : `💪 VoltMart sent packing! +$${pay} · ${state.rival.wins}/${RV.giveUp}`);
  track.milestone(`rival${state.rival.wins}`);
  tally('rival');
  rivalLeave();
  save();
}

// Police turn into the lot and park; the officer gets out, walks to the owner (the player), talks and writes the ticket.
// Only jams after the first one cost a fine; the visit always clears the queue.
const PO = T.police;
function callPolice() {
  const g = buildPolice();
  g.position.set(RD.outLane, 0, RD.exitZ);
  g.rotation.y = Math.atan2(-1, 0);
  scene.add(g);
  // Pull over on the road level with the owner, where no parked car or queue is in the way; the camera rides along as it pulls in.
  const [, , z0, z1] = W.bounds, spot = [RD.outLane, THREE.MathUtils.clamp(player.g.position.z, z0 + 1.5, Math.min(z1, reachZ) - 1.5)];
  cop = { g, spot, phase: 'in', t: 0, path: [v3(spot)], officer: null };
  look(g, DIR.policeSec);
  audio.play('siren');
  hud.siren.hidden = false;
}
// Big ticket card in the middle of the screen, stamped in with a shake.
function showTicket(fine) {
  hud.ticketTitle.textContent = fine ? 'TRAFFIC FINE' : 'POLICE WARNING';
  hud.ticketAmount.textContent = fine ? `-$${fine}` : `Next time -$${fineFor(state.fines)}`;
  hud.ticketNote.textContent = fine ? (state.cash < 0 ? 'You are in debt: upgrades are locked until you earn it back' : 'Blocking the road with your queue') : 'Keep the road clear: serve cars faster';
  hud.ticket.classList.toggle('warn', !fine);
  hud.toast.hidden = true;
  hud.ticket.hidden = false;
  hud.ticket.getAnimations().forEach((a) => a.cancel());
  hud.ticket.animate([{ transform: 'scale(2.6) rotate(-14deg)', opacity: 0 }, { transform: 'scale(0.92) rotate(-4deg)', opacity: 1, offset: 0.55 }, { transform: 'scale(1) rotate(-4deg)', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1.2)' });
  clearTimeout(hud.ticket.timer);
  // A fine can be cancelled with a rewarded ad, so its card stays up twice as long.
  $('ticketAd').hidden = !fine;
  $('ticketAd').onclick = async () => {
    clearTimeout(hud.ticket.timer);
    hud.ticket.hidden = true;
    if (await ads.rewarded('fine')) { state.cash += fine; book('bonus', fine); flyCoins(player.g.position, fine); audio.play('cash'); save(); }
    nextToast();
  };
  hud.ticket.timer = setTimeout(() => { hud.ticket.hidden = true; nextToast(); }, PO.cardMs * (fine ? 2 : 1));
  shakeLeft = E.shakeSec * 2;
}
function updatePolice(dt) {
  copTag.visible = Boolean(cop);
  copLight.visible = Boolean(cop);
  if (!cop) return;
  cop.t += dt;
  const blink = Math.floor(state.playSec * PO.blinkHz) % 2 === 0;
  cop.g.userData.flash(blink);
  copLight.color.set(blink ? COL.siren : COL.police);
  copLight.position.copy(cop.g.position).setY(2.2);
  const o = cop.officer, boss = player;
  if (cop.phase === 'in' && drive(cop, dt)) {
    // Parking waves the queue away, then the officer steps out.
    state.lost += queue.length;
    [...queue].forEach(turnAway);
    cop.officer = { g: buildOfficer(), path: [] };
    cop.officer.g.position.copy(v3(cop.spot).add(v3(PO.door)));
    scene.add(cop.officer.g);
    pop(cop.officer.g);
    Object.assign(cop, { phase: 'walk', t: 0 });
  } else if (cop.phase === 'walk') {
    o.path = [boss.g.position.clone()];
    const near = o.g.position.distanceTo(boss.g.position) < ST.wakeDist;
    if (!near) walk(o, dt);
    if (near || cop.t >= PO.chaseSec) { Object.assign(cop, { phase: 'talk', t: 0 }); audio.play('talk'); }
  } else if (cop.phase === 'talk') {
    o.g.lookAt(boss.g.position.x, 0, boss.g.position.z);
    if (cop.t >= PO.talkSec) {
      // The first police visit of a run is always a warning.
      const fine = state.policeVisits++ > 0 ? fineFor(state.fines) : 0;
      if (fine) { state.cash -= fine; book('fine', fine); state.fines++; track.milestone(`fine${state.fines}`); emit(boss.g.position.clone().setY(S.carRoof), FX.fine, E.bigBurst); }
      once(fine ? 'fine' : 'policewarning');
      floatText(boss.g.position, fine ? `-$${fine}` : '⚠️ Warning', fine ? COL.loss : COL.pad);
      showTicket(fine);
      audio.play(fine ? 'fine' : 'alert');
      buzz();
      Object.assign(cop, { phase: 'back', t: 0 });
    }
  } else if (cop.phase === 'back') {
    o.path = [v3(cop.spot).add(v3(PO.door))];
    if (walk(o, dt)) {
      scene.remove(o.g);
      Object.assign(cop, { phase: 'out', officer: null, path: [v3([RD.outLane, RD.spawnZ])] });
    }
  } else if (cop.phase === 'out' && drive(cop, dt)) { scene.remove(cop.g); cop = null; hud.siren.hidden = true; return; }
  const who = cop.officer?.g ?? cop.g;
  copTag.userData.set({ in: '🚨', walk: '👮', talk: '👮💬', back: '📝', out: '🚨' }[cop.phase]);
  copTag.position.copy(who.position).setY(S.tagHeight);
}

// Floating text such as "+$8" over a car that just paid.
const payPops = [];
const payPop = (at, amount, prefix = '') => floatText(at, `${prefix}+$${amount}`, COL.gain);
// Text pops in large, settles and floats up; color says gain, loss or action.
function floatText(at, text, color) {
  // Only a few texts float at once so they never pile on top of each other.
  if (payPops.length >= F.maxFloats) { const old = payPops.shift(); scene.remove(old.s); old.s.material.map.dispose(); old.s.material.dispose(); }
  const s = label();
  s.userData.set(text, undefined, color);
  s.position.copy(at).setY(S.tagHeight);
  payPops.push({ s, t: 0, base: s.scale.clone() });
}
function updatePayPops(dt) {
  for (let i = payPops.length - 1; i >= 0; i--) {
    const p = payPops[i];
    p.t += dt / F.payPopSec;
    p.s.position.y += F.payPopRise * dt / F.payPopSec;
    p.s.material.opacity = Math.min(1, 2 * (1 - p.t));
    p.s.scale.copy(p.base).multiplyScalar(p.t < F.popInShare ? F.popPeak * p.t / F.popInShare : F.popPeak - (F.popPeak - 1) * Math.min((p.t - F.popInShare) / F.popInShare, 1));
    if (p.t >= 1) { scene.remove(p.s); p.s.material.map.dispose(); p.s.material.dispose(); payPops.splice(i, 1); }
  }
}

// Walks a driver along their path; true once they arrive.
function walk(d, dt) {
  const p = d.g.position, t = d.path[0], dx = t.x - p.x, dz = t.z - p.z, dist = Math.hypot(dx, dz), stepLen = G.walkSpeed * dt;
  if (dist > 0) d.g.rotation.y = Math.atan2(dx, dz);
  if (dist <= stepLen) { p.copy(t); d.path.shift(); } else { p.x += dx / dist * stepLen; p.z += dz / dist * stepLen; }
  stepPerson(d.g, d.path.length ? 1 : 0, dt);
  return d.path.length === 0;
}

// Driver leaves the car after plugging in, orders at the table, eats, then walks back; past this share of patience the tag turns angry.
const PATIENCE_WARN = 0.6;
function updateDriver(bay, car, dt) {
  const d = car.driver, table = bay.table;
  // Patience stops while the player stands at the table with food this driver wants.
  const serving = d.phase === 'order' && player.carry > 0 && inside(player.g.position, table.zone, S.table.zone) && wanted(d, player) !== null;
  if (!serving) d.t += dt;
  if (d.phase === 'toTable' && walk(d, dt)) {
    Object.assign(d, { phase: 'order', t: 0 });
    // Once side machines run, some drivers swap one of their foods for a side, so an order stays the same size.
    const open = machines.filter((m) => sideOwned(m.i));
    d.size = G.orderSize;
    if (open.length && Math.random() < SD.chance) { Object.assign(d, { side: open[Math.floor(Math.random() * open.length)].i, sideLeft: 1, need: d.need - 1, size: d.size - 1 }); tally('sideOrder'); }
  }
  else if (d.phase === 'toTerminal' && walk(d, dt)) { scene.remove(d.g); Object.assign(d, { phase: 'away', t: 0 }); }
  else if (d.phase === 'away' && d.t >= VALET.sec) { scene.add(d.g); Object.assign(d, { phase: 'back', path: walkway(bay, VALET.terminal[0], 'in') }); }
  else if (d.phase === 'order' && (fed(d) || d.t >= G.patienceSec)) {
    if (!fed(d)) once('hungry');
    rate(!fed(d) ? E.ratingScores.hungry : d.t < G.patienceSec * E.ratingFastShare ? E.ratingScores.fast : E.ratingScores.fed);
    // A fed VIP counts for the mission and will drop a trail of bills on the way back.
    if (car.vip && fed(d)) { emit(table.zone.clone().setY(S.tableTop), FX.heart); once('viptip'); count('vip'); tally('vip'); d.bills = VIP.bills + airport.extraBills(); d.drop = 0; }
    Object.assign(d, { phase: fed(d) ? 'eat' : 'back', t: 0, path: fed(d) ? [] : walkway(bay, bay.table.seat.x, 'in') });
  }
  else if (d.phase === 'eat' && d.t >= G.eatSec * CONFIG.upgrades.speed.factor ** state.levels.speed) Object.assign(d, { phase: 'back', path: walkway(bay, bay.table.seat.x, 'in') });
  else if (d.phase === 'back' && walk(d, dt)) { scene.remove(d.g); car.driver = null; car.back = true; }
  // Bills are spread evenly over the walk back, so the trail runs from the table to the car.
  if (d.phase === 'back' && d.bills > 0) {
    d.every ??= Math.max(0.15, d.g.position.distanceTo(bay.door) / G.walkSpeed / (VIP.bills + airport.extraBills() + 1));
    if ((d.drop += dt) >= d.every) { d.drop = 0; d.bills--; dropVipBill(d.g.position); }
  }
  table.tag.userData.set(d.phase === 'order' ? `${d.t > G.patienceSec * PATIENCE_WARN ? '😠' : ''}${car.vip ? '👑' : ''}${FOOD.icon}${d.size - d.need}/${d.size}${d.sideLeft ? ` ${SIDES[d.side].icon}` : ''}` : '');
}

function updateBay(bay, dt) {
  const car = bay.car;
  if (bay.blockedBy) return;
  if (!car) {
    bay.tag.userData.set('');
    // Queued drivers come first; with no queue a new driver arrives after the rating-based delay, sooner in rush hour.
    if (bay.held || (bay.wait -= dt * rushPace()) > 0) return;
    if (queue.length) toBay(bay, queue.shift());
    else if ((bay.pull -= dt * rushPace()) <= 0) toBay(bay, makeCar('arrive'));
    return;
  }
  // In a blackout the chargers stop; everything else carries on.
  if (!(grid.out && car.phase === 'charge')) car.t += dt;
  const full = chargeTime(state.levels.speed) * (car.bus ? BUS.chargeMult : 1), charged = car.phase === 'charge' && car.t >= full;
  if (car.driver) updateDriver(bay, car, dt);
  else bay.table.tag.userData.set('');
  if (car.phase === 'arrive') {
    if (drive(car, dt)) { Object.assign(car, { phase: 'plug', t: 0 }); if (car.vip) rollCarpet(bay, car); }
  } else if (car.phase === 'plug' && car.t >= G.selfPlugSec) {
    plugIn(bay);
    once('selfplug');
  } else if (charged && (!car.back || shopping(car, full))) {
    // Idle fee: only a fed driver lingering at the table keeps a full car plugged in; waiting for food is the station's fault.
    // At a mall the driver also goes shopping for a while after charging, and that time is billed too.
    const lingering = car.driver?.phase === 'eat' || (car.driver?.phase === 'back' && fed(car.driver)) || shopping(car, full);
    if (shopping(car, full)) bay.tag.userData.set('🛍️ Shopping');
    car.full = (car.full ?? 0) + dt;
    if (lingering && car.full > G.idleGraceSec) { car.idle += dt * CONFIG.economy.idleFeePerSec; once('idlefee'); }
  } else if (charged) {
    bay.charger.userData.setOn(false);
    // Some drivers stop at the car wash: they turn left on the exit lane instead of heading for the road.
    const servicing = !car.bus && service.accept(car), washing = !car.bus && !servicing && wash.accept();
    Object.assign(car, { phase: 'leave', servicing, washing, path: servicing ? [bay.pathOut[0], v3([RD.serviceLane, W.exitZ]), service.entry] : washing ? [bay.pathOut[0], wash.entry] : car.bus ? [bay.pathOut[0].clone().setX(car.g.position.x), ...bay.pathOut.slice(1)] : [...bay.pathOut] });
    // A bus served while the player held a big combo pays double; buses and valets count toward the goals.
    const busBonus = car.bus && car.comboHit ? CHN.busComboMult : 1;
    const fee = Math.round(chargeFee(state.levels.tariff) * (car.vip ? VIP.feeMult : car.bus ? BUS.feeMult * busBonus : car.valet ? VALET.feeMult : car.regular ? CHN.regularMult : 1) * (car.convoy ? CV.feeMult : 1) * (car.golden ? CONFIG.golden.feeMult : 1) * (storm.on ? SM.feeMult : 1) * (festDay() ? CONFIG.fest.mult : 1) * airport.feeFactor());
    if (car.golden) { floatText(car.g.position, `💰 Golden car ×${CONFIG.golden.feeMult}!`, COL.bill); emit(car.g.position.clone().setY(1.5), FX.gold, 3); }
    if (car.regular) { tally('regular'); floatText(car.g.position, car.who ? `${car.who.icon} ${car.who.name}: "${car.who.line}"` : '❤️ Regular', COL.bill); }
    if (car.who) regularVisit(car.who, car.g.position);
    albumAdd(car.vip ? 'limo' : car.bus ? 'bus' : car.g.userData.model, car.g.position);
    if (busBonus > 1) floatText(car.g.position, `COMBO BUS ×${busBonus}`, COL.bill);
    if (car.convoy) floatText(car.g.position, `🚐 Convoy ×${CV.feeMult}`, COL.bill);
    if (car.bus) tally('bus');
    if (car.valet) tally('valet');
    earn(bay, fee + Math.floor(car.idle), bay.spot);
    book('charge', fee);
    book('idle', Math.floor(car.idle));
    state.served++;
    count('cars');
    tally('cars');
    once('car1');
  } else if (car.phase === 'leave' && !laneBusy(car, bay) && (drive(car, dt) || car.path.length === 1)) {
    if (car.servicing) service.take(car);
    else if (car.washing) wash.take(car);
    else traffic.push(car);
    bay.car = null;
    if (car.bus) car.blocks.blockedBy = null;
    if (car.carpet) { scene.remove(car.carpet); car.carpet = null; }
    bay.wait = spawnWait();
    // A driver rescued by a van comes straight in and turns into a regular.
    const rescued = mobile.takeRescued();
    if (rescued) nextRegular = true;
    bay.pull = rescued ? 0 : G.carSpawnSec * (E.ratingStart - rating()) * E.ratingSlowdown;
    bay.tag.userData.set('');
    return;
  }
  // Battery gauge rides above the car; the text says what the car needs or owes.
  bay.tag.position.copy(car.g.position).setY(S.tagHeight);
  const level = car.phase === 'charge' || car.phase === 'leave' ? car.start + (1 - car.start) * Math.min(car.t / full, 1) : car.start;
  const text = car.phase === 'plug' ? '🔌' : car.phase !== 'leave' && car.idle >= 1 ? `⏱+$${Math.floor(car.idle)}` : car.fix ? SVC[car.fix].label : car.valet ? '🔑' : car.regular ? '❤️' : '';
  if (car.carpet) updateCarpet(car, dt);
  bay.tag.userData.set(car.phase === 'arrive' ? '' : text, level);
  const roof = car.g.position.clone().setY(S.carRoof);
  if (car.phase === 'charge' && car.t < full) maybeEmit(roof, FX.spark, dt);
  if (car.vip) maybeEmit(roof, FX.vip, dt);
}

// Drivers walk along the aisle above the parked cars, never through them: out from the car door up to the aisle and across to x,
// or back in from x along the aisle and down to the door.
function walkway(bay, x, dir) {
  const z = bay.pos.z - W.aisle, up = v3([bay.door.x, z]), across = v3([x, z]);
  return dir === 'out' ? [up, across] : [across, up, bay.door];
}
// Plugging in starts the charge and sends the driver to their table.
function plugIn(bay) {
  const car = bay.car, g = buildPerson(COL.drivers[Math.floor(Math.random() * COL.drivers.length)]);
  g.position.copy(bay.door);
  scene.add(g);
  // A valet driver walks to the terminal instead of the table and flies off.
  Object.assign(car, { phase: 'charge', t: 0, driver: car.valet ? { g, phase: 'toTerminal', t: 0, need: 0, path: [...walkway(bay, VALET.terminal[0], 'out'), v3(VALET.terminal)] } : { g, phase: 'toTable', t: 0, need: G.orderSize, path: [...walkway(bay, bay.table.seat.x, 'out'), bay.table.seat] } });
  bay.charger.userData.setOn(!grid.out);
}

// Money lands on a bay's or table's cash pile with a floating amount.
function earn(spot, amount, at = spot.cashPos, prefix) {
  spot.cash += amount;
  state.earned += amount;
  payPop(at, amount, prefix);
}

// Station rating is the average of the last few drivers' scores; better service brings cars sooner.
const rating = () => (state.ratings.length ? state.ratings.reduce((a, b) => a + b, 0) / state.ratings.length : E.ratingStart);
function rate(score) {
  state.ratings = [...state.ratings, score].slice(-E.ratingWindow);
}

// Fast back-to-back serves by the player build a combo that raises the meal price and the sound pitch.
let combo = 0, comboLeft = 0;

// Returns true once per `interval` while an action continues.
function tick(actor, dt, interval) {
  actor.timer += dt;
  if (actor.timer < interval) return false;
  actor.timer = 0;
  return true;
}

const sfx = (actor, name) => { if (actor === player) audio.play(name); };

// A driver's order is the station's food plus, sometimes, one side; it is done when both are served.
const fed = (d) => d.need === 0 && !d.sideLeft;
const ordering = (b) => b.car?.driver?.phase === 'order' && !fed(b.car.driver);
// What the actor can hand this driver now: the food first, then the side, or null.
const wanted = (d, actor) => (d.need > 0 && actor.items.includes('main') ? 'main' : d.sideLeft && actor.items.includes(d.side) ? d.side : null);

// Plugging cars in, picking up meals and serving them at tables; shared by player and worker.
function interact(actor, dt) {
  if (actor === player && service.tireWork(actor.g.position, dt, true)) return;
  const p = actor.g.position, here = openBays().find((b) => b.car && inside(p, b.zone, touchBay(Z.bay.size)));
  if (here?.car.phase === 'plug') {
    if (tick(actor, dt, G.plugSec)) { plugIn(here); sfx(actor, 'plug'); once(actor === player ? 'plug' : 'workerplug'); if (actor === player) count('plug'); }
    return;
  }
  // The player hands cups straight from the coffee machine to the car at the drive-thru window.
  const atWindow = kiosk.cars[0];
  if (actor === player && state.coffee && atWindow?.phase === 'order' && atWindow.need > 0 && kiosk.stock > 0 && inside(p, kiosk.zone, CF.zone)) {
    if (tick(actor, dt, CF.serveSec)) { serveCup(atWindow); audio.play('deliver'); }
    return;
  }
  if (inside(p, cafe.zone, Z.cafe.size) && cafe.stock > 0 && mains(actor) < capOf(actor)) {
    if (tick(actor, dt, G.pickupSec)) {
      const from = cafe.stack[cafe.stock - 1]?.getWorldPosition(new THREE.Vector3()) ?? cafeTop.getWorldPosition(new THREE.Vector3());
      cafe.stock--;
      actor.carry++;
      actor.items.push('main');
      actor.incoming++;
      fly(mealGeo, mealMat, from, () => stackTop(actor), () => actor.incoming--);
      // Each burger picked up pops a little higher, so a full tray sounds like it fills.
      if (actor === player) audio.play('pickup', 1 + 0.08 * actor.carry);
    }
    return;
  }
  const mc = machines.find((m) => sideOwned(m.i) && m.stock > 0 && inside(p, m.zone, SD.zone));
  if (mc && sideRoom(actor)) {
    if (tick(actor, dt, G.pickupSec)) {
      const from = mc.stack[mc.stock - 1]?.getWorldPosition(new THREE.Vector3()) ?? mc.top.getWorldPosition(new THREE.Vector3());
      mc.stock--;
      actor.carry++;
      actor.items.push(mc.i);
      actor.incoming++;
      fly(sideGeo[mc.i].geo, sideGeo[mc.i].mat, from, () => stackTop(actor), () => actor.incoming--);
      if (actor === player) audio.play('pickup', 1 + 0.08 * actor.carry);
    }
    return;
  }
  const diner = actor.carry > 0 && openBays().find((b) => ordering(b) && inside(p, b.table.zone, S.table.zone) && wanted(b.car.driver, actor) !== null);
  if (diner) {
    if (tick(actor, dt, G.deliverSec)) {
      const d = diner.car.driver, type = wanted(d, actor), geo = type === 'main' ? { geo: mealGeo, mat: mealMat } : sideGeo[type];
      actor.carry--;
      actor.items.splice(actor.items.lastIndexOf(type), 1);
      if (type === 'main') d.need--; else d.sideLeft = 0;
      tally(type === 'main' ? 'serve' : `side${type}`);
      const target = diner.table.zone.clone().setY(S.tableTop);
      fly(geo.geo, geo.mat, stackTop(actor), () => target);
      if (actor === player) { combo = Math.min(combo + 1, E.comboMax); comboLeft = E.comboWindow; }
      const bonus = actor === player ? 1 + E.comboBonus * (combo - 1) : 1;
      const meal = Math.round((type === 'main' ? CONFIG.economy.mealPrice : SIDES[type].price) * CONFIG.economy.incomeMultiplier ** state.levels.tariff * city.income * bonus * (rush.on ? rushMult() : 1));
      earn(diner.table, meal, diner.table.zone);
      book('meal', meal);
      once('serve');
      if (combo >= 3) once('combo3');
      if (actor === player) { count('serve'); count('combo', combo); }
      if (actor === player) audio.play('deliver', 1 + E.comboPitch * (combo - 1));
    }
    return;
  }
  actor.timer = 0;
}

function produce(dt) {
  if (cafe.stock >= G.machineMax) return;
  cafe.timer += dt;
  if (cafe.timer >= G.machineSec / boostFactor('kitchen')) { cafe.timer = 0; cafe.stock++; }
}

function hireWorker() {
  state.worker = true;
  worker = makeActor(COL.worker, v3(W.workerPad));
  worker.slackIn = rand(...ST.slackEverySec);
}

// Walks an actor toward target at speed; true once it is there.
function walkTo(actor, target, speed, dt) {
  const p = actor.g.position, dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz);
  if (d > G.arriveDist) { step(actor, dx / d, dz / d, speed, dt); return false; }
  actor.pace = 0;
  return true;
}

// A staff member plugs in waiting cars first, otherwise fills a tray and serves open orders.
function updateWorker(actor, dt) {
  const p = actor.g.position, bays = openBays();
  const toPlug = bays.find((b) => b.car?.phase === 'plug');
  const serve = bays.find((b) => ordering(b) && wanted(b.car.driver, actor) !== null);
  // A side someone waits for and the actor does not carry sends it to that machine once it has stock.
  const sideFor = bays.filter(ordering).map((b) => b.car.driver).find((d) => d.sideLeft && !actor.items.includes(d.side) && machines[d.side].stock > 0);
  const room = actor.carry < G.workerCap;
  const loading = room && ((inside(p, cafe.zone, Z.cafe.size) && cafe.stock > 0) || machines.some((m) => m.stock > 0 && inside(p, m.zone, SD.zone)));
  const target = toPlug ? toPlug.pos : serve && !loading ? serve.table.zone : sideFor && room ? machines[sideFor.side].zone : cafe.pos;
  walkTo(actor, target, G.workerSpeed * boostFactor('speed'), dt);
  interact(actor, dt);
}

// Staff: the worker sometimes slacks; the owner or the manager gets them back to work.
let manager = null, temp = null, officeZoneMesh = null;
const boosts = Object.fromEntries(Object.keys(ST.boosts).map((k) => [k, { left: 0, cool: 0, seen: 0, reported: 0 }]));
const boostFactor = (k) => (boosts[k].left > 0 ? ST.boosts[k].factor : 1);
// Shortage each boost answers, as staff would see it.
const shortage = {
  kitchen: () => openBays().filter(ordering).length >= 2 && cafe.stock === 0,
  speed: () => Boolean(worker) && openBays().filter((b) => b.car?.phase === 'plug').length >= 2,
  extra: () => queue.length >= 3,
};
function wake(text) {
  worker.slack = null;
  worker.slackIn = rand(...ST.slackEverySec);
  if (text) { floatText(worker.g.position, text, COL.action); audio.play('talk'); }
}
function updateStaff(dt) {
  if (worker && !worker.slack && (worker.slackIn -= dt) <= 0) {
    worker.slack = { icon: ST.kinds[Math.floor(Math.random() * ST.kinds.length)], t: 0 };
    if (!state.seen.slack) toast(state.office ? 'Your worker is slacking! Wake them or tell the manager' : 'Your worker is slacking! Walk over to get them back to work', E.bannerMs * 2);
    once('slack');
  }
  if (worker?.slack) {
    const s = worker.slack;
    s.t += dt;
    if (s.icon === '📱') walkTo(worker, v3(ST.slackSpot), G.workerSpeed / 2, dt);
    else worker.pace = 0;
    if (worker.g.position.distanceTo(player.g.position) < ST.wakeDist) { wake('Back to work!'); once('wake'); }
    else if (s.t >= ST.slackMaxSec) wake('');
  } else if (worker) updateWorker(worker, dt);
  if (worker) { worker.tag.userData.set(worker.slack?.icon ?? ''); worker.tag.position.copy(worker.g.position).setY(S.tagHeight); }

  if (manager) {
    // The manager only acts on the owner's orders: sent to a slacking worker, he talks, then returns to the desk.
    if (manager.order && !worker?.slack) manager.order = null;
    const there = walkTo(manager, manager.order ? worker.g.position : v3(ST.desk), ST.managerSpeed, dt);
    manager.talk = manager.order && there ? manager.talk + dt : 0;
    if (manager.talk >= ST.talkSec) { wake('Manager: Back to work!'); once('managerwake'); }
    manager.tag.userData.set(manager.talk > 0 ? '💬' : managerNeeded() ? '❗' : '');
    manager.tag.position.copy(manager.g.position).setY(S.tagHeight);
    // Standing at the manager's desk opens the orders sheet; walking away closes it.
    const atDesk = inside(player.g.position, v3(ST.officeZone), ST.officeZoneSize) || player.g.position.distanceTo(manager.g.position) < ST.talkDist;
    if (atDesk !== manager.atDesk) { manager.atDesk = atDesk; hud.manager.hidden = !atDesk; if (atDesk) renderManager(); }
  }
  updateBoosts(dt);
  if (temp) updateWorker(temp, dt);
}

// The manager needs the owner when a worker slacks or staff reported a shortage that can still be ordered.
const managerNeeded = () => Boolean(manager) && (Boolean(worker?.slack) || Object.keys(ST.boosts).some((k) => boosts[k].reported > state.playSec && !boosts[k].left && !boosts[k].cool));

// Expected extra income of a boost, priced by the accountant from the last minute's income.
const boostValue = (b) => Math.round(perSec(b.sources) * b.gain * b.sec + (b.fineRisk ? fineFor(state.fines) * Math.min(queue.length / T.jamAt, 1) : 0));

// Staff report shortages; the owner decides at the manager's desk what to buy.
function updateBoosts(dt) {
  for (const [k, b] of Object.entries(ST.boosts)) {
    const s = boosts[k];
    s.left = Math.max(s.left - dt, 0);
    s.cool = Math.max(s.cool - dt, 0);
    if (k === 'extra' && temp && s.left === 0) { scene.remove(temp.g); scene.remove(temp.tag); temp = null; }
    if (!manager) continue;
    s.seen = shortage[k]() ? s.seen + dt : 0;
    if (s.seen < ST.reportSec || s.reported > state.playSec) continue;
    s.reported = state.playSec + ST.cooldownSec;
    const who = worker && !worker.slack ? worker : player;
    floatText(who.g.position, '❗', COL.pad);
    toast(`${who === player ? 'You' : 'Worker'}: "${b.line}" Visit the manager to order ${b.name}`, E.bannerMs * 2);
    once(`report_${k}`);
  }
}

// Owner's order at the manager's desk; the accountant's estimate is shown but the choice is the owner's.
// A free order comes from a rewarded ad and costs nothing.
function orderBoost(k, free = false) {
  const b = ST.boosts[k], s = boosts[k];
  if (s.left > 0 || s.cool > 0 || (!free && state.cash < b.cost)) return false;
  const value = state.accounting ? boostValue(b) : null;
  if (!free) { state.cash -= b.cost; book('boost', b.cost); }
  s.left = b.sec;
  s.cool = b.sec + ST.cooldownSec;
  if (k === 'extra') temp = makeActor(COL.temp, v3(ST.desk));
  holdPolice(`${b.name} ordered!`);
  decisions.unshift({ name: b.name, value, cost: b.cost });
  decisions.length = Math.min(decisions.length, AC.decisions);
  floatText(manager.g.position, `✅ ${b.name}`, COL.gain);
  if (value !== null) toast(value > b.cost ? `Accountant: ${b.name} should earn ~$${value} for $${b.cost}. Good call!` : `Accountant: ${b.name} may only earn ~$${value} for $${b.cost}. A loss!`, E.bannerMs * 2);
  audio.play('buy');
  track.milestone(`boost_${k}`);
  renderManager();
  return true;
}
function orderWake() {
  if (!worker?.slack || manager.order) return;
  manager.order = 'wake';
  floatText(manager.g.position, '👍 On it!', COL.action);
  renderManager();
}

// Manager sheet: one row per order with cost, the accountant's estimate and whether staff asked for it.
function renderManager() {
  if (hud.manager.hidden) return;
  // With an accountant each order shows its estimate; without one a single line says how to get them.
  const est = (b) => (state.accounting ? `<small class="${boostValue(b) > b.cost ? 'gain' : 'loss'}">Accountant: earns ~$${boostValue(b)}</small>` : '');
  const rows = Object.entries(ST.boosts).map(([k, b]) => {
    const s = boosts[k], label = s.left > 0 ? `On ${Math.ceil(s.left)}s` : s.cool > 0 ? `Wait ${Math.ceil(s.cool)}s` : `$${b.cost}`;
    return `<div class="row"><div><b>${shortage[k]() ? '❗ ' : ''}${b.name}</b><small>${b.info}</small>${est(b)}</div>
      ${s.left > 0 || s.cool > 0 || state.cash >= b.cost ? `<button data-boost="${k}" ${s.left > 0 || s.cool > 0 ? 'disabled' : ''}>${label}</button>` : `<button data-boost-ad="${k}" class="ad">▶ Free</button>`}</div>`;
  });
  if (worker?.slack) rows.unshift(`<div class="row"><div><b>❗ Wake the worker</b><small>The manager walks over and talks to them</small></div><button data-wake ${manager.order ? 'disabled' : ''}>${manager.order ? 'Going' : 'Free'}</button></div>`);
  if (!state.accounting) rows.push('<small>Build Accounting to see which orders pay off</small>');
  hud.managerRows.innerHTML = rows.join('');
}

// Accounting office sits next to the manager in the back office; profit piles up on the accountant's desk.
const AC = ST.accounting, decisions = [];
let accountant = null;
const accountingModel = buildOffice('ACCOUNTING', COL.accountant, buildCoinIcon(), '$'), profitTop = accountingModel.userData.counter, profitStack = [];
accountingModel.position.copy(v3(AC.office));
function openAccounting() {
  state.accounting = true;
  scene.add(accountingModel);
  pop(accountingModel);
  accountant = makeActor(COL.accountant, v3(AC.desk));
}
const INCOME = ['charge', 'idle', 'meal', 'tip', 'coffee', 'mobile', 'wash', 'tire', 'repair', 'tow', 'moto', 'mart', 'air', 'chain', 'mission', 'bonus'], EXPENSE = ['build', 'upgrade', 'boost', 'fine', 'fuel'];
// A station's own earning rate leaves out missions, bonuses and what the other stations send in.
const RATE_KINDS = INCOME.filter((k) => !['chain', 'mission', 'bonus'].includes(k));
const total = (kinds) => kinds.reduce((a, k) => a + (state.ledger[k] ?? 0), 0);

const officeModel = buildOffice('MANAGER', COL.manager, buildTieIcon(COL.manager), 'TALK');
officeModel.position.copy(v3(ST.office));
function openOffice() {
  state.office = true;
  scene.add(officeModel);
  pop(officeModel);
  manager = makeActor(COL.manager, v3(ST.desk));
  manager.talk = 0;
  officeZoneMesh = zoneMesh(v3(ST.officeZone), ST.officeZoneSize, COL.zoneTable);
  scene.add(officeZoneMesh);
}

// Drive-thru coffee: cars pull up at the kiosk window, the driver stays inside and pays per cup.
const cupGeo = new THREE.CylinderGeometry(CF.cup.r * 1.15, CF.cup.r, CF.cup.h, 10), cupMat = buildCupMaterials();
const kiosk = { zone: v3(CF.padAt), cashPos: v3([CF.padAt[0], CF.padAt[1] + 1.4]), size: CF.zone, cash: state.coffeeCash, bills: [], stock: 0, timer: 0, stack: [], cars: [], next: 0, tag: label() };
const kioskModel = buildKiosk([CF.padAt[0] - CF.kioskAt[0], CF.padAt[1] - CF.kioskAt[1]]), kioskTop = kioskModel.userData.top, kioskZone = zoneMesh(kiosk.zone, CF.zone, COL.zoneCafe);
kioskModel.position.copy(v3(CF.kioskAt));
kioskModel.rotation.y = CF.kioskTurn;
function openCoffee() {
  state.coffee = true;
  Object.keys(CF.upgrades).forEach((k) => { state.levels[k] ??= 0; });
  scene.add(kioskModel, kioskZone);
  pop(kioskModel);
}
// One cup from the machine to the car at the window, paid at the kiosk's cash pile.
function serveCup(car) {
  kiosk.stock--;
  car.need--;
  fly(cupGeo, cupMat, kioskTop.getWorldPosition(new THREE.Vector3()), () => car.g.position.clone().setY(S.carRoof));
  const cup = Math.round(CF.cupPrice * CONFIG.economy.incomeMultiplier ** state.levels.coffeePrice * city.income);
  earn(kiosk, cup, car.g.position);
  book('coffee', cup);
  state.cups++;
  once('cup1');
}
let barista = null;
function updateCoffee(dt) {
  kiosk.tag.visible = state.coffee;
  if (!state.coffee) return;
  if (kiosk.stock < CF.machineMax && (kiosk.timer += dt) >= CF.machineSec * CF.upgrades.espresso.factor ** state.levels.espresso) { kiosk.timer = 0; kiosk.stock++; }
  if ((kiosk.next -= dt) <= 0 && kiosk.cars.length < CF.lineMax) {
    kiosk.next = rand(...CF.everySec);
    const g = randomCar();
    // Drive-thru cars come down their own paved access road beside the main road, clear of the charging queue.
    g.position.copy(v3(CF.spawnAt));
    g.rotation.y = Math.atan2(1, 0);
    scene.add(g);
    const [lo, hi] = CF.cups;
    kiosk.cars.push({ g, phase: 'in', t: 0, need: lo + Math.floor(Math.random() * (hi - lo + 1)), path: [] });
  }
  // Cars line up on the service lane behind the window and move up as the front car leaves; only the front car orders.
  kiosk.cars.forEach((c, i) => {
    const at = v3([CF.windowAt[0], CF.windowAt[1] - i * CF.gap]);
    if (c.g.position.distanceToSquared(at) > 1e-4) { c.path = [at]; drive(c, dt); }
    else if (i === 0 && c.phase !== 'order') Object.assign(c, { phase: 'order', t: 0 });
  });
  const c = kiosk.cars[0];
  if (c?.phase === 'order' && (c.need === 0 || (c.t += dt) >= CF.patienceSec)) {
    rate(c.need > 0 ? E.ratingScores.hungry : c.t < CF.patienceSec * E.ratingFastShare ? E.ratingScores.fast : E.ratingScores.fed);
    kiosk.cars.shift();
    traffic.push({ g: c.g, path: [...W.merge.map(v3), v3([RD.inLane, RD.exitZ])] });
  }
  const w = kiosk.cars[0];
  if (state.levels.barista && !barista) { barista = makeActor(COL.worker, v3(CF.baristaAt)); barista.timer = 0; pop(barista.g); }
  if (barista && w?.phase === 'order' && w.need > 0 && kiosk.stock > 0 && (barista.timer += dt) >= CF.baristaSec) { barista.timer = 0; serveCup(w); }
  kiosk.tag.visible = w?.phase === 'order';
  if (kiosk.tag.visible) { kiosk.tag.position.copy(w.g.position).setY(S.tagHeight); kiosk.tag.userData.set(`☕${w.need}`); }
}

// Purchase pad: standing on it drains cash until the unlock is paid.
// Floor power-ups as in the genre: one waits on a free spot for a while, and stepping on it boosts the player for a short time.
const puModels = Object.fromEntries(Object.entries(PU.kinds).map(([k, v]) => {
  const g = buildPowerup(k, v.glow), tag = label();
  tag.userData.set(`${Math.round(PU.factor * 100)}%`, undefined, v.glow);
  tag.position.set(0, S.tagHeight * 0.6, 0.9);
  g.add(tag);
  return [k, g];
}));
const powerTag = label();
scene.add(powerTag);
function updatePower(dt) {
  if (power.left > 0 && (power.left -= dt) <= 0) power.kind = null;
  powerTag.visible = Boolean(power.kind);
  if (power.kind) {
    powerTag.userData.set(`${PU.kinds[power.kind].icon} ${Math.ceil(power.left)}s`, power.left / PU.durSec);
    powerTag.position.copy(player.g.position).setY(Math.max(S.tagHeight, maxTag.visible ? maxTag.position.y + S.labelScale : 0));
  }
  const m = power.item && puModels[power.item];
  if (m) {
    m.userData.spin(dt);
    if (Math.hypot(player.g.position.x - m.position.x, player.g.position.z - m.position.z) < PU.radius) {
      Object.assign(power, { kind: power.item, left: PU.durSec });
      floatText(player.g.position, `${PU.kinds[power.item].icon} ${PU.kinds[power.item].text} +${Math.round((PU.factor - 1) * 100)}%`, PU.kinds[power.item].glow);
      emit(m.position.clone().setY(1), FX.confetti, E.bigBurst);
      audio.play('buy');
    }
    if (power.kind === power.item || (power.life -= dt) <= 0) { scene.remove(m); power.item = null; power.next = rand(...PU.everySec); }
  } else if (!power.kind && state.playSec > PU.firstSec && (power.next -= dt) <= 0) {
    const kinds = Object.keys(PU.kinds), spot = PU.spots[Math.floor(Math.random() * PU.spots.length)];
    Object.assign(power, { item: kinds[Math.floor(Math.random() * kinds.length)], life: PU.lifeSec });
    puModels[power.item].position.copy(v3(spot));
    scene.add(puModels[power.item]);
    pop(puModels[power.item]);
  }
}

// Red MAX tag over the player's stack when the hands are full.
const maxTag = label();
maxTag.visible = false;
maxTag.userData.set('MAX', undefined, COL.loss);
scene.add(maxTag);
const padMesh = new THREE.Group(), padTile = buildFloorTile(S.pad[0]);
padMesh.add(padTile);
let padKey = '';
// Glowing ring that pulses around the pad once it is affordable.
const padRing = new THREE.Mesh(new THREE.RingGeometry(FX.ring.inner, FX.ring.outer, 32), new THREE.MeshBasicMaterial({ color: FX.ring.color, transparent: true }));
padRing.rotation.x = -Math.PI / 2;
padRing.position.y = S.pad[1];
padMesh.add(padRing);
scene.add(padMesh);
// Station pads come first; the coffee drive-thru and then the depot appear once the level is complete.
// After stage 1 each stage's pad appears once the stage before it is maxed.
const extraPad = () => {
  if (stage() === 1) return undefined;
  // The side machines come first: a new product right after stage 1.
  const side = SIDES.findIndex((s, k) => !sideOwned(k));
  if (side >= 0) return { type: 'side', i: side, cost: SIDES[side].cost };
  const i = stageParts().findIndex(([owned, group]) => !(owned && maxed(group)));
  // A complete station goes on with its expansions.
  if (i === -1) { const k = extras.kinds.find((x) => !extras.owned(x)); return k ? { type: k, cost: EX[k].cost } : undefined; }
  return stageParts()[i][0] ? undefined : PAD_OF[i] === 'depot' ? CONFIG.mobile.pad : { type: PAD_OF[i] };
};
const currentPad = () => CONFIG.pads[state.pad] ?? extraPad();

// Lock tile on each locked building's spot; it goes once `owned()` turns true, and hides while its buy pad is out.
const ghosts = [
  ['office', officeModel, () => !!manager], ['accounting', accountingModel, () => state.accounting], ['coffee', kioskModel, () => state.coffee],
  ['depot', mobile.depot, mobile.owned], ['wash', wash.building, wash.owned],
  ...['tire', 'repair', 'tow'].map((k) => [k, service.buildings[k], () => service.owned(k)]),
  ...['solar', 'lounge'].map((k) => [k, airport.buildings[k], () => airport.owned(k)]),
  ...extras.kinds.map((k) => [k, extras.buildings[k], () => extras.owned(k)]),
  ...machines.map((m) => [`side${m.i}`, m.m, () => sideOwned(m.i)]),
].filter(([type]) => ['office', 'accounting', ...PAD_OF, ...extras.kinds, ...machines.map((m) => `side${m.i}`)].includes(type)).map(([type, model, owned]) => {
  const g = buildFloorTile(GH.size);
  g.position.copy(model.position).setY(0.02);
  g.userData.draw({ fill: GH.tile, lock: true, name: GH.names[type] ?? SIDES[type.slice(4)].name.toUpperCase(), ink: GH.ink, star: stageKeys.indexOf(type) > 0 ? stageKeys.indexOf(type) + 1 : 0, starFill: GH.star, starInk: GH.starInk });
  scene.add(g);
  return { type, g, owned };
});
function updateGhosts() {
  const pad = currentPad(), want = pad?.type === 'side' ? `side${pad.i}` : pad?.type;
  for (const h of ghosts) h.g.visible = !h.owned() && h.type !== want;
}
const PAD_NAMES = { bay: 'New Charger', worker: 'Hire Worker', office: 'Manager Office', accounting: 'Accounting Office', coffee: 'Coffee Drive-Thru', depot: 'Mobile Charging', wash: 'Car Wash', tire: 'Tire Shop', repair: 'Repair Garage', tow: 'Tow Truck', solar: 'Solar Field', lounge: 'VIP Lounge', moto: 'Moto Park', mart: 'Mini Mart', air: 'Air & Glass' };
function placePad() {
  const pad = currentPad();
  padMesh.visible = Boolean(pad);
  if (!pad) return;
  padMesh.position.copy(pad.type === 'bay' ? bays[state.bays].zone : v3({ depot: CONFIG.mobile.padAt, wash: CONFIG.wash.padAt, tire: SVC.tire.padAt, repair: SVC.repair.padAt, tow: SVC.tow.padAt, solar: AP.solar.padAt, lounge: AP.lounge.padAt, moto: STATION.extras?.moto, mart: STATION.extras?.mart, air: STATION.extras?.air, side: CONFIG.side.at[pad.i], coffee: CF.padAt, accounting: AC.pad, office: ST.officeZone }[pad.type] ?? W.workerPad)).setY(S.pad[1] / 2);
  pop(padMesh);
}
const padLeft = () => (currentPad() ? padCost(currentPad(), state.bays) - state.padPaid : null);
function updatePad(dt) {
  const pad = currentPad();
  if (!pad) return;
  const cost = padCost(pad, state.bays);
  if (inside(player.g.position, padMesh.position, [S.pad[0], S.pad[2]]) && state.cash > 0) {
    const pay = Math.min(state.cash, padLeft(), Math.ceil(cost * dt / G.padFillSec));
    state.cash -= pay;
    book('build', pay);
    state.padPaid += pay;
    if (state.padPaid >= cost) {
      if (pad.type === 'bay') { const g = bays[state.bays++].group; g.visible = true; pop(g); holdPolice('New charger open!'); }
      else if (pad.type === 'side') openSide(pad.i);
      else ({ depot: mobile.open, wash: wash.open, tire: () => service.open('tire'), repair: () => service.open('repair'), tow: () => service.open('tow'), solar: () => airport.open('solar'), lounge: () => airport.open('lounge'), moto: () => extras.open('moto'), mart: () => extras.open('mart'), air: () => extras.open('air'), office: openOffice, accounting: openAccounting, coffee: openCoffee, worker: hireWorker })[pad.type]();
      if (pad.type === 'worker') holdPolice('New worker hired!');
      emit(padMesh.position, FX.confetti, E.bigBurst);
      if (pad.type !== 'bay' && pad.type !== 'worker') look(padMesh.position, DIR.buildSec);
      celebrate({ bay: 'New charger open!', worker: 'Worker hired!', office: 'Manager hired!', accounting: 'Accountant hired! Tap 📊 for your books', coffee: 'Coffee drive-thru open!', depot: 'Mobile charging open!', wash: 'Car wash open!', tire: 'Tire shop open!', repair: 'Repair garage open!', tow: 'Tow truck ready!', solar: 'Solar field online!', lounge: 'VIP lounge open!', moto: 'Moto Park open! Scooters ride in to charge', mart: `Mini Mart open! Keep the shelf stocked with ${EX.mart.goods[STATION.id]}`, air: 'Air & Glass open! Take the tool to cars that ask', side: `${SIDES[pad.i]?.name} machine ready! Drivers now order it too` }[pad.type]);
      audio.play('buy');
      buzz();
      track.milestone(pad.type === 'bay' ? `bay${state.bays}` : pad.type);
      state.pad++;
      state.padPaid = 0;
      placePad();
      save();
      return;
    }
  }
  const pct = Math.round(state.padPaid / cost * 50) / 50, key = `${padLeft()}|${pct}`;
  if (key !== padKey) {
    padKey = key;
    padTile.userData.draw({ fill: GH.pad, done: GH.padFill, pct, amount: `$${padLeft()}`, ink: GH.ink, bill: COL.bill, billInk: COL.billInk });
  }
}

// Guide arrow shows the next step during the tutorial, then only affordable pads.
const arrow = new THREE.Mesh(new THREE.ConeGeometry(S.arrow.r, S.arrow.h), mat(COL.arrow));
arrow.rotation.x = Math.PI;
scene.add(arrow);
// Ground pointer at the owner's feet: during the tutorial, or whenever the next step is off screen, it points the way there.
const pointerShape = new THREE.Shape([[0, 0.55], [0.42, 0], [0.16, 0], [0.16, -0.4], [-0.16, -0.4], [-0.16, 0], [-0.42, 0]].map(([x, y]) => new THREE.Vector2(x, y)));
const pointer = new THREE.Mesh(new THREE.ShapeGeometry(pointerShape), new THREE.MeshBasicMaterial({ color: COL.arrow, transparent: true, depthWrite: false }));
pointer.geometry.rotateX(-Math.PI / 2);
pointer.renderOrder = 3;
scene.add(pointer);
const onScreen = (p) => { const v = p.clone().project(camera); return Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.85; };
// Next step as [position, tutorial text], or null when there is nothing to point at.
function goal() {
  // A blackout comes first: the arrow and the ground pointer lead to the generator.
  if (grid.out) return [grid.gen.position, 'Stand on the generator to restart it'];
  if (currentPad() && state.cash >= padLeft()) return [padMesh.position, 'Stand on the pad to build'];
  if (worker?.slack && !state.office) return [worker.g.position, 'Walk to your worker to wake them'];
  if (managerNeeded()) return [v3(ST.officeZone), 'Visit the manager'];
  const job = service.goal() ?? extras.goal();
  if (job) return job;
  if (state.served >= G.tutorialCars || STATION.level > 0) return nextStep();
  const toPlug = openBays().find((b) => b.car?.phase === 'plug');
  if (toPlug) return [toPlug.pos, 'Walk to the car to plug it in'];
  const order = openBays().find(ordering);
  if (player.carry > 0 && order) return [order.table.zone, `Bring the ${FOOD.word} to the hungry driver`];
  const cash = cashSpots().find((s) => s.cash > 0);
  if (cash) return [cash.cashPos, 'Pick up your cash'];
  if (order) return [cafe.pos, `Grab ${FOOD.word} at the counter`];
  return null;
}

// After the tutorial the arrow keeps pointing at the next thing to build; its name and price already sit in the bar under the cash.
function nextStep() {
  return currentPad() ? [padMesh.position, ''] : null;
}

// Big sums shorten to K and M (12.5K, 1.2M) so the cash counter keeps its width.
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : `${n}`);

// HUD and upgrade panel.
const $ = (id) => document.getElementById(id);
// iPhone Safari also zooms on a pinch whatever the viewport says; the game never wants page zoom.
document.addEventListener('gesturestart', (e) => e.preventDefault());
const hud = { rush: $('rush'), queue: $('queue'), queueText: $('queueText'), queueCars: document.querySelector('#queue .cars'), city: $('city'), cityHand: $('cityHand'), stageUpNote: $('stageUpNote'), stageUp: $('stageUp'), stageUpTitle: $('stageUpTitle'), stageUpIcon: $('stageUpIcon'), stageUpName: $('stageUpName'), manager: $('managerPanel'), managerRows: $('managerRows'), books: $('books'), booksBody: $('booksBody'), booksBtn: $('booksBtn'), deltas: $('deltas'), chainBox: $('chainBox'), stage: $('stage'), siren: $('siren'), ticket: $('ticket'), ticketTitle: $('ticketTitle'), ticketAmount: $('ticketAmount'), ticketNote: $('ticketNote'), jam: $('jam'), divert: $('divertBtn'), boosts: $('boosts'), map: $('map'), mapBig: $('mapBig'), mapPanel: $('mapPanel'), mapBadge: $('mapBadge'), mission: $('mission'), combo: $('combo'), rating: $('rating'), goalCard: $('goalCard'), goalName: $('goalName'), goalFill: $('goalFill'), cash: $('cash'), btn: $('upgBtn'), badge: $('badge'), progress: $('progress'), progressText: $('progressText'), panel: $('panel'), rows: $('rows'), toast: $('toast'), hint: $('hint') };

// Share of the level's unlocks and upgrade levels already bought.
const levelSteps = CONFIG.pads.length + Object.values(CONFIG.upgrades).reduce((n, u) => n + u.maxLevel, 0);
const progress = () => Math.min((Math.min(state.pad, CONFIG.pads.length) + Object.keys(CONFIG.upgrades).reduce((a, k) => a + state.levels[k], 0)) / levelSteps, 1);
// Upgrade lines on offer: the station's, plus the mobile service's once it is open.
const lines = () => Object.assign({ ...CONFIG.upgrades }, ...stageParts().map(([owned, group]) => (owned ? group : {})), extras.upgrades());
const maxed = (group) => Object.entries(group).every(([k, u]) => (state.levels[k] ?? 0) >= u.maxLevel);
const stage = () => {
  if (state.doneAt === null) return 1;
  const parts = stageParts(), i = parts.findIndex(([owned, group]) => !(owned && maxed(group)));
  return i === -1 ? parts.length + 1 : i + 2;
};
// Share of the current stage already built and upgraded.
function stageProgress() {
  if (stage() === 1) return progress();
  const [owned, group] = stageParts()[Math.min(stage(), stageParts().length + 1) - 2];
  const steps = 1 + Object.values(group).reduce((n, u) => n + u.maxLevel, 0);
  return ((owned ? 1 : 0) + Object.keys(group).reduce((n, k) => n + (state.levels[k] ?? 0), 0)) / steps;
}

// Current mini mission with goal and reward scaled by how many times the list has looped.
const M = CONFIG.missions;
function mission() {
  const m = M.list[state.mission.i % M.list.length], cycle = Math.floor(state.mission.i / M.list.length);
  const goal = m.type === 'combo' ? Math.min(Math.round(m.goal * M.goalScale ** cycle), E.comboMax) : Math.round(m.goal * M.goalScale ** cycle);
  return { ...m, goal, reward: Math.round(m.reward * M.rewardScale ** cycle * city.income) };
}
// Counts progress toward the active mission; combos count their best value, everything else adds up.
function count(type, value = 1) {
  const m = mission();
  if (m.type !== type) return;
  state.mission.progress = type === 'combo' ? Math.max(state.mission.progress, value) : state.mission.progress + value;
  if (state.mission.progress < m.goal) return;
  state.cash += m.reward;
  book('mission', m.reward);
  state.earned += m.reward;
  emit(player.g.position.clone().setY(S.carRoof), FX.gold, E.bigBurst);
  audio.play('buy');
  celebrate(`Mission complete! +$${m.reward}`);
  state.mission = { i: state.mission.i + 1, progress: 0 };
  track.milestone(`mission${state.mission.i}`);
}

// Decorations appear at progress thresholds so the station visibly grows.
const decorStages = buildDecorStages();
decorStages.forEach((g, i) => { g.visible = progress() >= CONFIG.decorAt[i]; scene.add(g); });
function updateDecor() {
  decorStages.forEach((g, i) => {
    if (g.visible || progress() < CONFIG.decorAt[i]) return;
    g.visible = true;
    pop(g);
    celebrate('Your station looks better!');
  });
}
let panelKey = '';
function renderPanel() {
  const key = `${state.cash}|${Object.values(state.levels)}`;
  if (hud.panel.hidden || key === panelKey) return;
  panelKey = key;
  // Buyable lines come first and glow, then the ones still too expensive, finished lines last.
  const rows = Object.entries(lines()).map(([k, u]) => {
    const lvl = state.levels[k], cost = upgradeCost(u.baseCost, lvl), maxed = lvl >= u.maxLevel, ready = !maxed && state.cash >= cost;
    return { order: ready ? 0 : maxed ? 2 : 1, html: `<div class="row ${ready ? 'ready' : maxed ? 'maxed' : ''}"><div><b>${u.name}</b><small>Lv ${lvl} / ${u.maxLevel}</small></div>
      <button data-k="${k}" ${ready ? '' : 'disabled'}>${maxed ? 'MAX' : `$${cost}`}</button></div>` };
  });
  hud.rows.innerHTML = rows.sort((a, b) => a.order - b.order).map((r) => r.html).join('');
  hud.rows.scrollTop = 0;
}
hud.btn.onclick = () => { hud.panel.hidden = !hud.panel.hidden; panelKey = ''; };
$('close').onclick = () => { hud.panel.hidden = true; };
// Buys the next level of upgrade line k; returns false when maxed or unaffordable.
// Every upgrade shows in the world: a burst where it works and its before → after over the owner, so money visibly buys something.
function showUpgrade(k, lvl) {
  const text = {
    tariff: `💲 $${chargeFee(lvl - 1)} → $${chargeFee(lvl)} per car`,
    capacity: `🍔 Tray ${capacity(lvl - 1)} → ${capacity(lvl)}`,
    speed: `⚡ Charge ${chargeTime(lvl - 1).toFixed(1)}s → ${chargeTime(lvl).toFixed(1)}s`,
  }[k] ?? `⬆️ ${lines()[k].name} ${lvl}`;
  floatText(player.g.position, text, COL.gain);
  const where = k === 'speed' || k === 'tariff' ? openBays().map((b) => b.charger) : [player.g];
  for (const o of where) { emit(o.getWorldPosition(new THREE.Vector3()).setY(1.2), FX.confetti); pop(o); }
}
function buy(k) {
  const u = lines()[k];
  if (!u || state.levels[k] >= u.maxLevel) return false;
  const cost = upgradeCost(u.baseCost, state.levels[k]);
  if (state.cash < cost) return false;
  state.cash -= cost;
  book('upgrade', cost);
  state.levels[k]++;
  extras.show();
  showUpgrade(k, state.levels[k]);
  track.milestone(`${k}${state.levels[k]}`);
  if (T.holdUpgrades.includes(k)) holdPolice(`${u.name} upgraded!`);
  audio.play('buy');
  buzz();
  save();
  return true;
}
hud.rows.onclick = (e) => buy(e.target.dataset?.k);
// Level ends when every pad is bought and every upgrade line is maxed.
const complete = () => !currentPad() && Object.entries(CONFIG.upgrades).every(([k, u]) => state.levels[k] >= u.maxLevel);
let doneShown = false;
function showDone() {
  doneShown = true;
  if (state.doneAt === null) { state.doneAt = Math.round(state.playSec); track.milestone('complete'); audio.play('complete'); celebrate(''); placePad(); save(); }
  const sec = state.doneAt;
  fillDone(sec);
}
// The result sheet: time, cars and money for a finished stage 1 or a finished city.
function fillDone(sec, title = 'Stage 1 Complete!', next = `Next: Stage 2 ${stageIcon(2)} ${stageName(2)}. Build it with your earnings.`) {
  $('doneTitle').textContent = title;
  // When the next station on Route 9 is open, a big Next button takes the player straight there; otherwise the map button may show.
  const after = CONFIG.stations[STATION.level + 1], go = after && unlocked(STATION.level + 1);
  $('nextStation').hidden = !go;
  if (go) { $('nextStation').textContent = `Next: ${after.icon} ${after.name} →`; $('nextStation').onclick = () => travel(after.id); }
  $('keepPlaying').textContent = go ? 'Stay here' : 'Continue';
  $('openChain').hidden = go || !CONFIG.stations.some((st, i) => i && unlocked(i));
  $('doneNext').textContent = next;
  $('doneTime').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  $('doneCars').textContent = state.served;
  $('doneEarned').textContent = `$${state.earned}`;
  $('done').hidden = false;
}
// The station is finished once the tow truck, its last stage, is built and maxed; the sheet says so once.
const cityComplete = () => state.doneAt !== null && stageParts().every(([owned, group]) => owned && maxed(group));
function showCityDone() {
  state.cityDone = Math.round(state.playSec);
  hud.stageUp.hidden = true;
  track.milestone('citydone');
  celebrate('');
  fillDone(state.cityDone, '🏁 Station Complete!', `All ${stageParts().length + 1} stages built. Keep serving to grow your earnings.`);
  save();
}
$('keepPlaying').onclick = () => { $('done').hidden = true; if (!state.cityDone) stageUp(2); };
// Starts a new run from the first city but keeps the player's settings; only the two-tap Reset in Settings calls it.
// Writes a clean save directly and reloads; the old world must not save its cash piles into the new run.
function resetRun() {
  resetting = true;
  // A deliberate reset drops the backup too, so the next start does not offer the old run back.
  try { localStorage.setItem(SV.key, JSON.stringify({ version: SV.version, active: STATION_IDS[0], stations: {}, settings: state.settings })); localStorage.removeItem(BACKUP); } catch { /* storage blocked */ }
  location.reload();
}

// Settings sheet: sound, vibration and a two-tap progress reset.
function renderSettings() {
  renderAlbum();
  $('soundBtn').textContent = state.settings.sound ? 'On' : 'Off';
  $('vibrateBtn').textContent = state.settings.vibrate ? 'On' : 'Off';
  $('qualityBtn').textContent = state.settings.quality ?? R.qualityDefault;
  $('shopNoAds').textContent = state.shop.noAds ? 'Owned ✓' : AD.shop.noAds.price;
  $('shopNoAds').disabled = state.shop.noAds;
  $('shopStarter').textContent = AD.shop.starter.price;
  $('shopStarterRow').hidden = state.shop.starter;
  $('privacyRow').hidden = !window.ChargeReadyAds?.privacyNeeded?.();
}
$('privacyBtn').onclick = () => window.ChargeReadyAds.privacy();
$('padAd').onclick = async () => {
  const left = padLeft();
  if (left && await ads.rewarded('pad')) { state.cash += left; book('bonus', left); audio.play('cash'); }
};
$('shopNoAds').onclick = () => ads.buy('noAds');
$('shopStarter').onclick = () => ads.buy('starter');
// Resolution steps through CONFIG.render.quality and applies at once.
$('qualityBtn').onclick = () => {
  const names = Object.keys(R.quality), now = state.settings.quality ?? R.qualityDefault;
  state.settings.quality = names[(names.indexOf(now) + 1) % names.length];
  pixelRatio = startRatio();
  renderer.setPixelRatio(pixelRatio);
  resize();
  renderSettings();
  save();
};
const toggle = (key) => () => { state.settings[key] = !state.settings[key]; renderSettings(); save(); };
$('soundBtn').onclick = toggle('sound');
$('vibrateBtn').onclick = toggle('vibrate');
$('settingsBtn').onclick = () => { renderSettings(); $('settings').hidden = false; };
$('settingsClose').onclick = () => { $('settings').hidden = true; disarmReset(); };

// Feedback: a 1-5 star rating and a comment, posted to the playtest form with where the player is in the game.
const FB = CONFIG.feedback;
let fbStars = 0;
$('stars').innerHTML = [1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" aria-label="${n} stars">⭐</button>`).join('');
const markStars = () => { [...$('stars').children].forEach((b) => b.classList.toggle('on', b.dataset.n <= fbStars)); $('feedbackSend').disabled = !fbStars; };
$('stars').onclick = (e) => { if (e.target.dataset.n) { fbStars = +e.target.dataset.n; markStars(); } };
function openFeedback() {
  $('settings').hidden = $('done').hidden = true;
  $('feedbackNote').textContent = '';
  $('feedback').hidden = false;
}
$('feedbackBtn').onclick = $('doneFeedback').onclick = openFeedback;
$('feedbackClose').onclick = () => { $('feedback').hidden = true; };
$('feedbackSend').onclick = async () => {
  const body = new FormData();
  body.append(FB.rating, fbStars);
  body.append(FB.comment, $('feedbackText').value.slice(0, FB.maxChars));
  body.append(FB.context, `${FB.build} · ${STATION.id} · ${$('progressText').textContent} · ${Math.round(state.playSec / 60)} min · ${innerWidth}x${innerHeight} · ${navigator.userAgent.match(/\(([^)]+)\)/)?.[1] ?? ''}`);
  $('feedbackSend').disabled = true;
  $('feedbackNote').textContent = 'Sending…';
  try {
    if (!BOT && !SIM) await fetch(FB.url, { method: 'POST', mode: 'no-cors', body });
    once('feedback');
    fbStars = 0; markStars(); $('feedbackText').value = '';
    $('feedbackNote').textContent = 'Thank you! 🙌';
    setTimeout(() => { $('feedback').hidden = true; }, 1200);
  } catch {
    $('feedbackNote').textContent = 'No connection. Try again when you are online.';
    $('feedbackSend').disabled = false;
  }
};
// Prototype test money: adds testCash to the wallet, booked as a bonus so the books stay true.
// Prototype test speed: each tap steps the game clock through CONFIG.testSpeeds (more updates per frame).
let testSpeed = 1;
const devTools = CONFIG.testHosts.includes(location.hostname) || params.has(CONFIG.testParam);
['testCash', 'testSpeed'].forEach((id) => { $(id).closest('.row').hidden = !devTools; });
$('testSpeed').onclick = (e) => { const S = CONFIG.testSpeeds; testSpeed = S[(S.indexOf(testSpeed) + 1) % S.length]; e.target.textContent = `×${testSpeed}`; };
$('testCash').onclick = () => { state.cash += CONFIG.testCash; book('bonus', CONFIG.testCash); audio.play('cash'); save(); };
// Reset needs a second, deliberate tap: a quick double tap does nothing, and the button disarms after a few seconds or when Settings closes.
let resetArmed = 0, resetTimer;
const disarmReset = () => { resetArmed = 0; clearTimeout(resetTimer); $('resetBtn').textContent = 'Reset'; };
// Owner outfit: the colour of the owner's clothes; each car in the album unlocks the next one.
function applyOutfit() {
  const color = CONFIG.outfits[state.settings.outfit ?? 0];
  ownMeshes.forEach((m) => { if (m.userData.outfit) { m.material.color.set(color); m.userData.ghost?.material.color.set(color); } });
}
$('outfitBtn').onclick = () => {
  const open = Math.min(CONFIG.outfits.length, state.album.length + 1);
  state.settings.outfit = ((state.settings.outfit ?? 0) + 1) % open;
  applyOutfit();
  pop(player.g);
  toast(open < CONFIG.outfits.length ? `👕 Outfit ${state.settings.outfit + 1}/${open}. Fill the car album to unlock more.` : `👕 Outfit ${state.settings.outfit + 1}/${open}`);
  save();
};
applyOutfit();

// Save code: the whole chain as text to keep or move to another device; Load takes a pasted code, checks it and restarts on it.
$('codeCopy').onclick = async () => {
  const code = btoa(unescape(encodeURIComponent(chainJson(state))));
  try { await navigator.clipboard.writeText(code); toast('💾 Save code copied. Keep it somewhere safe.'); }
  catch { Object.assign($('codeText'), { hidden: false, value: code }); $('codeText').select(); toast('💾 Copy the code from the box below.'); }
};
$('codeLoad').onclick = () => {
  const box = $('codeText');
  if (box.hidden || !box.value.trim()) { box.hidden = false; box.value = ''; box.focus(); return; }
  try {
    const saved = JSON.parse(decodeURIComponent(escape(atob(box.value.trim()))));
    if (typeof saved.stations !== 'object' || !saved.version) throw new Error('not a save');
    resetting = true;
    localStorage.setItem(SV.key, JSON.stringify(saved));
    location.reload();
  } catch { toast('❌ That code is not a Charge Ready save.'); }
};
// Share: the phone's share sheet with the station and stars, or the text copied where sharing is not available.
$('shareBtn').onclick = async () => {
  const stars = CONFIG.stations.map(starsOf).reduce((a, b) => a + b, 0), text = `My ${STATION.name} on Charge Ready has ${stars}⭐ and ${state.album.length} cars in the album. Can you beat it?`;
  track.milestone('share');
  try { if (navigator.share) return await navigator.share({ title: 'Charge Ready', text, url: CONFIG.shareUrl }); await navigator.clipboard.writeText(`${text} ${CONFIG.shareUrl}`); toast('📣 Copied! Paste it to a friend.'); } catch { /* share closed */ }
};
// Unstuck: the owner is set back at the start spot, whatever wall or corner held them.
$('unstuckBtn').onclick = () => {
  player.g.position.copy(v3(W.playerSpawn));
  pop(player.g);
  $('settingsClose').onclick();
  track.milestone('unstuck');
};
$('resetBtn').onclick = () => {
  const since = performance.now() - resetArmed;
  if (resetArmed && since > CONFIG.resetTap.minMs) return resetRun();
  if (resetArmed) return;
  resetArmed = performance.now();
  $('resetBtn').textContent = 'Tap again to reset';
  resetTimer = setTimeout(disarmReset, CONFIG.resetTap.armMs);
};

// Draws the mobile map at the canvas's CSS size and the screen's pixel density.
function drawMapCanvas(canvas, big) {
  const size = canvas.clientWidth, dpr = Math.min(devicePixelRatio, R.maxPixelRatio);
  if (canvas.width !== size * dpr || canvas.height !== size * dpr) canvas.width = canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mobile.drawMap(ctx, size, clock.elapsedTime, big);
}
$('map').onclick = () => { hud.mapPanel.hidden = false; };
// Books sheet: income and expenses by kind, net profit, last minute's pace and the latest boost decisions.
const LABELS = { charge: 'Charging', idle: 'Idle fees', meal: FOOD.word[0].toUpperCase() + FOOD.word.slice(1), tip: 'VIP tips', coffee: 'Coffee', mobile: 'Mobile rescues', wash: 'Car washes', tire: 'Tire swaps', repair: 'Repairs', tow: 'Tow fees', moto: 'Moto Park', mart: 'Mini Mart', air: 'Air & Glass', chain: 'Other stations', mission: 'Missions', bonus: 'Bonuses', build: 'Buildings', upgrade: 'Upgrades', boost: 'Boosts', fine: 'Police fines', fuel: 'Van fuel' };
const money = (v) => `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v))}`;
function renderBooks() {
  if (hud.books.hidden) return;
  const rows = (kinds, sign) => kinds.filter((k) => state.ledger[k]).map((k) => `<div class="row"><span>${LABELS[k]}</span><b class="${sign}">${sign === 'loss' ? '-' : '+'}$${state.ledger[k]}</b></div>`).join('');
  const net = total(INCOME) - total(EXPENSE), pace = (perSec(INCOME) - perSec(EXPENSE)) * 60;
  hud.booksBody.innerHTML = `<h3>Income</h3>${rows(INCOME, 'gain')}<h3>Expenses</h3>${rows(EXPENSE, 'loss')}
    <div class="row net"><span>Net profit</span><b class="${net < 0 ? 'loss' : 'gain'}">${money(net)}</b></div>
    <div class="row"><span>Last minute</span><b class="${pace < 0 ? 'loss' : 'gain'}">${money(pace)}/min</b></div>
    ${decisions.length ? `<h3>Your orders</h3>${decisions.map((d) => `<div class="row"><span>${d.value === null || d.value > d.cost ? '✅' : '⚠️'} ${d.name}</span><small>${d.value === null ? '' : `earns ~$${d.value} · `}costs $${d.cost}</small></div>`).join('')}` : ''}`;
}
hud.managerRows.onclick = async (e) => { const t = e.target.closest('button'); if (t?.dataset.boostAd) { if (await ads.rewarded('boost')) orderBoost(t.dataset.boostAd, true); } else if (t?.dataset.boost) orderBoost(t.dataset.boost); else if (t && 'wake' in t.dataset) orderWake(); };
$('managerClose').onclick = () => { hud.manager.hidden = true; };
hud.booksBtn.onclick = () => { hud.books.hidden = false; renderBooks(); };
$('booksClose').onclick = () => { hud.books.hidden = true; };

// Vans charge queued cars on the spot, so those drivers leave and the queue shrinks.
hud.divert.onclick = () => {
  const n = mobile.divert(queue.length);
  queue.slice(queue.length - n).forEach((car) => { turnAway(car); rate(E.ratingScores.fed); });
  if (n) { audio.play('plug'); once('divert'); holdPolice('Vans are charging the queue!'); }
};
$('mapClose').onclick = () => { hud.mapPanel.hidden = true; };
$('mapBig').onclick = (e) => {
  const r = hud.mapBig.getBoundingClientRect();
  if (mobile.tap(e.clientX - r.left, e.clientY - r.top, r.width)) audio.play('plug');
};

// One message at a time: new banners wait in a short queue, duplicates are dropped and nothing shows over the police ticket.
const toasts = [];
let toastTimer = 0;
function toast(text, ms = F.toastMs) {
  if (hud.toast.textContent === text && !hud.toast.hidden) return;
  if (toasts.some((t) => t.text === text)) return;
  toasts.push({ text, ms });
  if (toasts.length > F.toastQueue) toasts.shift();
  if (hud.toast.hidden) nextToast();
}
function nextToast() {
  clearTimeout(toastTimer);
  hud.toast.hidden = true;
  if (!hud.ticket.hidden) { toastTimer = setTimeout(nextToast, F.toastGapMs); return; }
  const t = toasts.shift();
  if (!t) return;
  hud.toast.textContent = t.text;
  hud.toast.hidden = false;
  hud.toast.animate([{ transform: 'translateY(-12px)', opacity: 0 }, { transform: 'none', opacity: 1 }], 180);
  toastTimer = setTimeout(nextToast, t.ms);
}
hud.toast.onclick = nextToast;

// Coins fly from a world spot to the cash counter so every pickup is felt on the HUD.
function flyCoins(at, amount) {
  if (BOT) return;
  const v = at.clone().setY(S.carRoof).project(camera), to = hud.cash.getBoundingClientRect();
  const x = (v.x + 1) / 2 * renderer.domElement.clientWidth, y = (1 - v.y) / 2 * renderer.domElement.clientHeight;
  for (let i = 0; i < Math.min(Math.ceil(amount / G.cashPerBill), F.maxCoins); i++) {
    const c = document.createElement('i');
    c.className = 'coin';
    document.body.appendChild(c);
    const dx = (Math.random() - 0.5) * 60, dy = (Math.random() - 0.5) * 60;
    c.animate([{ transform: `translate(${x}px, ${y}px) scale(1)` }, { transform: `translate(${x + dx}px, ${y + dy}px) scale(1.4)`, offset: 0.25 }, { transform: `translate(${to.left + 20}px, ${to.top + to.height / 2}px) scale(0.6)` }],
      { duration: F.coinMs, delay: i * F.coinStaggerMs, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'both' }).onfinish = () => c.remove();
  }
}
// Every change of cash shows as one green "+$" or red "-$" chip rising off the counter, with a glow or a shake.
let lastCash = state.cash, pendingDelta = 0, deltaAt = 0;
function showCashDelta() {
  pendingDelta += state.cash - lastCash;
  lastCash = state.cash;
  if (!pendingDelta || clock.elapsedTime - deltaAt < F.deltaGapSec) return;
  const gain = pendingDelta > 0, chip = document.createElement('b');
  chip.className = `delta ${gain ? 'gain' : 'loss'}`;
  chip.textContent = `${gain ? '+' : '-'}$${Math.abs(pendingDelta)}`;
  hud.deltas.replaceChildren(chip);
  chip.animate([{ transform: 'scale(1.4)', opacity: 1 }, { transform: 'scale(1)', opacity: 1, offset: 0.2 }, { transform: 'scale(1)', opacity: 1, offset: 0.7 }, { transform: 'translateY(-16px)', opacity: 0 }], { duration: F.deltaMs, easing: 'ease-out' }).onfinish = () => chip.remove();
  hud.cash.animate(gain ? [{ boxShadow: `0 4px 0 ${COL.labelStroke}, 0 0 0 6px ${COL.gain}` }, { boxShadow: `0 4px 0 ${COL.labelStroke}` }] : [{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], F.bumpMs * 2);
  pendingDelta = 0;
  deltaAt = clock.elapsedTime;
}

// Stage-up card: the new stage's icon and name stamp in the middle of the screen with confetti and a fanfare.
function stageUp(n, title = `STAGE ${n}`, icon = stageIcon(n), name = stageName(n), note = 'Unlocked! Build it with your earnings', kind = '') {
  hud.stageUp.className = kind;
  hud.stageUpNote.textContent = note;
  hud.stageUpTitle.textContent = title;
  hud.stageUpIcon.textContent = icon;
  hud.stageUpName.textContent = name;
  hud.stageUp.hidden = false;
  hud.stageUp.animate([{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)' }], { duration: 500, easing: 'ease-out' });
  emit(player.g.position.clone().setY(S.carRoof), FX.confetti, E.bigBurst * 2);
  audio.play('complete');
  shakeLeft = E.shakeSec;
  clearTimeout(hud.stageUp.timer);
  hud.stageUp.timer = setTimeout(() => { hud.stageUp.hidden = true; adBreak(); }, F.stageUpMs);
}
// After a stage card: the one-time starter offer once the player has played a while, otherwise a break ad after the first minutes.
async function adBreak() {
  if (state.playSec >= AD.starterAfterSec && await ads.offerStarter()) return;
  if (STATION.id !== 'town' || state.playSec >= AD.firstSec) ads.breakAd();
}

// Big moments shake the camera and show a short banner.
let shakeLeft = 0;
function celebrate(text) {
  shakeLeft = E.shakeSec;
  if (text) toast(text, E.bannerMs);
}

// Cheapest thing left to buy, shown as a progress card so the next goal always feels close.
function nextGoal() {
  const pad = currentPad();
  const options = Object.entries(lines()).filter(([k, u]) => state.levels[k] < u.maxLevel)
    .map(([k, u]) => ({ name: `${u.name} ${state.levels[k] + 1}`, cost: upgradeCost(u.baseCost, state.levels[k]) }));
  if (pad) options.push({ name: pad.type === 'side' ? `${SIDES[pad.i].name} Machine` : PAD_NAMES[pad.type], cost: padLeft() });
  return options.sort((a, b) => a.cost - b.cost)[0];
}

// Station chain: stars from each station's saved build, the star bonus, what the other stations earn, the map and travel.
const CH = CONFIG.chain;
const blockOf = (id) => (id === chain.active ? state : chain.stations[id]);
const GROUP = { solar: AP.solar.upgrades, lounge: AP.lounge.upgrades, coffee: CF.upgrades, depot: CONFIG.mobile.upgrades, wash: CONFIG.wash.upgrades, ...SVC.upgrades };
const HAS = { solar: (b) => Boolean(b.airport?.solar), lounge: (b) => Boolean(b.airport?.lounge), coffee: (b) => b.coffee, depot: (b) => Boolean(b.mobile), wash: (b) => Boolean(b.wash), ...Object.fromEntries(['tire', 'repair', 'tow'].map((k) => [k, (b) => Boolean(b.service?.[k])])) };
// One star when every stage is open, two when every upgrade is maxed, three after topSec at a top rating.
function starsOf(st) {
  const b = blockOf(st.id);
  if (!b || b.doneAt == null || !st.stages.every((k) => HAS[k](b))) return 0;
  const full = [CONFIG.upgrades, ...st.stages.map((k) => GROUP[k])].every((g) => Object.entries(g).every(([k, u]) => (b.levels?.[k] ?? 0) >= u.maxLevel));
  return !full ? 1 : (b.topSec ?? 0) >= CH.topSec ? 3 : 2;
}
const unlocked = (i) => i === 0 || starsOf(CONFIG.stations[i - 1]) >= 1;
const starTotal = () => CONFIG.stations.reduce((a, st) => a + starsOf(st), 0);
// Income per second of a station on its own: measured live for the played one, as last saved for the others.
const rateOf = (st) => (st.id === chain.active ? perSec(RATE_KINDS) : blockOf(st.id)?.rate ?? 0);
let stars = starTotal(), chainTick = 0;
setCity(STATION.level, stars * CH.starBonus);
// Once a second: the other stations pay in at the offline share, stars and the new-station badge are checked.
function updateChain(dt) {
  const others = CONFIG.stations.filter((st) => st.id !== chain.active).reduce((a, st) => a + rateOf(st), 0) * CONFIG.economy.offlineShare;
  // The box fills like offline earnings and stops at the same cap.
  state.chainBox = Math.min(state.chainBox + dt * others, Math.max(state.chainBox, others * CONFIG.economy.offlineCapSec));
  if ((chainTick += dt) < 1) return;
  chainTick = 0;
  renderChainBox();
  if (starsOf(STATION) >= 2 && rating() >= CH.topRating) state.topSec += 1;
  updateGoals();
  if (goalsOpen) renderGoals();
  const now = starTotal(), newOpen = CONFIG.stations.some((st, i) => unlocked(i) && !chain.stations[st.id] && st.id !== chain.active);
  hud.city.classList.toggle('new', newOpen);
  hud.cityHand.hidden = !newOpen;
  if (newOpen) hud.cityHand.style.right = `${hud.city.parentElement.getBoundingClientRect().right - hud.city.getBoundingClientRect().left + 2}px`;
  // A newly unlocked station gets its own purple banner once, and the hand keeps pointing at the station name until the player goes there.
  const ready = CONFIG.stations.find((st, i) => unlocked(i) && !chain.stations[st.id] && st.id !== chain.active);
  if (ready && !state.seen[`ready_${ready.id}`]) {
    once(`ready_${ready.id}`);
    stageUp(0, 'NEW STATION READY', ready.icon, ready.name, '👉 Tap the purple station name at the top to travel', 'station');
  }
  if (now === stars) return;
  if (now > stars) {
    celebrate(`⭐ New star! +${Math.round(CH.starBonus * 100)}% income at every station`);
    if (starsOf(STATION) === 3) rosa(STORY.star3);
  }
  stars = now;
  setCity(STATION.level, stars * CH.starBonus);
  hud.stage.dataset.n = '';
  // The chain's big goal: a star at every station.
  if (CONFIG.stations.every((st) => starsOf(st) >= 1) && !state.seen.chainDone) {
    once('chainDone');
    fillDone(Math.round(state.playSec), '🏆 Charging Chain Complete!', `👵 Rosa: ${STORY.end} Every station has its star. Keep growing for three stars everywhere.`);
  }
}
// Money from the other stations waits in a box under the counter until tapped, so the counter never ticks up by itself.
function renderChainBox() {
  const box = Math.floor(state.chainBox);
  hud.chainBox.hidden = box < 1;
  hud.chainBox.textContent = `🔗 +$${box}`;
}
hud.chainBox.onclick = () => {
  const pay = Math.floor(state.chainBox);
  if (pay < 1) return;
  state.chainBox -= pay;
  state.cash += pay;
  book('chain', pay);
  audio.play('cash');
  renderChainBox();
  save();
};
function openChainMap() {
  const total = CONFIG.stations.reduce((a, st) => a + rateOf(st), 0);
  const done = CONFIG.stations.filter((st) => starsOf(st) >= 1).length;
  $('chainTotal').textContent = `🏆 Goal: a ⭐ at every station (${done}/${CONFIG.stations.length}) · Your stations earn about $${Math.round(total * 60)}/min · ⭐${stars} = +${Math.round(stars * CH.starBonus * 100)}% income`;
  // Later stations sit higher on the road, so the chain reads as growing upward.
  $('chainRows').innerHTML = CONFIG.stations.map((st, i) => [st, i]).reverse().map(([st, i]) => {
    const here = st.id === chain.active, open = unlocked(i), s = starsOf(st);
    const rate = blockOf(st.id) ? `<span class="rate">+$${Math.round(rateOf(st) * 60)}/min</span>` : '';
    const action = here ? '<small>▶ You are here</small>' : open ? `<button data-go="${st.id}">Go ▶</button>` : `<small>🔒 Needs ⭐1 at ${CONFIG.stations[i - 1].name}</small>`;
    return `<div class="node ${here ? 'here' : open ? '' : 'locked'}"><b>${st.icon} ${st.name}</b>${rate}<span class="stars">${'★'.repeat(s)}<i>${'★'.repeat(3 - s)}</i></span><small>${st.note}</small>${action}</div>`;
  }).join('');
  $('chain').hidden = false;
}
// Travel saves both stations and reloads into the other one; a first visit tops the wallet up to the station's grant.
function travel(id) {
  save();
  resetting = true;
  const st = CONFIG.stations.find((s) => s.id === id), first = !chain.stations[id];
  const cash = first ? Math.max(state.cash, Math.round(CH.grant * CONFIG.economy.costMultiplier ** st.level)) : state.cash;
  const stations = { ...chain.stations, [chain.active]: omit(state, [...GLOBAL, 'version']), [id]: chain.stations[id] ?? { cityIntro: true } };
  try { localStorage.setItem(SV.key, JSON.stringify({ ...pick(state, GLOBAL), cash, savedAt: Date.now(), version: SV.version, active: id, stations })); } catch { /* storage blocked */ }
  track.milestone(`travel_${id}`);
  $('chain').hidden = true;
  // The car drives along Route 9 from this station's stop to the next one, then the new station loads and greets the player.
  const n = CONFIG.stations.length, x = (s) => 10 + CONFIG.stations.indexOf(s) * 80 / (n - 1), here = x(STATION), there = x(st);
  $('travel').innerHTML = `<div class="trip"><div class="road"></div>${CONFIG.stations.map((s) => `<span class="stop" style="left:${x(s)}%">${s.icon}</span>`).join('')}<span class="car${there > here ? ' right' : ''}">🚗</span></div><p>Driving to ${st.icon} ${st.name}…</p>`;
  $('travel').hidden = false;
  $('travel').querySelector('.car').animate([{ left: `${here}%` }, { left: `${there}%` }], { duration: CH.travelMs * 0.85, easing: 'ease-in-out', fill: 'forwards' });
  try { sessionStorage.setItem('arrive', `${st.icon} Welcome to ${st.name}`); } catch { /* storage blocked */ }
  if (!BOT) setTimeout(() => location.reload(), CH.travelMs);
}
hud.city.onclick = openChainMap;
hud.mission.onclick = () => { goalsOpen = !goalsOpen; $('goals').hidden = !goalsOpen; if (goalsOpen) renderGoals(); };
$('goalsClose').onclick = () => { goalsOpen = false; $('goals').hidden = true; };
// One-time note for players whose tire shop, garage and tow truck moved to the highway.
function showNotice() {
  if (state.notice !== 'moved' || chain.active === 'highway') return;
  $('notice').hidden = false;
  const done = () => { $('notice').hidden = true; delete state.notice; save(); };
  $('noticeGo').onclick = () => { done(); travel('highway'); };
  $('noticeLater').onclick = done;
}
$('rushDouble').onclick = async () => { if (!(await ads.rewarded('rush'))) return; rush.boost = true; $('rushDouble').hidden = true; track.milestone('rush2x'); };
$('chainClose').onclick = () => { $('chain').hidden = true; };
$('chainRows').onclick = (e) => { if (e.target.dataset.go) travel(e.target.dataset.go); };
$('openChain').onclick = () => { $('done').hidden = true; openChainMap(); };

// Restore world from save and pay offline earnings.
bays.forEach((b, i) => { b.group.visible = i < state.bays; b.cash = state.bayCash[i] ?? 0; b.table.cash = state.tableCash[i] ?? 0; });
if (state.worker) hireWorker();
if (state.office) openOffice();
if (state.accounting) openAccounting();
if (state.coffee) openCoffee();
mobile.show();
wash.show();
service.show();
extras.show();
airport.show();
showSides();
placePad();
// Every station earns while the player is away, each from its own measured rate; a played station without one uses the old estimate (one charge a minute per bay).
const awaySec = (Date.now() - state.savedAt) / 1000;
const awayRows = CONFIG.stations.filter((st) => blockOf(st.id)).map((st) => [`${st.icon} ${st.name}`, offlineEarnings(awaySec, blockOf(st.id).rate ?? (st.id === chain.active ? state.bays * chargeFee(state.levels.tariff) / CONFIG.economy.offlineSecPerCar : 0))]).filter(([, v]) => v > 0);
const earned = awayRows.reduce((a, [, v]) => a + v, 0);

// Arriving from another station: the travel card says welcome and fades away over the new station.
let arrive = null;
try { arrive = sessionStorage.getItem('arrive'); sessionStorage.removeItem('arrive'); } catch { /* storage blocked */ }
if (arrive && !BOT) {
  $('travel').innerHTML = `<p>${arrive}</p>`;
  $('travel').hidden = false;
  $('travel').animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], CH.arriveMs).onfinish = () => { $('travel').hidden = true; };
}

// Opening: logo letters drop one by one with a bolt flash, while the camera swoops in; Tap to Play shows once it lands.
const OP = CONFIG.opening;
let swoop = BOT || SIM ? 1 : 0, opening = BOT || SIM;
function playOpening() {
  const words = 'Charge Ready'.split(' ').map((w) => [...w].map((ch) => `<span>${ch}</span>`).join(''));
  $('logo').innerHTML = `<b>${words[0]}</b><b><span class="bolt">⚡</span>${words[1]}</b>`;
  const letters = $('logo').querySelectorAll('span');
  letters.forEach((el, k) => {
    const bolt = el.classList.contains('bolt');
    el.animate(bolt ? [{ transform: 'scale(0) rotate(-40deg)', opacity: 0 }, { transform: 'scale(1.6)', opacity: 1, filter: 'brightness(3)', offset: 0.6 }, { transform: 'scale(1)' }]
      : [{ transform: 'translateY(-120vh)' }, { transform: 'translateY(8px) scaleY(0.8)', offset: 0.75 }, { transform: 'none' }],
    { duration: OP.dropMs, delay: bolt ? OP.boltMs : k * OP.letterMs, easing: 'ease-in', fill: 'backwards' });
  });
  setTimeout(() => $('start').classList.add('ready'), OP.swoopMs);
}

// Title screen; the first tap also unlocks audio.
let started = BOT;
$('start').hidden = BOT;
// The loading intro hands over to the opening once the world is built; tests skip both.
const startOpening = () => { opening = true; playOpening(); };
// Shaders are built while the bar still shows, so the full charge and the fade play smoothly.
if (!BOT && !SIM && window.boot) { window.boot.progress(0.95); renderer.compile(scene, camera); }
if (!BOT && !SIM) window.boot ? window.boot.done(startOpening) : startOpening();
else document.getElementById('boot')?.remove();
$('startBtn').onclick = () => {
  started = true;
  swoop = 1;
  $('start').hidden = true;
  audio.unlock();
  audio.play('complete');
  // A new city opens with its own welcome card.
  if (state.cityIntro) { state.cityIntro = false; stageUp(1, 'NEW STATION', STATION.icon, STATION.name, `👵 ${STORY.open[STATION.id] ?? 'Your other stations keep earning.'}`); }
  // Daily return streak: each consecutive day back pays a growing bonus, capped at maxDays.
  const day = (d) => d.toLocaleDateString('en-CA'), today = day(new Date()), yesterday = day(new Date(Date.now() - 864e5));
  const rows = [...awayRows];
  if (state.daily.last && state.daily.last !== today) {
    state.daily.streak = state.daily.last === yesterday ? state.daily.streak + 1 : 1;
    rows.push([`🔥 Day ${state.daily.streak} streak`, CONFIG.daily.base * Math.min(state.daily.streak, CONFIG.daily.maxDays)]);
    once(`day${Math.min(state.daily.streak, CONFIG.daily.maxDays)}`);
  }
  state.daily.last = today;
  if (rows.length) showWelcome(rows, earned);
  showNotice();
  offerRestore();
  save();
};
// Welcome-back card: the player collects the away earnings and streak bonus; ×2 doubles the away part (a rewarded ad in the publisher build).
function showWelcome(rows, away) {
  const sum = rows.reduce((a, [, v]) => a + v, 0), h = Math.floor(Math.min(awaySec, CONFIG.economy.offlineCapSec) / 3600), m = Math.floor(Math.min(awaySec, CONFIG.economy.offlineCapSec) % 3600 / 60);
  $('welcomeAway').textContent = away > 0 ? `Your station${awayRows.length > 1 ? 's' : ''} worked ${h ? `${h} h ` : ''}${m} min while you were away (max 2 h)` : 'Thanks for coming back today';
  $('welcomeAmount').textContent = `+$${sum}`;
  $('welcomeRows').innerHTML = rows.map(([name, v]) => `<div><span>${name}</span><b>$${v}</b></div>`).join('');
  $('welcomeDouble').hidden = away <= 0;
  $('welcome').hidden = false;
  const collect = (extra) => {
    $('welcome').hidden = true;
    state.cash += sum + extra;
    book('bonus', sum + extra);
    flyCoins(player.g.position, sum + extra);
    audio.play('cash');
    track.milestone(extra ? 'welcome2x' : 'welcome');
    save();
  };
  $('welcomeCollect').onclick = () => collect(0);
  $('welcomeDouble').onclick = async () => { if (await ads.rewarded('welcome')) collect(away); };
}
save();
setInterval(save, SV.intervalMs);
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

const readInput = createInput([renderer.domElement, hud.toast], CONFIG.joystick.radius, CONFIG.joystick);
// A tap (not a drag) on a parked van sends it to the nearest stranded EV.
const ray = new THREE.Raycaster(), tapAt = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || !(mobile.owned() || service.owned('tow')) || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > CONFIG.joystick.tapSlop) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(tapAt.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
  // A tapped tow truck drives out to a breakdown call.
  const truck = ray.intersectObjects(service.truckMeshes(), true)[0];
  if (truck) {
    let o = truck.object;
    while (o.userData.truck === undefined) o = o.parent;
    if (service.tapTruck(o.userData.truck)) { audio.play('plug'); emit(o.position.clone().setY(1), FX.spark); }
    else toast('No breakdown call right now');
    return;
  }
  const hit = ray.intersectObjects(mobile.vanMeshes.filter((m) => m.visible), true)[0];
  if (!hit) return;
  let o = hit.object;
  while (o.userData.van === undefined) o = o.parent;
  if (mobile.tapVan(o.userData.van)) { audio.play('plug'); emit(o.position.clone().setY(1), FX.spark); once('vantap'); }
  else toast('No stranded EV is waiting right now');
});
// Drops render resolution step by step while the frame rate stays under minFps, so slower phones keep up.
let pixelRatio = startRatio(), windowFrames = 0, windowSec = 0;
let goodSec = 0;
function adaptQuality(raw) {
  if (fixedRatio()) return;
  windowFrames++;
  windowSec += raw;
  if (windowSec < R.qualityWindowSec) return;
  const fps = windowFrames / windowSec, top = Math.min(devicePixelRatio, R.maxPixelRatio);
  goodSec = fps >= R.upFps ? goodSec + windowSec : 0;
  // Down a step on a slow window, back up a step after a long smooth stretch, so a short hitch never leaves the picture blurry.
  const next = fps < R.minFps ? Math.max(pixelRatio - R.pixelRatioStep, R.minPixelRatio) : goodSec >= R.upSec ? Math.min(pixelRatio + R.pixelRatioStep, top) : pixelRatio;
  if (next !== pixelRatio) {
    if (next < pixelRatio) once('lowfps');
    pixelRatio = next;
    goodSec = 0;
    renderer.setPixelRatio(pixelRatio);
    resize();
  }
  windowFrames = 0;
  windowSec = 0;
}

// Camera centre for the player's x: past either end of cameraX it leans further, so at the lot's edge the scenery out to W.viewLeft or W.viewRight is on screen.
function camX(px) {
  const half = new THREE.Vector3(...W.cameraOffset).length() * zoom * camZoom * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect;
  const [a0, a1] = W.cameraX, [b0, b1] = W.bounds;
  // The lean stops where the player would leave the screen, keeping edgeView.keep units between them and its edge.
  const keep = half - W.edgeView.keep;
  if (px > a1) return a1 + (Math.min(px, b1) - a1) * (Math.max(a1, Math.min(W.viewRight - half, b1 + keep)) - a1) / (b1 - a1);
  if (px < a0) return a0 + (Math.max(px, b0) - a0) * (Math.min(a0, Math.max(W.viewLeft + half, b0 - keep)) - a0) / (b0 - a0);
  return px;
}
// 0 inside the lot, rising to 1 as the player reaches its left, right or top edge, where the camera pulls back to show the surroundings.
function edgeNear() {
  const { x, z } = player.g.position, [b0, b1, top] = W.bounds, band = W.edgeView.band;
  return Math.max(0, ...[x - b0, b1 - x, z - top].map((d) => 1 - d / band));
}
// Narrower screens than the tuned phone pull the camera back so the whole station width stays visible.
let zoom = 1;
// CSS keeps the canvas full screen; only the drawing buffer follows the measured size, so a stale size on iOS never shrinks the view.
function resize() {
  const w = document.documentElement.clientWidth || innerWidth, h = document.documentElement.clientHeight || innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const FR = CONFIG.frame, base = 2 * new THREE.Vector3(...W.cameraOffset).length() * Math.tan(THREE.MathUtils.degToRad(R.fov) / 2);
  zoom = Math.max(FR.minH, FR.minW / camera.aspect, h / FR.unitPx) / base;
  // Point sprites keep their world size at any resolution.
  particleCloud.material.uniforms.scale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}
addEventListener('resize', resize);
['orientationchange', 'pageshow'].forEach((e) => addEventListener(e, () => setTimeout(resize, 300)));
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(resize, 300); });
resize();

let shownCash = state.cash, moved = false, shownStage = stage(), stillSec = 0, eye = 0;
// Any touch on the screen, a tap or a button, brings the play view back from the own-eye view.
addEventListener('pointerdown', () => { stillSec = 0; }, true);
const clock = new THREE.Clock();

// Advances the simulation by dt with joystick vector `move`.
// Income watch: a long stretch with no money while cars wait points the player to Unstuck, once per session.
let stallT = 0, stallEarned = 0, stallHinted = false;
function watchStall(dt) {
  stallT = state.earned > stallEarned ? 0 : stallT + dt;
  stallEarned = state.earned;
  if (stallT < CONFIG.rescue.stallSec || stallHinted || !openBays().some((b) => b.car)) return;
  stallHinted = true;
  rosa('No cash for a while? ⚙️ Settings → Unstuck puts you back at the counter.');
}
function update(dt, move) {
  state.playSec += dt;
  watchStall(dt);
  if ((comboLeft -= dt) <= 0) combo = 0;
  shakeLeft = Math.max(shakeLeft - dt, 0);
  if (!doneShown && complete()) showDone();
  if (!state.cityDone && cityComplete()) showCityDone();
  // Moving up to a new stage is a big moment: banner, confetti and the stage's pad.
  if (stage() !== shownStage) {
    shownStage = stage();
    if (shownStage >= 3) { stageUp(shownStage); placePad(); track.milestone(`stage${shownStage}`); }
  }
  player.pace = 0;
  stillSec = move.x || move.y ? 0 : stillSec + dt;
  if (move.x || move.y) {
    step(player, move.x, move.y, G.playerSpeed * boosted('speed'), dt);
    // Rosa's welcome waits for the first step, so the opening screen only teaches the drag.
    if (!moved && !state.seen.rosaStart) { once('rosaStart'); rosa(STORY.start); }
    moved = true;
  }

  produce(dt);
  produceSides(dt);
  // Working on a spot (plugging in, picking up, serving) counts as busy, so the own-eye view waits for real idling.
  const busyFrom = player.timer;
  interact(player, dt);
  if (player.timer !== busyFrom) stillSec = 0;
  // A car pulling into the spot where the owner stands eases them aside instead of swallowing them.
  const clear = player.g.position.clone();
  solidPush(clear);
  player.g.position.lerp(clear, Math.min(dt * G.nudgeRate, 1));
  openBays().forEach((b) => updateBay(b, dt));
  cashSpots().forEach((s) => {
    if (s.cash > 0 && inside(player.g.position, s.zone, s.size ?? (s.table ? touchBay(Z.bay.size) : S.table.zone))) {
      s.bills.forEach((m, i) => fly(billGeo, billMat, m.getWorldPosition(new THREE.Vector3()), () => stackTop(player), null, i * F.cashStagger));
      flyCoins(player.g.position, s.cash);
      state.cash += s.cash;
      s.cash = 0;
      audio.play('cash');
      emit(player.g.position.clone().setY(S.carRoof), FX.gold);
    }
    syncStack(s.bills, Math.min(Math.ceil(s.cash / G.cashPerBill), G.maxBills), scene, [s.cashPos.x, S.bill[1] / 2, s.cashPos.z], billGeo, billMat);
  });
  updatePad(dt);
  updateStaff(dt);

  syncStack(cafe.stack, cafe.stock, cafeTop, [0, S.meal.h / 2, -S.meal.gap / 2], mealGeo, mealMat, S.meal.cols);
  syncStack(profitStack, state.accounting ? THREE.MathUtils.clamp(Math.floor((total(INCOME) - total(EXPENSE)) / AC.stackPer), 0, AC.maxStack) : 0, profitTop, [0, S.bill[1] / 2, 0], billGeo, billMat);
  syncStack(kiosk.stack, state.coffee ? kiosk.stock : 0, kioskTop, [0, CF.cup.h / 2, 0], cupGeo, cupMat, 3);
  [player, worker, temp, manager].filter(Boolean).forEach((a) => stepPerson(a.g, a.pace, dt, a === player && eye > 0.5 && a.stack.length > 0));
  [player, worker, temp].filter(Boolean).forEach((a) => {
    syncItems(a);
    a.lean += (-F.leanMax * a.pace - a.lean) * Math.min(dt * F.leanRate, 1);
    a.stackRoot.rotation.x = a.lean;
  });
  updateFlights(dt);
  updatePops(dt);
  updateParticles(dt);
  updateDecor();
  mobile.update(dt);
  wash.update(dt);
  service.update(dt);
  extras.update(dt);
  airport.update(dt);
  if (combo >= FX.trail.minCombo) maybeEmit(player.g.position.clone().setY(S.carRoof / 4), FX.trail, dt);
  if (cafe.stock > 0) maybeEmit(cafeTop.getWorldPosition(new THREE.Vector3()), FX.steam, dt);
  updateTraffic(dt);
  updateQueue(dt);
  updatePolice(dt);
  updateRival(dt);
  updateConvoy();
  updateStorm(dt);
  updateBlackout(dt);
  updateCoffee(dt);
  pave();
  updateGhosts();
  updateVipBills(dt);
  updateRush(dt);
  updateBus(dt);
  if (combo >= CHN.busCombo) bays.forEach((b) => { if (b.car?.bus) b.car.comboHit = true; });
  updateChain(dt);
  // MAX shows when the tray is full, and at a side machine when the hands are full of sides.
  maxTag.visible = mains(player) >= capOf(player) || (!sideRoom(player) && machines.some((m) => sideOwned(m.i) && inside(player.g.position, m.zone, SD.zone)));
  if (maxTag.visible) maxTag.position.copy(stackTop(player)).y += S.meal.h;
  updatePower(dt);
  updatePayPops(dt);
}

function draw(dt) {
  stationDecor.userData.tick(dt, clock.elapsedTime);
  padRing.visible = Boolean(currentPad()) && state.cash >= padLeft();
  // Standing on a pad that is half paid with no cash left, a rewarded ad pays the rest; it waits while a toast is up.
  const padAd = hud.toast.hidden && currentPad() && state.cash < padLeft() && state.padPaid >= padCost(currentPad(), state.bays) * AD.padShare && inside(player.g.position, padMesh.position, [S.pad[0], S.pad[2]]);
  $('padAd').hidden = !padAd;
  if (padAd) $('padAd').textContent = `▶ Finish it free ($${padLeft()})`;
  const pulse = (1 + Math.sin(clock.elapsedTime * FX.ring.pulse)) / 2;
  padRing.material.opacity = pulse;
  playerRing.material.opacity = 0.5 + pulse / 2;
  playerMark.position.y = S.markHeight + pulse * S.arrow.bob;
  playerMark.rotation.y = clock.elapsedTime * 2;
  // The manager's zone glows when he needs the owner.
  if (officeZoneMesh) officeZoneMesh.material.opacity = managerNeeded() ? Z.opacity + pulse * 0.4 : Z.opacity;
  padRing.scale.setScalar(1 + pulse * F.ringGrow);
  const [target, tip] = goal() ?? [];
  arrow.visible = Boolean(target);
  if (target) arrow.position.set(target.x, S.arrow.height + Math.sin(clock.elapsedTime * G.bobSpeed) * S.arrow.bob, target.z);
  const pp = player.g.position, far = target && Math.hypot(target.x - pp.x, target.z - pp.z) > G.pointerMin;
  pointer.visible = Boolean(far && (tip || !onScreen(target)));
  if (pointer.visible) {
    const yaw = Math.atan2(target.x - pp.x, target.z - pp.z), r = G.pointerAt + pulse * 0.25;
    pointer.position.set(pp.x + Math.sin(yaw) * r, 0.08, pp.z + Math.cos(yaw) * r);
    pointer.rotation.y = yaw;
    pointer.material.opacity = 0.75 + pulse * 0.25;
  }
  // Until the first upgrade is bought, an affordable one nudges the Upgrades button.
  const ready = Object.entries(lines()).filter(([k, u]) => state.levels[k] < u.maxLevel && state.cash >= upgradeCost(u.baseCost, state.levels[k])).length;
  const nudge = ready > 0 && state.served > 0 && Object.values(state.levels).every((l) => l === 0);
  hud.btn.classList.toggle('nudge', nudge);
  hud.hint.textContent = moved ? (nudge && !tip ? 'Tap Upgrades to grow faster' : tip ?? '') : hud.hint.dataset.start;
  hud.hint.hidden = !hud.hint.textContent;
  hud.hint.classList.toggle('drag', !moved);

  if (shownCash < state.cash && !hud.cash.getAnimations().length) hud.cash.animate([{ transform: `scale(${F.bumpScale})` }, { transform: 'scale(1)' }], F.bumpMs);
  shownCash += (state.cash - shownCash) * Math.min(dt * F.countRate, 1);
  if (Math.abs(state.cash - shownCash) < 1) shownCash = state.cash;
  hud.hint.hidden ||= !hud.manager.hidden || !hud.ticket.hidden || !hud.toast.hidden || !$('padAd').hidden;
  const shown = Math.round(shownCash);
  hud.cash.textContent = `${shown < 0 ? '-' : ''}$${short(Math.abs(shown))}`;
  showCashDelta();
  hud.cash.classList.toggle('debt', state.cash < 0);
  hud.jam.hidden = !jammed;
  // Queue meter: one block per waiting car up to the jam limit; orange when close, red with the police countdown when jammed.
  // The banner slot shows the rush, or at the airport the next flight's countdown.
  const flightIn = airport.nextIn();
  hud.rush.hidden = !rush.on && flightIn === null && !nightNow();
  if (nightNow()) { $('rushText').textContent = `🌙 Night · valet check-ins · morning in ${Math.ceil(rush.next)}s`; $('rushDouble').hidden = true; }
  if (!rush.on && flightIn !== null) { $('rushText').textContent = `✈️ Next flight ${Math.floor(flightIn / 60)}:${String(Math.ceil(flightIn) % 60).padStart(2, '0')}`; $('rushDouble').hidden = true; }
  if (rush.on) $('rushText').textContent = `${RUSH.icon} ${RUSH.title} · ${Math.ceil(rush.left)}s · ${FOOD.board} ×${rushMult()}`;
  hud.queue.hidden = queue.length === 0;
  if (!hud.queue.hidden) {
    hud.queue.className = jammed && holdT > 0 ? 'hold' : jammed ? 'jam' : queue.length >= T.jamAt - 1 ? 'warn' : '';
    hud.queueText.textContent = jammed && holdT > 0 ? `🛠 ${Math.ceil(holdT)}s` : jammed ? `🚔 ${Math.max(Math.ceil(T.jamSec - jamT), 0)}s` : `🚗 ${queue.length} in line`;
    hud.queueCars.innerHTML = Array.from({ length: T.jamAt }, (_, i) => `<i class="${i < queue.length ? 'on' : ''}"></i>`).join('');
  }
  hud.divert.hidden = !(mobile.owned() && queue.length >= 2 && mobile.status().idle);
  const active = Object.entries(boosts).filter(([, b]) => b.left > 0).map(([k, b]) => `⚡${ST.boosts[k].name} ${Math.ceil(b.left)}s`).join('  ');
  hud.boosts.hidden = !active;
  hud.boosts.textContent = active;
  hud.btn.hidden = state.served === 0;
  hud.badge.hidden = ready === 0;
  hud.badge.textContent = ready;
  hud.progress.style.width = `${stageProgress() * 100}%`;
  hud.progressText.textContent = `STAGE ${shownStage}/${stageKeys.length} · ${stageIcon(Math.min(shownStage, stageKeys.length))} ${Math.round(stageProgress() * 100)}%`;
  // Stage tracker: finished stages are ticked, the current one glows, later ones wait greyed out.
  if (hud.stage.dataset.n !== String(shownStage)) {
    hud.stage.dataset.n = shownStage;
    // One star with its count keeps the chip short enough for small phones.
    hud.city.textContent = `${STATION.icon} ${STATION.name} · ${starsOf(STATION) ? `⭐${starsOf(STATION)}` : '☆'}`;
    // With more than four stages the finished ones fold into one ✓ chip, so the tracker keeps its width on small phones.
    const icons = stageKeys.map((k) => CONFIG.stageInfo[k][1]), from = icons.length > 4 ? Math.max(0, Math.min(shownStage - 1, icons.length - 3)) : 0;
    const chips = icons.slice(from, from + (from ? 3 : 4)).map((icon, j) => `<span class="st ${from + j + 1 < shownStage ? 'done' : from + j + 1 === shownStage ? 'now' : ''}">${icon}</span>`);
    hud.stage.innerHTML = [...(from ? [`<span class="st done">${from}</span>`] : []), ...chips].join('<i></i>');
  }
  const shownRating = rating().toFixed(1);
  if (hud.rating.dataset.last && shownRating > hud.rating.dataset.last) hud.rating.animate([{ transform: 'scale(1.5)', color: COL.pad }, { transform: 'scale(1)' }], F.bumpMs * 3);
  hud.rating.dataset.last = shownRating;
  hud.rating.textContent = `⭐${shownRating}`;
  // Mini map (and the big one while it is open) once the mobile service runs.
  hud.map.hidden = !mobile.owned();
  if (mobile.owned()) {
    const { calls, idle } = mobile.status();
    hud.mapBadge.hidden = calls === 0;
    hud.mapBadge.textContent = calls;
    drawMapCanvas(hud.map, false);
    if (!hud.mapPanel.hidden) drawMapCanvas(hud.mapBig, true);
    if (calls && idle && hud.mapPanel.hidden && !hud.hint.textContent) { hud.hint.textContent = 'Tap the map to send a van'; hud.hint.hidden = false; }
  }
  if (`x${combo}` !== hud.combo.dataset.shown) {
    hud.combo.dataset.shown = `x${combo}`;
    hud.combo.textContent = `x${combo} Combo!`;
    hud.combo.hidden = combo < 2;
    if (combo >= 2) hud.combo.animate([{ transform: `scale(${F.bumpScale * F.bumpScale})` }, { transform: 'scale(1)' }], F.bumpMs);
  }
  const m = mission();
  hud.mission.hidden = state.served === 0;
  // While the station's checklist is open, its next goal takes the mission line; tapping it opens the full list.
  const gi = GOALS.findIndex((g, i) => !state.goalDone?.[i]), cur = GOALS[gi];
  hud.mission.classList.toggle('goal', Boolean(cur));
  hud.mission.textContent = cur
    ? `📋 ${gi}/${GOALS.length} · ${cur.text} · ${cur.type === 'rating' ? goalValue(cur).toFixed(1) : Math.min(goalValue(cur), cur.goal)}/${cur.goal} ›`
    : `🎯 ${m.text.replace('{n}', m.goal).replace('{food}', FOOD.word)} · ${Math.min(state.mission.progress, m.goal)}/${m.goal} · $${m.reward}`;
  const g = nextGoal();
  hud.goalCard.hidden = !g || state.served === 0;
  if (g) {
    hud.goalName.textContent = state.cash >= g.cost ? `${g.name} · Ready!` : `${g.name} · $${g.cost - state.cash} to go`;
    hud.goalFill.style.width = `${Math.min(state.cash / g.cost, 1) * 100}%`;
  }
  renderPanel();
  hud.booksBtn.hidden = !state.accounting;
  if (Math.floor(clock.elapsedTime * 2) !== Math.floor((clock.elapsedTime - dt) * 2)) { renderBooks(); renderManager(); }

  // A raised object (a landing plane) is framed by the ground point it covers on screen, so it sits in the middle of the shot.
  const want = shot.at ? (shot.at.isObject3D ? shot.at.position.clone().setZ(shot.at.position.z - shot.at.position.y * W.cameraOffset[2] / W.cameraOffset[1]).setY(0) : shot.at) : new THREE.Vector3(camX(player.g.position.x), 0, THREE.MathUtils.clamp(player.g.position.z, W.cameraZ[0], W.cameraZ[1]));
  // The director's looks glide there; the way back eases from where the look ended onto the player, so following resumes without a snap.
  if (shot.at) camFocus.lerp(want, Math.min(dt * DIR.glide, 1));
  else if (shot.back > 0) { const t = 1 - shot.back / DIR.backSec; camFocus.lerpVectors(glideFrom, want, t * t * (3 - 2 * t)); }
  else camFocus.copy(want);
  if (shot.at && (shot.left -= dt) <= 0) { Object.assign(shot, { at: null, back: DIR.backSec }); glideFrom.copy(camFocus); nextShot(); }
  else if (!shot.at) shot.back -= dt;
  const focus = camFocus;
  // The station's size sets how far back the camera sits; a director's look leans in a little.
  const GZ = CONFIG.growZoom, grow = Math.min(GZ.start + GZ.perBay * (state.bays - 1) + (manager ? GZ.office : 0) + (state.doneAt !== null ? GZ.later : 0), GZ.max);
  camZoom += ((shot.at ? grow * shot.zoom : grow * (1 + W.edgeView.zoom * edgeNear())) - camZoom) * Math.min(dt * GZ.rate, 1);
  // The camera's opening swoop waits until the loading intro has faded.
  if (opening && swoop < 1) swoop = Math.min(1, swoop + dt * 1000 / OP.swoopMs);
  const rise = 1 + (OP.liftFrom - 1) * (1 - swoop) ** 3;
  camera.position.copy(focus).add(new THREE.Vector3(...W.cameraOffset).multiplyScalar(zoom * camZoom * rise));
  if (shakeLeft > 0) camera.position.add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(E.shakeAmp * shakeLeft / E.shakeSec));
  camera.lookAt(focus);
  // The bottom of the screen never shows ground past the end of the lot: if it would, the whole view slides up.
  camera.updateMatrixWorld();
  bottomRay.setFromCamera(SCREEN_BOTTOM, camera);
  if (bottomRay.ray.intersectPlane(GROUND, bottomHit) && bottomHit.z > reachZ + CONFIG.growZoom.viewBelow) {
    const lift = bottomHit.z - reachZ - CONFIG.growZoom.viewBelow;
    focus.z -= lift;
    camera.position.z -= lift;
    camera.lookAt(focus);
    camera.updateMatrixWorld();
  }
  keepPlayer();
  padFrame(dt);
  eyeView(dt);
  fadeOccluders(dt);
  winterTwinkle?.(clock.elapsedTime);
  renderer.render(scene, camera);
}

// Standing still for a few seconds eases the camera down to the owner's own eyes: from just behind and above their shoulder, looking
// the way they face with a wide lens, so the station is seen as they see it, not zoomed in on anything. The first step eases it back.
// Something solid behind the owner pulls the camera in front of it, so the view never ends up inside a wall.
const eyeRay = new THREE.Raycaster(), eyeAim = new THREE.Vector3(), eyeSpot = new THREE.Vector3(), eyeLook = new THREE.Vector3();
eyeRay.camera = camera;
function eyeView(dt) {
  const EV = CONFIG.eyeView, on = !shot.at && swoop >= 1 && moved && stillSec >= EV.afterSec;
  eye = THREE.MathUtils.clamp(eye + (on ? dt / EV.inSec : -dt / EV.outSec), 0, 1);
  const ease = eye * eye * (3 - 2 * eye);
  if (camera.fov !== R.fov + (EV.fov - R.fov) * ease) { camera.fov = R.fov + (EV.fov - R.fov) * ease; camera.updateProjectionMatrix(); }
  // The "this is you" arrow and ring belong to the view from above; in the owner's own view they would fill the screen.
  playerMark.visible = playerRing.visible = ease < 0.5;
  // Seen from behind, the stack goes from the back to the hands in front, so it never hides the owner or the view.
  player.stackRoot.position.z = S.carryBase[2] + (EV.carryZ - S.carryBase[2]) * ease;
  if (ease === 0) return;
  const p = player.g.position, r = player.g.rotation.y, fx = Math.sin(r), fz = Math.cos(r);
  // Over the right shoulder: the camera and its aim shift sideways, so the owner and what they carry sit left of the view ahead.
  const sx = -fz * EV.side, sz = fx * EV.side;
  eyeAim.set(p.x + sx, EV.height, p.z + sz);
  eyeSpot.set(p.x + sx - fx * EV.back, EV.height, p.z + sz - fz * EV.back);
  eyeRay.set(eyeAim, eyeSpot.clone().sub(eyeAim).normalize());
  eyeRay.far = EV.back;
  const wall = eyeRay.intersectObject(scene, true).find((h) => h.object.isMesh && h.object.visible && !ownedByPlayer(h.object));
  // Against a wall the camera climbs by the distance it loses, so the owner never fills the screen.
  if (wall) { const d = Math.max(wall.distance - EV.wallGap, 0.2); eyeSpot.copy(eyeAim).addScaledVector(eyeRay.ray.direction, d).y += (EV.back - d) * EV.climb; }
  eyeLook.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), camera.position.distanceTo(p));
  camera.position.lerp(eyeSpot, ease);
  camera.lookAt(eyeLook.lerp(new THREE.Vector3(p.x + sx + fx * EV.look, EV.lookY, p.z + sz + fz * EV.look), ease));
  camera.updateMatrixWorld();
}

// Stage pads nearest the player are framed whole by pulling the camera back around the player, so the player keeps its spot on
// screen and only the view around it widens; the pull eases in and out so the camera never jumps.
const PF = CONFIG.padFrame, cornerV = new THREE.Vector3(), playerV = new THREE.Vector3(), frameAhead = new THREE.Vector3();
let frameZoom = 1;
const stagePads = () => [...ghosts.filter((h) => h.g.visible).map((h) => [h.g.position, GH.size]), ...(padMesh.visible ? [[padMesh.position, S.pad[0]]] : [])];
// How far the view must widen around the player so a point d away on screen fits between the player and the safe edge (lo below, hi above).
const widen = (d, lo, hi) => (d > hi ? d / hi : d < lo ? d / lo : 1);
function padFrame(dt) {
  const tablet = innerWidth >= 700 && innerHeight >= 700 ? 1.3 : 1;
  const sx = 2 * PF.safe.side * tablet / innerWidth, top = 2 * PF.safe.top * tablet / innerHeight, bottom = 2 * PF.safe.bottom * tablet / innerHeight;
  // The pad the player is walking toward wins over one just behind.
  const pp = player.g.position, r = player.g.rotation.y;
  frameAhead.set(pp.x + Math.sin(r) * PF.lead, 0, pp.z + Math.cos(r) * PF.lead);
  const near = !shot.at && swoop >= 1 && moved ? stagePads().filter(([pos, size]) => pos.distanceTo(pp) <= PF.near + size / 2).sort(([a], [b]) => a.distanceTo(frameAhead) - b.distanceTo(frameAhead)) : [];
  let aimZoom = 1;
  if (near.length) {
    playerV.copy(pp).project(camera);
    const lo = { x: -1 + sx - playerV.x, y: -1 + bottom - playerV.y }, hi = { x: 1 - sx - playerV.x, y: 1 - top - playerV.y };
    // The nearest pad always counts; each further pad joins only if the view can still widen enough for it.
    for (const [pos, size] of near) {
      const h = size / 2 + PF.margin;
      let z = 1;
      for (const [dx, dz] of [[-h, -h], [h, -h], [-h, h], [h, h]]) {
        cornerV.set(pos.x + dx, 0, pos.z + dz).project(camera);
        z = Math.max(z, widen(cornerV.x - playerV.x, lo.x, hi.x), widen(cornerV.y - playerV.y, lo.y, hi.y));
      }
      if (pos !== near[0][0] && z > PF.maxZoom) continue;
      aimZoom = Math.max(aimZoom, z);
    }
  }
  // Eases toward the target but never faster than speed per second, so a new pad coming into play never jolts the view.
  frameZoom += THREE.MathUtils.clamp((Math.min(aimZoom, PF.maxZoom) - frameZoom) * Math.min(dt * PF.rate, 1), -dt * PF.speed, dt * PF.speed);
  if (Math.abs(frameZoom - 1) < 1e-4) return;
  camera.position.sub(pp).multiplyScalar(frameZoom).add(pp);
  camera.updateMatrixWorld();
}

// The ground point under a screen point (normalised device coordinates) for the camera as it stands now.
function groundAt(x, y) {
  const d = new THREE.Vector3(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
  return camera.position.clone().addScaledVector(d, -camera.position.y / d.y);
}

// Last word on framing: whatever the rules above did (pads, edges, the end of the lot, the road), the view slides back until the player
// sits inside the middle box of the screen; a few passes settle the perspective.
const KP = CONFIG.keepPlayer, over = (v, m) => (v > m ? v - m : v < -m ? v + m : 0);
function keepPlayer() {
  if (shot.at || swoop < 1) return;
  // Near the lot's edge the box widens so the view can lean out over the scenery.
  const e = edgeNear(), bx = KP.x + (W.edgeView.box - KP.x) * e, by = KP.y + (W.edgeView.box - KP.y) * e;
  for (let i = 0; i < 3; i++) {
    cornerV.copy(player.g.position).project(camera);
    const sx = over(cornerV.x, bx), sy = over(cornerV.y, by);
    if (!sx && !sy) return;
    const o = groundAt(0, 0);
    camera.position.add(groundAt(1, 0).sub(o).multiplyScalar(sx).add(groundAt(0, 1).sub(o).multiplyScalar(sy)).setY(0));
    camera.updateMatrixWorld();
  }
}

// Test hook: `?bot` hands the simulation to tools/bot.js instead of the real-time loop.
// Test hook: read access for the bot brain in both test modes; only `?bot` drives update() directly. `?probe` adds the same read
// access to an otherwise untouched game, so a test sees exactly what a player sees.
if (BOT || SIM || params.has('probe')) window.__cr = { eye: () => eye, solidPush, faded: () => [...faded.keys()], convoy, storm, grid, outfitMeshes: () => ownMeshes.filter((m) => m.userData.outfit), dailyTasks, tally, albumAdd, regularVisit, rival: () => rival, floats: () => payPops.map((p) => p.s.userData.text), save, callPolice, readInput, edgeNear, pointerOn: () => pointer.visible, ads, adBreak, shotOn: () => Boolean(shot.at) || shot.back > 0, reach: () => reachZ, stagePads: () => stagePads().map(([p, s]) => [p.x, p.z, s]), box: (o) => new THREE.Box3().setFromObject(o), size: (o) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()), state, camera, renderer, player, cafe, kiosk, queue, worker: () => worker, police: () => cop, decisions, orderBoost, officeZone: v3(ST.officeZone), boostOptions: () => (manager ? Object.entries(ST.boosts).map(([k, b]) => ({ k, need: shortage[k](), value: state.accounting ? boostValue(b) : 0, cost: b.cost, ready: !boosts[k].left && !boosts[k].cool })) : []), divert: () => hud.divert.onclick(), openBays, currentPad, padLeft, padMesh, powerupAt: () => (power.item ? puModels[power.item].position : null), vipBills: () => vipBills, airport, machines, sideOwned, wanted, travel, stars: () => CONFIG.stations.map(starsOf), chain: () => chain, station: STATION, rush, buy, update, draw, capOf, sideCarry: SD.carry, rating, mission, mobile, wash, service, audio, lines, log: botLog, nextCost: (k) => upgradeCost(lines()[k].baseCost, state.levels[k]) };
const PAUSE_CARDS = ['restore', 'adCard', 'feedback', 'done', 'panel', 'goals', 'chain', 'welcome', 'notice', 'settings', 'books', 'mapPanel', 'travel'];
let since = 0, frameNo = 0;
if (!BOT) renderer.setAnimationLoop(() => {
  // Frames are capped at maxFps so the phone's GPU is not run flat out and does not heat up.
  if ((since += clock.getDelta()) < 1 / R.maxFps) return;
  const raw = since, dt = Math.min(raw, G.maxDt);
  since = 0;
  if (frameNo++ % R.shadowEvery === 0) renderer.shadowMap.needsUpdate = true;
  // Full-screen cards and sheets pause the game, so no timer (jams, police, patience) runs behind them.
  const paused = PAUSE_CARDS.some((id) => !$(id).hidden);
  if (started && !paused) for (let i = 0; i < WARP * testSpeed; i++) update(WARP > 1 ? G.maxDt : dt, readInput());
  // Stalls (tab resume, page load) are not real frame times, so they stay out of fps and quality checks.
  if (started && raw < G.stallSec) { perf.frames++; perf.sec += raw; adaptQuality(raw); }
  draw(dt);
});
