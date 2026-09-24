import type { ExamController } from './examController';
import { PaperEnterDeg, PaperExitDeg } from './lookGaze';

/**
 * 开发用的状态面板（` 键开关）。零 HUD 是对玩家的承诺：它**默认不显示**，
 * 只在开发构建或 ?debug 时存在，按 ` 才出来；而且只写 ASCII 的变量名与数字 —— 它不是界面文本，不走 String Table。
 */
export class DebugOverlay {
  private readonly el: HTMLPreElement;
  visible = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.id = 'debug';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  render(c: ExamController, fps: number): void {
    if (!this.visible) return;
    const s = c.session;
    const g = s.gaze;
    const clock = s.clock;
    const p = s.patrol;
    const phone = s.phone;
    const mm = Math.floor(clock.remainingGameSeconds / 60);
    const ss = Math.floor(clock.remainingGameSeconds % 60);
    this.el.textContent = [
      'fps            ' + fps.toFixed(0),
      'attempt        ' + c.run.attempt + '   deaths ' + c.run.totalDeaths + '   year ' + c.run.year,
      'phase          ' + s.phase + (c.runComplete ? '  (run complete)' : '') + (c.paused ? '  (paused)' : ''),
      'gaze.state     ' + g.state,
      'view.pitch     ' + c.view.pitchDeg.toFixed(1) + ' deg  paper>=' + PaperEnterDeg + '  around<=' + PaperExitDeg,
      'gaze.active    ' + g.activeGaze + (g.activeGazeSummoned ? ' (summoned)' : '') + '   perceived ' + g.perceived,
      'exposure       ' + g.exposure.toFixed(2),
      'recorded       ' + g.timesRecorded + ' / ' + g.recordsToDeath,
      'repel          ' + g.anomalyRepelProgress.toFixed(2) + '   aiming ' + g.isAimingAtAnomaly,
      'next gaze      ' + s.director.upcomingKind + ' in ' + s.director.secondsToNext.toFixed(1) + 's' + (s.director.isCueing ? '  CUE' : ''),
      'patrol         ' + (p ? p.state + '  susp ' + p.suspicion.toFixed(2) + '  rage ' + p.rage.toFixed(2) + '  at ' + p.x.toFixed(2) + ',' + p.z.toFixed(2) + (p.watchingPlayer ? '  WATCHING' : '') + (p.reading ? '  reading' : '') : 'none'),
      'phone          ' + phone.screen + '  bal ' + phone.balanceText + '  batt ' + phone.battery.toFixed(2) + (phone.silent ? '  SILENT' : '  RING') + '  unread ' + phone.unread + '  pending ' + phone.pendingReplies,
      'codes          ' + s.questions.map((_, i) => phone.codeFor(i)).join(' '),
      'clock          ' + mm + ':' + String(ss).padStart(2, '0') + ' left' + (clock.inListening ? '  LISTENING' : '') + '   tamper ' + s.tamper,
      'score          ' + s.score + ' / ' + s.questions.length,
    ].join('\n');
  }
}
