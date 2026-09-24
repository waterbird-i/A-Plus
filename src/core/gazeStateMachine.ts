/** 2.1 三态视线：你只能同时处于一档。 */
export const GazeState = { Paper: 'paper', LookingAround: 'looking_around', Phone: 'phone' } as const;
export type GazeState = (typeof GazeState)[keyof typeof GazeState];

/** 世界真相：现在落在你身上的是哪一道视线。 */
export const GazeKind = { None: 'none', Teacher: 'teacher', Anomaly: 'anomaly' } as const;
export type GazeKind = (typeof GazeKind)[keyof typeof GazeKind];

/** 玩家（在 2 秒模糊窗之后）能分辨出来的那一档。 */
export const GazeWarning = { Unknown: 'unknown', Teacher: 'teacher', Anomaly: 'anomaly' } as const;
export type GazeWarning = (typeof GazeWarning)[keyof typeof GazeWarning];

/**
 * summoned：暴露到顶，师视被召来（决策 #37）。它和 recorded / died 一样是「事件」，
 * 呈现层据此放脚步声、写记名册、起死亡表现。
 */
export const TickResult = { Idle: 'idle', Safe: 'safe', Repelled: 'repelled', Recorded: 'recorded', Died: 'died', Summoned: 'summoned' } as const;
export type TickResult = (typeof TickResult)[keyof typeof TickResult];

/** 死因。记名册与死亡表现都要知道是哪一种。 */
export const DeathCause = { None: 'none', Records: 'records', Anomaly: 'anomaly' } as const;
export type DeathCause = (typeof DeathCause)[keyof typeof DeathCause];

/**
 * 设计文档 2.1（三态视线）+ 2.2（双重注视）的可执行骨架，按决策 #37 / #39 收口：
 *
 *   师视：只有「卷子」算服从。环视或掏手机 ⇒ 违规 ⇒ 记名；同场记满 recordsToDeath 次 ⇒ 死
 *         （隐藏规则六「被记名三次者，其名归考场所有」字面应验）。
 *   异视：只有「环视并直视它」算对抗。低头看卷子或掏手机 ⇒ 躲避 ⇒ 死。
 *   暴露：到顶不直接死，而是召来一次师视 —— 呼吸声就是它的预警。
 *
 * 掏手机在两种视线下都是错的（决策 #39）：它是整个游戏里最危险的一档。
 */
export class GazeStateMachine {
  // ---- 可标定参数（手感全在这几个数上；必须靠真人测试标定，见 Docs/难度配比标定.md §6）----
  /** 2.2 细节 2：前 2 秒内两种警告应该几乎无法分辨。 */
  ambiguitySeconds = 2.0;
  /** 给你「反应」的时间窗。 */
  complyGraceSeconds = 0.6;
  /** 2.2：异视必须被直视到「它先移开」。 */
  anomalyStareSeconds = 1.5;
  /** 环视时每秒累积的暴露（0..1）。 */
  exposurePerSecond = 0.25;
  /** 2.1：手机屏幕发光会吸引注视 ⇒ 暴露更快。 */
  phoneExposureMultiplier = 1.5;
  /** 退回卷子后暴露的自然回落（呼吸平复）。 */
  exposureDecayPerSecond = 0.08;
  /** 决策 #37：同场记名满这么多次就死。 */
  recordsToDeath = 3;
  /** 决策 #37：暴露到顶召来的师视持续多久。 */
  summonedGazeSeconds = 4.0;
  /**
   * 暴露到顶是否直接召来一道师视。巡考模式（决策 #43）下关掉：老师是走在过道里的真人，
   * 你的呼吸声只有在她走近时才会被听见 —— 由 InvigilatorPatrol 判定。
   */
  summonOnExposure = true;

