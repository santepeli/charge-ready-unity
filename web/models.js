// Placeholder low-poly art built from primitives; proportions here are art data, replaced by Kenney models in Unity.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';

const COL = CONFIG.colors, W = CONFIG.world, RD = CONFIG.road;
const cache = new Map();
// Three-step toon ramp gives the bright, flat-lit cartoon look of the arcade genre.
const ramp = new THREE.DataTexture(new Uint8Array(CONFIG.render.toonSteps.flatMap((v) => [v, v, v, 255])), CONFIG.render.toonSteps.length, 1);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;
export const mat = (color, extra = {}) => {
  const key = color + JSON.stringify(extra);
  if (!cache.has(key)) cache.set(key, new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra }));
  return cache.get(key);
};
// KayKit models (CC0, Kay Lousberg) packed into one GLB; each model is a named scene, drawn with the same toon ramp.
// The host serves only plain file types, so the kit ships as glTF JSON with base64 geometry plus PNG textures, rebuilt here as a GLB.
function toGLB(json, bin) {
  const pad = (n) => (4 - (n % 4)) % 4, text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = text.length + pad(text.length), binLen = bin.length + pad(bin.length), total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonLen, true); view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen); out.set(text, 20);
  view.setUint32(20 + jsonLen, binLen, true); view.setUint32(24 + jsonLen, 0x004e4942, true);
  out.set(bin, 28 + jsonLen);
  return out.buffer;
}
// Reads a JSON asset in chunks and moves the loading bar from `from` to `to` as bytes arrive.
async function loadJson(name, from, to) {
  const res = await fetch(new URL(`./assets/${name}`, import.meta.url)), total = Number(res.headers.get('content-length')) || 0, reader = res.body?.getReader();
  if (!reader) return res.json();
  const parts = [];
  for (let got = 0, r; !(r = await reader.read()).done;) {
    parts.push(r.value);
    got += r.value.length;
    // Without a size header the bar eases toward `to` instead.
    window.boot?.progress(from + (to - from) * (total ? Math.min(got / total, 1) : 1 - Math.exp(-got / 1.5e6)));
  }
  return JSON.parse(await new Blob(parts).text());
}
window.boot?.progress(0.05);
const pack = await loadJson('kaykit.json', 0.05, 0.6);
const glb = toGLB(pack.gltf, Uint8Array.from(atob(pack.bin), (c) => c.charCodeAt(0)));
const kit = Object.fromEntries((await new GLTFLoader().parseAsync(glb, new URL('./assets/', import.meta.url).href)).scenes.map((s) => [s.name, s]));
// Kenney Food Kit and Car Kit models (CC0, www.kenney.nl), each shipped as a base64 GLB in one JSON file.
const kenneyPack = await loadJson('kenney.json', 0.6, 0.9);
const kenney = Object.fromEntries(await Promise.all(Object.entries(kenneyPack).map(async ([name, b64]) =>
  [name, (await new GLTFLoader().parseAsync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer, '')).scene])));
const toonCache = new Map();
const toonOf = (m) => { if (!toonCache.has(m.uuid)) toonCache.set(m.uuid, new THREE.MeshToonMaterial({ name: m.name, map: m.map, color: m.color, gradientMap: ramp })); return toonCache.get(m.uuid); };
// World size of a real thing given in metres; people and the props they use get the cartoon factor.
const REAL = CONFIG.sizes.real;
export const worldSize = (key) => REAL[key] * REAL.unit * (REAL.cartoonKeys.includes(key) ? REAL.cartoon : 1);
// Longest horizontal side of a model as built, used to fit it to its real size.
const longest = (o) => { const v = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()); return Math.max(v.x, v.z); };
// Copy of a kit model scaled by k and turned by rotY, ready to place.
export function kitModel(name, k = 1, rotY = 0) {
  const g = new THREE.Group(), m = kit[name].clone(true);
  m.traverse((o) => { if (o.isMesh) { o.material = toonOf(o.material); o.castShadow = o.receiveShadow = true; } });
  m.scale.setScalar(k);
  m.rotation.y = rotY;
  g.add(m);
  return g;
}
// Copy of a Kenney model scaled by k and turned by rotY, in the toon look.
export function kenneyModel(name, k = 1, rotY = 0) {
  const g = new THREE.Group(), m = kenney[name].clone(true);
  m.traverse((o) => { if (o.isMesh) { o.material = toonOf(o.material); o.castShadow = o.receiveShadow = true; } });
  m.scale.setScalar(k);
  m.rotation.y = rotY;
  g.add(m);
  return g;
}

// One scale for every kit car (fitted on the sedan) and every Kenney truck, so they all share real proportions.
const CAR_K = worldSize('car') / longest(kitModel('car_sedan'));
const TRUCK_K = worldSize('truck') / longest(kenneyModel('truck'));
// Height of the chibi body as modelled, hair included, and the scale that gives it its real size.
const PERSON_K = worldSize('person') / 1.95;

// Geometry of a single-mesh kit model, scaled and centered, for stacked items like burgers.
export function kitGeometry(name, k) {
  let mesh = null;
  kit[name].traverse((o) => { mesh ??= o.isMesh ? o : null; });
  return { geo: mesh.geometry.clone().scale(k, k, k).center(), mat: toonOf(mesh.material) };
}

// Stackable food: the kit burger, or any Kenney food model merged into one geometry with a material group per part, about `size` wide.
// `tint` recolours parts by material name, for models whose own colours are too pale to read on a phone.
export function foodGeometry(model, size, tint = {}) {
  if (model === 'burger') return kitGeometry('food_burger', size);
  const geos = [], mats = [];
  kenney[model].updateMatrixWorld(true);
  kenney[model].traverse((o) => { if (o.isMesh) { geos.push(o.geometry.clone().applyMatrix4(o.matrixWorld)); mats.push(tint[o.material.name] ? mat(tint[o.material.name]) : toonOf(o.material)); } });
  const geo = mergeGeometries(geos, true);
  geo.computeBoundingBox();
  const s = geo.boundingBox.getSize(new THREE.Vector3()), k = FOOD_WIDTH * size / Math.max(s.x, s.z);
  return { geo: geo.scale(k, k, k).center(), mat: mats };
}
// Width in world units of a stacked food at size 1, matching the kit burger at the meal scale.
const FOOD_WIDTH = 1.15;

// Kit rooms: each piece is [model, x, z, turn] in kit units (a floor tile is 4 wide), scaled by the room's factor.
const KIT_K = { cafe: 0.6, office: 0.7, kiosk: 0.8 }, Q = Math.PI / 2;
const CAFE_ROOM = { k: KIT_K.cafe, pieces: [
  ['floor_kitchen', 0, -2.5, 0], ['wall_window_open', 0, -4.5, 0], ['stove_multi_decorated', -1, -3.4, 0], ['fridge_A_decorated', 1.2, -3.4, 0],
  ['kitchencounter_straight_A', -1, 0, 0], ['kitchencounter_straight_A', 1, 0, 0]] };
const KIOSK_ROOM = { k: KIT_K.kiosk, pieces: [
  ['floor_kitchen', 0, 0, 0], ['wall_half', 0, -2, 0], ['wall_orderwindow_decorated', 2, 0, Q], ['wall_half', -2, 0, Q],
  ['kitchencounter_straight_A', -1, 0.6, 0], ['kitchencounter_straight_A', 1, 0.6, 0], ['stove_multi_countertop', 1, -1.4, 0]] };
function room({ k, pieces }) {
  const g = new THREE.Group();
  for (const [name, x, z, r] of pieces) { const o = kitModel(name, k, r); o.position.set(x * k, 0, z * k); g.add(o); }
  return g;
}

// Toon material with a texture, for painted ground.
export const paintedMat = (map) => new THREE.MeshToonMaterial({ map, gradientMap: ramp });

// Canvas texture repeated over the ground: plain tiles with grout lines, or a two-color checker.
export function tileTexture([a, b], px, checker, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = px * 2;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = checker && (i === 1 || i === 2) ? b : a;
    ctx.fillRect((i % 2) * px, Math.floor(i / 2) * px, px, px);
  }
  if (!checker) { ctx.strokeStyle = b; ctx.lineWidth = 3; for (let i = 0; i < 2; i++) ctx.strokeRect(i * px, i * px, px, px); ctx.strokeRect(0, px, px, px); ctx.strokeRect(px, 0, px, px); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(...repeat);
  return tex;
}

// Painted text on the ground, such as a bay number.
function decal(text, size) {
  const c = document.createElement('canvas');
  // 512 px with anisotropic filtering keeps floor words sharp on 2-3x phone screens seen at an angle.
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  Object.assign(ctx, { font: '800 384px "Baloo 2", sans-serif', textAlign: 'center', textBaseline: 'middle', fillStyle: COL.paint });
  ctx.fillText(text, 256, 280, 480);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85 }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// Floor power-up: glowing disc in a white ring with a floating pair of roller skates (speed) or gloves (carry); spin(dt) animates it.
export function buildPowerup(kind, color) {
  const g = new THREE.Group(), item = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.08, 40), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  disc.rotation.x = ring.rotation.x = -Math.PI / 2;
  disc.position.y = 0.02;
  ring.position.y = 0.03;
  const white = mat('#ffffff'), add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; return o; };
  for (const side of [-1, 1]) {
    const one = new THREE.Group();
    if (kind === 'speed') {
      const wheel = new THREE.CylinderGeometry(0.08, 0.08, 0.08, 12), dark = mat('#1d2b3f');
      one.add(add(new THREE.BoxGeometry(0.3, 0.34, 0.42), mat('#3f7bff'), 0, 0.3, -0.04), add(new THREE.BoxGeometry(0.32, 0.06, 0.56), white, 0, 0.11, 0));
      for (const [x, z] of [[-0.12, -0.18], [0.12, -0.18], [-0.12, 0.18], [0.12, 0.18]]) one.add(add(wheel, dark, x, 0.06, z)).children.at(-1).rotation.z = Math.PI / 2;
      one.add(add(new THREE.BoxGeometry(0.04, 0.16, 0.3), white, side * 0.18, 0.42, -0.08));
    } else {
      one.add(add(new THREE.BoxGeometry(0.36, 0.12, 0.34), white, 0, 0.2, 0));
      for (let i = 0; i < 4; i++) one.add(add(new THREE.CapsuleGeometry(0.045, 0.16, 4, 8), white, -0.13 + i * 0.087, 0.2, -0.26)).children.at(-1).rotation.x = Math.PI / 2;
      one.add(add(new THREE.CapsuleGeometry(0.05, 0.12, 4, 8), white, side * 0.22, 0.2, -0.02)).children.at(-1).rotation.z = Math.PI / 2;
    }
    one.position.x = side * 0.27;
    one.rotation.y = side * 0.25;
    item.add(one);
  }
  g.add(disc, ring, item);
  let t = 0;
  g.userData.spin = (dt) => { t += dt; item.position.y = 0.35 + Math.sin(t * 3) * 0.12; item.rotation.y += dt * 1.5; };
  return g;
}

