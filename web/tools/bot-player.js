// Bot brain for tests: it only reads game state and decides where to walk and what to buy, like a player looking at the screen.
window.botBrain = (strategy, profile) => {
  const g = window.__cr, s = g.state, p = g.player.g.position;
  const dist = (t) => Math.hypot(t.x - p.x, t.z - p.z);
  const nearest = (list) => list.sort((a, b) => dist(a.zone) - dist(b.zone))[0];

  return {
    // Same priorities a sensible player follows, without the guide arrow.
    target() {
      const bays = g.openBays(), toPlug = bays.filter((b) => b.car?.phase === 'plug');
      const orders = bays.filter((b) => b.car?.driver?.phase === 'order' && (b.car.driver.need > 0 || b.car.driver.sideLeft));
      if (g.currentPad() && s.cash >= g.padLeft()) return g.padMesh.position;
      if (toPlug.length) return nearest(toPlug).zone;
      // A glowing power-up close by is worth the short detour.
      const pu = g.powerupAt();
      if (pu && dist(pu) < 8) return pu;
      // A car at the drive-thru window leaves soon, so it comes right after plugging.
      const win = g.kiosk.cars[0];
      if (s.coffee && win?.phase === 'order' && win.need > 0 && g.kiosk.stock > 0) return g.kiosk.zone;
      // A staff report the accountant says will pay off sends the owner to the manager's desk.
      const order = s.cash > 0 && g.boostOptions().find((o) => o.need && o.ready && o.value > o.cost && s.cash >= o.cost);
      if (order && Math.random() < (profile.shopChance ?? 1)) { this.order = order.k; return g.officeZone; }
      this.order = null;
      // The owner walks over to wake a slacking worker.
      const w = g.worker();
      if (w?.slack) return w.g.position;
      // A new player only discovers the diner after learnSec.
      const knowsFood = s.playSec >= (profile.learnSec ?? 0);
      const servable = orders.filter((b) => g.wanted(b.car.driver, g.player) !== null);
      if (knowsFood && servable.length) return nearest(servable.map((b) => b.table)).zone;
      // A side someone waits for, with stock on its machine and room on the tray, is picked up next.
      const side = orders.map((b) => b.car.driver).find((d) => d.sideLeft && !g.player.items.includes(d.side) && g.machines[d.side].stock > 0);
      const mains = g.player.items.filter((t) => t === 'main').length;
      if (knowsFood && side && g.player.items.length - mains < g.sideCarry) return g.machines[side.side].zone;
      const cash = [...bays.flatMap((b) => [b, b.table]), ...(g.mobile.owned() ? [g.mobile.spot] : []), ...(g.wash.owned() ? [g.wash.spot] : []), ...(s.coffee ? [g.kiosk] : [])].filter((c) => c.cash > 0);
      if (cash.length) return nearest(cash).zone;
      if (knowsFood && mains < g.capOf(g.player) && g.cafe.stock > 0) return g.cafe.pos;
      return g.player.carry > 0 ? nearest([...bays]).zone : g.cafe.pos;
    },
    // Upgrade the player would press now, or null; a persona only looks at upgrades with probability shopChance.
    shopChoice() {
      if (Math.random() >= (profile.shopChance ?? 1)) return null;
      const reserve = strategy.savePads && g.currentPad() ? g.padLeft() : 0;
      const lines = g.lines(), open = [...strategy.order, ...Object.keys(lines).filter((k) => !strategy.order.includes(k))].filter((k) => lines[k] && s.levels[k] < lines[k].maxLevel);
      const list = strategy.cheapest ? open.sort((a, b) => g.nextCost(a) - g.nextCost(b)) : open;
      return list.find((key) => s.cash - g.nextCost(key) >= reserve) ?? null;
    },
    // Places the planned order once the owner stands at the manager's desk.
    managerOrder() {
      const z = g.officeZone;
      return this.order && Math.abs(p.x - z.x) < 1 && Math.abs(p.z - z.z) < 0.6 ? this.order : null;
    },
    // Nearest unanswered stranded EV, when a van is free to go.
    mapChoice() {
      if (!g.mobile.owned() || !g.mobile.status().idle) return null;
      return g.mobile.calls().filter((c) => !c.van).sort((a, b) => a.km - b.km)[0]?.id ?? null;
    },
  };
};

const dist2 = (t, p) => Math.hypot(t.x - p.x, t.z - p.z);

// Fast player: drives update() at a fixed step with the persona's attention lapses and steering noise.
window.playBot = (strategy, profile, limitSec, dt, afterSec = 0) => {
  const g = window.__cr, s = g.state, p = g.player.g.position, brain = window.botBrain(strategy, profile), still = { x: 0, y: 0 };
  let goal = brain.target(), think = 0, lapse = 0, ratingDone = null;
  while (s.playSec < limitSec && (s.doneAt === null || s.playSec < s.doneAt + afterSec)) {
    // Stage 1 rating is taken the moment the level completes; later stages are measured separately.
    if (ratingDone === null && s.doneAt !== null) ratingDone = g.rating();
    if (lapse > 0) { lapse -= dt; g.update(dt, still); continue; }
    if (Math.random() < (profile.lapsePerMin ?? 0) * dt / 60) lapse = profile.lapseSec;
    if ((think -= dt) <= 0) {
      const k = brain.shopChoice();
      if (k) g.buy(k);
      const order = brain.managerOrder();
      if (order) { g.orderBoost(order); brain.order = null; }
      const call = brain.mapChoice();
      if (call) g.mobile.dispatch(call);
      goal = brain.target();
      think = profile.thinkSec;
    }
    const d = dist2(goal, p), a = Math.atan2(goal.z - p.z, goal.x - p.x) + (Math.random() - 0.5) * (profile.noise ?? 0);
    g.update(dt, d < profile.arrive ? still : { x: Math.cos(a) * profile.speed, y: Math.sin(a) * profile.speed });
  }
  return { log: g.log, doneAt: s.doneAt, served: s.served, earned: s.earned, rating: ratingDone ?? g.rating(), ratingEnd: g.rating(), missions: s.mission.i, playSec: Math.round(s.playSec), mobile: s.mobile, jams: s.jams, fines: s.fines, lost: s.lost, cups: s.cups };
};
