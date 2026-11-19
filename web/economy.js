import { CONFIG } from './config.js';

const E = CONFIG.economy, U = CONFIG.upgrades, N = CONFIG.unlocks;

// Station level n applies the project multipliers once more per level (costs ×1.6, prices ×1.3); `bonus` is the chain's star bonus on income.
export const city = { cost: 1, income: 1 };
export const setCity = (n, bonus = 0) => { city.cost = E.costMultiplier ** n; city.income = E.incomeMultiplier ** n * (1 + bonus); };

// Cost of buying the next step when an upgrade line sits at `level`.
export const upgradeCost = (base, level) => Math.round(base * E.costMultiplier ** level * city.cost);

// Charging fee a car pays when it leaves full.
export const chargeFee = (tariffLevel) => Math.round(E.chargeFeeBase * E.incomeMultiplier ** tariffLevel * city.income);

export const capacity = (level) => U.capacity.start + U.capacity.step * level;

// Seconds a car needs on the charger at Fast Chargers `level`.
export const chargeTime = (level) => U.speed.startSec * U.speed.factor ** level;

// Bay k (1-based) costs base × 1.6^(k-2); `baysOwned` bays already exist; other pads have a fixed price.
export const padCost = (pad, baysOwned) =>
  pad.type === 'bay' ? upgradeCost(N.bay.baseCost, baysOwned - 1) : Math.round((pad.cost ?? (pad.type === 'depot' ? CONFIG.mobile.depotCost : (N[pad.type] ?? CONFIG.service[pad.type] ?? CONFIG.airport[pad.type]).cost)) * city.cost);

// Police fine for the n-th fine of a run (0-based): grows each time up to a cap, rounded to a friendly step.
export const fineFor = (n) => {
  const T = CONFIG.traffic;
  return Math.round(Math.min(T.fineBase * T.fineGrowth ** n, T.fineMax) / T.fineRound) * T.fineRound;
};

// Net pay for a mobile rescue at `km`: fee by distance minus the van's round-trip cost.
export const rescuePay = (km) => {
  const M = CONFIG.mobile;
  return Math.round((M.feeBase + M.feePerKm * km - M.costPerKm * km * 2) * city.income);
};

// Away earnings: capped time × income per second × the offline share.
export const offlineEarnings = (elapsedSec, ratePerSec) =>
  Math.floor(Math.min(Math.max(elapsedSec, 0), E.offlineCapSec) * ratePerSec * E.offlineShare);
