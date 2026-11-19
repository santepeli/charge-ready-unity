// Feel check, run like a client: every player action must make a sound, money must read as yellow cash, and key screens are saved for a visual review.
const path = require('path');
const { serve, launch, openGame } = require('./harness.cjs');
const { PERSONAS } = require('./personas.cjs');

const PORT = 8135, PLAY_SEC = 240, OUT = path.join(__dirname, 'out');
// Sounds a player must hear in the first minutes: picking up burgers, serving, plugging in, collecting money and buying.
const SOUNDS = ['pickup', 'deliver', 'plug', 'cash', 'buy'];
// Money is yellow everywhere: hue range in degrees.
const MONEY_HUE = [35, 60];

const hue = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

(async () => {
  const server = serve(PORT), browser = await launch(), failures = [];
  const page = await openGame(browser, PORT, 'bot', { seed: 3 });
  const P = PERSONAS.engaged;
  const heard = await page.evaluate(([st, pr, sec]) => {
    const log = {};
    __cr.audio.play = (name) => { log[name] = (log[name] ?? 0) + 1; };
    window.playBot(st, pr, sec, 0.05, 1e9);
    return log;
  }, [P.strategy, P, PLAY_SEC]);
  for (const s of SOUNDS) if (!heard[s]) failures.push(`no "${s}" sound in ${PLAY_SEC}s of play`);

  const colors = await page.evaluate(async () => {
    const coin = document.createElement('i');
    coin.className = 'coin';
    document.body.appendChild(coin);
    const css = getComputedStyle(coin).backgroundImage, icon = getComputedStyle(document.getElementById('cash'), '::before').backgroundColor;
    coin.remove();
    const { CONFIG } = await import('./config.js');
    return { css, icon, bill: CONFIG.colors.bill };
  });
  const { bill } = colors;
  if (hue(bill) < MONEY_HUE[0] || hue(bill) > MONEY_HUE[1]) failures.push(`bill color ${bill} is not yellow`);
  const rgb = colors.icon.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
  const iconHex = `#${rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  if (hue(iconHex) < MONEY_HUE[0] || hue(iconHex) > MONEY_HUE[1]) failures.push(`cash icon ${iconHex} is not yellow`);
  if (!/242, 194, 48/.test(colors.css)) failures.push('flying money is not a yellow banknote');

  // Screens for the visual review: the diner, the bays and a cash pile up close.
  for (const [x, z, name] of [[-4.6, -9, 'feel-diner'], [4, -3, 'feel-bays'], [7.5, 1.5, 'feel-offices']]) {
    await page.evaluate(([x, z]) => { const g = __cr; g.player.g.position.set(x, 0, z); for (let i = 0; i < 20; i++) g.update(0.05, { x: 0, y: 0 }); g.draw(0.016); }, [x, z]);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  }
  await browser.close();
  server.close();
  console.log(`sounds: ${JSON.stringify(heard)}`);
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'PASS (sounds, money colors, screens saved to tools/out)');
  process.exitCode = failures.length ? 1 : 0;
})();
