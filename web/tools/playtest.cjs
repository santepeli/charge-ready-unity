// Strategy search: a perfect bot tries every upgrade strategy, then the calibrated casual persona replays the best ones.
const fs = require('fs'), path = require('path');
const { serve, launch, openGame, mmss } = require('./harness.cjs');
const { LINES, PERSONAS } = require('./personas.cjs');

const PORT = 8130, DT = 0.05, LIMIT_SEC = 1800, SEED = 1;
// FLOW_5MIN.md targets in seconds; complete is the 6-8 minute window midpoint.
const TARGETS = { car1: 10, bay2: 50, bay3: 120, worker: 195, bay4: 240, complete: 420 };
// CR_PROFILE='{"speed":0.6}' overrides the casual persona while calibrating it.
const PROFILES = { bot: PERSONAS.optimizer, human: { ...PERSONAS.casual, ...JSON.parse(process.env.CR_PROFILE || '{}') } };
const perms = (a) => (a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])));
const strategies = [true, false].flatMap((savePads) => [
  { name: `${savePads ? 'save' : 'spend'}-cheapest`, savePads, cheapest: true, order: LINES },
  ...perms(LINES).map((order) => ({ name: `${savePads ? 'save' : 'spend'}-${order.join('>')}`, savePads, cheapest: false, order })),
]);

async function run(browser, strategy, profileName) {
  const page = await openGame(browser, PORT, 'bot', { seed: SEED });
  const result = await page.evaluate(([st, pr, lim, dt]) => window.playBot(st, pr, lim, dt), [strategy, PROFILES[profileName], LIMIT_SEC, DT]);
  await page.close();
  return { strategy: strategy.name, profile: profileName, ...result, at: Object.fromEntries(result.log) };
}

(async () => {
  const server = serve(PORT), browser = await launch(), results = [];
  for (const st of strategies) results.push(await run(browser, st, 'bot'));
  const ranked = [...results].sort((a, b) => (a.doneAt ?? Infinity) - (b.doneAt ?? Infinity));
  const best = strategies.find((s) => s.name === ranked[0].strategy);
  // Humans follow the guide arrow to pads, so the best pad-saving strategy is replayed too.
  const bestSave = strategies.find((s) => s.name === ranked.find((r) => r.strategy.startsWith('save')).strategy);
  results.push(await run(browser, best, 'human'), await run(browser, bestSave, 'human'));
  await browser.close();
  server.close();

  fs.writeFileSync(path.join(__dirname, 'playtest-results.json'), JSON.stringify({ targets: TARGETS, best: best.name, results }, null, 2));
  const keys = Object.keys(TARGETS);
  console.log(['strategy', 'profile', ...keys, 'cars'].join(' | '));
  console.log(['hedef', '', ...keys.map((k) => mmss(TARGETS[k])), ''].join(' | '));
  for (const r of [...ranked, ...results.slice(-2)]) console.log([r.strategy, r.profile, ...keys.map((k) => mmss(r.at[k])), r.served].join(' | '));
  console.log(`En iyi strateji: ${best.name}`);
})();