  // ---- 状态（零 HUD ⇒ 这些量不上屏，只驱动声音与画面）----
  private _state: GazeState = GazeState.Paper;
  private _exposure = 0;
  private _timesRecorded = 0;
  private _isDead = false;
  private _cause: DeathCause = DeathCause.None;
  private _activeGaze: GazeKind = GazeKind.None;
  private _perceived: GazeWarning = GazeWarning.Unknown;
  private _activeGazeSummoned = false;
  private _anomalyRepelProgress = 0;
  private _isAimingAtAnomaly = false;
  private _activeGazeSeconds = 0;
  private _activeGazeRemaining = 0;
  private _exposureSeconds = 0;

  private nonComplySeconds = 0;
  private avoidSeconds = 0;
  private recordedThisGaze = false;

  get state(): GazeState { return this._state; }
  /** 2.1 要点 4：暴露时间不显示为进度条，它的唯一表现是呼吸声。 */
  get exposure(): number { return this._exposure; }
  /** 2.1：环视 ⇒ 管道视野。周边不可信，老师会在你的盲区里移动。 */
  get peripheralReliable(): boolean { return this._state === GazeState.Paper; }
  /** 2.1 要点 4：紧张度与暴露时间合并成一个听觉变量。 */
  get breathing(): number { return this._exposure; }
  get timesRecorded(): number { return this._timesRecorded; }
  get isDead(): boolean { return this._isDead; }
  get cause(): DeathCause { return this._cause; }
  /** 世界真相。 */
  get activeGaze(): GazeKind { return this._activeGaze; }
  get perceived(): GazeWarning { return this._perceived; }
  /** 当前这道视线是暴露到顶召来的（而不是老师自己抬头）。 */
  get activeGazeSummoned(): boolean { return this._activeGazeSummoned; }
  /** 2.2 细节 1：注视异象时它必须立刻可见地变淡/抖动。判定可以难，绝不能不可读。 */
  get anomalyRepelProgress(): number { return this._anomalyRepelProgress; }
  get isAimingAtAnomaly(): boolean { return this._isAimingAtAnomaly; }
  get activeGazeSeconds(): number { return this._activeGazeSeconds; }
  /** 当前视线还剩多久自行移开；≤0 表示不限时（异视只能被瞪走）。 */
  get activeGazeRemaining(): number { return this._activeGazeRemaining; }
  /** 累计暴露秒数（调试 / 标定用）。 */
  get exposureSeconds(): number { return this._exposureSeconds; }

  // ---- 输入 ----
  setState(s: GazeState): void {
    if (this._isDead) return;
    this._state = s;
  }

  /** 右键：卷子 ↔ 环视。 */
  toggleLookingAround(): void {
    this.setState(this._state === GazeState.LookingAround ? GazeState.Paper : GazeState.LookingAround);
  }

  /** 空格：卷子 ↔ 手机。 */
  togglePhone(): void {
    this.setState(this._state === GazeState.Phone ? GazeState.Paper : GazeState.Phone);
  }

  /** 环视时你正对着哪边。只有在环视状态下朝异视看才算「抬头直视」。 */
  setAimingAtAnomaly(aiming: boolean): void {
    this._isAimingAtAnomaly = aiming;
  }

  /** 世界侧触发一道视线，durationSeconds 秒后自行移开（≤0 = 不限时；GazeKind.None 表示它移开了）。 */
  injectGaze(kind: GazeKind, durationSeconds = 0): void {
    if (this._isDead) return;
    if (this._activeGaze === kind && kind !== GazeKind.None) {
      this._activeGazeRemaining = durationSeconds;
      return;
    }
    this._activeGaze = kind;
    this._activeGazeSeconds = 0;
    this._activeGazeRemaining = kind === GazeKind.None ? 0 : durationSeconds;
    this._activeGazeSummoned = false;
    this._perceived = GazeWarning.Unknown;
    this.nonComplySeconds = 0;
    this.avoidSeconds = 0;
    this._anomalyRepelProgress = 0;
    this.recordedThisGaze = false;
  }