// Rounded floor tile painted on a canvas, as the genre's lock and buy pads; draw(opts) repaints it.
export function buildFloorTile(size) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d'), tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  m.rotation.x = -Math.PI / 2;
  const tile = () => { ctx.beginPath(); ctx.roundRect(14, 14, 228, 228, 44); };
  const text = (t, x, y, px, fill, ink) => {
    Object.assign(ctx, { font: `800 ${px}px "Baloo 2", sans-serif`, textAlign: 'center', textBaseline: 'middle', lineJoin: 'round', lineWidth: px / 6, strokeStyle: ink, fillStyle: fill });
    if (ink) ctx.strokeText(t, x, y, 210);
    ctx.fillText(t, x, y, 210);
  };
  // fill, pct of done fill, lock, star number and name for a lock tile; bill and amount for a buy pad.
  m.userData.draw = ({ fill, done, pct = 0, lock, star, name, note, amount, ink, starFill, starInk, bill, billInk }) => {
    ctx.clearRect(0, 0, 256, 256);
    tile();
    ctx.fillStyle = fill;
    ctx.fill();
    if (pct > 0) { ctx.save(); ctx.clip(); ctx.fillStyle = done; ctx.fillRect(14, 242 - 228 * pct, 228, 228 * pct); ctx.restore(); }
    tile();
    Object.assign(ctx, { lineWidth: 12, strokeStyle: '#ffffff' });
    ctx.stroke();
    if (lock) {
      // White padlock: shackle arc over a rounded body with a keyhole.
      Object.assign(ctx, { lineWidth: 16, strokeStyle: '#ffffff', fillStyle: '#ffffff' });
      ctx.beginPath(); ctx.arc(128, 92, 30, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.roundRect(80, 90, 96, 74, 16); ctx.fill();
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.arc(128, 118, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(123, 118, 10, 26);
      text(name, 128, 202, 46, '#ffffff', ink);
      if (note) text(note, 84, 46, 26, '#ffffff', ink);
    }
    if (star) {
      // "STAGE n" ribbon across the top, so the number reads as the stage it opens with, not as stars needed.
      Object.assign(ctx, { fillStyle: starFill, strokeStyle: starInk, lineWidth: 5 });
      ctx.beginPath(); ctx.roundRect(48, 22, 160, 44, 12); ctx.fill(); ctx.stroke();
      text(`STAGE ${star}`, 128, 46, 30, starInk);
    }
    if (amount) {
      // Yellow banknote over the amount still to pay.
      Object.assign(ctx, { fillStyle: bill, strokeStyle: billInk, lineWidth: 6 });
      ctx.beginPath(); ctx.roundRect(92, 52, 72, 42, 8); ctx.fill(); ctx.stroke();
      text('$', 128, 75, 32, billInk);
      text(amount, 128, 160, 72, '#ffffff', ink);
    }
    tex.needsUpdate = true;
  };
  return m;
}

const glow = (color, intensity = 1) => mat(color, { emissive: color, emissiveIntensity: intensity });
// Shared geometry per shape and size, so every car and driver reuses the same GPU buffers.
const geoCache = new Map();
function shape(type, ...args) {
  const key = type + args.join(',');
  if (!geoCache.has(key)) geoCache.set(key, new THREE[`${type}Geometry`](...args));
  return geoCache.get(key);
}
const B = (w, h, d) => shape('Box', w, h, d);

// Adds a shadow-casting mesh to parent at (x, y, z).
function add(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Car faces -x, the direction it drives in from the road.
export function buildCar(name) {
  const g = kitModel(name, CAR_K, -Math.PI / 2);
  outline(g, CONFIG.sizes.carInk);
  return g;
}

// Charger post; setOn lights its screen while a car charges.
export function buildCharger() {
  const g = new THREE.Group();
  add(g, B(0.6, 0.12, 0.6), mat(COL.curb), 0, 0.06, 0);
  add(g, B(0.5, 1.7, 0.36), mat(COL.charger), 0, 0.95, 0);
  add(g, B(0.56, 0.12, 0.42), mat(COL.battery), 0, 1.84, 0);
  const screen = add(g, B(0.34, 0.42, 0.02), mat(COL.screenOff), 0, 1.25, 0.19);
  // Lit EV board on top marks it as a charger from any angle.
  const bolt = add(g, B(0.56, 0.5, 0.06), glow(COL.battery, 0.5), 0, 2.2, 0);
  bolt.add(textPlane('EV', 0.5, 0.46, COL.labelStroke));
  const cable = add(g, shape('Torus', 0.9, 0.05, 6, 16, Math.PI), mat(COL.cable), 0.95, 0.95, 0);
  cable.rotation.z = Math.PI;
  // Lights the screen and shows the cable while a car is plugged in.
  g.userData.setOn = (on) => { screen.material = on ? glow(COL.battery, 0.9) : mat(COL.screenOff); cable.visible = on; };
  cable.visible = false;
  g.scale.setScalar(worldSize('charger') / 2.45);
  return g;
}

// Diner counter with a grill; `top` is where fresh meals stack.
// Kitchen with the food's board, a striped awning and a giant sign food on the back wall and a planter beside it, so the shop reads at a glance.
export function buildCafe(food) {
  const g = room(CAFE_ROOM), k = KIT_K.cafe;
  const board = add(g, B(2.6, 0.5, 0.08), mat(COL.umbrella), 0, 4 * k + 0.35, -4.5 * k + 0.1);
  board.add(textPlane(food.board, 2.4, 0.42, COL.paint));
  awning(g, 2.6, 0, 4 * k - 0.2, -4.5 * k + 0.5, 0.6, COL.umbrella);
  planter(g, -1.6, -4.5 * k + 0.3);
  // The giant sign food is the station's own main food.
  let icon;
  if (food.model === 'burger') icon = kitModel('food_burger', 2.2);
  else { const f = foodGeometry(food.model, food.sign ?? 2.4, food.tint); icon = new THREE.Mesh(f.geo, f.mat); }
  icon.position.set(0, 4 * k + 0.65, -4.5 * k + 0.1);
  g.add(icon);
  const menu = kitModel('menu', 1.4);
  menu.position.set(-1.1, k * 1.2, 0.05);
  g.add(menu);
  const top = new THREE.Group();
  top.position.set(0.2, KIT_K.cafe * 1.2 + 0.03, 0.1);
  g.add(top);
  g.userData.top = top;
  return g;
}

// Patio table with stools where drivers eat while their car charges; no umbrella, so the food stays in view from above.
export function buildTable() {
  const g = new THREE.Group();
  g.add(kitModel('table_round_A_small', 0.8));
  for (const x of [-0.85, 0.85]) { const stool = kitModel('chair_stool', 0.9); stool.position.x = x; g.add(stool); }
  return g;
}

// Ink outline: a slightly larger back-face copy behind each mesh, so characters read clearly against the lot.
const inkMat = new THREE.MeshBasicMaterial({ color: COL.labelStroke, side: THREE.BackSide });
function outline(group, scale) {
  group.traverse((m) => {
    // A mesh from an already inked part (a parked plane) keeps its one hull.
    if (!m.isMesh || m.userData.noInk || m.userData.inked) return;
    m.userData.inked = true;
    const o = new THREE.Mesh(m.geometry, inkMat);
    o.scale.setScalar(scale);
    // The hull grows around the shape's own centre, so a model whose origin sits at a corner keeps its hull behind it.
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    m.geometry.boundingBox.getCenter(o.position).multiplyScalar(1 - scale);
    o.userData.noInk = true;
    m.add(o);
  });
}

// Chibi person: big round head with eyes and cheeks, short body, swinging arms and legs; staff add a cap, apron, ⚡ badge and floor ring, customers show hair.
export function buildPerson(color, staff = false) {
  const g = new THREE.Group(), limb = (x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); g.add(p); return p; };
  const legs = [-0.12, 0.12].map((x) => limb(x, 0.45)), arms = [-0.33, 0.33].map((x) => limb(x, 0.98));
  legs.forEach((p) => { add(p, shape('Capsule', 0.11, 0.2, 4, 8), mat(COL.pants), 0, -0.2, 0); add(p, B(0.2, 0.1, 0.28), mat(COL.labelStroke), 0, -0.4, 0.04); });
  arms.forEach((p) => { add(p, shape('Capsule', 0.08, 0.24, 4, 8), mat(color), 0, -0.18, 0); add(p, shape('Sphere', 0.085, 8, 6), mat(COL.skin), 0, -0.36, 0); });
  add(g, shape('Capsule', 0.26, 0.28, 4, 12), mat(color), 0, 0.78, 0);
  add(g, shape('Sphere', 0.34, 16, 12), mat(COL.skin), 0, 1.5, 0);
  for (const x of [-0.12, 0.12]) {
    add(g, shape('Sphere', 0.05, 8, 6), mat(COL.labelStroke), x, 1.55, 0.31).userData.noInk = true;
    add(g, shape('Sphere', 0.05, 8, 6), mat(COL.cheek), x * 1.5, 1.44, 0.27).userData.noInk = true;
  }
  add(g, shape('Sphere', 0.355, 16, 12, 0, Math.PI * 2, 0, 1.25), mat(staff ? color : COL.hair), 0, 1.56, -0.02);
  g.userData.limbs = { legs, arms };
  g.userData.step = 0;
  if (staff) {
    add(g, B(0.36, 0.05, 0.22), mat(color), 0, 1.62, 0.33);
    add(g, B(0.4, 0.4, 0.04), mat(COL.apron), 0, 0.72, 0.25);
    add(g, B(0.12, 0.12, 0.03), mat(COL.badge), 0, 0.88, 0.28).userData.noInk = true;
  }
  outline(g, CONFIG.sizes.inkScale);
  g.userData.person = true;
  g.scale.setScalar(PERSON_K);
  if (staff) {
    const ring = add(g, shape('Ring', 0.46, 0.62, 24), mat(color), 0, 0.03, 0);
    ring.rotation.x = -Math.PI / 2;
    ring.castShadow = false;
  }
  return g;
}

// Swings legs and arms while a person moves (amount 0-1) and lets them settle when standing; a carrier holds both arms out front.
export function stepPerson(g, amount, dt, carrying = false) {
  const u = g.userData;
  if (!u.limbs) return;
  u.step = amount > 0.05 ? u.step + dt * CONFIG.feel.stepRate : 0;
  const swing = Math.sin(u.step) * CONFIG.feel.stepSwing * Math.min(amount, 1);
  u.limbs.legs[0].rotation.x = swing;
  u.limbs.legs[1].rotation.x = -swing;
  const hold = carrying ? CONFIG.feel.carryArms : 0;
  u.limbs.arms[0].rotation.x = hold || -swing;
  u.limbs.arms[1].rotation.x = hold || swing;
}

function tree(parent, x, z, k) {
  add(parent, shape('Cylinder', 0.12 * k, 0.16 * k, 0.7 * k, 6), mat(COL.trunk), x, 0.35 * k, z);
  add(parent, shape('Icosahedron', 0.75 * k, 0), mat(COL.leaf), x, 1.15 * k, z);
  add(parent, shape('Icosahedron', 0.5 * k, 0), mat(COL.leafLight), x + 0.2 * k, 1.65 * k, z - 0.1);
}

// Roadside pylon that tells drivers what the station sells.
function buildSign() {
  const g = new THREE.Group(), c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d'), tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    ctx.fillStyle = COL.signBoard;
    ctx.fillRect(0, 0, 512, 256);
    Object.assign(ctx, { textAlign: 'center', textBaseline: 'middle', fillStyle: COL.battery, font: '800 76px "Baloo 2", sans-serif' });
    ctx.fillText('⚡ EV CHARGING + DINER', 256, 92, 480);
    Object.assign(ctx, { fillStyle: COL.wall, font: '700 54px "Baloo 2", sans-serif' });
    ctx.fillText('Charge up, grab a bite!', 256, 186, 480);
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.ready.then(draw);
  // Planter base, twin posts, a lime frame round the board and a lit bolt cap make it a chunky landmark.
  add(g, B(3, 0.5, 0.9), mat(COL.charger), 0, 0.25, 0);
  for (const x of [-1, 0, 1]) prop(g, 'plant_bushLarge', 2.6, x, 0.05).position.y = 0.5;
  for (const x of [-1.1, 1.1]) add(g, B(0.24, 3.4, 0.24), mat(COL.pole), x, 1.9, 0);
  add(g, B(3.6, 2, 0.2), mat(COL.battery), 0, 4.2, 0);
  add(g, B(3.4, 1.8, 0.24), mat(COL.signBoard), 0, 4.2, 0);
  const face = new THREE.Mesh(shape('Plane', 3.2, 1.6), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.set(0, 4.2, 0.13);
  g.add(face);
  add(g, B(0.9, 0.5, 0.3), glow(COL.battery, 0.8), 0, 5.45, 0).add(textPlane('⚡', 0.8, 0.46));
  outline(g, CONFIG.sizes.inkScale);
  g.position.set(RD.serviceLane - 2, 0, W.floorParts[0][0] - 1.2);
  return g;
}

// Five decoration stages that appear as the station grows; positions are art data.
export function buildDecorStages() {
  const stages = [0, 1, 2, 3, 4].map(() => new THREE.Group());
  const [planters, lights, lounge, logo, solar] = stages;
  for (const [x, z] of [[-9.2, -14.8], [-9.2, 9.6], [12.6, 13.4], [11.4, -1.4]]) {
    add(planters, B(0.9, 0.5, 0.9), mat(COL.counter), x, 0.25, z);
    add(planters, shape('Icosahedron', 0.45, 0), mat(COL.leafLight), x, 0.75, z);
    add(planters, shape('Sphere', 0.12, 6, 6), mat(COL.umbrella), x + 0.2, 1.05, z);
  }
  for (let x = -9.5; x <= 8.5; x += 1) add(lights, shape('Sphere', 0.1, 6, 6), glow(COL.pad, 1), x, 2.2 + Math.sin(x) * 0.15, -16.4);
  add(lights, B(18.2, 0.03, 0.03), mat(COL.cable), -0.5, 2.25, -16.4);
  for (const x of [-9.5, -0.5, 8.5]) add(lights, B(0.12, 2.3, 0.12), mat(COL.pole), x, 1.15, -16.4);
  for (const z of [-4.6, 1.6, 7.6]) {
    const bench = kitModel('bench', 3, Math.PI / 2);
    bench.position.set(-9.4, 0, z);
    lounge.add(bench);
  }
  add(logo, B(0.5, 0.02, 1.6), glow(COL.battery, 0.4), 11.2, 0.02, 9.4).rotation.y = 0.5;
  add(logo, B(0.5, 0.02, 1.6), glow(COL.battery, 0.4), 11.6, 0.02, 10.4).rotation.y = 0.5;
  for (let i = 0; i < 3; i++) add(solar, B(1.2, 0.06, 0.8), mat(COL.rackDark), -11.6, 0.6, -11.6 + i * 1.1).rotation.x = -0.3;
  return stages;
}

// Service garage for the vans: green walls with a white cap, a dark roof with a lime edge and solar panels, a striped roller door
// with a hazard frame and an awning toward the van bays, an EV SERVICE board facing the camera, and crates and a plant at its sides.
export function buildDepot() {
  const g = new THREE.Group();
  add(g, B(4.2, 1.7, 2.4), mat(COL.vanBody), 0, 0.85, 0);
  add(g, B(4.3, 0.12, 2.5), mat(COL.paint), 0, 1.76, 0);
  add(g, B(4.4, 0.16, 2.6), mat(COL.roof), 0, 1.9, 0);
  add(g, B(4.5, 0.1, 2.7), mat(COL.battery), 0, 1.84, 0);
  add(g, B(2.9, 1.5, 0.06), mat(COL.charger), 0, 0.75, 1.2);
  for (let i = 0; i < 6; i++) add(g, B(2.6, 0.2, 0.05), mat(COL.wall), 0, 0.15 + i * 0.24, 1.24);
  awning(g, 3.2, 0, 1.62, 1.5, 0.6, COL.vanBody);
  // Solar panels on the roof charge the vans' batteries.
  for (const x of [-1.4, -0.1]) add(g, B(1.1, 0.08, 1.9), mat(COL.solar), x, 2.04, 0).rotation.x = -0.12;
  // The board turns to face the camera, since the depot itself is turned toward the van bays.
  const front = new THREE.Group();
  front.position.set(1.4, 2, 0);
  front.rotation.y = -Math.PI / 2;
  leanBoard(front, 'EV SERVICE', 2.6, COL.vanBody, COL.paint, 0.45, 0);
  g.add(front);
  prop(g, 'cardboardBoxClosed', 2.4, 1.6, 1.3);
  prop(g, 'cardboardBoxClosed', 2.4, 1.75, 1.6, 0.4);
  planter(g, -1.8, 1.55);
  return g;
}

// Service van: the Kenney Car Kit van painted in the brand green with a roof beacon, nose toward -z, outlined so it stands out on the lot.
export function buildVan() {
  const g = new THREE.Group(), van = kenneyModel('van', 0.7, Math.PI);
  van.traverse((o) => { if (o.isMesh && /paint/i.test(o.material.name ?? '')) { o.material = o.material.clone(); o.material.color.set(COL.vanBody); } });
  g.add(van);
  add(g, B(0.5, 0.12, 0.3), glow(COL.pad, 0.8), 0, 1.3, 0.1);
  outline(g, CONFIG.sizes.carInk);
  g.scale.setScalar(worldSize('van') / longest(g));
  return g;
}

// Portable generator for the blackout: a yellow box with hazard stripes, a red pull handle and a blinking lamp.
export function buildGenerator() {
  const g = new THREE.Group();
  add(g, B(1.1, 0.8, 0.8), mat(COL.pad), 0, 0.45, 0);
  for (let i = -2; i <= 2; i++) add(g, B(0.12, 0.82, 0.02), mat(COL.charger), i * 0.22, 0.45, 0.41).rotation.z = 0.5;
  add(g, B(0.9, 0.08, 0.6), mat(COL.charger), 0, 0.9, 0);
  add(g, B(0.3, 0.12, 0.12), mat(COL.siren), 0.3, 1, 0);
  const lamp = add(g, shape('Sphere', 0.14, 10, 8), glow(COL.siren, 1.5), -0.35, 1.05, 0);
  g.userData.blink = (t) => { lamp.visible = Math.floor(t * 4) % 2 === 0; };
  outline(g, CONFIG.sizes.carInk);
  return g;
}

// The rival: a VoltMart van in cold steel blue with a glowing roof sign, built like our service van so it reads as a competitor.
export function buildRivalVan() {
  // Nose to -x like every customer car, so it drives forward along the road; the roof board spans its width and reads front and back.
  const g = new THREE.Group(), van = kenneyModel('van', 0.7, -Math.PI / 2);
  van.traverse((o) => { if (o.isMesh && /paint/i.test(o.material.name ?? '')) { o.material = o.material.clone(); o.material.color.set(COL.rival); } });
  g.add(van);
  const sign = add(g, B(0.12, 0.5, 1.9), glow(COL.rivalSign, 1.2), 0, 1.75, 0);
  for (const s of [1, -1]) { const t = textPlane('VOLTMART', 1.8, 0.42, COL.paint); t.rotation.y = s * Math.PI / 2; t.position.x = s * 0.07; sign.add(t); }
  outline(g, CONFIG.sizes.carInk);
  g.scale.setScalar(worldSize('van') / longest(g));
  return g;
}

// Static surroundings: ground in the station's color, road, parking lines, shop kiosk, hedge, trees and lamps.
// Ground texture for the station's district, drawn once on a canvas with its own seeded random so the game's random stays untouched:
// town grass with mowing stripes, highway sand with ripples and grit, airport concrete in slabs with joints.
function groundTexture(base, kind) {
  const c = document.createElement('canvas'), N = 512, ctx = c.getContext('2d'), shade = new THREE.Color(base);
  c.width = c.height = N;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, tone = (k) => `#${shade.clone().multiplyScalar(k).getHexString()}`;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, N, N);
  if (kind === 'town') {
    for (let x = 0; x < N; x += 64) { ctx.fillStyle = tone(1.06); ctx.fillRect(x, 0, 32, N); }
    for (let i = 0; i < 900; i++) { ctx.fillStyle = tone(0.88); ctx.fillRect(rnd() * N, rnd() * N, 2, 5); }
  } else if (kind === 'highway' || kind === 'hotel') {
    ctx.strokeStyle = tone(0.93);
    ctx.lineWidth = 3;
    for (let y = 20; y < N; y += 40) { ctx.beginPath(); for (let x = 0; x <= N; x += 16) ctx.lineTo(x, y + Math.sin(x / 40 + y) * 6); ctx.stroke(); }
    for (let i = 0; i < 1400; i++) { ctx.fillStyle = tone(rnd() < 0.5 ? 0.8 : 1.12); ctx.fillRect(rnd() * N, rnd() * N, 3, 3); }
  } else {
    for (let y = 0; y < N; y += 128) for (let x = 0; x < N; x += 128) { ctx.fillStyle = tone(0.95 + rnd() * 0.08); ctx.fillRect(x + 2, y + 2, 124, 124); }
    for (let i = 0; i < 300; i++) { ctx.fillStyle = tone(0.9); ctx.fillRect(rnd() * N, rnd() * N, 2, 2); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.anisotropy = 8;
  return tex;
}

export function buildDecor(scene, ground = COL.grass, kind = 'town') {
  const g = new THREE.Group();
  add(g, B(80, 0.2, 80), paintedMat(groundTexture(ground, kind)), 0, -0.25, 0);
  add(g, B(RD.width, 0.2, 80), mat(COL.road), RD.x, -0.1, 0);
  // Raised sidewalk on the road's far side, in front of the shops across the street.
  add(g, B(0.9, 0.2, 80), mat(COL.sidewalk), RD.x + RD.width / 2 + 0.45, -0.02, 0);
  for (let z = -38; z < 38; z += 2.4) add(g, B(0.18, 0.02, 1.2), mat(COL.roadLine), RD.x, 0.01, z);
  for (const z of [W.floorParts[0][0], W.floorParts.at(-1)[1]]) add(g, B(0.3, 0.25, 3), mat(COL.curb), W.floorX + W.floorWidth / 2, 0.02, z);
  g.add(buildSign());
  // Painted line on the open side of each bay.
  for (const [x, z] of W.bays) add(g, B(0.12, 0.02, 3.8), mat(COL.paint), x + W.carOffset[0] + 1, 0.01, z + W.carOffset[1]);
  // Patio tiles under the diner and painted bay numbers make the lot read as a real place.
  const P = W.patio, patio = new THREE.Mesh(new THREE.PlaneGeometry(P.size[0], P.size[1]), paintedMat(tileTexture(COL.patio, 64, true, P.repeat)));
  patio.rotation.x = -Math.PI / 2;
  patio.position.set(P.at[0], 0.005, P.at[1]);
  patio.receiveShadow = true;
  g.add(patio);
  W.bays.forEach(([x], i) => { const d = decal(String(i + 1), 1.1); d.position.set(x + W.carOffset[0], 0.015, W.bayNumberZ); g.add(d); });

  [[-12.5, -9, 1], [-12.8, -4, 1.2], [-12.5, 1, 1.4], [-12.9, 6, 1], [-12.1, 10.5, 1.2], [-12.9, 15, 1.4], [-12.7, 20, 1],
    // The highway's desert gets cacti where greener stations have trees.
    [-13, -13, 1.25], [-9.2, -18.6, 1.25], [4.8, -18.8, 1.25]].forEach(([x, z, k], i) => { if (kind === 'highway') prop(g, i % 2 ? 'cactus_short' : 'cactus_tall', 3.4 * k, x, z, i); else if (kind === 'hotel') prop(g, 'tree_palm', 3 * k, x, z, i); else tree(g, x, z, k); });
  // Kit props: a hedge of bushes and street lights along the road.
  const place = (name, k, x, z, r = 0) => { const o = kitModel(name, k, r); o.position.set(x, 0, z); g.add(o); };
  // Hedge along the left edge of the lot.
  for (let z = -15.6; z < 14; z += 2.2) { if (kind === 'highway') prop(g, 'rock_smallA', 3, -10.6, z, z); else place('bush', 2.6, -10.6, z); }
  for (const z of W.streetLights) place('streetlight', 3, W.streetLightX, z, Math.PI);
  place('firehydrant', 3, W.streetLightX, -3.8);
  place('trash_A', 4, -9.4, -5.6);
  scene.add(g);
}

// Police car: white body with a blue band and a red-blue light bar that blinks via `flash(on)`.
export function buildPolice() {
  const g = buildCar('car_police');
  const red = add(g, B(0.4, 0.2, 0.45), glow(COL.siren, 2), 0, 1.05, -0.26), blue = add(g, B(0.4, 0.2, 0.45), glow(COL.police, 2), 0, 1.05, 0.26);
  g.userData.flash = (on) => { red.scale.setScalar(on ? 1.25 : 0.7); blue.scale.setScalar(on ? 0.7 : 1.25); };
  return g;
}

// Traffic officer: navy uniform, peaked cap, gold badge and a white belt so they read as police from above.
export function buildOfficer() {
  const g = buildPerson(COL.police);
  add(g, shape('Cylinder', 0.38, 0.34, 0.18, 14), mat(COL.labelStroke), 0, 1.84, 0);
  add(g, B(0.38, 0.05, 0.24), mat(COL.labelStroke), 0, 1.76, 0.34);
  add(g, B(0.16, 0.12, 0.03), glow(COL.pad, 0.6), 0, 1.88, 0.37);
  add(g, B(0.14, 0.16, 0.03), glow(COL.pad, 0.5), -0.12, 0.88, 0.26);
  add(g, shape('Cylinder', 0.29, 0.29, 0.08, 12), mat(COL.wall), 0, 0.58, 0);
  return g;
}

// Roll-over car wash like at fuel stations: blue drive-through bay with drains, a portal gantry with two side brushes
// and a top brush that rolls back and forth over the car, an entry light, and a CAR WASH board with a giant water drop.
export function buildWash() {
  const g = new THREE.Group(), gantry = new THREE.Group(), brushes = [];
  bayShell(g, 2.8, 4.4, COL.washWall);
  for (const z of [-1.2, 0, 1.2]) add(g, B(1.6, 0.035, 0.1), mat(COL.charger), 0, 0.05, z);
  for (const x of [-1.2, 1.2]) add(gantry, B(0.22, 2.1, 0.5), mat(COL.washWall), x, 1.05, 0);
  add(gantry, B(2.64, 0.3, 0.5), mat(COL.washWall), 0, 2.1, 0);
  for (const x of [-0.85, 0.85]) brushes.push(add(gantry, shape('Cylinder', 0.3, 0.3, 1.5, 12), mat(COL.washBrush), x, 0.9, 0));
  const top = add(gantry, shape('Cylinder', 0.26, 0.26, 1.5, 12), mat(COL.bubble), 0, 1.65, 0);
  top.rotation.z = Math.PI / 2;
  g.add(gantry);
  // Entry light on the portal: green when the bay is free, red while a car is washed.
  const free = glow(COL.battery, 1), busy = glow(COL.loss, 1), light = add(g, B(0.3, 0.3, 0.12), free, -1.4, 1.6, -1.8);
  leanBoard(g, 'CAR WASH', 2.8, COL.washWall, COL.paint, 2.85, -2);
  const drop = new THREE.Group();
  add(drop, shape('Sphere', 0.38, 16, 12), glow(COL.bubble, 0.3), 0, 0.38, 0);
  add(drop, shape('Cone', 0.32, 0.55, 16), glow(COL.bubble, 0.3), 0, 0.88, 0);
  outline(drop, CONFIG.sizes.inkScale);
  drop.position.set(0, 3.25, -2.3);
  g.add(drop);
  // Soap barrels and a planter along the free left side.
  prop(g, 'barrel', 1.3, -1.85, 1.2);
  prop(g, 'barrel', 1.3, -1.85, 0.3);
  planter(g, -1.85, -1.3);
  let t = 0;
  // While a car is inside the gantry rolls over it and the brushes spin; when idle it rests at the exit end.
  g.userData.spin = (dt) => {
    t += dt;
    gantry.position.z = Math.sin(t * 1.6) * 1.3;
    brushes.forEach((b) => { b.rotation.y += dt * 14; });
    top.rotation.x += dt * 14;
    light.material = busy;
  };
  g.userData.idle = () => { light.material = free; };
  return g;
}

// One tire: dark rubber ring with a light rim, lying flat unless turned.
function tire(parent, r, x, y, z) {
  const t = add(parent, shape('Torus', r, r * 0.42, 8, 16), mat(COL.tire), x, y, z);
  t.rotation.x = Math.PI / 2;
  add(t, shape('Cylinder', r * 0.62, r * 0.62, r * 0.5, 14), mat(COL.rim)).rotation.x = Math.PI / 2;
  return t;
}
// Kenney prop placed on parent at (x, z), scaled by k and turned by rot.
function prop(parent, name, k, x, z, rot = 0) {
  const m = kenneyModel(name, k, rot);
  m.position.set(x, 0, z);
  parent.add(m);
  return m;
}
// Striped awning of width w hung at height y, sloping down toward the camera over depth d, with a valance strip on its front edge.
function awning(parent, w, x, y, z, d, color, stripe = COL.paint, n = 6) {
  const s = w / n, tilt = 0.45;
  for (let i = 0; i < n; i++) add(parent, B(s, 0.06, d), mat(i % 2 ? stripe : color), x - w / 2 + s * (i + 0.5), y, z).rotation.x = tilt;
  add(parent, B(w + 0.06, 0.14, 0.06), mat(color), x, y - Math.sin(tilt) * d / 2 - 0.05, z + Math.cos(tilt) * d / 2);
}
// Name board leaning back so it faces the overhead camera.
function leanBoard(parent, text, w, color, ink, y, z) {
  const board = add(parent, B(w, 0.6, 0.08), mat(color), 0, y, z);
  board.rotation.x = -0.75;
  board.add(textPlane(text, w - 0.2, 0.52, ink));
  return board;
}
// Drive-through shop bay of width w and depth d: slab with a curb rim, low walls in the shop colour with a white cap (at x = walls),
// and a portal over the entry at the back with a dark header and a striped awning; cars drive in from -z and out toward the camera.
function bayShell(g, w, d, color, walls = [-w / 2, w / 2], stripe = COL.paint) {
  add(g, B(w + 0.5, 0.04, d), mat(COL.curb), 0, 0.02, 0);
  add(g, B(w, 0.03, d - 0.2), mat(COL.washFloor), 0, 0.03, 0);
  for (const x of walls) {
    add(g, B(0.22, 0.9, d - 0.8), mat(color), x, 0.45, 0.2);
    add(g, B(0.3, 0.1, d - 0.7), mat(COL.paint), x, 0.94, 0.2);
  }
  for (const x of [-w / 2, w / 2]) add(g, B(0.34, 2.3, 0.34), mat(color), x, 1.15, -d / 2 + 0.2);
  add(g, B(w + 0.34, 0.34, 0.4), mat(COL.charger), 0, 2.4, -d / 2 + 0.2);
  awning(g, w, 0, 2.1, -d / 2 + 0.6, 0.7, color, stripe);
}
// Potted bush for a building's corner.
function planter(parent, x, z, k = 1) {
  prop(parent, 'pot_large', 1.6 * k, x, z);
  prop(parent, 'plant_bushLarge', 2.6 * k, x, z).position.y = 0.3 * k;
}
// Tire shop: orange drive-through bay with a striped awning, a stacked tire rack, a floor jack, a TIRES board and a giant tire on top.
export function buildTireShop() {
  const g = new THREE.Group();
  bayShell(g, 3.2, 4.2, COL.tireShop);
  add(g, B(0.08, 1.0, 3.4), mat(COL.charger), -2.55, 0.5, 0.2);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) tire(g, 0.26, -2.2, 0.12 + j * 0.24, -1.0 + i * 0.8);
  add(g, B(0.5, 0.12, 0.9), mat(COL.lift), 0.9, 0.06, 0.2);
  leanBoard(g, 'TIRES', 3.2, COL.tireShop, COL.paint, 2.85, -2);
  const icon = new THREE.Group();
  tire(icon, 0.55, 0, 0, 0).rotation.x = 0;
  outline(icon, CONFIG.sizes.inkScale);
  icon.position.set(0, 3.75, -2.3);
  g.add(icon);
  prop(g, 'pylon', 3, 1.95, 2);
  planter(g, -2.2, 2.2);
  return g;
}
// Repair garage: two grey-blue drive-through bays with yellow car lifts that rise during a repair, tool walls, oil barrels,
// a REPAIR board and a giant wrench on top.
export function buildGarage(lifts) {
  const g = new THREE.Group(), platforms = [];
  bayShell(g, 5.6, 4.2, COL.garage, [-2.8, 0, 2.8], COL.lift);
  lifts.forEach(([x]) => {
    for (const dx of [-0.8, 0.8]) add(g, B(0.16, 1.6, 0.16), mat(COL.lift), x + dx, 0.8, 0.1);
    platforms.push(add(g, B(1.3, 0.08, 2.2), mat(COL.lift), x, 0.06, 0.1));
  });
  for (const x of [-2.6, 2.6]) for (let i = 0; i < 3; i++) add(g, B(0.04, 0.5, 0.12), mat(COL.rim), x + (x < 0 ? 0.12 : -0.12), 0.9, -0.8 + i * 0.5);
  leanBoard(g, 'REPAIR', 4.4, COL.garage, COL.paint, 2.85, -2);
  prop(g, 'barrel', 1.2, -3.25, 1.6);
  prop(g, 'cardboardBoxClosed', 2.4, -3.45, 0.6);
  const wrench = new THREE.Group();
  add(wrench, B(0.22, 1.2, 0.14), mat(COL.rim), 0, 0, 0);
  for (const s of [-1, 1]) add(wrench, B(0.16, 0.34, 0.14), mat(COL.rim), s * 0.2, 0.72, 0);
  add(wrench, shape('Torus', 0.2, 0.08, 6, 12), mat(COL.rim), 0, -0.66, 0);
  outline(wrench, CONFIG.sizes.inkScale);
  wrench.rotation.z = 0.7;
  wrench.position.set(0, 3.8, -2.3);
  g.add(wrench);
  g.userData.platforms = platforms;
  return g;
}
// Tow truck garage: amber drive-through shed with a hazard-striped awning, a TOW board, a giant hook on top, cones and a spare-tire stack.
export function buildTowDepot() {
  const g = new THREE.Group();
  bayShell(g, 3, 4.2, COL.tow, undefined, COL.labelStroke);
  leanBoard(g, 'TOW', 3, COL.labelStroke, COL.tow, 2.85, -2);
  const hook = new THREE.Group();
  add(hook, B(0.1, 0.7, 0.1), mat(COL.charger), 0, 0.35, 0);
  const curl = add(hook, shape('Torus', 0.26, 0.08, 6, 12, Math.PI * 1.4), mat(COL.charger), 0, -0.2, 0);
  curl.rotation.z = Math.PI * 0.8;
  outline(hook, CONFIG.sizes.inkScale);
  hook.position.set(0, 3.7, -2.3);
  g.add(hook);
  for (const z of [0.6, 1.4]) prop(g, 'pylon', 3, -1.95, z);
  for (let j = 0; j < 3; j++) tire(g, 0.26, -1.95, 0.12 + j * 0.24, -0.6);
  return g;
}
// Tow truck, nose toward -x like the kit cars: cab, flat bed, a crane boom with a hook and an amber beacon; `hook` carries the towed car.
export function buildTowTruck() {
  const g = new THREE.Group();
  add(g, B(1.0, 0.95, 1.2), mat(COL.tow), -0.95, 0.75, 0);
  add(g, B(0.1, 0.4, 1.0), mat(COL.glass), -1.46, 0.95, 0);
  add(g, B(1.9, 0.25, 1.2), mat(COL.charger), 0.45, 0.45, 0);
  const boom = add(g, B(1.2, 0.14, 0.14), mat(COL.tow), 0.9, 1.0, 0);
  boom.rotation.z = -0.5;
  add(g, B(0.3, 0.14, 0.3), glow(COL.tow, 1.2), -0.95, 1.3, 0);
  for (const x of [-0.9, 0.8]) for (const z of [-0.6, 0.6]) add(g, shape('Cylinder', 0.26, 0.26, 0.18, 12), mat(COL.tire), x, 0.26, z).rotation.x = Math.PI / 2;
  outline(g, CONFIG.sizes.carInk);
  const hook = new THREE.Group(), k = worldSize('tow') / longest(g);
  hook.position.set(2.5, 0.25, 0);
  hook.rotation.z = -0.15;
  // The towed car keeps its own size inside the scaled truck.
  hook.scale.setScalar(1 / k);
  g.add(hook);
  g.userData.hook = hook;
  g.scale.setScalar(k);
  return g;
}

// Electric bus, nose to -x like the cars: white body with a green stripe, dark window band, roof battery packs and a lightning badge.
export function buildBus(body = CONFIG.colors.busBody) {
  const g = new THREE.Group(), C = CONFIG.colors;
  add(g, B(5.2, 1.5, 2.1), mat(body), 0, 1.05, 0);
  add(g, B(5.22, 0.28, 2.12), mat(C.battery), 0, 0.55, 0);
  add(g, B(4.6, 0.5, 2.14), mat(C.glass), 0.15, 1.35, 0);
  add(g, B(0.06, 0.8, 1.7), mat(C.glass), -2.62, 1.25, 0);
  for (const x of [-1.4, 0, 1.4]) add(g, B(1.0, 0.22, 1.5), mat(C.charger), x, 1.92, 0);
  add(g, B(0.5, 0.5, 0.04), glow(C.battery, 1.2), -1.2, 1.0, 1.07);
  for (const x of [-1.7, 1.7]) for (const z of [-0.95, 0.95]) add(g, shape('Cylinder', 0.36, 0.36, 0.24, 12), mat(C.tire), x, 0.36, z).rotation.x = Math.PI / 2;
  outline(g, CONFIG.sizes.carInk);
  g.scale.setScalar(worldSize('bus') / longest(g));
  return g;
}

// VIP limousine: the Kenney luxury SUV stretched into a gloss black limo with tinted windows, chrome trim and a gold pinstripe down each
// side, sized like the customers' cars and nose to -x. The gold ring and VIP tag above mark it in play.
export function buildLimo() {
  const g = kenneyModel('suvLuxury', 1, -Math.PI / 2), L = CONFIG.colors.limo;
  g.scale.x = 1.35;
  g.scale.multiplyScalar(worldSize('limo') / longest(g));
  const paint = { paint: L.body, window: L.glass, plastic: L.trim, _defaultMat: L.trim };
  g.traverse((o) => {
    const key = Object.keys(paint).find((k) => new RegExp(k, 'i').test(o.material?.name ?? ''));
    if (o.isMesh && key) { o.material = o.material.clone(); o.material.color.set(paint[key]); }
  });
  // Pinstripes sit just outside the body at belt height, in model units so the stretch keeps them full length.
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()), gold = mat(L.stripe);
  for (const z of [-1, 1]) add(g, B(size.x * 0.86 / g.scale.x, 0.05 / g.scale.y, 0.02 / g.scale.z), gold, 0, size.y * 0.52 / g.scale.y, z * (size.z / 2 + 0.01) / g.scale.z);
  add(g, B(size.x * 0.3 / g.scale.x, 0.03 / g.scale.y, size.z * 0.5 / g.scale.z), gold, 0, (box.max.y + 0.01) / g.scale.y, 0);
  outline(g, CONFIG.sizes.carInk);
  return g;
}

// Side-product machine: a counter in the station's colors with the product on top, a lit board with its icon, and a `top` where the stock piles.
export function buildMachine(side, color) {
  const g = new THREE.Group(), C = CONFIG.colors;
  add(g, B(1.5, 1.0, 1.0), mat(color), 0, 0.5, 0);
  add(g, B(1.56, 0.08, 1.06), mat(C.counter), 0, 1.04, 0);
  const board = add(g, B(1.5, 0.5, 0.08), mat(C.charger), 0, 2.1, -0.5);
  board.add(textPlane(side.name.toUpperCase(), 1.4, 0.4, C.paint));
  add(g, B(0.08, 1.1, 0.08), mat(C.pole), -0.6, 1.55, -0.5);
  add(g, B(0.08, 1.1, 0.08), mat(C.pole), 0.6, 1.55, -0.5);
  const icon = foodGeometry(side.model, 0.9), big = new THREE.Mesh(icon.geo, icon.mat);
  big.position.set(0, 2.75, -0.5);
  g.add(big);
  outline(g, CONFIG.sizes.inkScale);
  const top = new THREE.Group();
  top.position.set(0, 1.1, 0.15);
  g.add(top);
  g.userData.top = top;
  return g;
}

// Highway roadside show, built for contrast on the darker desert: every landmark is dark-outlined and saturated so it reads on a phone.
// Below the lot a teal dinosaur by a creek, at the entry a blinking neon arrow, across the road a lit charging canopy and a camper camp,
// beside the outlets a white and blue tube man and a taco truck, and yellow edge lines along the road.
function highwayShow(g, anims, sign) {
  // Blinking parts get their own material so the shared colour of other objects stays put.
  const C = COL, TEAL = '#0b5c57', PINK = '#ff3d8b', blink = (m, a, b, hz) => { m.material = m.material.clone(); anims.push((dt, t) => m.material.color.set(Math.sin(t * hz) > 0 ? a : b)); };
  // Front: a creek with sand banks and a plank bridge, and a teal dinosaur with pink back plates that slowly turns its head.
  add(g, B(30, 0.04, 2.2), mat(C.sea), 1, 0.025, 27);
  for (const dz of [-1.2, 1.2]) add(g, B(30, 0.06, 0.3), mat(C.bread), 1, 0.03, 27 + dz);
  for (let i = 0; i < 6; i++) add(g, B(0.4, 0.12, 2.8), mat(C.counter), 7.4 + i * 0.45, 0.3, 27);
  const dino = new THREE.Group(), body = mat(TEAL);
  add(dino, B(3, 1.4, 1.3), body, 0, 1.9, 0);
  for (const [dx, dz] of [[-0.9, -0.4], [-0.9, 0.4], [0.9, -0.4], [0.9, 0.4]]) add(dino, B(0.4, 1.2, 0.4), body, dx, 0.6, dz);
  add(dino, B(2.2, 0.6, 0.6), body, -2.4, 2, 0).rotation.z = 0.25;
  const neck = new THREE.Group();
  neck.position.set(1.3, 2.3, 0);
  dino.add(neck);
  add(neck, B(0.6, 2.4, 0.6), body, 0.3, 1.1, 0).rotation.z = -0.25;
  add(neck, B(1.2, 0.6, 0.7), body, 0.9, 2.4, 0);
  for (const dz of [-0.2, 0.2]) add(neck, B(0.14, 0.14, 0.05), mat(C.paint), 1.2, 2.55, dz * 1.8);
  for (let i = 0; i < 4; i++) add(dino, shape('Cone', 0.28, 0.6, 4), mat(PINK), -0.9 + i * 0.6, 2.85, 0);
  dino.position.set(-4, 0, 29.5);
  dino.scale.setScalar(0.85);
  g.add(dino);
  anims.push((dt, t) => { neck.rotation.y = Math.sin(t * 0.4) * 0.6; });
  // Entry: a dark board with a pink neon arrow and a row of bulbs that chase toward the lot.
  for (const x of [11.2, 13.4]) add(g, B(0.2, 3.2, 0.2), mat(C.pole), x, 1.6, -15.2);
  const board = add(g, B(3, 1.5, 0.15), mat(C.labelStroke), 12.3, 3.6, -15.2);
  board.rotation.x = -0.6;
  const arrow = add(board, B(1.8, 0.45, 0.06), mat(PINK), -0.2, 0, 0.08);
  add(board, shape('Cone', 0.45, 0.7, 3), mat(PINK), 1, 0, 0.08).rotation.z = -Math.PI / 2;
  blink(arrow, PINK, C.paint, 3);
  for (let i = 0; i < 6; i++) {
    const bulb = add(board, shape('Sphere', 0.08, 8, 6), mat(C.mustard), -1.1 + i * 0.36, -0.5, 0.1);
    bulb.material = bulb.material.clone();
    bulb.userData.noInk = true;
    anims.push((dt, t) => bulb.material.color.set(Math.floor(t * 6) % 6 === i ? C.paint : C.mustard));
  }
  // Road: yellow edge lines along both kerbs.
  for (const x of [14.05, 17.15]) add(g, B(0.12, 0.02, 120), mat(C.mustard), x, 0.035, 0).userData.noInk = true;
  // Across the road: a lit charging canopy and a camper by a smoking campfire.
  for (const [dx, dz] of [[-1.6, -1.2], [1.6, -1.2], [-1.6, 1.2], [1.6, 1.2]]) add(g, B(0.2, 3, 0.2), mat(C.paint), 22 + dx, 1.5, -17 + dz);
  add(g, B(4, 0.4, 3.2), mat(C.labelStroke), 22, 3.1, -17);
  const glow = add(g, B(4.1, 0.12, 3.3), mat(C.action), 22, 2.85, -17);
  blink(glow, C.action, C.paint, 2);
  for (const dx of [-0.8, 0.8]) add(g, B(0.5, 1.4, 0.4), mat(TEAL), 22 + dx, 0.7, -17);
  sign('SUPER EV', 22, -14.6, 2.4, C.labelStroke);
  add(g, B(1.8, 1.5, 4), mat(C.paint), 22.5, 0.95, 9);
  add(g, B(1.82, 0.3, 4.02), mat(C.police), 22.5, 0.9, 9);
  for (const dz of [-1.2, 1.2]) add(g, shape('Cylinder', 0.35, 0.35, 0.3, 10), mat(C.tire), 21.6, 0.35, 9 + dz).rotation.z = Math.PI / 2;
  const fire = add(g, shape('Cone', 0.25, 0.55, 6), mat(C.truck), 20.6, 0.3, 9);
  anims.push((dt, t) => { fire.scale.y = 1 + Math.sin(t * 12) * 0.2; });
  for (let i = 0; i < 4; i++) {
    const puff = add(g, shape('Sphere', 0.22, 8, 6), new THREE.MeshBasicMaterial({ color: C.paint, transparent: true, opacity: 0.6 }), 20.6, 1, 9);
    puff.userData.noInk = true;
    anims.push((dt, t) => { const k = (t * 0.35 + i / 4) % 1; puff.position.set(20.6 + Math.sin(k * 6) * 0.3, 0.8 + k * 3, 9); puff.scale.setScalar(0.6 + k * 1.6); puff.material.opacity = 0.6 * (1 - k); });
  }
  // Left: a white and blue tube man by the outlets, a pink SALE sign on a dark board and a taco truck with a small queue.
  const tube = new THREE.Group(), segs = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Group();
    s.position.y = i ? 0.8 : 0.4;
    add(s, shape('Cylinder', 0.32, 0.32, 0.8, 10), mat(i % 2 ? C.police : C.paint), 0, 0.4, 0);
    (segs[i - 1] ?? tube).add(s);
    segs.push(s);
  }
  const arms = [-1, 1].map((d) => add(segs[3], B(1.1, 0.18, 0.18), mat(C.police), d * 0.6, 0.6, 0));
  tube.position.set(-13, 0, -6);
  g.add(tube);
  anims.push((dt, t) => { segs.forEach((s, i) => { s.rotation.z = Math.sin(t * 3 + i * 0.7) * 0.25; s.rotation.x = Math.cos(t * 2.3 + i) * 0.12; }); arms.forEach((a, i) => { a.rotation.z = Math.sin(t * 5 + i * 3) * 0.7; }); });
  const sale = add(g, B(2.4, 0.7, 0.1), mat(C.labelStroke), -17.4, 3.4, 4.4);
  const saleText = textPlane('SALE', 2.2, 0.6, PINK);
  saleText.position.z = 0.06;
  sale.add(saleText);
  anims.push((dt, t) => { saleText.visible = Math.sin(t * 3) > -0.3; });
  add(g, B(1.8, 1.6, 3.4), mat(C.mustard), -13, 1.1, 12);
  add(g, B(1.82, 0.5, 3.42), mat(C.siren), -13, 2.1, 12);
  add(g, B(0.05, 0.6, 1.6), mat(C.labelStroke), -12.08, 1.4, 12);
  leanBoard(g, 'TACOS', 1.6, C.siren, C.paint, 2.6, 13.8).position.x = -13;
  for (let i = 0; i < 2; i++) { const who = buildPerson(C.drivers[i + 1]); who.position.set(-11.6, 0, 11.4 + i * 0.9); who.rotation.y = -Math.PI / 2; g.add(who); }
}

