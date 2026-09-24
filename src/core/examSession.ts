import { AnswerContext } from './answerExpression';
import { buildChoice, type ExamQuestion } from './choiceBuilder';
import { ClassroomLayout } from './classroomLayout';
import { DeathCurve, DeathWindow, type DeathPresentation } from './deathCurve';
import { BroadcastTamper, ExamClock, type BroadcastCue } from './examClock';
import type { GameData } from './gameData';
import { GazeDirector, InvigilatorProfile } from './gazeDirector';
import { FlipPhone, PhoneEventKind, type PhoneEvent, type PhoneKey } from './flipPhone';
import { GazeState, GazeStateMachine, TickResult } from './gazeStateMachine';
import { InvigilatorPatrol, PatrolEventKind, PatrolProfile, type PatrolEvent } from './invigilatorPatrol';
import { AllocationMode, ExamRoundGenerator, MixSpec, type RoundPlan } from './roundGenerator';
import type { RunState, RunTransition } from './runState';
import type { StringTable } from './stringTable';

export const SessionPhase = { NotStarted: 'not_started', Running: 'running', Died: 'died', Submitted: 'submitted' } as const;
export type SessionPhase = (typeof SessionPhase)[keyof typeof SessionPhase];

/** 一场考试的可调参数。三条推进线（异象强度 / 报时污染 / 死亡退化）刻意错峰（2.4 丝滑技术 4）。 */
export class SessionConfig {
  roundSize = 9;
  /** 4.3：推荐 3,3,3 + 抖动 1（Docs/难度配比标定.md §5）。 */
  mixEasy = 3;
  mixMedium = 3;
  mixHard = 3;
  mode: AllocationMode = AllocationMode.QuotaJitter;
  jitter = 1;

  /** 6.2：异象强度随累计死亡在这个区间里从 0 爬到 1。 */
  anomalyIntensity = new DeathWindow(3, 15);
  /** 3.4：第几次模拟考试起，报时开始变慢 / 倒退 / 改念考号。 */
  slowFromAttempt = 4;
  rewindFromAttempt = 8;
  rosterFromAttempt = 12;

  /** A2：听力期间离开卷子多久算违规。 */
  listeningViolationGrace = 0.6;

  get mix(): MixSpec {
    return new MixSpec('session', this.mixEasy, this.mixMedium, this.mixHard);
  }

  tamperFor(attempt: number): BroadcastTamper {
    if (attempt >= this.rosterFromAttempt) return BroadcastTamper.Roster;
    if (attempt >= this.rewindFromAttempt) return BroadcastTamper.Rewind;
    if (attempt >= this.slowFromAttempt) return BroadcastTamper.Slow;
    return BroadcastTamper.Normal;
  }
}

/** 一帧里发生的事。呈现层据此放声音、翻记名册、起死亡表现。 */
export class SessionEvents {
  readonly broadcasts: BroadcastCue[] = [];
  readonly gaze: TickResult[] = [];
  readonly phone: PhoneEvent[] = [];
  readonly patrol: PatrolEvent[] = [];
  died = false;
  timeUp = false;
  /** 巡考这一帧抓了你现行（她已经闪现到你身边）。 */
  caught = false;

  clear(): void {
    this.broadcasts.length = 0;
    this.gaze.length = 0;
    this.phone.length = 0;
    this.patrol.length = 0;
    this.died = false;
    this.timeUp = false;
    this.caught = false;
  }
}

/**
 * 一场考试的全部逻辑：抽卷 → 注视调度 → 计时与广播 → 作答 → 交卷或死亡 → 写回 RunState。
 * 不依赖渲染引擎；呈现层每帧调 tick，并把输入转成 setGaze / select / pressPhoneKey。
 *
 * 巡考模式（InvigilatorProfile.patrol，决策 #43）：师视不再按时间表落下，而是由在过道里走动的
 * InvigilatorPatrol 用视锥和耳朵判定；被她抓现行 = 记名一次，她闪现到你身边瞪着你。
 */
