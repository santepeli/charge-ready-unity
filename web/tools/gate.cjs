// Quality gate: every check must pass before a version is published. Runs every check below in order; after publishing,
// tools/apk-check.cjs checks the app bundle and tools/release-check.cjs the built APK (see docs/TESTING.md).
const { spawnSync } = require('child_process');
const path = require('path');

const CHECKS = [
  ['Wiring (every button answers a tap, every id exists, every fixed element covered)', 'wiring-check.cjs', {}],
  ['Look (food stands out from the floor at every station)', 'look-check.cjs', {}],
  ['Layout (9 screens: phones both ways and tablets, no overlaps)', 'layout-check.cjs', {}],
  ['Camera (opening, full lot tour like a player, pads whole; 5 stations × 9 screens)', 'camera-check.cjs', {}],
  ['Visibility (the owner shows through any car in front, 5 stations)', 'visibility-check.cjs', {}],
  ['View (as a player sees it: standing still eases into the owner\'s own wide view, a step brings the play view back, no tint in the open)', 'view-check.cjs', {}],
  ['Sight (the owner keeps their own look on every spot of the lot, play and eye view; nothing blinks while walking; 5 stations)', 'sight-check.cjs', {}],
  ['Motion (every vehicle on road or lot, facing its way, no jumps, no crashes, no deadlocks; 5 stations)', 'motion-check.cjs', {}],
  ['Movement (touch drags against the idle arcade standard: start, stop, dead zone, speed curve, reversal, turns, cards)', 'move-check.cjs', {}],
  ['Feel (action sounds, yellow money, review screens)', 'feel-check.cjs', {}],
  ['Services (tire, repair, tow flows)', 'service-check.cjs', {}],
  ['Offline and VIP (away pay, welcome card, bill trail)', 'offline-check.cjs', {}],
  ['Reset (only two deliberate taps wipe the run)', 'reset-check.cjs', {}],
  ['Rescue (Unstuck, wiped save offered back from the backup, reset drops it)', 'rescue-check.cjs', {}],
  ['Features (visible upgrades, VoltMart rival driving forward, regulars, car album, daily tasks, convoy)', 'features-check.cjs', {}],
  ['Progress (one save, no resets, migration, station travel)', 'progress-check.cjs', {}],
  ['Ads and shop (rewarded pad, skip, purchases, break ad timing)', 'ads-check.cjs', {}],
  ['Play (every station: income, HUD, clipping, sides, pause)', 'play-check.cjs', {}],
  ['Simulation (5 player types, timing, rating, fines)', 'simulate.cjs', { SIM_RUNS: process.env.SIM_RUNS ?? '3' }],
  ['Journey (new player: onboarding by hand, then every station to the last through the real map)', 'journey-check.cjs', {}],
];

let failed = 0;
// GATE_SKIP=journey-check.cjs,... leaves out checks already run on their own for this version.
const skip = process.env.GATE_SKIP?.split(',') ?? [];
for (const [name, file, env] of CHECKS.filter(([, f]) => !skip.includes(f))) {
  const run = spawnSync('node', [path.join(__dirname, file)], { env: { ...process.env, ...env }, encoding: 'utf8' });
  const out = `${run.stdout}${run.stderr}`.trim().split('\n');
  const ok = run.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(out.slice(-6).map((l) => `      ${l}`).join('\n'));
}
console.log(failed ? `GATE CLOSED: ${failed} check(s) failed` : 'GATE OPEN: all checks passed');
process.exitCode = failed ? 1 : 0;
