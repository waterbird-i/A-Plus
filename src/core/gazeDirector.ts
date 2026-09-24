import { GazeKind, type GazeStateMachine } from './gazeStateMachine';
import { DeterministicRng } from './rng';

/**
 * 一位监考的注视规则（2.3「四位监考，四套注视规则」）。秒数都是真实时间。
 * Demo 只用 podium（一直坐在讲台：缓慢、稳定、可预判）。
 */
export class InvigilatorProfile {
  id = 'podium';
  firstTeacherDelay = 20;
  teacherIntervalMin = 22;
  teacherIntervalMax = 38;
  teacherGazeMin = 3;
  teacherGazeMax = 5;

  firstAnomalyDelay = 60;
  anomalyIntervalMin = 45;
  anomalyIntervalMax = 75;
  /** 6.2：异象越往后越频繁。强度 1 时间隔乘以这个数。 */
  anomalyIntervalAtFullIntensity = 0.6;

  /**
   * 听力时段异象计时走得多快（1 = 不变）。听力时离开试卷会被记名，抬头瞪异象也算离开，
   * 所以这段时间来的每一道异象都必然换走一次记名 —— 让它少来。
   */
  listeningAnomalyRate = 0.35;

  /** 视线落下之前，世界先给出的声音预警有多长（皮鞋声 / 日光灯变调）。 */
  cueLeadSeconds = 2.5;

  /**
   * 师视由调度器按时间表注入（podium）。巡考模式为 false：老师是在过道里走动的真人，
   * 看没看见你由 InvigilatorPatrol 的视锥决定，调度器只管异视（决策 #43）。
   */
  teacherScheduled = true;

  static podium(): InvigilatorProfile {
    return new InvigilatorProfile();
  }

  /** 决策 #43：巡考老师（v4 默认）。她不再「定时抬头」，而是真的在过道里走、用眼睛看。 */
  static patrol(): InvigilatorProfile {
    const p = new InvigilatorProfile();
    p.id = 'patrol';
    p.teacherScheduled = false;
    return p;
  }
}

/**
 * 调度谁在什么时候看你。它只往 GazeStateMachine 里注入视线，不做任何判定。
 * 一道视线在场时两条计时都暂停 —— 同一时刻只落一道视线（2.2）。
 */
export class GazeDirector {
  readonly profile: InvigilatorProfile;
  /** 0..1，来自复读进度（6.2 异象强度）。 */
  anomalyIntensity: number;
  /** 听力时段：老师不抬头（听力规则本身就是监视，A2），异象按 listeningAnomalyRate 放慢。 */
  listening = false;

  private readonly rng: DeterministicRng;
  private teacherIn: number;
  private anomalyIn: number;

  constructor(profile: InvigilatorProfile | null, seed: number, anomalyIntensity: number) {
    this.profile = profile ?? InvigilatorProfile.podium();
    this.rng = new DeterministicRng(seed);
    this.anomalyIntensity = Math.min(1, Math.max(0, anomalyIntensity));
    this.teacherIn = this.profile.firstTeacherDelay;
    this.anomalyIn = this.profile.firstAnomalyDelay;
  }

  /** 下一道视线是谁、还有多久。呈现层用它起声音预警。 */
  get upcomingKind(): GazeKind {
    return this.anomalyInReal < this.teacherInReal ? GazeKind.Anomaly : GazeKind.Teacher;
  }

  get secondsToNext(): number {
    return Math.min(this.teacherInReal, this.anomalyInReal);
  }

  get isCueing(): boolean {
    return this.secondsToNext <= this.profile.cueLeadSeconds;
  }

  private get teacherInReal(): number {
    return this.listening || !this.profile.teacherScheduled ? Infinity : this.teacherIn;
  }

  private get anomalyInReal(): number {
    if (!this.listening) return this.anomalyIn;
    return this.profile.listeningAnomalyRate > 0 ? this.anomalyIn / this.profile.listeningAnomalyRate : Infinity;
  }

  tick(dt: number, machine: GazeStateMachine): void {
    if (machine.isDead || machine.activeGaze !== GazeKind.None) return;
    if (dt < 0) dt = 0;

    if (!this.listening && this.profile.teacherScheduled) this.teacherIn -= dt;
    this.anomalyIn -= this.listening ? dt * this.profile.listeningAnomalyRate : dt;

    if (this.anomalyIn <= 0) {
      machine.injectGaze(GazeKind.Anomaly);
      this.anomalyIn = this.nextAnomalyInterval();
      if (this.teacherIn < this.profile.cueLeadSeconds) this.teacherIn = this.profile.cueLeadSeconds;
      return;
    }
    if (this.teacherIn <= 0) {
      machine.injectGaze(GazeKind.Teacher, this.range(this.profile.teacherGazeMin, this.profile.teacherGazeMax));
      this.teacherIn = this.range(this.profile.teacherIntervalMin, this.profile.teacherIntervalMax);
      if (this.anomalyIn < this.profile.cueLeadSeconds) this.anomalyIn = this.profile.cueLeadSeconds;
    }
  }

  private nextAnomalyInterval(): number {
    const scale = 1 + (this.profile.anomalyIntervalAtFullIntensity - 1) * this.anomalyIntensity;
    return this.range(this.profile.anomalyIntervalMin, this.profile.anomalyIntervalMax) * scale;
  }

  private range(min: number, max: number): number {
    return min + (max - min) * this.rng.nextFloat();
  }
}
