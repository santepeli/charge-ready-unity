// Look check: on every station the food it sells stands out from the floor it is served on. The strongest part of the food model
// (by luminance contrast) must reach MIN against both floor colours, or players cannot tell what they carry (the pale hot dog lesson).
const { serve, launch, openGame } = require('./harness.cjs');

// Stations still waiting for their food recolour: reported as warnings until fixed, then removed from this list.
const PORT = 8149, MIN = 2, KNOWN = [];
(async () => {
  const server = serve(PORT), browser = await launch(), page = await openGame(browser, PORT, 'sim');
  const rows = await page.evaluate(async (min) => {
    const { CONFIG } = await import('./config.js'), { foodGeometry } = await import('./models.js');
    const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    return CONFIG.stations.map((st) => {
      if (st.food.model === 'burger') return [st.id, null];
      const parts = foodGeometry(st.food.model, 1, st.food.tint).mat.map((m) => `#${m.color.getHexString()}`);
      const worst = Math.min(...st.floor.map((f) => Math.max(...parts.map((p) => ratio(p, f)))));
      return [st.id, +worst.toFixed(2)];
    });
  }, MIN);
  await browser.close();
  server.close();
  const low = rows.filter(([, r]) => r !== null && r < MIN), failures = low.filter(([id]) => !KNOWN.includes(id)).map(([id, r]) => `${id}: food reaches only ${r}:1 against its floor (needs ${MIN}:1)`);
  // A known station that now passes must leave KNOWN, so the list cannot hide a fix or a new problem.
  KNOWN.filter((id) => !low.some(([l]) => l === id)).forEach((id) => failures.push(`${id} now passes: take it out of KNOWN`));
  const warn = low.filter(([id]) => KNOWN.includes(id)).map(([id, r]) => `${id} ${r}:1`).join(', ');
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : `PASS (food against floor: ${rows.map(([id, r]) => `${id} ${r ?? 'kit'}`).join(', ')}${warn ? `; still pale, to fix: ${warn}` : ''})`);
  process.exitCode = failures.length ? 1 : 0;
})();
