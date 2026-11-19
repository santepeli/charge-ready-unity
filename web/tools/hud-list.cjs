// One list of the screens and the fixed elements every check covers; wiring-check fails when index.html gains a fixed element missing here.
module.exports = {
  // Phones both ways and tablets.
  SIZES: [[360, 800], [375, 667], [390, 844], [430, 932], [844, 390], [932, 430], [768, 1024], [820, 1180], [1180, 820]],
  // HUD: controls and labels that may be on screen together; no two may overlap and none may leave the screen.
  HUD: ['joy', 'upgBtn', 'hint', 'cash', 'goalCard', 'mapWrap', 'mission', 'divertBtn', 'boosts', 'booksBtn', 'toast', 'queue', 'city', 'rush', 'padAd', 'chainBox', 'rivalBar'],
  // Sample text for HUD parts the frame loop shows only in rare moments, so the check sees them at a realistic width.
  SAMPLE: { boosts: '⚡Kitchen Rush 30s  ⚡Extra Hand 40s', divertBtn: '🚐 Vans', booksBtn: '📊 Books', toast: 'Worker: "The kitchen can\'t keep up!" Visit the manager to order Kitchen Rush', queue: '🚗 4 in line', padAd: '▶ Finish it free ($1,240)', chainBox: '🔗 +$124,800', rivalBar: '⚡ VoltMart dare · You 2/3 · 24s' },
  // Pairs that never show at the same time, with the reason.
  APART: [
    ['hint', 'padAd'], // the hint hides while the pad ad button shows
    ['toast', 'padAd'], // the pad ad button waits while a toast is up
    ['rush', 'rivalBar'], // VoltMart never comes during a rush, a flight or the night
  ],
  // Full-screen cards: the sheet must fit the screen and sit centred.
  CARDS: ['panel', 'settings', 'done', 'adCard', 'welcome', 'restore', 'notice', 'feedback', 'goals', 'chain', 'books', 'mapPanel', 'managerPanel'],
  // Short banners in the middle of the screen: with sample text they must stay on screen.
  BANNERS: { adWarn: '📺 Short ad in 3…', combo: 'COMBO ×5', deltas: '+$1,240', jam: '🚨 Road blocked! Serve faster', siren: '🚔 Police on the way', stageUp: null, ticket: null },
  // Covers the whole screen by design, so there is nothing to place.
  FULLSCREEN: ['start', 'travel', 'flash', 'boot'],
};
