// Trailer: records real gameplay, frame by frame at a steady 30 fps, and cuts a ~30 s vertical 1080x1920 video with short captions
// and an end card (tools/out/trailer.mp4). The game runs as a player gets it (`probe`); a bot walks where a player would, and each
// scene only sets up the moment it shows (a VIP due, a storm due, VoltMart due), as a lucky session would bring it.
// Usage: node tools/trailer.cjs; TRAILER_ONLY=2,3 records only those scenes (the cut uses whatever frames are on disk).
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { serve, launch, openGame } = require('./harness.cjs');
const { PERSONAS } = require('./personas.cjs');

const PORT = 8187, FPS = 30, OUT = path.join(__dirname, 'out', 'trailer'), FONT = process.env.TRAILER_FONT ?? path.join(__dirname, 'out', 'trailer-font.ttf');
const SCENES = [
  { station: 'town', warm: 4, sec: 4, caption: 'Charge cars, serve food' },
  { station: 'town', warm: 150, sec: 4, caption: 'Grow your station' },
  { station: 'town', warm: 90, sec: 4.5, setup: 'vip', caption: 'VIPs pay big' },
  { station: 'highway', warm: 90, sec: 4.5, setup: 'storm', caption: 'Storms bring a rush' },
  { station: 'town', warm: 90, sec: 4.5, setup: 'rival', caption: 'Beat the rival station' },
  { station: 'airport', warm: 60, sec: 3, caption: '5 stations to build' },
  { station: 'hotel', warm: 60, sec: 3, caption: '5 stations to build' },
];
const only = process.env.TRAILER_ONLY?.split(',').map(Number);

async function record(i, scene) {
  const dir = path.join(OUT, `scene${i}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await launch(), errors = [];
  // The game's font is offline here, so it is handed to the page directly.
  const font = (w) => `@font-face { font-family: 'Baloo 2'; font-weight: ${w}; src: url(data:font/woff2;base64,${fs.readFileSync(`/tmp/fs/package/files/baloo-2-latin-${w}-normal.woff2`).toString('base64')}) format('woff2'); }`;
  const css = font(600) + font(800);
  const page = await openGame(browser, PORT, 'probe', { viewport: { width: 540, height: 960 }, scale: 2, station: scene.station, errors,
    init: (css) => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.append(st); }), initArg: css });
  // The button pulses, so the tap does not wait for it to hold still.
  await page.click('#startBtn', { force: true });
  if (!(await page.evaluate(() => Boolean(window.botBrain)))) await page.addScriptTag({ path: path.join(__dirname, 'bot-player.js') });
  // The game's own loop stops; from here every frame is one bot step and one picture, so the footage is smooth whatever the machine.
  await page.evaluate(async ({ scene, pr }) => {
    const { CONFIG } = await import('./config.js'), g = window.__cr, p = g.player.g.position, s = g.state;
    g.renderer.setAnimationLoop(null);
    s.shop.noAds = true;
    const brain = window.botBrain(pr.strategy, pr);
    window.__step = (dt, draw = true) => {
      const t = brain.target(), d = Math.hypot(t.x - p.x, t.z - p.z);
      g.update(dt, d < pr.arrive ? { x: 0, y: 0 } : { x: (t.x - p.x) / d, y: (t.z - p.z) / d });
      // Upgrades are bought now and then, as a player taps the shop between runs.
      if ((window.__think = (window.__think ?? 0) - dt) <= 0) { window.__think = 1; const k = brain.shopChoice(); if (k) g.buy(k); }
      if (draw) g.draw(dt);
    };
    // Events this scene does not show wait, so they do not steal the camera.
    const far = s.playSec + 9999;
    g.storm.next = far; g.grid.next = far; g.convoy.next = far;
    s.rival = { ...(s.rival ?? {}), wins: CONFIG.rival.giveUp };
    for (let k = 0; k < scene.warm / 0.05; k++) window.__step(0.05, k % 10 === 0);
    if (scene.setup === 'vip') {
      const E = CONFIG.engage, chance = (g.station.vip?.chance ?? E.vipChance) * 100;
      let n = Math.max(E.vipFirstCar, s.spawned + 1);
      while ((n * 37) % 100 >= chance) n++;
      s.spawned = n - 1;
      s.playSec += 300;
      for (let k = 0; k < 4000 && !g.queue.some((c) => c.vip) && !g.openBays().some((b) => b.car?.vip); k++) window.__step(0.05, k % 10 === 0);
    }
    if (scene.setup === 'storm') g.storm.next = s.playSec;
    if (scene.setup === 'rival') {
      s.rival.wins = 0;
      s.playSec = Math.max(s.playSec, CONFIG.rival.firstSec + 600);
      for (let k = 0; k < 4000 && g.rival()?.phase !== 'dare'; k++) window.__step(0.05, k % 10 === 0);
    }
    // A moment for the camera to settle on the action.
    for (let k = 0; k < 20; k++) window.__step(1 / 30);
  }, { scene, pr: PERSONAS.engaged });
  for (let f = 0; f < scene.sec * FPS; f++) {
    await page.evaluate((dt) => window.__step(dt), 1 / FPS);
    await page.screenshot({ path: path.join(dir, `${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  await browser.close();
  if (errors.length) console.log(`scene ${i} page errors: ${errors.join(' | ')}`);
  console.log(`scene ${i}: ${scene.sec * FPS} frames`);
}

// One clip per scene with its caption, then the end card, joined into the trailer.
function cut() {
  const esc = (t) => t.replace(/'/g, "’").replace(/:/g, '\\:');
  const caption = (t) => `drawtext=fontfile=${FONT}:text='${esc(t)}':fontsize=84:fontcolor=white:borderw=8:bordercolor=0x1d2b4f:x=(w-text_w)/2:y=h*0.70`;
  const clips = SCENES.map((s, i) => {
    const clip = path.join(OUT, `clip${i}.mp4`);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(OUT, `scene${i}`, '%04d.jpg'),
      '-vf', `scale=1080:1920,${caption(s.caption)},fade=t=in:st=0:d=0.15`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', clip]);
    return clip;
  });
  const end = path.join(OUT, 'end.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0xffb300:s=1080x1920:d=2.5:r=${FPS}`,
    '-vf', [`drawtext=fontfile=${FONT}:text='⚡':fontsize=260:x=(w-text_w)/2:y=h*0.26`,
      `drawtext=fontfile=${FONT}:text='CHARGE READY':fontsize=130:fontcolor=white:borderw=10:bordercolor=0x1d2b4f:x=(w-text_w)/2:y=h*0.45`,
      `drawtext=fontfile=${FONT}:text='Play free':fontsize=80:fontcolor=0x1d2b4f:x=(w-text_w)/2:y=h*0.58`, 'fade=t=in:st=0:d=0.3'].join(','),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', end]);
  const list = path.join(OUT, 'list.txt');
  fs.writeFileSync(list, [...clips, end].map((c) => `file '${c}'`).join('\n'));
  const out = path.join(__dirname, 'out', 'trailer.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
  console.log(`trailer: ${out}`);
}

(async () => {
  const server = serve(PORT);
  for (const [i, scene] of SCENES.entries()) if (!only || only.includes(i)) await record(i, scene);
  server.close();
  cut();
})();
