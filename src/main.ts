import { EngineFactory, Scene } from '@babylonjs/core';
import { loadBundledData } from './data/browserData';
import { buildClassroom } from './game/classroom';
import { DebugOverlay } from './game/debugOverlay';
import { ExamController } from './game/examController';
import './style.css';

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const gate = document.getElementById('gate') as HTMLButtonElement;
  const flash = document.getElementById('flash') as HTMLElement;

  const { table, data } = loadBundledData();
  const problems = [...table.problems, ...data.problems, ...data.labels.problems];
  if (problems.length > 0) console.warn(problems);

  const engine = await EngineFactory.CreateAsync(canvas, { antialias: true, stencil: true });
  const scene = new Scene(engine);
  const room = buildClassroom(scene);
  const seed = Number(new URLSearchParams(location.search).get('seed') ?? Date.now() % 1000000) | 0;
  const game = new ExamController(scene, room, data, table, flash, seed);
  scene.activeCamera = game.view.camera;

  const debug = import.meta.env.DEV || location.search.includes('debug') ? new DebugOverlay(document.body) : null;
  if (import.meta.env.DEV) (window as unknown as { __aplus: unknown }).__aplus = game;

  // 浏览器规定：锁鼠标、出声音都必须由一次用户点击触发 —— 开场这一下就是它。
  gate.textContent = table.get('ui.menu.start');
  const setGate = (key: string | null) => {
    gate.style.display = key ? 'block' : 'none';
    if (key) gate.textContent = table.get(key);
  };
  gate.addEventListener('click', async () => {
    if (game.runComplete) game.restartRun((Date.now() % 1000000) | 0);
    await canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    game.paused = !locked;
    setGate(locked ? null : game.runComplete ? 'ui.menu.start' : 'ui.pause.resume');
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (game.paused) return;
    if (e.button === 2) game.toggleLookAround();
  });
  document.addEventListener('mousemove', (e) => {
    if (!game.paused) game.look(e.movementX, e.movementY);
  });
  canvas.addEventListener('wheel', (e) => {
    if (!game.paused) game.flip(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') { debug?.toggle(); return; }
    if (game.paused) return;
    if (e.code === 'Space') { e.preventDefault(); game.togglePhone(); return; }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') game.flip(1);
    if (e.code === 'ArrowUp' || e.code === 'KeyW') game.flip(-1);
    if (e.code === 'Enter') game.submit();
    const digit = /^Digit([1-4])$/.exec(e.code);
    if (digit) game.select(parseInt(digit[1], 10) - 1);
  });

  engine.runRenderLoop(() => {
    game.update(engine.getDeltaTime() / 1000);
    if (game.runComplete && document.pointerLockElement === canvas) document.exitPointerLock();
    scene.render();
    debug?.render(game, engine.getFps());
  });
  window.addEventListener('resize', () => engine.resize());
}

void boot();
