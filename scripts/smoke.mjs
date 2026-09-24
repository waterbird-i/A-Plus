#!/usr/bin/env node
/**
 * 无头冒烟：起 dev server → 用本机 Chrome 真跑一遍流程 → 断言没有运行时报错。
 *
 * 为什么需要它：Vitest 那 106 条全在 `src/core`（纯逻辑，不开浏览器）。
 * 呈现层改一行（教室、试卷、手机、镜头）都没有任何自动化守着 ——
 * 之前那次「无头 Chromium 全流程通过」是手跑的，跑完就没了。
 * 这个脚本把它固化成一条命令：`npm run smoke`。
 *
 * 零依赖：Node 18+ 自带 WebSocket（这里用 Node 24），Chrome 自带 CDP。
 * 它不替代真人测试（好不好玩只有人能答），只保证「打得开、不报错、流程走得通」。
 *
 * 环境变量：
 *   CHROME_BIN   指定 Chrome 可执行文件（默认 macOS 的 Google Chrome）
 *   SMOKE_HEADED=1  不带头跑（看得到画面，用来排查）
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HEADED = process.env.SMOKE_HEADED === '1';
const DEV_PORT = 5199;
const CDP_PORT = 9333;
// ?debug 是生产构建里打开调试钩子的开关（见 src/main.ts 的 wantsDebug）。
const URL_ = `http://127.0.0.1:${DEV_PORT}/?seed=4242&debug=1`;
const VITE_BIN = new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname;

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
  return ok;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询直到 fn() 为真或超时。 */
async function until(what, fn, ms = 30000, step = 150) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what);
    await sleep(step);
  }
}

async function httpJson(path) {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
  return r.json();
}

class Cdp {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); this.listeners = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('cdp connect failed')), { once: true });
    });
    const c = new Cdp(ws);
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id !== undefined) {
        const p = c.pending.get(msg.id);
        if (p) { c.pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
        return;
      }
      for (const l of c.listeners) l(msg);
    });
    return c;
  }
  on(fn) { this.listeners.push(fn); }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() { this.ws.close(); }
}

const problems = [];   // 控制台 error / 未捕获异常
let vite, chrome, cdp, chromeProfile;

