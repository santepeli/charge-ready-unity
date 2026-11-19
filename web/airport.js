// Airport stages: a solar field that raises every charge fee and a VIP lounge that brings VIPs sooner with longer money trails.
// At stations with planes a control tower and a runway stand beside the lot, and a flight lands now and then.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildSolarField, buildOffice, buildCoinIcon, buildPlane, buildTower, buildRunway } from './models.js';

const AP = CONFIG.airport, KINDS = ['solar', 'lounge'], APPROACH = 26;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const v3 = ([x, z]) => new THREE.Vector3(x, 0, z);

// The game passes its state, scene, whether this station has planes, `ready()` (whether a flight may come) and `land(plane, phase)`, called as a flight starts ('approach') and touches down ('landed').
export function createAirport({ state, scene, planes, ready, land }) {
  const buildings = { solar: buildSolarField(), lounge: buildOffice('VIP LOUNGE', CONFIG.colors.gold, buildCoinIcon(), 'VIP') };
  KINDS.forEach((k) => buildings[k].position.copy(v3(AP[k].at)));
  const owned = (k) => Boolean(state.airport?.[k]);
  const lvl = (k) => state.levels[k] ?? 0;

  function show() {
    for (const k of KINDS) if (owned(k) && !buildings[k].parent) scene.add(buildings[k]);
  }
  function open(k) {
    state.airport ??= {};
    state.airport[k] = true;
    Object.keys(AP[k].upgrades).forEach((u) => { state.levels[u] = 0; });
    show();
  }
  const S = AP.solar.upgrades, L = AP.lounge.upgrades;
  // Charge fee factor from the solar field and its battery bank.
  const feeFactor = () => (owned('solar') ? 1 + AP.solar.step * lvl('solarPanels') + S.solarStorage.step * lvl('solarStorage') : 1);
  const vipGapCut = () => (owned('lounge') ? L.vipInvites.gapStep * lvl('vipInvites') : 0);
  const extraBills = () => (owned('lounge') ? L.redCarpet.billStep * lvl('redCarpet') : 0);

  let plane = null, next = AP.landEverySec[0] / 2, t = -1;
  const [rx, rz] = AP.runway;
  if (planes) {
    const tower = buildTower();
    tower.position.copy(v3(AP.tower));
    plane = buildPlane();
    plane.scale.setScalar(AP.planeScale);
    plane.visible = false;
    scene.add(tower, plane, buildRunway(AP.runway));
  }
  // A flight glides down onto the runway over landSec, rolls out and is gone; the game is told when it starts and when it lands.
  function update(dt) {
    if (!plane) return;
    if (t < 0) {
      // Flights only start once a second bay can take the wave of travelers.
      if (!ready() || (next -= dt) > 0) return;
      t = 0;
      plane.visible = true;
      land(plane, 'approach');
    }
    const f = (t += dt) / AP.landSec;
    plane.position.set(rx + APPROACH * (1 - f), AP.planeY * Math.max(1 - f, 0) + 0.6, rz);
    plane.rotation.z = f < 1 ? -0.12 : 0;
    if (f >= 1 && t - dt < AP.landSec) land(plane, 'landed');
    if (f >= 1.6) { plane.visible = false; t = -1; next = rand(...AP.landEverySec); }
  }

  // Seconds to the next flight while one is due, otherwise null.
  const nextIn = () => (plane && t < 0 && ready() ? Math.max(next, 0) : null);
  return { buildings, owned, open, show, update, feeFactor, vipGapCut, extraBills, nextIn, flying: () => Boolean(plane?.visible) };
}