  // ---- 每帧推进 ----
  tick(dt: number): TickResult {
    if (this._isDead) return TickResult.Died;
    if (dt < 0) dt = 0;

    this.updateExposure(dt);

    let summoned = false;
    if (this.summonOnExposure && this._exposure >= 1 && this._activeGaze === GazeKind.None) {
      this.injectGaze(GazeKind.Teacher, this.summonedGazeSeconds);
      this._activeGazeSummoned = true;
      summoned = true;
    }

    this.updatePerception(dt);

    let result: TickResult = TickResult.Idle;
    if (this._activeGaze === GazeKind.Teacher) result = this.tickTeacher(dt);
    else if (this._activeGaze === GazeKind.Anomaly) result = this.tickAnomaly(dt);

    if (!this._isDead && this._activeGaze !== GazeKind.None && this._activeGazeRemaining > 0) {
      this._activeGazeRemaining -= dt;
      if (this._activeGazeRemaining <= 0) this.injectGaze(GazeKind.None);
    }

    if (summoned && (result === TickResult.Idle || result === TickResult.Safe)) return TickResult.Summoned;
    return result;
  }

  private updateExposure(dt: number): void {
    if (this._state === GazeState.Paper) {
      this._exposure = Math.max(0, this._exposure - this.exposureDecayPerSecond * dt);
      return;
    }
    let rate = this.exposurePerSecond;
    if (this._state === GazeState.Phone) rate *= this.phoneExposureMultiplier;
    this._exposure = Math.min(1, this._exposure + rate * dt);
    this._exposureSeconds += dt;
  }

  private updatePerception(dt: number): void {
    if (this._activeGaze === GazeKind.None) {
      this._activeGazeSeconds = 0;
      this._perceived = GazeWarning.Unknown;
      return;
    }
    this._activeGazeSeconds += dt;
    if (this._activeGazeSeconds <= this.ambiguitySeconds) this._perceived = GazeWarning.Unknown;
    else this._perceived = this._activeGaze === GazeKind.Teacher ? GazeWarning.Teacher : GazeWarning.Anomaly;
  }

  private tickTeacher(dt: number): TickResult {
    if (this._state === GazeState.Paper) {
      this.nonComplySeconds = 0;
      return TickResult.Safe;
    }
    this.nonComplySeconds += dt;
    if (this.nonComplySeconds >= this.complyGraceSeconds && !this.recordedThisGaze) {
      this.recordedThisGaze = true;
      return this.addRecord();
    }
    return TickResult.Idle;
  }

  private tickAnomaly(dt: number): TickResult {
    const staring = this._state === GazeState.LookingAround && this._isAimingAtAnomaly;
    if (staring) {
      this._anomalyRepelProgress += dt / Math.max(0.0001, this.anomalyStareSeconds);
      this.avoidSeconds = 0;
      if (this._anomalyRepelProgress >= 1) {
        this._anomalyRepelProgress = 0;
        this.injectGaze(GazeKind.None);
        return TickResult.Repelled;
      }
      return TickResult.Safe;
    }

    this._anomalyRepelProgress = Math.max(0, this._anomalyRepelProgress - dt * 2);

    if (this._state === GazeState.LookingAround) {
      // 环视但没朝它看：它在你的盲区里。7.1 第三场专门教「无法用视线回应的身后注视」，
      // 所以这里保持中性、不提前杀死玩家。
      this.avoidSeconds = 0;
      return TickResult.Idle;
    }

    this.avoidSeconds += dt;
    if (this.avoidSeconds >= this.complyGraceSeconds) {
      this.die(DeathCause.Anomaly);
      return TickResult.Died;
    }
    return TickResult.Idle;
  }

  /** 不经过视线的违规（例：A2 听力期间离开卷子）。同样计入记名，同样满 recordsToDeath 即死。 */
  recordViolation(): TickResult {
    if (this._isDead) return TickResult.Died;
    return this.addRecord();
  }

  private addRecord(): TickResult {
    this._timesRecorded++;
    if (this._timesRecorded >= this.recordsToDeath) {
      this.die(DeathCause.Records);
      return TickResult.Died;
    }
    return TickResult.Recorded;
  }

  private die(cause: DeathCause): void {
    this._isDead = true;
    this._cause = cause;
  }
}
