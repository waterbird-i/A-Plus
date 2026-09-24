import { EngineFactory, Scene } from '@babylonjs/core';
import { GazeState, PhoneKey } from './core';
import { loadBundledData } from './data/browserData';
import { Classroom } from './game/classroom';
import { DebugOverlay } from './game/debugOverlay';
import { ExamController } from './game/examController';
import { HintOverlay } from './game/hintOverlay';
import './style.css';

/** 手机掏着时，键盘怎么落到手机键上。先看 e.key（Shift+8 = *，Shift+3 = #），再看物理键位。 */
function phoneKeyFor(e: KeyboardEvent): PhoneKey | null {
  if (e.key === '*') return PhoneKey.Star;
  if (e.key === '#') return PhoneKey.Hash;
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  if (digit) return digit[1] as PhoneKey;
  switch (e.code) {
    case 'Enter':
    case 'NumpadEnter': return PhoneKey.Ok;
    case 'Backspace':
    case 'Delete': return PhoneKey.Back;
    case 'KeyW':
    case 'ArrowUp': return PhoneKey.Up;
    case 'KeyS':
    case 'ArrowDown': return PhoneKey.Down;
    case 'KeyQ':
    case 'NumpadMultiply': return PhoneKey.Star;
    case 'KeyE':
    case 'NumpadDivide': return PhoneKey.Hash;
    default: return null;
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const gateBar = document.getElementById('gate-bar') as HTMLDivElement;
  const gate = document.getElementById('gate') as HTMLButtonElement;
  const gateHelp = document.getElementById('gate-help') as HTMLButtonElement;
  const flash = document.getElementById('flash') as HTMLElement;

  const { table, data } = loadBundledData();
  const problems = [...table.problems, ...data.problems, ...data.labels.problems];
  if (problems.length > 0) console.warn(problems);

  const engine = await EngineFactory.CreateAsync(canvas, { antialias: true, stencil: true });
  // 「要调试」= 开发构建，或生产版带了 ?debug。
  // 引擎必须在 controller 之前就能看到：万一 EngineFactory 静默退回 NullEngine
  // （画面全黑却一条报错都没有），得有个地方能把「你到底给了我哪个引擎」问出来。
  const wantsDebug = import.meta.env.DEV || location.search.includes('debug');
  if (wantsDebug) (window as unknown as { __engine: unknown }).__engine = engine;
  const scene = new Scene(engine);
  const room = new Classroom(scene, table);
  const seed = Number(new URLSearchParams(location.search).get('seed') ?? Date.now() % 1000000) | 0;
  const caption = document.createElement('div');
  caption.id = 'caption';
  document.body.appendChild(caption);
  const game = new ExamController(scene, room, data, table, flash, caption, seed);
  scene.activeCamera = game.view.camera;

  // 调试面板：默认关着，按 ` 才出来（而且只有开发构建或 ?debug 才有这个东西）。
  const debug = wantsDebug ? new DebugOverlay(document.body) : null;
  // scripts/smoke.mjs 也读它 —— 冒烟跑的是**构建产物**（那才是要发出去的东西），所以这里不能只认 DEV。
  if (wantsDebug) (window as unknown as { __aplus: unknown }).__aplus = game;

  // 「怎么玩」自己占一屏：平时不出现，只有玩家点开始按钮旁边那颗、或按 H 才弹。
  const help = new HintOverlay(document.body, table, 'ui.pause.resume', () => refreshGate());
  const reticle = document.createElement('div');
  reticle.id = 'reticle';
  document.body.appendChild(reticle);
  const cursor = document.createElement('div');
  cursor.id = 'phone-cursor';
  document.body.appendChild(cursor);
  let started = false;

  // 只有没锁鼠标时（开始 / 暂停 / 一轮结束）才露按钮；教学那一屏开着时按钮让位。
  function refreshGate(): void {
    const locked = document.pointerLockElement === canvas;
    const showBar = !locked && !help.visible;
    gateBar.style.display = showBar ? 'flex' : 'none';
    if (showBar) gate.textContent = table.get(started && !game.runComplete ? 'ui.pause.resume' : 'ui.menu.start');
  }

  /** 开教学就等于暂停：顺带退出鼠标锁定，所以它永远不会盖在正在进行的考试上。 */
  const setHelp = (open: boolean): void => {
    if (open === help.visible) return;
    if (open) help.show();
    else help.hide();
    if (open && document.pointerLockElement === canvas) void document.exitPointerLock();
  };

  // 浏览器规定：锁鼠标、出声音都必须由一次用户点击触发 —— 开场这一下就是它。
  gate.textContent = table.get('ui.menu.start');
  gateHelp.textContent = table.get('ui.hint.title');
  refreshGate();
  gate.addEventListener('click', async () => {
    game.audio.unlock();
    if (game.runComplete) game.restartRun((Date.now() % 1000000) | 0);
    started = true;
    await canvas.requestPointerLock();
  });
  gateHelp.addEventListener('click', () => setHelp(true));
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    game.paused = !locked;
    game.audio.setPaused(!locked);
    game.setSubmitHeld(false);
    refreshGate();
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    // 左键 = 用准星点卷子上的翻题按钮；掏着手机时 = 点光标下的手机键。
    if (e.button === 0) game.click();
  });
  document.addEventListener('mousemove', (e) => {
    if (!game.paused) game.look(e.movementX, e.movementY);
  });
  canvas.addEventListener('wheel', (e) => {
    if (!game.paused) game.flip(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') { debug?.toggle(); return; }
    // 教学那一屏：H 开关（游玩中开它 = 暂停），ESC 关掉。它在游玩流程之外，所以先于 game.paused 判。
    if (e.code === 'KeyH') { e.preventDefault(); setHelp(!help.visible); return; }
    if (e.code === 'Escape' && help.visible) { setHelp(false); return; }
    if (game.paused) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) game.togglePhone();
      return;
    }
    if (game.phoneOut) {
      const key = phoneKeyFor(e);
      if (key) {
        e.preventDefault();
        if (!e.repeat) game.pressPhone(key);
      }
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { game.setSubmitHeld(true); return; }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') game.flip(1);
    if (e.code === 'ArrowUp' || e.code === 'KeyW') game.flip(-1);
    const digit = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
    if (digit) game.select(parseInt(digit[1]!, 10) - 1);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') game.setSubmitHeld(false);
  });

  engine.runRenderLoop(() => {
    game.update(engine.getDeltaTime() / 1000);
    if (game.runComplete && document.pointerLockElement === canvas) document.exitPointerLock();
    scene.render();
    // 准星只在看着卷子时露出来 —— 那是唯一需要瞄准的地方。
    const live = !game.paused && !game.runComplete && !game.dying;
    reticle.style.opacity = live && game.session.gaze.state === GazeState.Paper ? '1' : '0';
    const phone = live && game.phoneOut;
    cursor.style.display = phone ? 'block' : 'none';
    if (phone) {
      const r = canvas.getBoundingClientRect();
      cursor.style.left = r.left + game.cursor.x + 'px';
      cursor.style.top = r.top + game.cursor.y + 'px';
      cursor.classList.toggle('hot', game.hoverKey !== null);
    }
    debug?.render(game, engine.getFps());
  });
  window.addEventListener('resize', () => engine.resize());
}

void boot();