// Border prop spots: top row above the back wall, bottom row below the back street, then the left edge (the airport keeps only the bottom row and the top-left spot).
const BORDER = [[-7, -18.6], [-3, -18.9], [1.5, -18.6], [6, -18.9], [-8, 24], [-3.5, 24.4], [1, 24], [5.5, 24.4], [10, 24], [-14.5, -12], [-14.5, -3], [-14.5, 6], [-14.5, 15]];
// Town houses [model, x] along the top, kerb cars [model, x] in front of them, highway hills [x, z, radius] left of the lot and the airport garage's centre.
const TOWN_HOUSES = [['building_A', -13], ['building_E', -7.6], ['building_B', -2.2], ['building_F', 3.2]];
const TOWN_CARS = [['car_hatchback', -10.4], ['car_sedan', -5], ['car_stationwagon', 0.6]];
// Shops of the outlet mall left of the highway lot: name and colour, from the top down.
const MALL = [['SHOES', 'truck'], ['TOYS', 'shuttle'], ['BOOKS', 'mustard'], ['SPORT', 'battery']];
const AIRPORT_GARAGE = [-1, -19.6];
// Station props that give each place its own look and fill the lot's free corners; kind is the station's decor key.
export function buildStationDecor(kind) {
  const g = new THREE.Group(), C = CONFIG.colors, anims = [];
  // Moving scenery (turbines, balloons, birds, radar, helicopter) registers here; the game calls userData.tick every frame.
  g.userData.tick = (dt, t) => anims.forEach((f) => f(dt, t));
  // Hot air balloon: striped envelope, tapered skirt and a basket on ropes; it bobs and drifts slowly around (x, y, z).
  const balloon = (x, y, z, a, b, phase) => {
    const bg = new THREE.Group();
    add(bg, shape('Sphere', 1.3, 16, 12), mat(a), 0, 0, 0).scale.y = 1.15;
    add(bg, shape('Cylinder', 1.32, 1.32, 0.45, 16), mat(b), 0, -0.1, 0);
    add(bg, shape('Cylinder', 0.95, 0.35, 0.9, 16), mat(a), 0, -1.35, 0);
    for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) add(bg, B(0.03, 0.7, 0.03), mat(C.cable), dx, -2.05, dz);
    add(bg, B(0.55, 0.4, 0.55), mat(C.counter), 0, -2.55, 0);
    bg.position.set(x, y, z);
    bg.scale.setScalar(0.6);
    g.add(bg);
    anims.push((dt, t) => { bg.position.y = y + Math.sin(t * 0.6 + phase) * 0.4; bg.position.x = x + Math.sin(t * 0.07 + phase) * 2; });
  };
  const sign = (text, x, z, w = 3.2, color = C.sign) => {
    add(g, B(0.16, 3, 0.16), mat(C.pole), x, 1.5, z);
    const board = add(g, B(w, 1, 0.1), mat(color), x, 3.2, z);
    board.add(textPlane(text, w - 0.2, 0.8, C.paint));
  };
  // Border spots on the grass above, below and left of the lot, clear of every lane, zone and the roadside sign.
  BORDER.forEach(([x, z], i) => {
    if (kind === 'town') {
      prop(g, i % 2 ? 'tree_oak' : 'tree_default', 2.6, x, z, i);
      prop(g, i % 2 ? 'flower_redA' : 'flower_yellowA', 3, x + 1.2, z + 0.5);
    } else if (kind === 'highway') {
      if (x < -14) return;
      // Cacti only: sand-coloured rocks vanished on the desert.
      prop(g, i % 2 ? 'cactus_short' : 'cactus_tall', 3.4, x, z, i);
    } else if ((z > 0 || x < AIRPORT_GARAGE[0] - 3.5) && x > -14) planter(g, x, z, 1.4);
  });
  if (kind === 'town') {
    // Neighbourhood beyond the top sidewalk: houses and shops facing the lot, cars parked at the kerb, benches and street lights.
    add(g, B(30, 0.06, 1.6), mat(C.sidewalk), -1, 0.03, -20);
    TOWN_HOUSES.forEach(([name, x]) => { const h = kitModel(name, 2.4); h.position.set(x, 0, -23.2); g.add(h); });
    TOWN_CARS.forEach(([name, x]) => { const c = kitModel(name, CAR_K, Math.PI / 2); c.position.set(x, 0, -21.1); g.add(c); });
    for (const x of [-11, -0.8, 8]) { const l = kitModel('streetlight', 3, Math.PI / 2); l.position.set(x, 0, -19.4); g.add(l); }
    for (const x of [-9, 3.6]) { const b = kitModel('bench', 3); b.position.set(x, 0, -19.6); g.add(b); }
    // Greenfield Park on the open grass left of the lot: footpaths, a fountain with benches, a playground, a duck pond and the town library.
    add(g, B(1.2, 0.04, 36), mat(C.sidewalk), -16.3, 0.02, 2);
    add(g, B(7, 0.04, 1.2), mat(C.sidewalk), -19.5, 0.02, -6);
    add(g, shape('Cylinder', 1.6, 1.7, 0.5, 20), mat(C.curb), -19.5, 0.25, -6);
    add(g, shape('Cylinder', 1.4, 1.4, 0.06, 20), glow(C.bubble, 0.25), -19.5, 0.5, -6);
    add(g, shape('Cylinder', 0.2, 0.25, 1.2, 10), mat(C.curb), -19.5, 0.9, -6);
    add(g, shape('Cylinder', 0.6, 0.3, 0.25, 14), mat(C.curb), -19.5, 1.5, -6);
    add(g, shape('Sphere', 0.3, 12, 8), glow(C.bubble, 0.4), -19.5, 1.75, -6);
    for (const [x, z, r] of [[-17.2, -8.4, 0], [-21.8, -8.4, 0], [-17.2, -3.6, Math.PI], [-21.8, -3.6, Math.PI]]) { const b = kitModel('bench', 3, r); b.position.set(x, 0, z); g.add(b); }
    add(g, B(1.2, 1.6, 1.2), mat(C.siren), -18.5, 0.8, 4.6);
    add(g, shape('Cone', 1, 0.8, 4), mat(C.mustard), -18.5, 2, 4.6).rotation.y = Math.PI / 4;
    add(g, B(0.8, 0.08, 2.6), mat(C.shuttle), -18.5, 0.8, 6.3).rotation.x = 0.55;
    for (const z of [4.2, 7.8]) for (const dx of [-0.5, 0.5]) add(g, B(0.15, 2.3, 0.15), mat(C.truck), -21.5 + dx, 1.15, z).rotation.z = dx * 0.5;
    add(g, B(0.15, 0.15, 3.8), mat(C.truck), -21.5, 2.25, 6);
    for (const z of [5.3, 6.7]) {
      for (const dz of [-0.2, 0.2]) add(g, B(0.03, 1.6, 0.03), mat(C.pole), -21.5, 1.45, z + dz);
      add(g, B(0.6, 0.08, 0.45), mat(C.siren), -21.5, 0.65, z);
    }
    add(g, B(2.4, 0.25, 2.4), mat(C.counter), -19, 0.12, 10);
    add(g, B(2.1, 0.27, 2.1), mat(C.bread), -19, 0.13, 10);
    const pond = add(g, shape('Cylinder', 2.6, 2.6, 0.06, 28), glow(C.shuttle, 0.15), -19.8, 0.03, 16.5);
    pond.scale.x = 1.4;
    for (const [x, z] of [[-21.5, 15.8], [-18.4, 17.4], [-20.6, 18]]) add(g, shape('Cylinder', 0.35, 0.35, 0.04, 10), mat(C.lettuce), x, 0.08, z);
    for (const [x, z] of [[-19.4, 15.6], [-20.4, 16.6]]) {
      add(g, B(0.4, 0.25, 0.25), mat(C.paint), x, 0.18, z);
      add(g, B(0.16, 0.2, 0.16), mat(C.paint), x + 0.18, 0.38, z);
      add(g, B(0.1, 0.06, 0.08), mat(C.mustard), x + 0.3, 0.38, z);
    }
    const library = kitModel('building_G', 3.4, Math.PI / 2);
    library.position.set(-21.5, 0, -13.5);
    g.add(library);
    sign('GREENFIELD PARK', -17.6, -16, 3.6, C.sign);
    for (const [x, z, i] of [[-23.4, -2, 0], [-23.4, 11, 1], [-17, 13.2, 0], [-23, 21, 1], [-16.8, 21.5, 0]]) prop(g, i ? 'tree_oak' : 'tree_default', 2.6, x, z, i);
    // Across the road: a row of town shops and houses facing the street.
    // The tall blocks go without ink: at their size a hull scaled with them swallows the roofs in a dark slab.
    for (const [name, x, z] of CONFIG.world.cityBlocks) { const b = kitModel(name, 3.4, -Math.PI / 2); b.position.set(x, 0, z); b.traverse((m) => { m.userData.noInk = true; }); g.add(b); }
  } else if (kind === 'highway') {
    // Open desert: a big roadside billboard above the lot, and an open-air outlet mall with its car park to the left.
    for (const x of [-4.5, -1.5]) add(g, B(0.25, 3.6, 0.25), mat(C.pole), x, 1.8, -20.4);
    const bill = add(g, B(7, 2.4, 0.2), mat(C.signBoard), -3, 4.2, -20.4);
    bill.rotation.x = -0.35;
    const ad = textPlane('EV ⚡ CHARGE · EAT · REST', 6.6, 1.4, C.battery);
    ad.position.z = 0.11;
    bill.add(ad);
    MALL.forEach(([name, color], i) => {
      const z = -12 + i * 8;
      add(g, B(5, 2.6, 5), mat(C.paint), -19, 1.3, z);
      add(g, B(5.2, 0.3, 5.2), mat(C[color]), -19, 2.75, z);
      awning(g, 4.6, -19, 2, z + 2.9, 1, C[color]);
      leanBoard(g, name, 3.6, C[color], C.paint, 3.5, z + 2.4).position.x = -19;
      const car = kitModel(['car_sedan', 'car_hatchback'][i % 2], CAR_K);
      car.position.set(-15, 0, z + 1);
      g.add(car);
    });
    add(g, B(0.3, 5, 0.3), mat(C.pole), -14.5, 2.5, -17);
    add(g, B(5.4, 1.4, 0.2), mat(C.shuttle), -14.5, 5.4, -17).add(textPlane('ROUTE 9 OUTLETS', 5, 1.1, C.paint));
    // Mall plaza: a striped car park beside the shops, café umbrellas between them, cactus planters, shopping carts and sale flags.
    add(g, B(3.6, 0.04, 30), mat(C.charger), -15.2, 0.02, 0);
    for (let z = -14; z <= 14; z += 2.4) add(g, B(3.2, 0.03, 0.08), mat(C.paint), -15.2, 0.05, z);
    for (const z of [-8, 0, 8]) {
      add(g, B(0.08, 1.6, 0.08), mat(C.pole), -19, 0.8, z);
      add(g, shape('Cone', 1, 0.45, 8), mat(z ? C.umbrella : C.mustard), -19, 1.75, z);
      for (const dx of [-0.7, 0.7]) add(g, B(0.45, 0.45, 0.45), mat(C.paint), -19 + dx, 0.22, z);
    }
    for (const z of [-16.5, 15.5]) { planter(g, -17.2, z); prop(g, 'cactus_tall', 3.4, -21, z, 0); }
    for (const [x, z] of [[-17.4, -2.2], [-17.8, -1.6], [-17.3, 6.2]]) { add(g, B(0.5, 0.35, 0.7), mat(C.guardrail), x, 0.45, z); add(g, B(0.04, 0.4, 0.04), mat(C.pole), x, 0.2, z + 0.3); }
    for (const [z, color] of [[-14, C.siren], [-6, C.shuttle], [2, C.mustard], [10, C.battery]]) {
      add(g, B(0.08, 3.2, 0.08), mat(C.pole), -16.8, 1.6, z);
      add(g, B(0.05, 1.2, 0.6), mat(color), -16.8, 2.6, z + 0.32);
    }
  } else if (kind === 'airport') {
    // In front of the runway: a low parking garage with cars on its deck, and a glass terminal wing with its own board.
    const [gx, gz] = AIRPORT_GARAGE;
    add(g, B(6, 0.3, 3.4), mat(C.curb), gx, 1.4, gz);
    for (const x of [gx - 2.8, gx + 2.8]) for (const z of [gz - 1.4, gz + 1.4]) add(g, B(0.4, 1.4, 0.4), mat(C.curb), x, 0.7, z);
    add(g, B(6, 0.5, 0.15), mat(C.shuttle), gx, 1.8, gz + 1.75).add(textPlane('P  PARKING', 5.6, 0.45, C.paint));
    for (const [i, name] of ['car_sedan', 'car_taxi', 'car_hatchback'].entries()) { const c = kitModel(name, CAR_K); c.position.set(gx - 1.8 + i * 1.8, 1.55, gz - 0.2); g.add(c); }
    add(g, B(4.4, 3, 3.2), mat(C.glass), gx + 6.2, 1.5, gz);
    add(g, B(4.6, 0.3, 3.4), mat(C.shuttle), gx + 6.2, 3.1, gz);
    leanBoard(g, 'TERMINAL B', 4, C.shuttle, C.paint, 3.6, gz + 1.2).position.x = gx + 6.2;
    // Apron left of the terminal: parked planes nose-in on a grey slab.
    add(g, B(12, 0.04, 44), mat(C.curb), -19, 0.02, 2);
    for (const z of [-15, 3, 12, 21]) {
      const plane = buildPlane();
      plane.scale.setScalar(1.4);
      plane.rotation.y = Math.PI;
      plane.position.set(-16, 0.9, z);
      g.add(plane);
    }
    // Apron life: a yellow taxi line with blue edge lights, a baggage tug pulling loaded carts, a fuel truck and a windsock.
    add(g, B(0.15, 0.03, 44), mat(C.mustard), -20.6, 0.05, 2);
    for (let z = -19; z <= 23; z += 3) add(g, shape('Sphere', 0.12, 8, 6), glow(C.shuttle, 1), -22.4, 0.1, z);
    [[-7, -17.5], [7.5, -18.5]].forEach(([z, tug], k) => {
      const train = new THREE.Group();
      add(train, B(0.9, 0.5, 0.6), mat(C.mustard), 0, 0.3, 0);
      add(train, B(0.3, 0.3, 0.5), mat(C.glass), 0.2, 0.7, 0);
      for (let i = 1; i <= 3; i++) {
        add(train, B(0.8, 0.12, 0.55), mat(C.pole), -i * 1.05, 0.3, 0);
        add(train, B(0.55, 0.35, 0.4), mat([C.luggage, C.siren, C.shuttle][i - 1]), -i * 1.05, 0.55, 0);
      }
      train.position.set(tug, 0, z);
      g.add(train);
      anims.push((dt, t) => { train.position.z = z + Math.sin(t * 0.25 + k * 2) * 3; });
    });
    const fuel = kenneyModel('truck', TRUCK_K * 0.8, Math.PI);
    fuel.position.set(-19.5, 0, 16.5);
    g.add(fuel);
    add(g, B(0.08, 2.6, 0.08), mat(C.pole), -23.2, 1.3, -18);
    const sock = new THREE.Group();
    add(sock, shape('Cone', 0.3, 1.1, 8), mat(C.truck), 0.55, 0, 0).rotation.z = Math.PI / 2;
    sock.position.set(-23.2, 2.4, -18);
    g.add(sock);
    anims.push((dt, t) => { sock.rotation.y = Math.sin(t * 1.3) * 0.4; });
    // Radar mast by the fence with a dish that sweeps round.
    add(g, B(0.3, 4, 0.3), mat(C.pole), -24.5, 2, -20);
    const radar = new THREE.Group();
    add(radar, B(2.2, 1, 0.15), mat(C.paint), 0, 0, 0.2).rotation.x = -0.4;
    add(radar, B(0.2, 0.2, 0.5), mat(C.pole), 0, 0, 0);
    radar.position.set(-24.5, 4.2, -20);
    g.add(radar);
    anims.push((dt) => { radar.rotation.y += dt * 1.6; });
    // Runway edge lights chase toward the threshold like approach strobes.
    const strobes = [];
    for (let x = -34; x <= 8; x += 3) strobes.push(add(g, B(0.3, 0.12, 0.3), glow(C.paint, 1.2), x, 0.1, -26.7));
    anims.push((dt, t) => { const on = Math.floor(t * 10) % strobes.length; strobes.forEach((l, i) => l.scale.setScalar(i === on ? 2.4 : 1)); });
    // Helicopter circling the hotel's rooftop helipad.
    add(g, shape('Cylinder', 1.4, 1.4, 0.1, 20), mat(C.charger), 20.8, 8.05, 15);
    add(g, B(0.25, 0.02, 1.2), mat(C.paint), 20.5, 8.12, 15);
    add(g, B(0.25, 0.02, 1.2), mat(C.paint), 21.1, 8.12, 15);
    add(g, B(0.6, 0.02, 0.25), mat(C.paint), 20.8, 8.12, 15);
    const heli = new THREE.Group(), rotor = new THREE.Group();
    add(heli, shape('Sphere', 0.6, 12, 10), mat(C.siren), 0, 0, 0).scale.x = 1.4;
    add(heli, B(1.6, 0.18, 0.18), mat(C.siren), -1.3, 0.1, 0);
    add(heli, B(0.1, 0.5, 0.3), mat(C.siren), -2.05, 0.3, 0);
    add(heli, B(0.4, 0.3, 0.6), mat(C.glass), 0.45, 0.1, 0);
    add(rotor, B(3.2, 0.05, 0.18), mat(C.charger), 0, 0, 0);
    add(rotor, B(0.18, 0.05, 3.2), mat(C.charger), 0, 0, 0);
    rotor.position.y = 0.7;
    heli.add(rotor);
    g.add(heli);
    anims.push((dt, t) => { const a = t * 0.35; heli.position.set(20.8 + Math.cos(a) * 5, 11 + Math.sin(t) * 0.3, 15 + Math.sin(a) * 5); heli.rotation.y = -a - Math.PI / 2; rotor.rotation.y += dt * 20; });
    balloon(-4, 12, -12, C.mustard, C.siren, 1);
    balloon(-16, 11, 6, C.shuttle, C.paint, 3);
  }
  if (kind === 'highway') {
    // Truck parking with parked rigs and guardrails along the road.
    for (const z of [10.2, 12.8]) { const t = kenneyModel('truck', TRUCK_K, -Math.PI / 2); t.position.set(9.5, 0, z); g.add(t); }
    sign('TRUCK STOP', 6, 9.6, 2.6, C.truck);
    for (let z = -15; z < 20; z += 2.5) add(g, B(0.12, 0.45, 2.2), mat(C.guardrail), 14.2, 0.35, z);
    // Desert road life: wooden telephone poles with sagging wires along the far roadside, tumbleweeds and dry grass tufts on the sand.
    for (let z = -26; z <= 30; z += 8) {
      add(g, B(0.2, 5, 0.2), mat(C.counter), 18.9, 2.5, z);
      add(g, B(1.4, 0.12, 0.12), mat(C.counter), 18.9, 4.6, z);
      if (z < 30) for (const dx of [-0.6, 0.6]) add(g, B(0.03, 0.03, 8), mat(C.cable), 18.9 + dx, 4.45, z + 4);
    }
    for (const [x, z, r] of [[-12.6, -17.6, 0.45], [20.5, 8, 0.55], [-23, 5, 0.5], [24, -14, 0.45], [-15, 21.5, 0.5], [7, -27, 0.55]]) {
      const weed = add(g, shape('Icosahedron', r, 0), mat(C.bunTop), x, r, z);
      weed.material = weed.material.clone();
      weed.material.wireframe = true;
    }
    for (const [x, z] of [[-13, -9], [-12.8, 4], [19.6, -18], [23, 23], [-22, -20], [12, -24], [-13.2, 16], [25, 0]]) {
      for (const d of [-0.18, 0, 0.18]) add(g, shape('Cone', 0.06, 0.6, 4), mat(C.bun), x + d, 0.3, z + d * 0.6).rotation.z = d;
    }
  } else if (kind === 'airport') {
    // Terminal front with its sign, a shuttle bus and luggage carts, and a taxi rank in the free top corner.
    add(g, B(3.2, 4, 7), mat(C.wall), -12.6, 2, -6);
    add(g, B(3.26, 1.2, 7.06), mat(C.shuttle), -12.6, 2.6, -6);
    add(g, B(3.4, 0.3, 7.2), mat(C.curb), -12.6, 4.15, -6);
    sign('TERMINAL', -10.4, -2, 3, C.shuttle);
    const shuttle = buildBus(C.shuttle);
    shuttle.position.set(8.5, 0, 11.2);
    g.add(shuttle);
    for (const [x, z] of [[4.5, 12.6], [5.5, 12.6], [6.5, 12.6]]) { add(g, B(0.8, 0.12, 0.5), mat(C.pole), x, 0.35, z); add(g, B(0.6, 0.5, 0.4), mat(C.luggage), x, 0.66, z); }
    sign('TAXI', 8.2, -14.4, 1.8, C.mustard);
    // Airfield edge: a chain-link fence along the runway side, a row of flags by the hotel and modern light posts along the road.
    for (let x = -26; x <= 12; x += 3) add(g, B(0.1, 1.6, 0.1), mat(C.pole), x, 0.8, -21.4);
    const mesh = add(g, B(38, 1.4, 0.03), new THREE.MeshBasicMaterial({ color: C.guardrail, transparent: true, opacity: 0.35 }), -7, 0.8, -21.4);
    mesh.userData.noInk = true;
    add(g, B(38, 0.08, 0.08), mat(C.pole), -7, 1.6, -21.4);
    [C.siren, C.shuttle, C.mustard, C.battery, C.luggage].forEach((color, i) => {
      add(g, B(0.08, 3.4, 0.08), mat(C.paint), 18.8, 1.7, 3 + i * 1.2);
      add(g, B(0.04, 0.6, 0.9), mat(color), 18.8, 3, 3.45 + i * 1.2);
    });
    for (const z of [-18, -2, 14, 26]) prop(g, 'lightPostModern', 3, 18.9, z, -Math.PI / 2);
    // Travelers with rolling suitcases wait at the terminal doors, swaying a little; white chevrons on the walkway point the way to the gates.
    [[-10.4, -4.4, C.drivers[0]], [-10.6, -2.6, C.drivers[2]], [-10.3, -0.8, C.drivers[4]]].forEach(([x, z, color], i) => {
      const who = buildPerson(color);
      who.position.set(x, 0, z);
      who.rotation.y = Math.PI / 2;
      g.add(who);
      add(g, B(0.45, 0.6, 0.3), mat([C.luggage, C.siren, C.mustard][i]), x + 0.55, 0.38, z + 0.3);
      add(g, B(0.04, 0.4, 0.04), mat(C.pole), x + 0.55, 0.88, z + 0.3);
      anims.push((dt, t) => { who.rotation.y = Math.PI / 2 + Math.sin(t * 0.8 + i * 2) * 0.35; });
    });
    for (let x = -7; x <= 9; x += 4) for (const d of [-1, 1]) {
      const bar = add(g, B(0.7, 0.02, 0.14), new THREE.MeshBasicMaterial({ color: C.paint, transparent: true, opacity: 0.55 }), x, 0.03, CONFIG.world.bays[0][1] - CONFIG.world.aisle + d * 0.22);
      bar.rotation.y = d * 0.6;
      bar.userData.noInk = true;
    }
    // Across the road: a rental car lot with its booth and an airport hotel tower.
    add(g, B(5.6, 0.04, 13), mat(C.charger), 21, 0.02, -6);
    for (let i = 0; i < 9; i++) { const c = kitModel(['car_sedan', 'car_hatchback', 'car_stationwagon'][i % 3], CAR_K, -Math.PI / 2); c.position.set(19.4 + (i % 3) * 1.8, 0, -10.5 + Math.floor(i / 3) * 3.6); g.add(c); }
    add(g, B(1.6, 1.4, 1.2), mat(C.shuttle), 19.6, 0.7, 1.4);
    sign('RENT A CAR', 20.8, 1.6, 3, C.mustard);
    add(g, B(3.6, 8, 4), mat(C.wall), 20.8, 4, 15);
    for (let y = 1.5; y < 8; y += 1.6) add(g, B(3.66, 0.5, 4.06), mat(C.shuttle), 20.8, y, 15);
    add(g, B(3.4, 0.8, 0.1), mat(C.shuttle), 20.8, 8.6, 17.05).add(textPlane('SKY HOTEL', 3.4, 0.7, C.paint));
    // Around the rental lot, what a traveller spots first: a blue P tower, a striped windsock that swings in the wind and a dish
    // turning on the rental booth.
    add(g, B(0.4, 2.6, 0.4), mat(C.pole), 17.6, 1.3, -12.4);
    const letter = textPlane('P', 1.8, 1.8, C.paint);
    letter.position.z = 0.16;
    add(g, B(2.2, 2.2, 0.3), mat(C.police), 17.6, 3.6, -12.4).add(letter);
    add(g, B(0.15, 3, 0.15), mat(C.pole), 21, 1.5, -13.8);
    const lotSock = new THREE.Group();
    for (let i = 0; i < 5; i++) add(lotSock, shape('Cylinder', 0.42 - i * 0.06, 0.36 - i * 0.06, 0.5, 10, 1, true), mat(i % 2 ? C.paint : C.siren), 0, 0, 0.3 + i * 0.5).rotation.x = Math.PI / 2;
    lotSock.position.set(21, 2.8, -13.8);
    g.add(lotSock);
    add(g, B(0.15, 0.8, 0.15), mat(C.pole), 19.6, 1.8, 1.4);
    const dish = add(g, shape('Cylinder', 0.7, 0.3, 0.25, 16), mat(C.paint), 19.6, 2.3, 1.4);
    dish.rotation.x = 1.1;
    anims.push((dt, t) => { lotSock.rotation.y = Math.sin(t * 0.7) * 0.6 - 0.4; lotSock.rotation.x = Math.sin(t * 2.3) * 0.05; dish.rotation.z += dt * 1.5; });
  }
  if (kind === 'highway') {
    // Across the road: an EV motel with its neon sign, a water tower and wind turbines; flat-topped mesas and more turbines beyond the billboard.
    add(g, B(2.6, 1.6, 9), mat(C.wall), 20.6, 0.8, -6);
    add(g, B(3, 0.25, 9.4), mat(C.truck), 20.6, 1.7, -6);
    for (let z = -9.6; z < -2; z += 1.8) add(g, B(0.06, 1, 0.6), mat(C.shuttle), 19.28, 0.5, z);
    sign('EV MOTEL', 19.4, -11.8, 2.6, C.siren);
    for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) add(g, B(0.15, 4, 0.15), mat(C.pole), 21 + dx, 2, 4 + dz);
    add(g, B(2, 1.4, 2), mat(C.paint), 21, 4.7, 4).add(textPlane('ROUTE 9', 1.8, 0.5, C.sign)).position.z = 1.01;
    for (const [x, z] of [[20, 12], [22, 19], [20, 26], [-11, -22], [9, -22]]) {
      add(g, B(0.3, 7, 0.3), mat(C.paint), x, 3.5, z);
      const hub = add(g, B(0.6, 0.6, 0.8), mat(C.paint), x, 7, z + 0.3), speed = 1.2 + (x + z) % 3 * 0.2;
      anims.push((dt) => { hub.rotation.z += dt * speed; });
      for (let i = 0; i < 3; i++) {
        const arm = new THREE.Group();
        arm.rotation.z = i * 2.09;
        arm.position.z = 0.42;
        hub.add(arm);
        add(arm, B(0.25, 3, 0.06), mat(C.paint), 0, 1.5, 0);
      }
    }
    // Monument-valley buttes on the horizon: stacked red rock layers narrowing toward a flat top.
    for (const [x, w, h] of [[-14, 7, 6], [1, 10, 4.5], [24, 6, 7]]) {
      for (let i = 0, y = 0; i < 4; i++) {
        const lh = h / 4, k = 1 - i * 0.12;
        add(g, B(w * k, lh, 4 * k), mat(C.mesa[i % C.mesa.length]), x, y + lh / 2, -26);
        y += lh;
      }
    }
    // A raised object shows higher on screen, so balloons sit nearer than they look: over the mall, across the road and above the kitchen row.
    balloon(-15, 10, 4, C.siren, C.mustard, 0);
    balloon(19.5, 11, 0, C.shuttle, C.paint, 2);
    balloon(7, 12, -12, C.battery, C.luggage, 4);
    // Vultures circling high over the desert.
    for (let i = 0; i < 3; i++) {
      const bird = new THREE.Group();
      add(bird, B(1, 0.06, 0.3), mat(C.charger), 0, 0, 0).rotation.z = 0.3;
      add(bird, B(1, 0.06, 0.3), mat(C.charger), 0.9, 0, 0).rotation.z = -0.3;
      g.add(bird);
      anims.push((dt, t) => { const a = t * 0.5 + i * 2.1; bird.position.set(Math.cos(a) * 4, 9 + i * 0.4, -14 + Math.sin(a) * 3); bird.rotation.y = -a; });
    }
    highwayShow(g, anims, sign);
  }
  if (kind === 'hotel') {
    // Sunset Bay: the sea and a palm-lined beach on the left with a lighthouse and sailboats, the hotel with its pool beside the lot,
    // beach huts above, and across the road an ice cream truck and a surf shop. At night the hotel windows and the lighthouse glow.
    const sea = add(g, B(30, 0.1, 90), mat(C.sea), -34.5, -0.1, 2);
    sea.receiveShadow = false;
    const foam = [];
    for (let z = -30; z <= 34; z += 4) foam.push(add(g, B(0.25, 0.04, 2.6), mat(C.paint), -19.9, -0.02, z));
    anims.push((dt, t) => foam.forEach((f, i) => { f.position.x = -19.9 - Math.abs(Math.sin(t * 0.8 + i)) * 1.2; }));
    for (const z of [-14, 6, 16, 25]) prop(g, z % 2 ? 'tree_palmBend' : 'tree_palm', 3, -19, z, z);
    for (const [z, a, b] of [[9, C.siren, C.paint], [13.5, C.shuttle, C.mustard], [20, C.battery, C.paint]]) {
      add(g, B(0.08, 1.6, 0.08), mat(C.pole), -18.4, 0.8, z);
      add(g, shape('Cone', 1, 0.45, 8), mat(a), -18.4, 1.75, z);
      add(g, B(0.8, 0.03, 1.6), mat(b), -17.4, 0.03, z + 1.2);
    }
    // Lighthouse on its rock with a lamp that pulses after dark.
    add(g, shape('Icosahedron', 2, 0), mat(C.curb), -23.5, 0, -16).scale.y = 0.5;
    for (let i = 0; i < 4; i++) add(g, shape('Cylinder', 0.7 - i * 0.07, 0.75 - i * 0.07, 1.4, 12), mat(i % 2 ? C.paint : C.siren), -23.5, 1.5 + i * 1.4, -16);
    const lamp = add(g, shape('Sphere', 0.5, 12, 8), glow(C.headlight, 0.4).clone(), -23.5, 7.4, -16);
    add(g, shape('Cone', 0.7, 0.6, 12), mat(C.siren), -23.5, 8.1, -16);
    // Sailboats rocking and drifting on the bay.
    [[-23, -4, C.siren], [-26, 9, C.shuttle], [-23.5, 20, C.mustard]].forEach(([x, z, sail], i) => {
      const boat = new THREE.Group();
      add(boat, B(2.2, 0.45, 0.8), mat(C.paint), 0, 0.2, 0);
      add(boat, B(0.08, 2.4, 0.08), mat(C.pole), 0.2, 1.6, 0);
      add(boat, B(0.06, 1.8, 1.1), mat(sail), 0.2, 1.7, 0.4).rotation.x = 0.1;
      boat.position.set(x, 0, z);
      g.add(boat);
      anims.push((dt, t) => { boat.rotation.x = Math.sin(t * 1.2 + i) * 0.08; boat.position.z = z + Math.sin(t * 0.1 + i * 2) * 3; });
    });
    // The hotel: white floors with coral bands, lit windows, a lobby canopy toward the lot (the valet drop-off) and its name on the roof.
    add(g, B(5, 7, 10), mat(C.paint), -16, 3.5, -6);
    for (let y = 1.4; y < 7; y += 1.4) add(g, B(5.06, 0.18, 10.06), mat(C.sofa), -16, y, -6);
    const windows = glow(C.headlight, 0).clone();
    for (let y = 0.7; y < 7; y += 1.4) for (let x = -17.8; x <= -14.2; x += 1.2) add(g, B(0.7, 0.6, 0.05), windows, x, y, -0.98);
    add(g, B(1.4, 0.15, 3), mat(C.sofa), -12.9, 2.2, -6);
    for (const z of [-7.3, -4.7]) add(g, B(0.1, 2.2, 0.1), mat(C.pole), -12.3, 1.1, z);
    add(g, B(5.2, 1, 0.15), mat(C.sofa), -16, 7.6, -1.2).add(textPlane('SUNSET BAY', 4.8, 0.8, C.paint));
    // Pool with loungers and umbrellas in front of the hotel.
    add(g, B(4.6, 0.12, 3.4), mat(C.paint), -16, 0.06, 3);
    add(g, B(4, 0.14, 2.8), glow(C.bubble, 0.3), -16, 0.08, 3);
    for (const x of [-17.4, -14.6]) prop(g, 'loungeChairRelax', 2.4, x, 5.6, Math.PI);
    // Beach huts with thatched roofs above the lot, and white gulls circling over them.
    for (const x of [-7, -2, 3, 8]) {
      add(g, B(2.4, 1.6, 2), mat(C.bread), x, 0.8, -21);
      add(g, shape('Cone', 1.9, 1.2, 4), mat(C.counter), x, 2.2, -21).rotation.y = Math.PI / 4;
    }
    for (let i = 0; i < 3; i++) {
      const gull = new THREE.Group();
      add(gull, B(0.9, 0.05, 0.25), mat(C.paint), 0, 0, 0).rotation.z = 0.35;
      add(gull, B(0.9, 0.05, 0.25), mat(C.paint), 0.8, 0, 0).rotation.z = -0.35;
      g.add(gull);
      anims.push((dt, t) => { const a = t * 0.6 + i * 2.1; gull.position.set(-4 + Math.cos(a) * 4, 8 + i * 0.3, -12 + Math.sin(a) * 2.5); gull.rotation.y = -a; });
    }
    // Across the road: an ice cream truck, a surf shop with boards and palms along the promenade.
    add(g, B(2.2, 1.6, 4), mat(C.sofa), 21, 0.8, -4);
    add(g, B(2.24, 0.5, 4.04), mat(C.paint), 21, 1.1, -4);
    add(g, shape('Cone', 0.45, 1, 10), mat(C.bread), 21, 2.2, -4).rotation.x = Math.PI;
    add(g, shape('Sphere', 0.5, 10, 8), mat(C.washBrush), 21, 2.8, -4);
    add(g, B(3.4, 2.2, 3.4), mat(C.shuttle), 21.5, 1.1, 8);
    add(g, B(3.6, 0.3, 3.6), mat(C.mustard), 21.5, 2.35, 8);
    add(g, B(3.2, 0.6, 0.1), mat(C.mustard), 21.5, 2.9, 9.75).add(textPlane('SURF', 2.8, 0.5, C.charger));
    [C.siren, C.battery, C.mustard].forEach((c, i) => add(g, B(0.5, 2, 0.1), mat(c), 19.6, 1, 6.8 + i * 0.7).rotation.z = 0.25);
    for (const z of [2, 16, 26]) prop(g, 'tree_palm', 3, 19.5, z, z);
    // Around the ice cream truck, a beach club: a giant pink flamingo float, a volleyball net with a bouncing ball, and a striped
    // umbrella over a sun lounger.
    const flamingo = new THREE.Group();
    add(flamingo, shape('Torus', 1.1, 0.5, 10, 20), mat('#ff7ab8'), 0, 0.5, 0).rotation.x = Math.PI / 2;
    add(flamingo, shape('Cylinder', 0.22, 0.28, 2.6, 10), mat('#ff7ab8'), 0, 1.9, -1).rotation.x = 0.3;
    add(flamingo, shape('Sphere', 0.5, 12, 10), mat('#ff7ab8'), 0, 3.25, -0.6);
    add(flamingo, shape('Cone', 0.18, 0.6, 8), mat(C.charger), 0, 3.15, -0.05).rotation.x = Math.PI / 2;
    flamingo.position.set(21.2, 0, -9.6);
    g.add(flamingo);
    for (const x of [18.6, 23.4]) add(g, B(0.12, 2.4, 0.12), mat(C.pole), x, 1.2, -13.5);
    add(g, B(4.8, 0.7, 0.04), mat(C.paint), 21, 2.1, -13.5);
    const ball = add(g, shape('Sphere', 0.3, 10, 8), mat(C.mustard), 21, 3, -13.5);
    add(g, B(0.08, 2.2, 0.08), mat(C.pole), 18.2, 1.1, -9.4);
    awning(g, 2.2, 18.2, 2.2, -9.4, 2.2, C.siren);
    add(g, B(0.8, 0.25, 1.8), mat(C.paint), 18.8, 0.3, -8.2);
    anims.push((dt, t) => { flamingo.rotation.y = Math.sin(t * 0.6) * 0.25; ball.position.set(21 + Math.sin(t * 1.4) * 1.8, 2.9 + Math.abs(Math.sin(t * 2.8)) * 1.6, -13.5 + Math.cos(t * 1.4) * 1.5); });
    g.userData.night = (k) => { windows.emissiveIntensity = k * 2; lamp.material.emissiveIntensity = 0.4 + k * 3; };
  }
  if (kind === 'mall') {
    // Sunset Plaza: a row of shopfronts and a cinema above the lot, a plaza with a fountain, food court and turning ferris wheel on
    // the left with shoppers carrying bags, and a parking garage with the plaza's sign tower across the road. Flash sales hang SALE boards.
    const sales = [];
    [['BOOKS', C.shuttle], ['SHOES', C.siren], ['TOYS', C.mustard], ['TECH', C.charger], ['GIFTS', C.battery]].forEach(([name, color], i) => {
      const x = -5 + i * 4.4;
      add(g, B(4, 3.2, 3), mat(C.paint), x, 1.6, -23);
      add(g, B(3.2, 1.6, 0.06), mat(C.glass), x, 1.1, -21.48);
      awning(g, 4, x, 2.3, -21.2, 0.8, color);
      leanBoard(g, name, 3, color, C.paint, 3.7, -21.6).position.x = x;
      const sale = add(g, B(1.6, 0.6, 0.08), mat(C.siren), x, 1.2, -21.4);
      sale.add(textPlane('SALE', 1.5, 0.5, C.paint));
      sale.visible = false;
      sales.push(sale);
    });
    add(g, B(6, 4.6, 4), mat(C.purple), -12.5, 2.3, -23);
    leanBoard(g, 'CINEMA', 4.6, C.purple, C.paint, 5, -21).position.x = -12.5;
    const marquee = add(g, B(5, 0.3, 0.1), glow(C.headlight, 0.6).clone(), -12.5, 3.9, -20.95);
    anims.push((dt, t) => { marquee.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(t * 3)) * 0.8; });
    g.userData.sale = (on) => sales.forEach((b) => { b.visible = on; });
    // Plaza: fountain, food court umbrellas and a ferris wheel that turns with its cabins kept level.
    add(g, shape('Cylinder', 1.6, 1.7, 0.5, 20), mat(C.curb), -17, 0.25, -12);
    add(g, shape('Cylinder', 1.4, 1.4, 0.06, 20), glow(C.bubble, 0.25), -17, 0.5, -12);
    add(g, shape('Cylinder', 0.2, 0.25, 1.2, 10), mat(C.curb), -17, 0.9, -12);
    for (const [x, z, color] of [[-15.5, -5, C.siren], [-15.8, -1, C.shuttle]]) {
      add(g, B(0.08, 1.6, 0.08), mat(C.pole), x, 0.8, z);
      add(g, shape('Cone', 1, 0.45, 8), mat(color), x, 1.75, z);
      add(g, B(0.9, 0.5, 0.9), mat(C.paint), x, 0.25, z);
    }
    for (const dz of [-1.2, 1.2]) for (const dx of [-1, 1]) add(g, B(0.25, 6, 0.25), mat(C.pole), -17.5 + dx * 0.9, 3, 12 + dz).rotation.z = -dx * 0.15;
    const wheel = new THREE.Group(), cabins = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      add(wheel, B(0.15, 7, 0.15), mat(C.paint), 0, 0, 0).rotation.z = a;
      const cabin = add(wheel, B(0.8, 0.7, 0.8), mat([C.siren, C.mustard, C.shuttle, C.battery][i % 4]), Math.cos(a) * 3.5, Math.sin(a) * 3.5, 0);
      cabins.push(cabin);
    }
    wheel.position.set(-17.5, 6.2, 12);
    g.add(wheel);
    anims.push((dt) => { wheel.rotation.z += dt * 0.25; cabins.forEach((c) => { c.rotation.z = -wheel.rotation.z; }); });
    // Shoppers stroll the plaza with their bags.
    for (let i = 0; i < 5; i++) {
      const who = buildPerson(C.drivers[i % C.drivers.length]);
      add(who, B(0.35, 0.4, 0.15), mat([C.siren, C.purple, C.mustard][i % 3]), 0.35, 0.5, 0);
      g.add(who);
      const z = -16 + i * 7, phase = i * 1.7;
      anims.push((dt, t) => { const x = -14.5 + Math.sin(t * 0.3 + phase) * 1.5; who.position.set(x, 0, z); who.rotation.y = Math.cos(t * 0.3 + phase) > 0 ? Math.PI / 2 : -Math.PI / 2; stepPerson(who, 1, dt); });
    }
    // Landmarks a passer-by remembers, the way real roadside malls do it: a giant pink donut turning on a pole by the plaza, a big LED
    // screen over the shops that flips between sale messages, pennant bunting along the shopfronts, a balloon arch over the plaza walk,
    // a carousel with bobbing horses, dancing fountain jets and an ice cream cart under a giant cone.
    const donut = new THREE.Group();
    add(donut, shape('Torus', 1.3, 0.62, 14, 28), mat(C.bun), 0, 0, 0);
    const icing = add(donut, shape('Torus', 1.32, 0.5, 12, 28), mat('#ff7ab8'), 0, 0, 0.16);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2, r = 1.3 + (i % 3 - 1) * 0.28;
      add(icing, B(0.24, 0.07, 0.07), mat([C.paint, C.mustard, C.shuttle, C.battery][i % 4]), Math.cos(a) * r, Math.sin(a) * r, 0.5).rotation.z = a * 3;
    }
    donut.position.set(-11.4, 4.6, -10);
    g.add(donut);
    add(g, B(0.3, 3.2, 0.3), mat(C.pole), -11.4, 1.6, -10);
    anims.push((dt) => { donut.rotation.y += dt * 0.8; });

    const screen = add(g, B(7.4, 2.4, 0.2), mat(C.charger), -3.5, 3.4, -18.6);
    screen.rotation.x = -0.35;
    const slides = [['MEGA SALE', C.siren], ['-50% TODAY', C.purple], ['NEW ARRIVALS', C.shuttle], ['BIG DEALS', C.battery]].map(([text, color]) => {
      const face = add(screen, B(7, 2, 0.04), glow(color, 0.55), 0, 0, 0.11);
      face.add(textPlane(text, 6.6, 1.6, C.paint));
      return face;
    });
    const bulbs = [];
    for (let i = 0; i < 24; i++) {
      const t = i / 24, edge = t < 0.5 ? [-3.6 + t * 2 * 7.2, 1.15] : [3.6 - (t - 0.5) * 2 * 7.2, -1.15];
      bulbs.push(add(screen, shape('Sphere', 0.09, 6, 6), glow(C.headlight, 0.2).clone(), edge[0], edge[1], 0.14));
    }
    add(g, B(0.3, 2.4, 0.3), mat(C.pole), -6.6, 1.2, -18.8);
    add(g, B(0.3, 2.4, 0.3), mat(C.pole), -0.4, 1.2, -18.8);
    anims.push((dt, t) => {
      const k = Math.floor(t / 1.8) % slides.length;
      slides.forEach((f, i) => { f.visible = i === k; });
      bulbs.forEach((b, i) => { b.material.emissiveIntensity = (i + Math.floor(t * 8)) % 3 === 0 ? 1.6 : 0.15; });
    });

    for (let x = -7; x < 15; x += 0.9) {
      const flag = add(g, shape('Cone', 0.22, 0.45, 3), mat([C.siren, C.mustard, C.shuttle, C.battery, C.purple][Math.round((x + 7) / 0.9) % 5]), x, 3.15, -21);
      flag.rotation.x = Math.PI;
    }
    add(g, B(22, 0.03, 0.03), mat(C.pole), 4, 3.4, -21);

    for (let i = 0; i <= 16; i++) {
      const a = Math.PI * i / 16;
      add(g, shape('Sphere', 0.34, 10, 8), mat([C.siren, C.paint, C.purple, C.mustard][i % 4]), -15 + Math.cos(a) * 2.1, 0.2 + Math.sin(a) * 3, -8);
    }

    const carousel = new THREE.Group(), horses = [];
    add(carousel, shape('Cylinder', 2.1, 2.2, 0.3, 24), mat(C.paint), 0, 0.15, 0);
    add(carousel, shape('Cylinder', 0.25, 0.25, 3, 10), mat(C.gold), 0, 1.6, 0);
    const canopy = add(carousel, shape('Cone', 2.5, 1.2, 12), mat(C.siren), 0, 3.6, 0);
    for (let i = 0; i < 12; i += 2) add(canopy, shape('Cone', 2.52, 1.21, 12, 1, false, (i / 12) * Math.PI * 2, Math.PI / 6), mat(C.paint), 0, 0.005, 0);
    add(carousel, shape('Sphere', 0.3, 8, 6), mat(C.mustard), 0, 4.35, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, horse = new THREE.Group();
      add(horse, B(0.06, 2.6, 0.06), mat(C.gold), 0, 1.6, 0);
      add(horse, B(0.8, 0.45, 0.3), mat([C.paint, C.mustard, C.shuttle][i % 3]), 0, 0, 0);
      add(horse, B(0.25, 0.5, 0.25), mat([C.paint, C.mustard, C.shuttle][i % 3]), 0.4, 0.3, 0);
      horse.position.set(Math.cos(a) * 1.5, 1.2, Math.sin(a) * 1.5);
      horse.rotation.y = -a;
      carousel.add(horse);
      horses.push(horse);
    }
    carousel.position.set(-19.2, 0, -2);
    g.add(carousel);
    anims.push((dt, t) => { carousel.rotation.y += dt * 0.6; horses.forEach((h, i) => { h.position.y = 1.2 + Math.sin(t * 2.4 + i) * 0.3; }); });

    const jets = [0, 1, 2, 3, 4].map((i) => {
      const a = (i / 5) * Math.PI * 2, r = i ? 0.9 : 0;
      return add(g, shape('Cylinder', 0.1, 0.16, 1, 8), glow(C.bubble, 0.6), -17 + Math.cos(a) * r, 0.5, -12 + Math.sin(a) * r);
    });
    anims.push((dt, t) => jets.forEach((j, i) => { const h = 0.6 + Math.abs(Math.sin(t * 2 + i * 1.3)) * (i ? 1.2 : 2.2); j.scale.y = h; j.position.y = 0.5 + h / 2; }));

    add(g, B(1.4, 0.9, 0.8), mat(C.paint), -12.2, 0.6, 16.5);
    awning(g, 1.6, -12.2, 1.6, 16.2, 0.6, '#ff7ab8');
    for (const dx of [-0.6, 0.6]) add(g, shape('Cylinder', 0.22, 0.22, 0.12, 12), mat(C.tire), -12.2 + dx, 0.22, 16.95).rotation.x = Math.PI / 2;
    add(g, shape('Cone', 0.55, 1.5, 10), mat(C.bread), -12.2, 2.75, 16.5).rotation.x = Math.PI;
    add(g, shape('Sphere', 0.62, 12, 10), mat('#ffb3d1'), -12.2, 3.6, 16.5);
    add(g, shape('Sphere', 0.5, 12, 10), mat(C.paint), -12.2, 4.25, 16.5);
    // Across the road: the parking garage with cars on its deck and the SUNSET PLAZA sign tower.
    add(g, B(5, 3.6, 11), mat(C.curb), 21.5, 1.8, -7);
    for (let y = 1.2; y < 3.6; y += 1.2) add(g, B(5.06, 0.12, 11.06), mat(C.paint), 21.5, y, -7);
    for (const [z, name] of [[-10, 'car_sedan'], [-6.5, 'car_hatchback'], [-3, 'car_stationwagon']]) { const car = kitModel(name, CAR_K, Math.PI / 2); car.position.set(21.5, 3.6, z); g.add(car); }
    add(g, B(0.5, 8, 0.5), mat(C.purple), 20, 4, 8);
    // Two giant shopping bags stand on the garage deck, the plaza's product on show across the road; they rock a little.
    [[20.2, -11.8, C.siren, 'SALE'], [23, -11.8, C.purple, 'SHOP']].forEach(([x, z, color, word], i) => {
      const bag = new THREE.Group();
      add(bag, B(1.7, 2.1, 1), mat(color), 0, 1.05, 0);
      add(bag, B(1.72, 0.25, 1.02), mat(C.paint), 0, 2.0, 0);
      add(bag, shape('Torus', 0.45, 0.07, 6, 16, Math.PI), mat(C.paint), 0, 2.1, 0.2);
      const tag = add(bag, B(1.3, 0.5, 0.02), mat(C.paint), 0, 1.1, 0.51);
      tag.add(textPlane(word, 1.2, 0.45, color));
      tag.children[0].position.z = 0.02;
      bag.position.set(x, 3.6, z);
      bag.scale.setScalar(1.5);
      bag.rotation.x = -0.3;
      g.add(bag);
      anims.push((dt, t) => { bag.rotation.z = Math.sin(t * 1.5 + i * 2) * 0.06; });
    });
    add(g, B(4.2, 1.2, 0.2), glow(C.purple, 0.4), 20, 7.8, 8.3).add(textPlane('SUNSET PLAZA', 4, 1, C.paint));
  }
  outline(g, CONFIG.sizes.inkScale);
  return g;
}