export class ExamSession {
  readonly profile: InvigilatorProfile;
  readonly config: SessionConfig;
  readonly curve: DeathCurve;
  readonly layout: ClassroomLayout;
  readonly patrolProfile: PatrolProfile;

  private _phase: SessionPhase = SessionPhase.NotStarted;
  plan!: RoundPlan;
  context!: AnswerContext;
  questions: ExamQuestion[] = [];
  gaze!: GazeStateMachine;
  director!: GazeDirector;
  clock!: ExamClock;
  tamper: BroadcastTamper = BroadcastTamper.Normal;
  death: DeathPresentation | null = null;
  /** 决策 #42：答案都在这台翻盖机里。 */
  phone!: FlipPhone;
  /** 巡考老师；podium 模式下为 null（师视由 GazeDirector 按时间表注入）。 */
  patrol: InvigilatorPatrol | null = null;

  private listeningOffPaper = 0;
  private listeningRecorded = false;
  private lookingAtTeacher = false;
  private readonly phoneQueue: PhoneEvent[] = [];

  constructor(
    readonly data: GameData,
    readonly table: StringTable,
    readonly run: RunState,
    profile?: InvigilatorProfile | null,
    config?: SessionConfig | null,
    curve?: DeathCurve | null,
    layout?: ClassroomLayout | null,
    patrolProfile?: PatrolProfile | null,
  ) {
    this.profile = profile ?? InvigilatorProfile.podium();
    this.config = config ?? new SessionConfig();
    this.curve = curve ?? new DeathCurve();
    this.layout = layout ?? new ClassroomLayout();
    this.patrolProfile = patrolProfile ?? new PatrolProfile();
  }

  get phase(): SessionPhase { return this._phase; }

  begin(): void {
    const gen = new ExamRoundGenerator(this.data);
    gen.mode = this.config.mode;
    gen.jitter = this.config.jitter;
    this.plan = gen.buildRound(this.run.roundSeed, this.config.roundSize, this.config.mix);

    this.context = AnswerContext.fromRun(this.run, this.plan.items.length, this.table);
    this.questions = this.plan.items.map((item) => {
      const q = buildChoice(item.chain, this.context);
      q.plan = item;
      return q;
    });

    this.gaze = new GazeStateMachine();
    this.director = new GazeDirector(this.profile, this.run.roundSeed ^ 0x2545f491, this.config.anomalyIntensity.ramp(this.run.totalDeaths));

    this.clock = new ExamClock();
    this.tamper = this.config.tamperFor(this.run.attempt);
    this.clock.rosterNumbers = this.clock.remainingAnnouncements.map((_, i) => this.run.rosterNumber(i));
    this.clock.build(this.tamper);

    this.phone = FlipPhone.forSession(this.questions, (key) => this.table.get(key), this.run.roundSeed ^ 0x7f4a7c15, this.run.attempt);
    this.phoneQueue.length = 0;
    this.patrol = this.profile.teacherScheduled ? null : new InvigilatorPatrol(this.layout, this.patrolProfile, this.run.roundSeed ^ 0x3c6ef372);
    this.gaze.summonOnExposure = this.patrol === null;
    this.lookingAtTeacher = false;

    this.death = null;
    this.listeningOffPaper = 0;
    this.listeningRecorded = false;
    this._phase = SessionPhase.Running;
  }

  /** 被抓现行的那一下（她闪现到你身边）：输入无效，视线被按回卷子上。 */
  get inputLocked(): boolean {
    return this.patrol?.busy ?? false;
  }

  setGaze(state: GazeState): void {
    if (this._phase !== SessionPhase.Running || this.inputLocked) return;
    const wasPhone = this.gaze.state === GazeState.Phone;
    this.gaze.setState(state);
    if (wasPhone && this.gaze.state !== GazeState.Phone) this.phone.putAway();
  }

  /** 呈现层每帧告诉我们：玩家是不是正对着老师的脸（对视判定）。 */
  setLookingAtTeacher(looking: boolean): void {
    this.lookingAtTeacher = looking;
  }

