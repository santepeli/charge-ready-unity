// Journey check: a brand new player from the first tap to the last station. The first minute is played with real mouse drags and
// must show the onboarding (drag hand, then the ground pointer to each step); after that a bot plays each station until the next one
// unlocks and travels there through the real station map. Fails on any page error, a station where money stops coming in, or a
// station that does not unlock within LIMIT_SEC of play.
const path = require('path');
const { serve, launch, openGame, mmss } = require('./harness.cjs');
const { PERSONAS } = require('./personas.cjs');

const PORT = 8155, LIMIT_SEC = 2400, CHUNK = 60, STUCK_SEC = 240, OUT = path.join(__dirname, 'out');
// Cards a player closes before travelling: they sit over the map button.
const CLOSERS = ['#keepPlaying', '#welcomeCollect', '#adNo', '#noticeLater', '#settingsClose', '#chainClose', '#goalsClose', '#feedbackClose', '#managerClose', '#booksClose', '#mapClose', '#close'];

(async () => {
  const server = serve(PORT), browser = await launch(), failures = [], errors = [];
  const log = (line) => console.log(line);
  const page = await openGame(browser, PORT, 'sim', { viewport: { width: 390, height: 844 }, errors });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `journey-${name}.png`) });
  const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return Boolean(e && !e.hidden && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'); }, sel);

  // Onboarding, played by hand: the start screen, the drag hint with its hand, then a real drag that makes the pointer take over.
  if (!(await visible('#startBtn'))) failures.push('no start button on first open');
  await page.click('#startBtn');
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => { const h = document.getElementById('hint'); return { text: h.textContent, drag: h.classList.contains('drag'), shown: !h.hidden }; });
  if (!before.shown || !before.drag || !/drag/i.test(before.text)) failures.push(`first screen does not show the drag hand (hint "${before.text}", shown ${before.shown})`);
  await shot('1-first-screen');
  await page.mouse.move(195, 600);
  await page.mouse.down();
  await page.mouse.move(230, 560, { steps: 8 });
  await page.waitForTimeout(1200);
  await page.mouse.up();
  // The first three cars are the tutorial: a bot that walks where a player would records every hint and whether the pointer shows.
  const steps = await page.evaluate((pr) => {
    const g = window.__cr, p = g.player.g.position, brain = window.botBrain(pr.strategy, pr), seen = new Set();
    for (let i = 0; i < 4000 && g.state.served < 3; i++) {
      const hint = document.getElementById('hint');
      if (!hint.hidden && hint.textContent) seen.add(`${hint.textContent}${g.pointerOn() ? ' +pointer' : ''}`);
      const t = brain.target(), d = Math.hypot(t.x - p.x, t.z - p.z);
      g.update(0.05, d < pr.arrive ? { x: 0, y: 0 } : { x: (t.x - p.x) / d, y: (t.z - p.z) / d });
      g.draw(0.05);
    }
    return [...seen];
  }, PERSONAS.engaged);
  log(`tutorial steps: ${steps.join(' | ')}`);
  if (!steps.some((t) => t.endsWith('+pointer'))) failures.push('the ground pointer never showed during the tutorial');
  if (await page.evaluate(() => window.__cr.state.served) < 3) failures.push('the tutorial bot did not serve 3 cars');
  if (await visible('#hint') && (await page.evaluate(() => document.getElementById('hint').classList.contains('drag')))) failures.push('drag hand still shows after the player moved');

  const stations = await page.evaluate(async () => (await import('./config.js')).CONFIG.stations.map((s) => s.id));
  for (let i = 0; i < stations.length; i++) {
    const id = await page.evaluate(() => window.__cr.station.id);
    if (id !== stations[i]) { failures.push(`expected to be at ${stations[i]}, found ${id}`); break; }
    let last = { earned: -1, sec: 0 }, unlocked = false, sec = 0;
    while (true) {
      ({ sec, unlocked } = await page.evaluate(([pr, chunk, lastStation]) => {
        const g = window.__cr;
        window.playBot(pr.strategy, pr, g.state.playSec + chunk, 0.05, 1e9);
        for (let k = 0; k < 4; k++) g.draw(0.05);
        // The next station unlocks when the purple name glows; at the last one the chain is done when every station has a star.
        return { sec: Math.round(g.state.playSec), unlocked: lastStation ? g.stars().every((n) => n >= 1) : document.getElementById('city').classList.contains('new') };
      }, [PERSONAS.engaged, CHUNK, i === stations.length - 1]));
      const earned = await page.evaluate(() => window.__cr.state.earned);
      if (earned > last.earned) last = { earned, sec };
      else if (sec - last.sec > STUCK_SEC) { failures.push(`${stations[i]}: no money for ${sec - last.sec}s at ${mmss(sec)}`); await shot(`stuck-${stations[i]}`); break; }
      if (unlocked || sec > LIMIT_SEC) break;
    }
    log(`${stations[i]}: ${unlocked ? 'next unlocked' : 'NOT unlocked'} after ${mmss(sec)} of play`);
    if (!unlocked) { failures.push(`${stations[i]} did not unlock the next station in ${mmss(LIMIT_SEC)}`); await shot(`locked-${stations[i]}`); break; }
    if (i === stations.length - 1) break;
    // Travel the way a player does: close whatever card is open, tap the station name, tap Go on the next station.
    for (let k = 0; k < 3; k++) for (const sel of CLOSERS) if (await visible(sel)) await page.click(sel).catch(() => {});
    await page.click('#city', { force: true });
    await page.waitForSelector(`#chain:not([hidden]) [data-go="${stations[i + 1]}"]`, { timeout: 5000 }).catch(() => {});
    if (!(await visible(`[data-go="${stations[i + 1]}"]`))) { failures.push(`map shows no Go button for ${stations[i + 1]}`); await shot(`map-${stations[i]}`); break; }
    await page.click(`[data-go="${stations[i + 1]}"]`, { force: true });
    await page.waitForFunction((want) => window.__cr?.station?.id === want, stations[i + 1], { timeout: 20000 }).catch(() => {});
    await page.addScriptTag({ path: path.join(__dirname, 'bot-player.js') }).catch(() => {});
    await page.waitForTimeout(800);
    for (const sel of ['#startBtn', ...CLOSERS]) if (await visible(sel)) await page.click(sel).catch(() => {});
    await shot(`${i + 2}-${stations[i + 1]}`);
  }

  await browser.close();
  server.close();
  if (errors.length) failures.push(...errors.map((e) => `page error: ${e}`));
  console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS journey');
  process.exit(failures.length ? 1 : 0);
})();
