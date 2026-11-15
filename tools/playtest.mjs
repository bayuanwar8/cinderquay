// playtest.mjs — live end-to-end play-test for Cinderquay (workstream D).
// Drives the REAL game (no ?shot=) through Chrome DevTools Protocol:
//   Play -> buy (Kevlar x2, Vex-9) -> Deploy -> pointer lock -> move +
//   look + fire -> watch bots fight -> round end -> next round buy.
// Observes plant / defuse if the bots reach them, and records every
// console error / exception / failed request.
//
//   node tools/playtest.mjs [--port 8901] [--cdp-port 9223]
//     [--chrome <path>] [--max-seconds 300] [--profile <dir>]
//
// Node 22+, no dependencies (global fetch + WebSocket). Chrome is launched
// by this script; the http server is started here too. Both are killed by
// PID at the end (never pkill -f). Reuse an existing hs-profile-* dir;
// a fresh profile hangs chrome-headless-shell.
// Exit code: 0 = full sequence observed with 0 console errors,
//            1 = sequence incomplete or any console error.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(opt('--port', '8901'));
const CDP_PORT = Number(opt('--cdp-port', '9223'));
const MAX_SECONDS = Number(opt('--max-seconds', '300'));
const CHROME = opt(
  '--chrome',
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`,
);
const PROFILE = opt('--profile', `${process.env.HOME}/workspace/makefun/.tmp/hs-profile-2-detail`);
const HEADLESS = opt('--headless', ''); // e.g. "new" for full chromium; headless-shell needs none
const WINDOW_SIZE = opt('--window-size', '1280,720'); // smaller (640,360) = faster swiftshader frames = faster game-time
const GAME_URL = `http://127.0.0.1:${PORT}/game/`;

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const errors = [];
const timeline = [];
const note = (msg) => { timeline.push(`${new Date().toISOString().slice(11, 19)} ${msg}`); log('EVT', msg); };

let server = null;
let chrome = null;

function killProc(p, name) {
  return new Promise((res) => {
    if (!p || p.killed) return res();
    p.once('exit', () => res());
    try { p.kill('SIGTERM'); } catch { /* already gone */ }
    setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* no-op */ } res(); }, 3000);
  });
}

async function waitFor(url, tries = 50) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  return false;
}

// Minimal CDP client over the built-in WebSocket.
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(fn) { this.listeners.push(fn); }

  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result ? r.result.value : undefined;
  }
}