// The station's restaurant building: a back wall in its colour with a trim band and a short side return behind the kitchen row only,
// and low planter boxes with wide gaps on the diner's left and bottom sides, so the lot stays open to the street around it.
export function buildStationFrame(st) {
  const g = new THREE.Group(), W = CONFIG.world, [x0, x1] = W.kitchenWall, z0 = W.floorParts[0][0], wall = mat(st.wall), trim = mat(st.trim);
  add(g, B(x1 - x0, 1.6, 0.4), wall, (x0 + x1) / 2, 0.8, z0 - 0.2);
  add(g, B(x1 - x0 + 0.06, 0.18, 0.46), trim, (x0 + x1) / 2, 1.62, z0 - 0.2);
  add(g, B(0.4, 1.6, 3), wall, x0 - 0.2, 0.8, z0 + 1.1);
  add(g, B(0.46, 0.18, 3.06), trim, x0 - 0.2, 1.62, z0 + 1.1);
  const [px, pz] = W.patio.at, [pw, pd] = W.patio.size, box = mat(st.fence);
  // Planter boxes 1.6 long with 1.2 gaps: down the diner's left side, then along its bottom up to the bays' side.
  const boxes = [];
  for (let z = pz - pd / 2 + 1; z < pz + pd / 2; z += 2.8) boxes.push([px - pw / 2, z, true]);
  for (let x = px - pw / 2 + 1; x < px + pw / 2 - 1.4; x += 2.8) boxes.push([x, pz + pd / 2, false]);
  for (const [x, z, side] of boxes) add(g, side ? B(0.4, 0.4, 1.6) : B(1.6, 0.4, 0.4), box, x, 0.2, z);
  outline(g, CONFIG.sizes.inkScale);
  // Bushes go in after the ink so they keep their own soft look.
  for (const [x, z, side] of boxes) for (const d of [-0.5, 0.5]) prop(g, 'plant_bush', 2.2, x + (side ? 0 : d), z + (side ? d : 0)).position.y = 0.38;
  return g;
}

