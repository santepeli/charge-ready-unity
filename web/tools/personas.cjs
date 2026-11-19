// Player personas for simulated playtests and the bars each one is held to.
const LINES = ['tariff', 'capacity', 'speed'];
const careful = { savePads: true, cheapest: true, order: LINES };

// speed: joystick push 0-1, thinkSec: decision gap, learnSec: time to discover the diner,
// lapsePerMin/lapseSec: moments of looking away, noise: steering wobble (rad), shopChance: chance to look at upgrades per decision.
// casual is calibrated to the real runs on 2026-11-05 (bay2 0:52, bay3 1:49, worker 3:33, bay4 4:03).
const PERSONAS = {
  novice: { speed: 0.55, thinkSec: 2.5, arrive: 0.6, learnSec: 50, lapsePerMin: 3, lapseSec: 4, noise: 0.6, shopChance: 0.15, strategy: careful },
  casual: { speed: 0.65, thinkSec: 2, arrive: 0.5, learnSec: 30, lapsePerMin: 1.5, lapseSec: 3, noise: 0.4, shopChance: 0.4, strategy: careful },
  engaged: { speed: 0.85, thinkSec: 1, arrive: 0.4, learnSec: 10, lapsePerMin: 0.5, lapseSec: 2, noise: 0.2, shopChance: 0.8, strategy: careful },
  optimizer: { speed: 1, thinkSec: 0.2, arrive: 0.3, learnSec: 0, lapsePerMin: 0, lapseSec: 0, noise: 0, shopChance: 1, strategy: careful },
  distracted: { speed: 0.65, thinkSec: 2, arrive: 0.5, learnSec: 30, lapsePerMin: 6, lapseSec: 6, noise: 0.4, shopChance: 0.3, strategy: careful },
};

// Every run must reach a first paying car in time; the median run must finish inside its window; rating must stay healthy;
// attentive players never meet the police before Station 1 is done, inattentive ones at most a couple of times.
const BARS = {
  firstCarMax: 45,
  // Rating at Stage 1 completion; the novice still learns the diner, so their bar is a little lower.
  minRating: { novice: 3.3, casual: 3.5, engaged: 3.5, optimizer: 3.5, distracted: 3.5 },
  completeWindow: { novice: [300, 780], casual: [360, 570], engaged: [300, 510], optimizer: [240, 450], distracted: [360, 840] },
  maxFines: { novice: 4, casual: 1, engaged: 0, optimizer: 0, distracted: 3 },
};

module.exports = { LINES, PERSONAS, BARS };
