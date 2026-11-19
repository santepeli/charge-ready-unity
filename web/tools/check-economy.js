// Compares the ECONOMY_L1.md tables with values computed from config.js and economy.js.
import { readFileSync } from 'node:fs';
import { CONFIG } from '../config.js';
import * as e from '../economy.js';

const TOLERANCE = 0.001;
const md = readFileSync(new URL('../docs/ECONOMY_L1.md', import.meta.url), 'utf8');

function table(id) {
  const lines = md.split(`<!-- check: ${id} -->`)[1].trim().split('\n');
  const end = lines.findIndex((l) => !l.startsWith('|'));
  return lines.slice(2, end < 0 ? undefined : end).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

const U = CONFIG.upgrades;
const cost = (k, n) => (n < U[k].maxLevel ? e.upgradeCost(U[k].baseCost, n) : 'MAX');
const lineTotal = (k) => Array.from({ length: U[k].maxLevel }, (_, n) => e.upgradeCost(U[k].baseCost, n)).reduce((a, b) => a + b);
const pads = CONFIG.pads.map((p, i) => [i + 1, p.type, e.padCost(p, 1 + CONFIG.pads.slice(0, i).filter((q) => q.type === 'bay').length)]);
const padTotal = pads.reduce((a, p) => a + p[2], 0);

const expected = {
  upgrades: Array.from({ length: U.tariff.maxLevel + 1 }, (_, n) =>
    [n, cost('tariff', n), e.chargeFee(n), cost('capacity', n), e.capacity(n), cost('speed', n), e.chargeTime(n)]),
  pads,
  total: [padTotal, lineTotal('tariff'), lineTotal('capacity'), lineTotal('speed')]
    .map((v) => [v]).concat([[padTotal + lineTotal('tariff') + lineTotal('capacity') + lineTotal('speed')]]),
  offline: table('offline').map(([b, t, s]) => [+b, +t, +s, e.offlineEarnings(+s, +b * e.chargeFee(+t) / CONFIG.economy.offlineSecPerCar)]),
};
// The total table carries a label column first.
const offset = { total: 1 };

let fails = 0;
for (const [id, rows] of Object.entries(expected)) {
  const got = table(id), shift = offset[id] ?? 0;
  if (got.length !== rows.length) { console.error(`${id}: tabloda ${got.length} satır, beklenen ${rows.length}`); fails++; }
  rows.forEach((row, i) => row.forEach((want, j) => {
    const have = got[i]?.[j + shift];
    const ok = typeof want === 'number' ? Math.abs(Number(have) - want) < TOLERANCE : have === want;
    if (!ok) { console.error(`${id} satır ${i + 1} sütun ${j + 1 + shift}: tabloda ${have}, formül ${want}`); fails++; }
  }));
}
console.log(fails ? `${fails} uyumsuzluk` : 'ECONOMY_L1.md formüllerle birebir uyumlu');
process.exitCode = fails ? 1 : 0;