// Runway beside the airport lot: dark strip with a white center line.
export function buildRunway([x, z]) {
  const g = new THREE.Group();
  add(g, B(52, 0.05, 5), mat(COL.road), x, 0.01, z);
  for (let i = -24; i < 26; i += 4) add(g, B(2, 0.06, 0.3), mat(COL.paint), x + i, 0.02, z);
  return g;
}

// Solar field: rows of tilted blue panels on posts with a glowing inverter box, centered on its spot.
export function buildSolarField() {
  const g = new THREE.Group(), C = CONFIG.colors;
  for (const z of [-0.9, 0.9]) for (const x of [-1.6, 0, 1.6]) {
    const p = add(g, B(1.4, 0.06, 1.1), mat(C.panel), x, 0.75, z);
    p.rotation.x = -0.45;
    add(p, B(1.42, 0.02, 0.04), mat(C.panelLine), 0, 0.04, 0);
    add(g, B(0.08, 0.6, 0.08), mat(C.pole), x, 0.3, z);
  }
  add(g, B(0.6, 0.8, 0.5), mat(C.charger), 2.7, 0.4, 0);
  add(g, B(0.3, 0.12, 0.04), glow(C.battery, 1.4), 2.7, 0.55, 0.26);
  outline(g, CONFIG.sizes.inkScale);
  return g;
}