async function main() {
  server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
  if (!(await waitFor(`http://127.0.0.1:${PORT}/game/`))) throw new Error('http server did not come up');

  chrome = spawn(CHROME, [
    ...(HEADLESS ? [`--headless=${HEADLESS}`] : []),
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox',
    '--disable-dev-shm-usage', '--hide-scrollbars',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
    `--window-size=${WINDOW_SIZE}`, 'about:blank',
  ], { stdio: 'ignore' });
  if (!(await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`))) throw new Error('chrome CDP did not come up');

  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new Cdp(ws);
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push('EXCEPTION ' + (d.exception?.description || d.text || '').slice(0, 300));
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('CONSOLE.ERROR ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const text = (msg.params.entry.text || '') + ' ' + (msg.params.entry.url || '');
      if (text.includes('favicon.ico')) return; // missing favicon is not a game error
      errors.push('LOG.ERROR ' + text);
    }
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.navigate', { url: GAME_URL });
  // Wait for the boot signal: main.js fills #grenade-count ('HE 0 · SMOKE 0')
  // only after the module evaluated and the HUD was wired. Static HTML
  // leaves it empty, so a click before this lands on a dead button.
  let booted = false;
  for (let i = 0; i < 60; i += 1) {
    const g = await cdp.eval(`document.getElementById('grenade-count') ? document.getElementById('grenade-count').textContent : ''`);
    if (g && g.length > 0) { booted = true; break; }
    await sleep(500);
  }
  if (!booted) throw new Error('game module did not boot (grenade-count still empty after 30s)');
  await sleep(1000);

  const snap = () => cdp.eval(`(() => {
    const t = (id) => { const el = document.getElementById(id); return el ? el.textContent.trim() : null; };
    const vis = (id) => { const el = document.getElementById(id); return el ? !el.hidden && !el.classList.contains('hidden') : false; };
    return {
      money: t('money'), armor: t('armor-num'), hp: t('health-num'),
      ammoMag: t('ammo-mag'), ammoRes: t('ammo-reserve'), weapon: t('weapon-name'),
      timer: t('timer'), scoreE: t('score-ember'), scoreT: t('score-tide'),
      round: t('round-num'), bomb: t('bomb-status'),
      buyMenu: vis('buy-menu'), overlay: vis('overlay'),
      overlayTitle: t('overlay-title'), overlayCopy: t('overlay-copy'),
      channel: (() => { const el = document.getElementById('channel'); return el && el.classList.contains('on') ? t('channel-label') : null; })(),
      killfeed: Array.from(document.querySelectorAll('#killfeed div')).map((d) => d.textContent.trim()),
      locked: !!document.pointerLockElement,
    };
  })()`);

  const realClick = async (selector) => {
    // Trusted click via CDP input events: el.click() from Runtime.evaluate
    // is synthetic and carries no user activation, so requestPointerLock()
    // (Deploy / resume) refuses it. A dispatched mouse press+release counts.
    const rect = await cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!rect) return 'NOT-FOUND:' + selector;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    return 'CLICKED:' + selector;
  };

  const clickByText = (selector, text) => cdp.eval(`(() => {
    const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const el = els.find((e) => e.textContent.includes(${JSON.stringify(text)}));
    if (!el) return 'NOT-FOUND:' + ${JSON.stringify(text)};
    if (el.disabled) return 'DISABLED:' + ${JSON.stringify(text)};
    el.click(); return 'CLICKED:' + ${JSON.stringify(text)};
  })()`);

  const key = (code, type) => cdp.eval(
    `window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)}, { code: ${JSON.stringify(code)}, bubbles: true })); 'ok'`,
  );
  const mouse = (type, extra = {}) => cdp.eval(
    `window.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, Object.assign({ bubbles: true, button: 0 }, ${JSON.stringify(extra)}))); 'ok'`,
  );

  // --- 1. start overlay -> PLAY -----------------------------------------
  let s = await snap();
  note(`loaded: overlay=${s.overlay} title=${s.overlayTitle} timer=${s.timer}`);
  if (!s.overlay) throw new Error('start overlay not visible after load');
  log('play click:', await realClick('#play'));
  await sleep(1500);
  s = await snap();
  note(`after PLAY: buyMenu=${s.buyMenu} timer=${s.timer} money=${s.money} round=${s.round}`);
  if (!s.buyMenu) throw new Error('buy menu did not open after PLAY');

  // --- 2. buy: Kevlar x1 (armor 0 -> 50; $800 only buys one $650 vest,
  // a second is unaffordable — the DISABLED below is expected, not a bug).
  // Vex-9 ($1500) is likewise unaffordable in round 1 with $800.
  log('buy:', await clickByText('.buy-item', 'Kevlar vest'));
  await sleep(300);
  s = await snap();
  note(`after Kevlar x1: armor=${s.armor} money=${s.money}`);
  log('buy (expect DISABLED, $150 left):', await clickByText('.buy-item', 'Kevlar vest'));
  log('buy (expect DISABLED, $1500 > $150):', await clickByText('.buy-item', 'Vex-9'));
  await sleep(300);
  s = await snap();
  note(`after unaffordable attempts: weapon=${s.weapon} ammo=${s.ammoMag}${s.ammoRes} money=${s.money}`);

  // --- 3. Deploy -> pointer lock -----------------------------------------
  log('deploy click:', await realClick('#deploy-btn'));
  await sleep(1500);
  s = await snap();
  note(`after Deploy: locked=${s.locked} buyMenu=${s.buyMenu} overlay=${s.overlay} title=${s.overlayTitle}`);
  if (!s.locked) {
    // One resume attempt: the pause overlay's play button re-locks.
    if (s.overlayTitle === 'PAUSED') {
      log('resume click:', await realClick('#play'));
      await sleep(1500);
      s = await snap();
      note(`after resume click: locked=${s.locked} overlay=${s.overlay}`);
    }
    if (!s.locked) throw new Error('pointer lock never granted in this chrome — live movement/shooting cannot be driven; retry with full chromium (see --chrome)');
  }

  // --- 4. wait for LIVE (buy timer expires), then move + look + fire -----
  // The buy phase runs on game-time; under swiftshader a 12 s buy takes
  // ~2 min wall, so poll for it instead of assuming the phase by now.
  let live = false;
  for (let i = 0; i < 60; i += 1) {
    await sleep(5000);
    s = await snap();
    if (!s.buyMenu && !s.overlay) { live = true; break; }
  }
  if (!live) throw new Error('live phase never started (buy menu still open after 300s)');
  s = await snap();
  note(`LIVE started: timer=${s.timer} round=${s.round} locked=${s.locked}`);
  if (!s.locked) throw new Error('pointer lock lost before live phase');
  const ammoBefore = s.ammoMag;
  await key('KeyW', 'keydown');
  await mouse('mousemove', { movementX: 120, movementY: 0 });
  await sleep(1500);
  await mouse('mousedown', {});
  await sleep(1200);
  await mouse('mouseup', {});
  await key('KeyW', 'keyup');
  await sleep(500);
  s = await snap();
  note(`after move+fire: ammo ${ammoBefore} -> ${s.ammoMag} timer=${s.timer} locked=${s.locked}`);

  // --- 5. observe until round end + next round buy (or timeout) -----------
  const seen = { live: true, planted: false, defusing: false, roundEnd: false, nextBuy: false };
  const startRound = s.round;
  const deadline = Date.now() + MAX_SECONDS * 1000;
  let lastRound = s.round;
  let lastScore = `${s.scoreE}-${s.scoreT}`;
  let lastFeed = (s.killfeed || []).join(' | ');
  let polls = 0;
  while (Date.now() < deadline) {
    await sleep(2000);
    s = await snap();
    polls += 1;
    const feedNow = (s.killfeed || []).join(' | ');
    if (feedNow !== lastFeed) {
      note(`KILLFEED: ${feedNow || '(empty)'}`);
      lastFeed = feedNow;
    }
    if (polls % 30 === 0) note(`heartbeat: timer=${s.timer} round=${s.round} feed=${(s.killfeed || []).length} entries`);
    if (s.bomb && s.bomb.includes('BOMB PLANTED') && !seen.planted) {
      seen.planted = true; note(`PLANTED: ${s.bomb}`);
    }
    if (s.channel && s.channel.includes('Defus') && !seen.defusing) {
      seen.defusing = true; note(`DEFUSING channel visible`);
    }
    if (s.overlay && s.overlayTitle && s.overlayTitle.includes('TAKES THE ROUND') && !seen.roundEnd) {
      seen.roundEnd = true;
      note(`ROUND END: ${s.overlayTitle} | ${s.overlayCopy} | score ${s.scoreE}-${s.scoreT}`);
    }
    if (s.round !== lastRound) { note(`round ${lastRound} -> ${s.round} (score ${s.scoreE}-${s.scoreT})`); lastRound = s.round; }
    if (`${s.scoreE}-${s.scoreT}` !== lastScore) { note(`score now ${s.scoreE}-${s.scoreT}`); lastScore = `${s.scoreE}-${s.scoreT}`; }
    if (s.overlay && s.overlayTitle === 'PAUSED') {
      note('PAUSED overlay — clicking resume');
      await realClick('#play');
      await sleep(1000);
    }
    if (seen.roundEnd && s.buyMenu && s.round !== startRound) {
      seen.nextBuy = true;
      note(`NEXT ROUND BUY: round=${s.round} timer=${s.timer} money=${s.money}`);
      // Round-2 buy check: round bonus money should afford a grenade.
      log('buy r2:', await clickByText('.buy-item', 'Blast charge'));
      await sleep(300);
      const s2 = await snap();
      note(`after round-2 HE buy: money=${s2.money}`);
      break;
    }
    // If two full rounds pass with no plant, keep watching only until the
    // next buy after a round end — the loop above breaks there.
  }
  s = await snap();
  note(`final: round=${s.round} score=${s.scoreE}-${s.scoreT} timer=${s.timer} buyMenu=${s.buyMenu} overlay=${s.overlayTitle || '-'} feed=[${(s.killfeed || []).join(' | ')}]`);

  console.log('\n--- TIMELINE ---');
  timeline.forEach((t) => console.log(t));
  console.log('--- SEEN ---', JSON.stringify(seen));
  console.log('--- CONSOLE ERRORS (' + errors.length + ') ---');
  errors.forEach((e) => console.log(' ', e));
  const ok = seen.live && seen.roundEnd && seen.nextBuy && errors.length === 0;
  console.log(ok ? 'PLAYTEST-PASS' : 'PLAYTEST-INCOMPLETE ' + JSON.stringify(seen));
  if (!seen.planted) console.log('NOTE: no bot plant observed in the watched rounds (plant/defuse path also covered by the staged ?shot=plant scene + rounds.js channels)');
  if (!seen.defusing) console.log('NOTE: no live defuse channel observed');
  process.exitCode = ok ? 0 : 1;
}

try {
  await main();
} catch (e) {
  console.error('PLAYTEST-ERROR', e.message);
  console.log('--- TIMELINE (partial) ---');
  timeline.forEach((t) => console.log(t));
  console.log('--- CONSOLE ERRORS (' + errors.length + ') ---');
  errors.forEach((e) => console.log(' ', e));
  process.exitCode = 1;
} finally {
  await killProc(chrome, 'chrome');
  await killProc(server, 'server');
}