  /** 掏着手机时按一个键。返回 false = 手机没掏出来 / 没电 / 考试不在进行。 */
  pressPhoneKey(key: PhoneKey): boolean {
    if (this._phase !== SessionPhase.Running || this.inputLocked) return false;
    if (this.gaze.state !== GazeState.Phone || this.phone.dead) return false;
    this.phone.press(key, this.phoneQueue);
    return true;
  }

  /** 作答只能在「卷子」状态（2.1：这是安全区，也是唯一能写字的地方）。 */
  select(questionIndex: number, choiceIndex: number): boolean {
    if (this._phase !== SessionPhase.Running || this.gaze.state !== GazeState.Paper) return false;
    const q = this.questions[questionIndex];
    if (!q || choiceIndex < 0 || choiceIndex >= q.choices.length) return false;
    q.selected = choiceIndex;
    return true;
  }

  tick(dt: number, events: SessionEvents): void {
    if (this._phase !== SessionPhase.Running) return;
    if (dt < 0) dt = 0;

    this.clock.tick(dt, events.broadcasts);
    this.director.listening = this.clock.inListening;
    if (!this.inputLocked) this.director.tick(dt, this.gaze);

    const phoneStart = events.phone.length;
    events.phone.push(...this.phoneQueue);
    this.phoneQueue.length = 0;
    this.phone.tick(dt, this.gaze.state === GazeState.Phone, events.phone);
    if (this.patrol) this.tickPatrol(dt, events, phoneStart);

    if (!this.gaze.isDead) {
      const r = this.gaze.tick(dt);
      if (r !== TickResult.Idle && r !== TickResult.Safe) events.gaze.push(r);
    }

    if (!this.gaze.isDead) this.tickListeningRule(dt, events);

    if (this.gaze.isDead) {
      this._phase = SessionPhase.Died;
      this.death = this.curve.evaluate(this.run.nextDeathOrdinal);
      events.died = true;
      return;
    }
    if (this.clock.isOver) {
      events.timeUp = true;
      this.submit();
    }
  }

  private tickPatrol(dt: number, events: SessionEvents, phoneStart: number): void {
    const patrol = this.patrol!;
    let ringing = false;
    let keyTones = 0;
    for (let i = phoneStart; i < events.phone.length; i++) {
      const e = events.phone[i];
      if (e.kind === PhoneEventKind.Ring) ringing = true;
      else if (e.kind === PhoneEventKind.Key && e.audible) keyTones++;
    }
    const patrolStart = events.patrol.length;
    patrol.tick(dt, {
      gaze: this.gaze.state,
      lookingAtTeacher: this.lookingAtTeacher,
      exposure: this.gaze.exposure,
      ringing,
      keyTones,
      listening: this.clock.inListening,
    }, this.gaze, events.patrol, events.gaze);
    for (let i = patrolStart; i < events.patrol.length; i++) {
      if (events.patrol[i].kind !== PatrolEventKind.Caught) continue;
      events.caught = true;
      if (this.gaze.state === GazeState.Phone) this.phone.putAway();
      this.gaze.setState(GazeState.Paper);
    }
  }

  private tickListeningRule(dt: number, events: SessionEvents): void {
    if (!this.clock.inListening || this.listeningRecorded) return;
    if (this.gaze.state === GazeState.Paper) { this.listeningOffPaper = 0; return; }
    this.listeningOffPaper += dt;
    if (this.listeningOffPaper < this.config.listeningViolationGrace) return;
    this.listeningRecorded = true;
    events.gaze.push(this.gaze.recordViolation());
  }

  submit(): void {
    if (this._phase === SessionPhase.Running) this._phase = SessionPhase.Submitted;
  }

  get score(): number {
    return this.questions.filter((q) => q.isCorrect).length;
  }

  /** 把这一场的结果写回 RunState，返回下一步去哪。只能调一次。 */
  finish(): RunTransition {
    if (this._phase !== SessionPhase.Died && this._phase !== SessionPhase.Submitted) {
      throw new Error('session is still ' + this._phase);
    }
    const died = this._phase === SessionPhase.Died;
    this._phase = SessionPhase.NotStarted;
    return this.run.completeAttempt(died, this.gaze.timesRecorded, this.gaze.cause);
  }
}
