// Monte Carlo playtest: every persona plays SIM_RUNS seeded runs; prints medians, p90s and pass/fail against the bars.
const fs = require('fs'), path = require('path');
const { serve, launch, openGame, mmss } = require('./harness.cjs');
const { PERSONAS, BARS } = require('./personas.cjs');

// AFTER_SEC: how long each persona keeps playing after Station 1, to measure the mobile service.
const PORT = 8131, DT = 0.05, LIMIT_SEC = 2400, RUNS = Number(process.env.SIM_RUNS) || 8, AFTER_SEC = Number(process.env.AFTER_SEC ?? 300);
const KEYS = ['car1', 'bay2', 'bay3', 'worker', 'office', 'accounting', 'bay4', 'complete', 'coffee', 'stage3', 'depot', 'stage4', 'wash'];
const pct = (xs, q) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.min(Math.floor(q * v.length), v.length - 1)] : null; };

(async () => {
  const server = serve(PORT), browser = await launch(), report = {}, failures = [];
  for (const [name, persona] of Object.entries(PERSONAS)) {
    const runs = [];
    for (let seed = 1; seed <= RUNS; seed++) {
      const errors = [], page = await openGame(browser, PORT, 'bot', { seed, errors });
      const r = await page.evaluate(([st, pr, lim, dt, after]) => window.playBot(st, pr, lim, dt, after), [persona.strategy, persona, LIMIT_SEC, DT, AFTER_SEC]);
      await page.close();
      runs.push({ seed, ...r, at: Object.fromEntries(r.log), errors });
    }
    const stat = Object.fromEntries(KEYS.map((k) => [k, { median: pct(runs.map((r) => r.at[k]), 0.5), p90: pct(runs.map((r) => r.at[k]), 0.9) }]));
    stat.rating = pct(runs.map((r) => r.rating), 0.5);
    stat.missions = pct(runs.map((r) => r.missions), 0.5);
    // Mobile service over AFTER_SEC: dollars per minute and share of calls missed.
    stat.vanPerMin = pct(runs.map((r) => (r.mobile ? Math.round(r.mobile.earned / AFTER_SEC * 60) : 0)), 0.5);
    stat.missedShare = pct(runs.map((r) => (r.mobile && r.mobile.jobs + r.mobile.missed ? r.mobile.missed / (r.mobile.jobs + r.mobile.missed) : 0)), 0.5);
    // Police fines before Station 1 is complete, jam count and cups sold after it.
    stat.fines = pct(runs.map((r) => r.log.filter(([n, t]) => /^fine\d/.test(n) && t <= (r.doneAt ?? Infinity)).length), 0.5);
    stat.jams = pct(runs.map((r) => r.jams), 0.5);
    stat.cups = pct(runs.map((r) => r.cups), 0.5);
    report[name] = { stat, runs };

    const [lo, hi] = BARS.completeWindow[name], done = stat.complete.median;
    if (runs.some((r) => r.errors.length)) failures.push(`${name}: page errors ${runs.flatMap((r) => r.errors).join('; ')}`);
    if (runs.some((r) => (r.at.car1 ?? Infinity) > BARS.firstCarMax)) failures.push(`${name}: a run had no paying car within ${BARS.firstCarMax}s`);
    if (done == null || done < lo || done > hi) failures.push(`${name}: median finish ${mmss(done)} outside ${mmss(lo)}-${mmss(hi)}`);
    if (stat.fines > BARS.maxFines[name]) failures.push(`${name}: median ${stat.fines} police fines before completion, allowed ${BARS.maxFines[name]}`);
    if (stat.rating < BARS.minRating[name]) failures.push(`${name}: median rating ${stat.rating.toFixed(1)} below ${BARS.minRating[name]}`);
  }
  await browser.close();
  server.close();

  fs.writeFileSync(path.join(__dirname, 'sim-report.json'), JSON.stringify(report, null, 2));
  console.log(`| persona | ${KEYS.join(' | ')} | rating | missions | jams | fines | cups | van $/min | missed |`);
  console.log(`|${'---|'.repeat(KEYS.length + 8)}`);
  for (const [name, { stat }] of Object.entries(report)) {
    console.log(`| ${name} | ${KEYS.map((k) => `${mmss(stat[k].median)} (p90 ${mmss(stat[k].p90)})`).join(' | ')} | ${stat.rating.toFixed(1)} | ${stat.missions} | ${stat.jams} | ${stat.fines} | ${stat.cups} | ${stat.vanPerMin} | ${Math.round(stat.missedShare * 100)}% |`);
  }
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : `PASS (${RUNS} runs per persona)`);
  process.exitCode = failures.length ? 1 : 0;
})();
