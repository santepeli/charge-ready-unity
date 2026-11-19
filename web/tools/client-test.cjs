// Client test: plays through the real UI (mouse drags on the joystick surface, button clicks) with a sped-up clock,
// then checks the start screen, a full level, the end screen, Play Again and HUD layout.
const fs = require('fs'), path = require('path');
const { serve, launch, openGame, mmss } = require('./harness.cjs');
const { PERSONAS } = require('./personas.cjs');

const PORT = 8132, WARP = Number(process.env.CLIENT_WARP) || 12, REAL_LIMIT_MS = 480000, TICK_MS = 120;
const PERSONA = process.env.CLIENT_PERSONA || 'engaged', OUT = path.join(__dirname, 'out');
const DRAG_PX = 45, ORIGIN = { x: 195, y: 560 };

const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = serve(PORT), browser = await launch(), errors = [], checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const page = await openGame(browser, PORT, `sim&warp=${WARP}`, { seed: 7, errors });
  const persona = PERSONAS[PERSONA];

  check('start screen visible', await page.isVisible('#startBtn'));
  await page.click('#startBtn');
  await page.evaluate(([st, pr]) => { window.brain = window.botBrain(st, pr); }, [persona.strategy, persona]);

  // Hold the mouse down and steer by moving it around the drag origin, like a thumb on the screen.
  let holding = false;
  const steer = async (dir) => {
    if (!dir) { if (holding) { await page.mouse.up(); holding = false; } return; }
    if (!holding) { await page.mouse.move(ORIGIN.x, ORIGIN.y); await page.mouse.down(); holding = true; }
    await page.mouse.move(ORIGIN.x + dir.x * DRAG_PX, ORIGIN.y + dir.y * DRAG_PX);
  };
  // Buys through the panel: open Upgrades, tap the row, close.
  const shop = async (k) => {
    await steer(null);
    if (!(await page.isVisible('#upgBtn'))) return;
    // The nudge pulse keeps the button moving; a thumb can still tap it, so the click does not wait for it to settle.
    await page.click('#upgBtn', { force: true });
    const row = page.locator(`#rows button[data-k="${k}"]`);
    if (await row.isEnabled()) await row.click();
    // The last upgrade can finish the level, and the end screen then covers the panel.
    if (!(await page.isVisible('#done'))) await page.click('#close');
  };

  const started = Date.now(), shots = new Set();
  let state;
  while (Date.now() - started < REAL_LIMIT_MS) {
    state = await page.evaluate(() => {
      const g = window.__cr, s = g.state, p = g.player.g.position, t = window.brain.target(), d = Math.hypot(t.x - p.x, t.z - p.z);
      return { done: s.doneAt !== null, playSec: s.playSec, served: s.served, bays: s.bays, dir: d < 0.5 ? null : { x: (t.x - p.x) / d, y: (t.z - p.z) / d }, shop: window.brain.shopChoice() };
    });
    if (state.done) break;
    if (state.shop) await shop(state.shop);
    await steer(state.dir);
    for (const [mark, sec] of [['early', 30], ['mid', 180], ['late', 360]]) {
      if (state.playSec >= sec && !shots.has(mark)) { shots.add(mark); await page.screenshot({ path: path.join(OUT, `client-${mark}.png`) }); }
    }
    await page.waitForTimeout(TICK_MS);
  }
  await steer(null);
  const log = Object.fromEntries(await page.evaluate(() => window.__cr.log));
  const doneAt = await page.evaluate(() => window.__cr.state.doneAt);

  check('no page errors', errors.length === 0, errors.join('; '));
  check('first paying car', log.car1 != null, `car1 ${mmss(log.car1)}`);
  check('level completed through the UI', doneAt !== null, doneAt !== null ? `finish ${mmss(doneAt)} game time, ${Math.round((Date.now() - started) / 1000)}s real` : `stopped at ${mmss(state.playSec)} game time, ${state.bays} bays`);
  check('end screen shown', await page.isVisible('#done'));
  await page.screenshot({ path: path.join(OUT, 'client-done.png') });

  const box = async (sel) => ((await page.isVisible(sel)) ? page.locator(sel).boundingBox() : null);
  if (await page.isVisible('#keepPlaying')) await page.click('#keepPlaying');
  const [joy, upg, hint, cash] = [await box('#joy'), await box('#upgBtn'), await box('#hint'), await box('#cash')];
  check('joystick clear of Upgrades button', !overlap(joy, upg), `joystick x ${Math.round(joy?.x)}-${Math.round(joy?.x + joy?.width)}, button x ${Math.round(upg?.x)}-${Math.round(upg?.x + upg?.width)}`);
  check('hint clear of joystick', !overlap(hint, joy));
  check('joystick inside the screen', joy && joy.y + joy.height <= 844 && joy.x >= 0);
  check('cash readable', cash && cash.width > 0);

  // A full restart is only in Settings and needs two taps.
  await page.evaluate(() => { document.getElementById('settings').hidden = false; });
  await page.click('#resetBtn');
  await page.waitForTimeout(700);
  await page.click('#resetBtn');
  await page.waitForFunction(() => window.__cr && window.__cr.state.playSec === 0);
  const fresh = await page.evaluate(() => { const s = window.__cr.state; return { cash: s.cash, bays: s.bays, piles: [...s.bayCash, ...s.tableCash].reduce((a, b) => a + b, 0) }; });
  check('Reset starts clean', fresh.cash === 0 && fresh.bays === 1 && fresh.piles === 0, JSON.stringify(fresh));

  await browser.close();
  server.close();
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  console.log(`Persona ${PERSONA}, warp ${WARP}, milestones: ${Object.entries(log).filter(([k]) => /car1|bay|worker|complete/.test(k)).map(([k, v]) => `${k} ${mmss(v)}`).join(', ')}`);
  console.log(`Screenshots: ${OUT}`);
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
})();