async function main() {
  console.log('A+ headless smoke (npm run smoke)\n');

  console.log('[1/5] build + preview');
  // 冒烟跑的是**构建产物**，不是 dev server：分块路径、base、压缩，
  // 以及「同一个 Babylon 模块被拆成两份实例」这类问题，只有产物上才看得见。
  await new Promise((resolve, reject) => {
    const b = spawn('npm', ['run', 'build'], { stdio: ['ignore', 'inherit', 'inherit'] });
    b.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('npm run build failed, exit ' + code))));
  });
  // 直接跑本地 vite 的入口，不经 npx：npx 会再套一层进程，
  // kill 掉 npx 之后孙进程还占着端口，第二次跑就起不来了。
  // --host 127.0.0.1 也不能省：vite 默认只绑 localhost，本机上会解析成 ::1，
  // 脚本去连 127.0.0.1 就会直接超时（这个坑真踩过一次）。
  vite = spawn(process.execPath, [VITE_BIN, 'preview', '--host', '127.0.0.1', '--port', String(DEV_PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  vite.stderr.on('data', (b) => { const s = String(b); if (!/VITE_CONFIG_NATIVE/.test(s)) process.stderr.write('[vite] ' + s); });
  await until('preview server', async () => {
    try { return (await fetch(`http://127.0.0.1:${DEV_PORT}/`)).ok; } catch { return false; }
  }, 60000);

  console.log('[2/5] launching Chrome');
  chromeProfile = mkdtempSync(join(tmpdir(), 'aplus-smoke-'));
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${chromeProfile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    // 无头里没有真 GPU，得显式允许软件 WebGL（Chrome 120+ 的开关名）。
    // 不要再叠 --use-gl=angle / --use-angle=swiftshader：本机实测那反而打出一堆 EGL 报错，
    // 而不加它 WebGL2 照样可用。
    '--enable-unsafe-swiftshader',
    // 页面不可见时 Chrome 会节流 rAF，那样游戏就「不动」了。
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=960,600',
    ...(HEADED ? [] : ['--headless=new']),
    'about:blank',
  ];
  chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', (b) => { const s = String(b); if (/ERROR|FATAL/.test(s) && !/DevTools listening/.test(s)) process.stderr.write('[chrome] ' + s); });

  await until('cdp http', async () => { try { return !!(await httpJson('/json/version')).webSocketDebuggerUrl; } catch { return false; } }, 30000);
  const { webSocketDebuggerUrl } = await httpJson('/json/version');
  cdp = await Cdp.connect(webSocketDebuggerUrl);

  const { targetId } = await cdp.send('Target.createTarget', { url: URL_ });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const ev = (method, params) => cdp.send(method, params, sessionId);

  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      problems.push('uncaught: ' + (msg.params?.exceptionDetails?.exception?.description ?? msg.params?.exceptionDetails?.text ?? '?'));
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      problems.push('console.error: ' + (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
      problems.push('log: ' + msg.params.entry.text);
    } else if (msg.method === 'Network.responseReceived' && (msg.params?.response?.status ?? 0) >= 400) {
      // 浏览器日志里只说「404」不带 URL，那等于没说 —— 所以自己再记一份。
      problems.push('http ' + msg.params.response.status + ': ' + msg.params.response.url);
    }
  });
  await ev('Runtime.enable');
  await ev('Log.enable');
  await ev('Network.enable');

  async function evaluate(expression) {
    const r = await ev('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval threw: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text) + '\n  expr: ' + expression);
    return r.result.value;
  }

  console.log('[3/5] waiting for the game to boot');
  // 先问引擎，再等 controller：controller 的构造里就会用到引擎扩展，
  // 如果引擎是假的，它会在那儿抛，而那时 __aplus 还没挂上 —— 就查不到根因了。
  await until('window.__engine', () => evaluate('!!window.__engine'), 60000);
  const engineName = await evaluate('window.__engine.getClassName()');
  check('Babylon gave us a real engine, not NullEngine', engineName !== 'NullEngine', engineName);
  await until('window.__aplus', () => evaluate('!!window.__aplus'), 90000);
  // 注意：**不要**在游戏画布上调 getContext —— 那会先替 Babylon 抢出一个默认属性的上下文，
  // 而浏览器不会给同一个画布第二个上下文，Babylon 随后拿到的就是这个缺 stencil 的，
  // EngineFactory 于是**静默**退回 NullEngine：画面全黑，却一条报错都没有。
  // 想知道 WebGL 在不在，用另一个一次性画布去问。
  const webgl2 = await evaluate('(() => { const c = document.createElement("canvas"); return !!c.getContext("webgl2"); })()');
  check('headless WebGL2 is available', webgl2 === true);
  const size = await evaluate('(() => { const c = document.getElementById("game"); return c.width + "x" + c.height; })()');
  check('game canvas has a non-zero size', !/^(0|1)x/.test(size), size);
  check('no errors during boot', problems.length === 0, problems.join(' | '));

  // 无头里 requestPointerLock 不可靠，所以直接解除暂停（指针锁本身是浏览器行为，不是游戏逻辑）。
  await evaluate('window.__aplus.audio.unlock(); window.__aplus.paused = false; true;');
  await until('session running', () => evaluate('window.__aplus.session.phase === "running"'), 15000);
  check('session is running', true);

  console.log('[4/5] driving the core loop');
  const before = await evaluate('(() => { const g = window.__aplus; return { code: g.session.phone.codeFor(0), balance: g.session.phone.balanceText, bars: g.session.phone.batteryBars }; })()');
  check('question code on the paper is 4 digits', /^\d{4}$/.test(before.code), before.code);

  // 搜题：空格掏出 → 1 → 题码四位 → 确认。拨号要 2.4 秒，必须一直掏着。
  await evaluate('window.__aplus.togglePhone(); true;');
  check('space opened the phone', await evaluate('window.__aplus.phoneOut === true'));
  await evaluate(`(() => { const g = window.__aplus; g.pressPhone('1'); for (const d of ${JSON.stringify(before.code)}) g.pressPhone(d); g.pressPhone('ok'); return true; })()`);
  await until('the search bills the phone', async () => (await evaluate('window.__aplus.session.phone.balanceText')) !== before.balance, 12000);
  const after = await evaluate('window.__aplus.session.phone.balanceText');
  check('search connected and billed the phone', after === '2.70', `${before.balance} -> ${after}`);
  await evaluate('window.__aplus.togglePhone(); true;');
  check('space put the phone away', await evaluate('window.__aplus.phoneOut === false'));

  // 翻题 + 作答 + 交卷。
  await evaluate('window.__aplus.flip(1); window.__aplus.select(0); true;');
  const answered = await evaluate('window.__aplus.session.questions.filter((q) => q.selected >= 0).length');
  check('picked an answer', answered >= 1, answered + ' answered');
  // 实测就是这样：新一轮刚建好还没 tick，phase 还是 not_started，于是 submit() 什么都不做
  // （它只认 running），看着像「交卷坏了」。
  await evaluate('window.__aplus.restartRun(4242); true;');
  await until('a fresh round is running', () => evaluate('window.__aplus.session.phase === "running"'), 20000);
  // 交卷要求「按住 Enter 1.1 秒」且「正看着卷子」（examController.canSubmit）。
  // 被抓的那几秒会锁输入，所以循环里每一步都重新断言一次。
  await evaluate('window.__aplus.look(0, 40); window.__aplus.setSubmitHeld(true); true;');
  let settled = false;
  let sawSubmitted = false;
  for (let i = 0; i < 40 && !settled; i++) {
    const st = await evaluate('(() => { const g = window.__aplus; return { phase: g.session.phase, done: g.runComplete, paused: g.paused, gaze: g.session.gaze.state }; })()');
    if (st.phase === 'submitted') sawSubmitted = true;
    // 不能靠轮询去抓 submitted：它只活一帧，下一帧就 finish 了。
    // 要断言的是整条链的结果 —— 交卷 → finish → 这一轮结束。
    settled = st.done === true;
    if (!settled) {
      await evaluate('(() => { const g = window.__aplus; if (g.paused) return; if (g.session.gaze.state !== "paper") g.look(0, 40); g.setSubmitHeld(true); })(); true;');
      await sleep(200);
    }
  }
  const submitState = await evaluate('(() => { const g = window.__aplus; return { runComplete: g.runComplete, attempt: g.run.attempt, deaths: g.run.totalDeaths, paused: g.paused }; })()');
  // deaths === 0 是「交上去的」而不是「被抓死的」的证据 —— 死亡那条路也会让这一轮结束。
  check('holding Enter 1.1s submits and ends the round', settled && submitState.deaths === 0, `${sawSubmitted ? 'saw the submitted phase - ' : ''}${JSON.stringify(submitState)}`);

  const fps = await evaluate('window.__aplus.view.camera.getScene().getEngine().getFps()');
  check('render loop is running', fps > 0, fps.toFixed(1) + ' fps');

  console.log('[5/5] wrapping up');
  check('no runtime errors at all', problems.length === 0, problems.slice(0, 5).join(' | '));
}

async function cleanup() {
  try { cdp?.close(); } catch { /* ignore */ }
  try { chrome?.kill('SIGKILL'); } catch { /* ignore */ }
  try { vite?.kill('SIGKILL'); } catch { /* ignore */ }
  if (chromeProfile) { try { rmSync(chromeProfile, { recursive: true, force: true }); } catch { /* ignore */ } }
}

let exitCode = 1;
try {
  await main();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${checks.length} checks)`);
  exitCode = failed.length === 0 ? 0 : 1;
} catch (e) {
  console.error('\nSMOKE ABORTED: ' + (e instanceof Error ? e.message : String(e)));
  if (problems.length) console.error('  problems seen:\n   - ' + problems.slice(0, 10).join('\n   - '));
  exitCode = 1;
} finally {
  await cleanup();
}
process.exit(exitCode);
