// Release check, run after the APK is built: the newest release on GitHub is a new tag (not the one given as the last release), and the
// APK inside it carries exactly the tested bundle. Any network error fails loudly, never waits silently.
// Usage: node tools/release-check.cjs <last tag, e.g. apk-7> [bundle folder]; with --wait it retries for up to 25 minutes.
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const REPO = 'santepeli/charge-ready-unity', LAST = process.argv[2], WWW = process.argv[3]?.startsWith('--') ? undefined : process.argv[3];
const BUNDLE = WWW ?? '/home/claude/apk/project/app/src/main/assets/www', WAIT = process.argv.includes('--wait');
const curl = (...args) => execFileSync('curl', ['-sS', '--fail', ...args], { maxBuffer: 1 << 28 });

const latestTag = () => {
  const head = curl('-I', `https://github.com/${REPO}/releases/latest/download/ChargeReady.apk`).toString();
  return head.match(/location: .*\/download\/([^/]+)\/ChargeReady\.apk/i)?.[1];
};

(async () => {
  if (!LAST) throw new Error('give the last release tag, e.g. node tools/release-check.cjs apk-7');
  let tag = latestTag();
  for (let i = 0; WAIT && tag === LAST && i < 50; i++) { await new Promise((r) => setTimeout(r, 30000)); tag = latestTag(); }
  const failures = [];
  if (!tag) failures.push('GitHub gave no latest release');
  else if (tag === LAST) failures.push(`latest release is still ${LAST}: the build did not finish or failed`);
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-')), apk = path.join(dir, 'a.apk');
    curl('-L', '-o', apk, `https://github.com/${REPO}/releases/download/${tag}/ChargeReady.apk`);
    const names = execFileSync('unzip', ['-Z1', apk]).toString().split('\n').filter((n) => n.startsWith('assets/www/') && !n.endsWith('/'));
    const local = (base, rel = '') => fs.readdirSync(path.join(base, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? local(base, path.join(rel, e.name)) : [path.join(rel, e.name)]));
    const want = local(BUNDLE);
    if (names.length !== want.length) failures.push(`APK has ${names.length} web files, the bundle ${want.length}`);
    for (const f of want) {
      const n = `assets/www/${f}`;
      if (!names.includes(n)) { failures.push(`${f} missing from the APK`); continue; }
      if (!execFileSync('unzip', ['-p', apk, n], { maxBuffer: 1 << 28 }).equals(fs.readFileSync(path.join(BUNDLE, f)))) failures.push(`${f} in the APK differs from the bundle`);
    }
    fs.rmSync(dir, { recursive: true });
  }
  console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : `PASS (${tag}: every web file in the APK matches the tested bundle)`);
  process.exitCode = failures.length ? 1 : 0;
})().catch((e) => { console.log(`FAIL\n- ${e.message.split('\n')[0]}`); process.exitCode = 1; });