// Airliner for the sky over the airport, nose to -x.
export function buildPlane() {
  const g = new THREE.Group(), C = CONFIG.colors;
  add(g, B(4.4, 0.7, 0.7), mat(C.paint), 0, 0, 0);
  add(g, B(1.2, 0.1, 5.2), mat(C.paint), 0.2, 0, 0);
  add(g, B(0.7, 0.9, 0.1), mat(C.siren), 1.9, 0.5, 0);
  add(g, B(0.6, 0.1, 1.8), mat(C.paint), 1.9, 0.1, 0);
  // Airliner details: blue belly stripe, window band, cockpit glass on the nose and an engine under each wing.
  add(g, B(4.42, 0.18, 0.72), mat(C.shuttle), 0, -0.22, 0);
  add(g, B(3.2, 0.1, 0.72), mat(C.glass), 0.1, 0.14, 0);
  add(g, B(0.3, 0.55, 0.6), mat(C.paint), -2.3, -0.02, 0);
  add(g, B(0.1, 0.18, 0.5), mat(C.glass), -2.42, 0.12, 0);
  for (const z of [-1.3, 1.3]) add(g, B(0.9, 0.4, 0.4), mat(C.pole), -0.1, -0.3, z);
  outline(g, CONFIG.sizes.inkScale);
  return g;
}

