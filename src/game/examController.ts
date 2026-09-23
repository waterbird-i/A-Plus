import type { Scene } from '@babylonjs/core';
import {
  DeathCurve, ExamSession, GazeKind, GazeState, InvigilatorProfile, RunState, RunTransition, SessionConfig, SessionEvents,
  SessionPhase, type DeathPresentation, type GameData, type StringTable,
} from '../core';
import { AnomalyView } from './anomalyView';
import type { Classroom } from './classroom';
import { PaperView } from './paperView';
import { PlayerView } from './playerView';

/** 直视判定的角度容差。 */
const STARE_TOLERANCE_DEG = 9;

interface DeathState {
  presentation: DeathPresentation;
  elapsed: number;
  duration: number;
}

/**
 * 呈现层的总控：每帧推进 ExamSession，把输入翻译成 setGaze / select，把结果交给各个 View。
 * 所有判定都在 core 里，这里只读不判。
 */
export class ExamController {
  run: RunState;
  session: ExamSession;
  readonly view: PlayerView;
  readonly paper: PaperView;
  readonly anomaly: AnomalyView;
  readonly events = new SessionEvents();
  paused = true;
  runComplete = false;
  private death: DeathState | null = null;

  constructor(
    scene: Scene,
    room: Classroom,
    private readonly data: GameData,
    private readonly table: StringTable,
    private readonly flash: HTMLElement,
    seed: number,
  ) {
    this.view = new PlayerView(scene, room.eye);
    this.paper = new PaperView(scene, room.desk, table);
    this.anomaly = new AnomalyView(scene, room.anomalySpots);
    this.run = new RunState(seed);
    this.session = this.beginSession();
  }

  private beginSession(): ExamSession {
    const s = new ExamSession(this.data, this.table, this.run, InvigilatorProfile.podium(), new SessionConfig(), new DeathCurve());
    s.begin();
    this.session = s;
    this.anomaly.reseed(this.run.roundSeed);
    this.paper.current = 0;
    this.paper.draw(s);
    return s;
  }

  restartRun(seed: number): void {
    this.run = new RunState(seed);
    this.runComplete = false;
    this.death = null;
    this.flash.style.opacity = '0';
    this.beginSession();
  }

  // ---- 输入 ----
  toggleLookAround(): void {
    const g = this.session.gaze;
    this.session.setGaze(g.state === GazeState.LookingAround ? GazeState.Paper : GazeState.LookingAround);
  }

  togglePhone(): void {
    const g = this.session.gaze;
    this.session.setGaze(g.state === GazeState.Phone ? GazeState.Paper : GazeState.Phone);
  }

  look(dx: number, dy: number): void {
    if (this.session.gaze.state === GazeState.LookingAround) this.view.addLook(dx, dy);
  }

  select(choice: number): void {
    if (this.session.select(this.paper.current, choice)) this.paper.draw(this.session);
  }

  flip(delta: number): void {
    if (this.session.gaze.state === GazeState.Paper) this.paper.flip(delta, this.session);
  }

  submit(): void {
    if (this.session.gaze.state === GazeState.Paper) this.session.submit();
  }

  // ---- 每帧 ----
  update(dt: number): void {
    if (this.paused || this.runComplete) return;
    dt = Math.min(dt, 0.1);

    if (this.death) { this.updateDeath(dt); return; }

    const s = this.session;
    const aim = this.anomaly.spot !== null && this.view.isAimingAt(this.anomaly.spot, STARE_TOLERANCE_DEG);
    s.gaze.setAimingAtAnomaly(s.gaze.state === GazeState.LookingAround && aim);

    this.events.clear();
    s.tick(dt, this.events);

    this.view.update(dt, s.gaze);
    this.anomaly.update(dt, s.gaze);

    if (s.phase === SessionPhase.Died && s.death) {
      const p = s.death;
      this.death = { presentation: p, elapsed: 0, duration: Math.max(1.2, p.leadInSilenceSeconds + p.postDeathDwellSeconds + 0.6) };
    } else if (s.phase === SessionPhase.Submitted) {
      this.advance(s.finish());
    }
  }

  /** 占位死亡表现：只把 DeathCurve 的白闪与余韵落到画面上。正脸、音效与音画错位在 M2 / M4。 */
  private updateDeath(dt: number): void {
    const d = this.death!;
    const p = d.presentation;
    d.elapsed += dt;
    const afterLeadIn = d.elapsed - p.leadInSilenceSeconds;
    const flash = p.eventless ? 0 : afterLeadIn >= 0 ? p.flashIntensity * Math.exp(-afterLeadIn * 6) : 0;
    const grey = Math.min(1, Math.max(0, afterLeadIn) / 0.6) * 0.85;
    this.flash.style.background = flash > grey ? '#fff' : '#111';
    this.flash.style.opacity = String(Math.max(flash, grey));
    this.view.update(dt, this.session.gaze);
    if (d.elapsed < d.duration) return;

    this.death = null;
    this.flash.style.opacity = '0';
    this.advance(this.session.finish());
  }

  private advance(next: RunTransition): void {
    if (next === RunTransition.RunComplete) {
      this.runComplete = true;
      return;
    }
    this.beginSession();
  }

  get teacherWatching(): boolean {
    return this.session.gaze.activeGaze === GazeKind.Teacher;
  }
}
