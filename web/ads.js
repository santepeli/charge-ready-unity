// Ads and shop: in the Android app ads come from AdMob through the app's bridge; on the web a test card stands in. Purchases are still test cards.
import { CONFIG } from './config.js';

const AD = CONFIG.ads, $ = (id) => document.getElementById(id);
// The Android app adds window.ChargeReadyAds; each shown ad reports back through window.__adDone(id, watched).
const native = window.ChargeReadyAds, waiting = new Map();
let seq = 0;
window.__adDone = (id, watched) => { waiting.get(id)?.(watched); waiting.delete(id); };
const playNative = (kind) => new Promise((done) => { const id = `ad${++seq}`; waiting.set(id, done); native.show(id, kind); });

// With skip (bots and tests) rewarded ads count as watched, break ads and offers never show, and buy() needs no confirm.
export function createAds(shop, { skip, track, onBuy }) {
  const card = $('adCard'), yes = $('adYes'), no = $('adNo');
  let lastAd = -Infinity;
  const now = () => performance.now() / 1000;

  // A break ad never comes as a surprise: a small banner counts down warnSec first.
  const warn = () => new Promise((done) => {
    const el = $('adWarn');
    let left = AD.warnSec;
    const tick = () => { el.textContent = `📺 Short ad in ${left}…`; if (left-- <= 0) { el.hidden = true; clearInterval(t); done(); } };
    el.hidden = false;
    const t = setInterval(tick, 1000);
    tick();
  });
  // Shows the card and resolves with true for the main button, false for the other one.
  const ask = ({ title, body, note = '', ok, cancel, waitSec = 0 }) => new Promise((done) => {
    $('adTitle').textContent = title;
    $('adBody').textContent = body;
    $('adNote').textContent = note;
    no.textContent = cancel;
    card.hidden = false;
    let left = waitSec;
    const tick = () => { yes.disabled = left > 0; yes.textContent = left > 0 ? `${ok} ${left}` : ok; };
    tick();
    const timer = setInterval(() => { left--; tick(); if (left <= 0) clearInterval(timer); }, 1000);
    const end = (v) => { clearInterval(timer); card.hidden = true; yes.onclick = no.onclick = null; done(v); };
    yes.onclick = () => end(true);
    no.onclick = () => end(false);
  });

  const buy = async (key) => {
    const item = AD.shop[key];
    track(`shop_open_${key}`);
    if (!skip && !(await ask({ title: item.name, body: item.info, note: 'Test build: no real payment is taken', ok: item.price, cancel: 'Not now' }))) return false;
    shop[key] = true;
    if (key === 'starter') shop.noAds = true;
    track(`shop_buy_${key}`);
    onBuy(key);
    return true;
  };

  return {
    buy,
    // A rewarded video the player asked for; true when it was watched to the end.
    async rewarded(where) {
      track(`ad_offer_${where}`);
      let ok = skip;
      if (!ok && native) {
        // No video loaded yet (offline, or the ad network had none): say so instead of failing silently.
        if (native.ready('rewarded')) ok = await playNative('rewarded');
        else await ask({ title: '📺 No video yet', body: 'No video is ready right now. Try again in a moment.', ok: 'OK', cancel: 'Close' });
      } else if (!ok) ok = await ask({ title: '📺 Test ad', body: 'A short video ad plays here in the app.', ok: 'Collect', cancel: 'Skip', waitSec: AD.mockSec });
      lastAd = now();
      if (ok) track(`ad_done_${where}`);
      return ok;
    },
    // A break ad between stages, only when the player has no No Ads and the last ad is long enough ago.
    async breakAd() {
      if (skip || shop.noAds || now() - lastAd < AD.gapSec) return;
      lastAd = now();
      track('ad_break');
      await warn();
      if (native) { if (native.ready('interstitial')) await playNative('interstitial'); return; }
      if (!(await ask({ title: '📺 Test ad', body: 'A break ad plays here in the app.', ok: 'Close', cancel: `Remove ads ${AD.shop.noAds.price}`, waitSec: AD.mockSec }))) await buy('noAds');
    },
    // The starter pack is offered once, at the first stage card after starterAfterSec of play.
    async offerStarter() {
      if (skip || shop.offered || shop.starter) return false;
      shop.offered = true;
      await buy('starter');
      return true;
    },
  };
}