// Control tower: a tall shaft with a glass cab and a red light on top.
export function buildTower() {
  const g = new THREE.Group(), C = CONFIG.colors;
  add(g, shape('Cylinder', 0.7, 0.9, 7, 10), mat(C.wall), 0, 3.5, 0);
  add(g, shape('Cylinder', 1.6, 1.2, 1.2, 10), mat(C.glass), 0, 7.6, 0);
  add(g, shape('Cylinder', 1.7, 1.7, 0.2, 10), mat(C.pole), 0, 8.3, 0);
  add(g, B(0.25, 0.25, 0.25), glow(C.siren, 2), 0, 8.6, 0);
  outline(g, CONFIG.sizes.inkScale);
  return g;
}

// Office in the kit style with low side walls so it reads from above: role-colored carpet, desk with laptop, chair, books, lamp and plant,
// an arch with the name board and a giant role icon over the entrance; `counter` is the desk top, where the accountant's profit piles up.
// Giant necktie for the manager's office sign.
export function buildTieIcon(color) {
  const g = new THREE.Group();
  add(g, shape('Cone', 0.18, 0.2, 4), mat(color), 0, 0.85, 0).rotation.z = Math.PI;
  add(g, shape('Cone', 0.26, 0.75, 4), mat(color), 0, 0.38, 0);
  add(g, B(0.5, 0.12, 0.1), mat(COL.paint), 0, 1.0, 0);
  outline(g, CONFIG.sizes.inkScale);
  return g;
}
// Giant stack of gold coins for the accounting office sign.
export function buildCoinIcon() {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) add(g, shape('Cylinder', 0.32, 0.32, 0.12, 18), glow(COL.bill, 0.25), (i % 2) * 0.05, 0.08 + i * 0.13, 0);
  outline(g, CONFIG.sizes.inkScale);
  return g;
}

