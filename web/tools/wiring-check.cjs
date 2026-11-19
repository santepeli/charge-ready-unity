// Wiring check: every button reacts to a tap, every id the code asks for exists, and every fixed element on screen is covered by the
// layout check (tools/hud-list.cjs), so a new control cannot ship untested or unwired.
const fs = require('fs'), path = require('path');
const { serve, launch, openGame } = require('./harness.cjs');
const { HUD, CARDS, BANNERS, FULLSCREEN } = require('./hud-list.cjs');

const ROOT = path.join(__dirname, '..'), html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const code = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const failures = [];
const ids = new Set([...html.matchAll(/\sid="([\w-]+)"/g)].map((m) => m[1]));
// Ids the code builds at run time (canvas, rows) are created by code, not markup.
const built = new Set([...code.matchAll(/id = '([\w-]+)'|id="([\w-]+)"/g)].map((m) => m[1] ?? m[2]));

// Ids the code reads must exist in index.html.
for (const [, id] of code.matchAll(/(?:\$|getElementById)\('([\w-]+)'\)/g)) if (!ids.has(id) && !built.has(id)) failures.push(`code asks for #${id}, which index.html does not have`);
// Every element the stylesheet pins to the screen is in one of the layout check's lists.
const covered = new Set([...HUD, ...CARDS, ...Object.keys(BANNERS), ...FULLSCREEN]);
for (const [, id] of html.matchAll(/#([\w-]+)\s*\{[^}]*position:\s*fixed/g)) if (!covered.has(id)) failures.push(`#${id} is fixed on screen but not in tools/hud-list.cjs, so no layout check covers it`);
for (const id of covered) if (!ids.has(id)) failures.push(`tools/hud-list.cjs lists #${id}, which index.html does not have`);

(async () => {
  // In the running game every button has a tap handler on itself or on a parent that hands taps down (click listeners are recorded as added).
  const server = serve(8145), browser = await launch(), errors = [];
  const game = await openGame(browser, 8145, 'sim', { errors, init: () => {
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...rest) { if (['click', 'pointerdown', 'pointerup'].includes(type)) this.__tap = true; return add.call(this, type, ...rest); };
  } });
  // Buttons inside a closed card get their handler when the card opens (the card's own check taps them); every other button, even one hidden
  // until needed, must already answer a tap.
  const dead = await game.evaluate(() => [...document.querySelectorAll('button')].filter((b) => !b.parentElement.closest('[hidden]')).filter((b) => { for (let e = b; e; e = e.parentElement) if (e.onclick || e.__tap || e.onpointerdown || e.onpointerup) return false; return true; }).map((b) => b.id || b.textContent.trim().slice(0, 20)));
  dead.forEach((id) => failures.push(`button ${id} does nothing when tapped: no handler on it or a parent`));
  // No element lets the phone zoom the page on a double tap (iPhone ignores user-scalable=no): each one is manipulation or none.
  const zoomable = await game.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => !['manipulation', 'none'].includes(getComputedStyle(e).touchAction)).map((e) => e.id || e.getAttribute('class') || e.tagName).slice(0, 5));
  if (zoomable.length) failures.push(`double tap can zoom the page on: ${zoomable.join(', ')}`);
  await browser.close();
  server.close();
  if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : `PASS (${ids.size} ids, every button wired, ${covered.size} fixed elements covered)`);
  process.exitCode = failures.length ? 1 : 0;
})();
