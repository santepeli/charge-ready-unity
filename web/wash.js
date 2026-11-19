// Car wash: a share of charged cars turn left on the exit lane, queue, drive through the tunnel and pay at its cash pile.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { city } from './economy.js';
import { buildWash } from './models.js';

const WS = CONFIG.wash, U = WS.upgrades, RD = CONFIG.road, W = CONFIG.world;
const v3 = ([x, z]) => new THREE.Vector3(x, 0, z);
// Queue route on the lot: second waiting spot on the exit lane, the corner, the first waiting spot, then the wash stop.
const ROUTE = [[WS.laneX + WS.entryGap, W.exitZ], [WS.laneX, W.exitZ], [WS.laneX, WS.enterZ], [WS.laneX, WS.stopZ]].map(v3);
// Where each car in the line waits on ROUTE: in the tunnel, at the corner a car length back, and on the exit lane.
const SLOT = [3, 1, 0];
const LEAVE = [[WS.laneX, WS.leaveZ], [13.6, WS.leaveZ], [RD.inLane, WS.leaveZ + 2], [RD.inLane, RD.exitZ]];

// The game passes its state, scene, `once`, `book`, `earn`, its `drive` stepper, `toTraffic` for cars done here and `fx` for foam.
export function createWash({ state, scene, once, book, earn, drive, toTraffic, fx }) {
  const building = buildWash();
  building.position.copy(v3(WS.padAt));
  const spot = { zone: v3(WS.cashAt), cashPos: v3(WS.cashAt), size: WS.cashZone, cash: 0, bills: [] };
  const line = [];
  let incoming = 0;

  const owned = () => Boolean(state.wash);
  const lvl = (k) => state.levels[k] ?? 0;

  function show() {
    if (!owned() || building.parent) return;
    scene.add(building);
    spot.cash = state.wash.cash;
  }
  function open() {
    state.wash = { cash: 0, washed: 0 };
    Object.keys(U).forEach((k) => { state.levels[k] = 0; });
    show();
  }

  // Decides whether a car leaving its bay wants a wash; a full line means it drives past.
  function accept() {
    if (!owned() || line.length + incoming >= WS.lineMax || Math.random() >= WS.share + U.washPopularity.step * lvl('washPopularity')) return false;
    incoming++;
    return true;
  }
  // A car reaching the exit lane joins the back of the line.
  function take(car) {
    incoming--;
    line.push({ car, k: 0, t: 0 });
  }

  function update(dt) {
    if (!owned()) return;
    // The line is ordered by how far each car got, so a car that slipped ahead in traffic is never told to wait behind one it passed.
    line.sort((a, b) => b.k - a.k);
    // Each car moves forward along the route up to its slot in the line.
    line.forEach((e, i) => {
      if (e.k > SLOT[i]) return;
      e.car.path = [ROUTE[e.k]];
      if (drive(e.car, dt)) e.k++;
    });
    const front = line[0];
    if (!front || front.k <= SLOT[0]) building.userData.idle();
    if (front && front.k > SLOT[0]) {
      building.userData.spin(dt);
      fx(front.car.g.position.clone().setY(1.2), dt);
      if ((front.t += dt) >= WS.washSec * U.washSpeed.factor ** lvl('washSpeed')) {
        const pay = Math.round(WS.price * CONFIG.economy.incomeMultiplier ** lvl('washPrice') * city.income);
        earn(spot, pay, spot.cashPos);
        book('wash', pay);
        state.wash.washed++;
        once('wash1');
        line.shift();
        toTraffic({ g: front.car.g, path: LEAVE.map(v3) });
      }
    }
    state.wash.cash = spot.cash;
  }

  return { building, owned, open, show, update, accept, take, spot, line, entry: ROUTE[0] };
}