export function buildOffice(sign, color, icon, mark) {
  // A tidy office in the role's colour: light plank floor with a rug, low side walls with a white cap, cut away toward the camera,
  // a white-topped desk with a coloured front, a glowing monitor, the chair behind it, a sofa for visitors and two plants.
  const g = new THREE.Group(), body = mat(color), white = mat(COL.paint), put = (name, x, z, rot, k) => prop(g, name, k, x, z, rot);
  add(g, B(3.4, 0.06, 3.4), mat(COL.floorWood), 0, 0.03, 0);
  add(g, B(2.2, 0.02, 1.6), mat(COL.rug), 0, 0.07, 0.3);
  add(g, B(3.4, 0.4, 0.16), body, 0, 0.2, 1.62);
  add(g, B(3.44, 0.08, 0.2), white, 0, 0.42, 1.62);
  for (const x of [-1.68, 1.68]) {
    add(g, B(0.16, 0.8, 3.4), body, x, 0.4, 0);
    add(g, B(0.2, 0.08, 3.44), white, x, 0.82, 0);
  }
  add(g, B(1.9, 0.1, 0.8), white, 0, 0.87, -0.95);
  add(g, B(1.9, 0.8, 0.08), body, 0, 0.42, -0.6);
  for (const x of [-0.88, 0.88]) add(g, B(0.1, 0.82, 0.76), body, x, 0.41, -0.95);
  add(g, B(0.7, 0.45, 0.06), mat(COL.charger), -0.35, 1.2, -1.15);
  add(g, B(0.6, 0.36, 0.02), glow(COL.action, 0.8), -0.35, 1.2, -1.11);
  add(g, B(0.08, 0.25, 0.08), mat(COL.charger), -0.35, 0.98, -1.15);
  add(g, B(0.7, 0.12, 0.6), body, 0, 0.5, -0.05);
  add(g, B(0.7, 0.7, 0.12), body, 0, 0.8, 0.22);
  add(g, B(1.8, 0.35, 0.6), mat(COL.sofa), 0.4, 0.3, 1.1);
  add(g, B(1.8, 0.4, 0.15), mat(COL.sofa), 0.4, 0.55, 1.33);
  put('pottedPlant', -1.3, 1.2, 0, 2.2);
  put('pottedPlant', 1.3, -1.25, 0, 2.2);
  const k = 0.92;
  // Arch over the entrance at the back: two posts, a big name board and the role's giant icon on top.
  for (const x of [-1.3, 1.3]) add(g, B(0.14, 2.3, 0.14), mat(COL.pole), x, 1.15, -1.5);
  leanBoard(g, sign, 2.8, color, COL.paint, 2.3, -1.5);
  icon.position.set(0, 2.85, -1.85);
  g.add(icon);
  // Floor word on the zone in front of the arch tells the player what standing there does.
  const word = decal(mark, 1.2);
  word.position.set(0, 0.02, -2.3);
  g.add(word);
  const counter = new THREE.Group();
  counter.position.set(0.55, k + 0.02, -0.95);
  g.add(counter);
  g.userData.counter = counter;
  return g;
}

// Flat dark text on a sign face.
function textPlane(text, w, h, color = COL.labelStroke) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = Math.round(1024 * h / w);
  const ctx = c.getContext('2d');
  Object.assign(ctx, { font: `800 ${Math.round(c.height * 0.72)}px "Baloo 2", sans-serif`, textAlign: 'center', textBaseline: 'middle', fillStyle: color });
  ctx.fillText(text, c.width / 2, c.height * 0.55, c.width * 0.94);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  m.position.z = 0.045;
  return m;
}

// Drive-thru coffee booth as a small kit room: order window toward the road, counter in front; `top` is where fresh cups line up.
// Coffee stand: low walls so the counter shows from above, a striped awning over the drive-thru window, a raised leaning COFFEE board,
// a planter and a lamp, a giant steaming take-away cup on top and a SERVE word on the player's spot (`zone` is that spot relative to the stand).
export function buildKiosk(zone) {
  const g = room(KIOSK_ROOM), k = KIT_K.kiosk;
  for (let i = 0; i < 6; i++) add(g, B(0.7, 0.06, 0.5), mat(i % 2 ? COL.cupBody : COL.cupLid), 2 * k + 0.3, 2.05 - 0.04, -1.25 + i * 0.5).rotation.z = -0.35;
  for (const x of [-1.5, 1.5]) add(g, B(0.14, 3.1, 0.14), mat(COL.pole), x, 1.55, -2 * k - 0.2);
  leanBoard(g, 'COFFEE', 3, COL.cupLid, COL.cupBody, 3.1, -2 * k - 0.2);
  planter(g, -2.05, 1.15);
  prop(g, 'lightPostModern', 3, -2.05, -1.4, Math.PI / 2);
  // Giant take-away cup over the sign, the stand's shop icon, with steam puffs.
  const cup = new THREE.Group();
  add(cup, shape('Cylinder', 0.5, 0.36, 1.15, 18), mat(COL.cupBody), 0, 0.58, 0);
  add(cup, shape('Cylinder', 0.47, 0.42, 0.36, 18), mat(COL.cupLid), 0, 0.55, 0);
  add(cup, shape('Cylinder', 0.54, 0.5, 0.16, 18), mat(COL.cupLid), 0, 1.2, 0);
  for (const [x, y, r] of [[-0.12, 1.55, 0.14], [0.1, 1.78, 0.11], [-0.05, 1.98, 0.08]]) add(cup, shape('Sphere', r, 10, 8), glow(COL.cupBody, 0.4), x, y, 0);
  outline(cup, CONFIG.sizes.inkScale);
  cup.position.set(0, 3.5, -2 * k - 0.6);
  g.add(cup);
  const word = decal('SERVE', 1.3);
  word.position.set(zone[0], 0.02, zone[1]);
  g.add(word);
  const top = new THREE.Group();
  top.position.set(-0.6, k * 1.2 + 0.03, 0.47);
  g.add(top);
  g.userData.top = top;
  return g;
}

// Banknote bundle: printed yellow note with a dark border, a big $ and a paper band on top, plain ink-yellow on the sides.
export function buildBillMaterials() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 80;
  const ctx = c.getContext('2d');
  Object.assign(ctx, { fillStyle: COL.bill });
  ctx.fillRect(0, 0, 128, 80);
  Object.assign(ctx, { strokeStyle: COL.billInk, lineWidth: 6 });
  ctx.strokeRect(6, 6, 116, 68);
  Object.assign(ctx, { fillStyle: COL.paint });
  ctx.fillRect(54, 0, 20, 80);
  Object.assign(ctx, { fillStyle: COL.billInk, font: '800 46px sans-serif', textAlign: 'center', textBaseline: 'middle' });
  ctx.fillText('$', 64, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshToonMaterial({ map: tex, gradientMap: ramp }), side = mat(COL.billInk);
  return [side, side, face, face, side, side];
}

// Takeaway cup: cream sides with a brown lid.
export function buildCupMaterials() {
  return [mat(COL.cupBody), mat(COL.cupLid), mat(COL.cupBody)];
}

// E-scooter for the Moto Park, nose toward -x like the cars so the shared car stepper steers it.
export function buildScooter(color) {
  const g = new THREE.Group();
  add(g, B(1.3, 0.3, 0.32), mat(color), 0, 0.5, 0);
  add(g, B(0.55, 0.14, 0.3), mat(COL.charger), 0.25, 0.72, 0);
  for (const x of [-0.55, 0.55]) add(g, shape('Cylinder', 0.26, 0.26, 0.12, 12), mat(COL.tire), x, 0.27, 0).rotation.x = Math.PI / 2;
  add(g, B(0.06, 0.55, 0.06), mat(COL.pole), -0.55, 0.85, 0);
  add(g, B(0.06, 0.06, 0.65), mat(COL.pole), -0.55, 1.12, 0);
  const rider = buildPerson(COL.drivers[Math.floor(Math.random() * COL.drivers.length)]), k = worldSize('scooter') / longest(g);
  // The seated rider keeps a person's size inside the scaled scooter.
  rider.scale.setScalar(PERSON_K * 0.9 / k);
  rider.position.set(0.1, 0.35, 0);
  rider.rotation.y = -Math.PI / 2;
  g.add(rider);
  outline(g, CONFIG.sizes.inkScale);
  g.scale.setScalar(k);
  return g;
}

// Moto Park: a green plate with painted slots and a small charging post at the top of each slot.
export function buildMotoPark(spots, gap) {
  const g = new THREE.Group(), w = spots * gap + 0.4;
  add(g, B(w, 0.05, 2.8), mat(COL.zoneBay), 0, 0.03, 0);
  for (let i = 0; i <= spots; i++) add(g, B(0.08, 0.02, 2.6), mat(COL.paint), -w / 2 + 0.2 + i * gap, 0.06, 0);
  for (let i = 0; i < spots; i++) {
    const x = -w / 2 + 0.2 + gap * (i + 0.5);
    add(g, B(0.35, 1, 0.3), mat(COL.charger), x, 0.5, -1.25);
    add(g, B(0.25, 0.2, 0.04), glow(COL.battery, 1), x, 0.8, -1.08);
  }
  leanBoard(g, 'MOTO PARK', 2.8, COL.zoneBay, COL.paint, 1.9, -1.5);
  outline(g, CONFIG.sizes.inkScale);
  // Slots past the ones in use stay hidden until bought.
  const parts = g.children.filter((m) => m.position.z === -1.25 || m.position.z === -1.08);
  g.userData.setSlots = (n) => parts.forEach((m) => { m.visible = Math.round((m.position.x + w / 2 - 0.2) / gap - 0.5) < n; });
  return g;
}

// Mini Mart: back wall with a striped awning, three stocked shelves whose goods show the stock left, and a till counter.
export function buildMart(color) {
  const g = new THREE.Group(), goods = [], tints = [COL.siren, COL.battery, COL.mustard, COL.shuttle];
  add(g, B(4.4, 0.06, 3), mat(COL.floorWood), 0, 0.03, 0);
  add(g, B(4.4, 2.2, 0.15), mat(color), 0, 1.1, -1.45);
  awning(g, 4.4, 0, 2.3, -1.3, 0.8, color);
  for (const x of [-1.3, 0, 1.3]) {
    add(g, B(1.1, 1.3, 0.5), mat(COL.counter), x, 0.65, -1);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) goods.push(add(g, B(0.2, 0.26, 0.2), mat(tints[(k + r) % 4]), x - 0.36 + k * 0.24, 0.42 + r * 0.4, -0.72));
  }
  add(g, B(1.4, 0.9, 0.6), mat(COL.paint), 1.4, 0.45, 0.8);
  add(g, B(0.5, 0.3, 0.4), mat(COL.charger), 1.7, 1.05, 0.8);
  leanBoard(g, 'MINI MART', 2.8, color, COL.paint, 2.9, -1.6);
  outline(g, CONFIG.sizes.inkScale);
  // Shows the share of goods still on the shelves.
  g.userData.setStock = (share) => goods.forEach((m, i) => { m.visible = i < Math.round(share * goods.length); });
  return g;
}

// Air & Glass: a red air post with its hose and gauge, a bucket with a squeegee, and its board.
export function buildAirPost() {
  const g = new THREE.Group();
  add(g, B(3, 0.05, 2.4), mat(COL.washFloor), 0, 0.03, 0);
  add(g, B(0.45, 1.5, 0.45), mat(COL.siren), -0.6, 0.75, -0.6);
  add(g, shape('Cylinder', 0.22, 0.22, 0.05, 16), mat(COL.paint), -0.6, 1.15, -0.36).rotation.x = Math.PI / 2;
  add(g, B(0.05, 0.05, 1.2), mat(COL.charger), -0.3, 0.45, 0);
  add(g, B(0.5, 0.45, 0.5), mat(COL.shuttle), 0.7, 0.23, -0.4);
  add(g, B(0.06, 0.9, 0.06), mat(COL.pole), 0.7, 0.7, -0.4);
  add(g, B(0.5, 0.08, 0.08), mat(COL.charger), 0.7, 1.15, -0.4);
  leanBoard(g, 'AIR & GLASS', 2.8, COL.siren, COL.paint, 1.9, -1.2);
  outline(g, CONFIG.sizes.inkScale);
  return g;
}
