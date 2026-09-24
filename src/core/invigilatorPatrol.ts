import type { ClassroomLayout, Point2 } from './classroomLayout';
import { GazeKind, GazeState, type GazeStateMachine, type TickResult } from './gazeStateMachine';
import { DeterministicRng } from './rng';

/**
 * 巡考老师的行为状态（决策 #43）。
 *
 *   podium        站在讲桌后：低头看记名册（看不见你，翻页声）与抬头扫视交替
 *   walking       沿过道走；走到一半可能停下（pausing）左右看
 *   alert         起疑：停步、转身、盯着你 —— 这是可读的预告，立刻收手机低头还来得及
 *   investigating 朝你那排走过来，站在你旁边看一会儿
 *   caught        抓现行：她已经闪现到你身边（暴怒形态）。呈现层接管镜头
 *   glaring       站在你旁边盯着你记名；这期间你只能低头
 *   leaving       恢复常态，走回讲台
 */
export const PatrolState = {
  Podium: 'podium',
  Walking: 'walking',
  Pausing: 'pausing',
  Alert: 'alert',
  Investigating: 'investigating',
  Caught: 'caught',
  Glaring: 'glaring',
  Leaving: 'leaving',
} as const;
export type PatrolState = (typeof PatrolState)[keyof typeof PatrolState];

/** 一帧里巡考发出的事件。呈现层据此放脚步声、翻页声、「嗯？」和惊吓。 */
export const PatrolEventKind = {
  Footstep: 'footstep',
  PageTurn: 'page_turn',
  Noticed: 'noticed',
  Calmed: 'calmed',
  Heard: 'heard',
  Caught: 'caught',
  GlareStart: 'glare_start',
  GlareEnd: 'glare_end',
} as const;
export type PatrolEventKind = (typeof PatrolEventKind)[keyof typeof PatrolEventKind];

export interface PatrolEvent {
  kind: PatrolEventKind;
  x: number;
  z: number;
}

/** 这一帧玩家那边能被她察觉的一切。 */
export interface PatrolInput {
  gaze: GazeState;
  /** 玩家正对着她的脸（呈现层做角度判定）。她也正看着你 ⇒ 对视（规则第五条）。 */
  lookingAtTeacher: boolean;
  /** 0..1 暴露 = 呼吸声。到顶且她在附近 ⇒ 她听见了。 */
  exposure: number;
  /** 这一帧手机响了（响铃模式下来短信）。 */
  ringing: boolean;
  /** 这一帧手机发出的按键音个数（静音模式恒为 0）。 */
  keyTones: number;
  /** 听力时段：她回讲台放录音，不下来巡。 */
  listening: boolean;
}

export function quietInput(gaze: GazeState = GazeState.Paper): PatrolInput {
  return { gaze, lookingAtTeacher: false, exposure: 0, ringing: false, keyTones: 0, listening: false };
}

/** 巡考的可标定参数。秒数都是真实时间，距离是米。 */
export class PatrolProfile {
  /** 开场先在讲台站多久：让玩家先学会看卷子、摸手机。 */
  firstPodiumSeconds = 16;
  podiumMin = 9;
  podiumMax = 18;
  /** 讲台上低头看记名册（看不见你）与抬头扫视交替。翻页声 = 她在低头。 */
  readMin = 3.5;
  readMax = 6.5;
  scanMin = 2.2;
  scanMax = 3.8;
  pageTurnMin = 2.2;
  pageTurnMax = 4.5;

  walkSpeed = 0.8;
  investigateSpeed = 1.25;
  leaveSpeed = 0.95;
  /** 按 walkSpeed 标定的步距；走得快，脚步声就密 —— 这本身就是预警。 */
  stepInterval = 0.56;
  pauseChance = 0.55;
  pauseMin = 1.6;
  pauseMax = 3.2;

  turnSpeed = 3.2;
  headTurnSpeed = 5;
  scanAmplitude = 1.05;
  scanSpeed = 0.85;

  // ---- 视锥 ----
  visionHalfAngleDeg = 55;
  visionRange = 9.5;
  nearDistance = 1.5;
  farDistance = 8;
  farFactor = 0.35;
  /** 她在你正前方且离得远：课桌挡住了你的腿，桌下的手机更难被看见。从背后看则一览无余。 */
  frontCoverFactor = 0.55;
  frontCoverMinDistance = 3;

  // ---- 起疑（0..1，满了就是抓现行）----
  gainRate = 1.4;
  alertGainMultiplier = 1.5;
  decayRate = 0.35;
  alertThreshold = 0.3;
  calmThreshold = 0.1;
  minAlertSeconds = 0.8;
  phoneActivity = 1;
  lookActivity = 0.25;
  eyeContactActivity = 0.9;
  investigateChance = 0.5;
  investigateStareSeconds = 2.4;

  // ---- 声音 ----
  ringSuspicion = 0.55;
  keyToneRadius = 3.5;
  keyToneSuspicion = 0.08;
  breathRadius = 3;

  // ---- 抓现行 ----
  /** 闪现 + 暴怒脸的那一下。呈现层在这段时间里接管镜头。 */
  caughtSeconds = 1.4;
  /** 之后她站在你旁边盯着你记名；这期间抬头 = 再记一次。 */
  glareSeconds = 4;
  rageFadePerSecond = 0.6;
}

interface Leg {
  x: number;
  z: number;
  /** 走到这里后站多久（0 = 不停）。 */
  pause: number;
  /** 站着的时候盯着你看（调查），而不是左右扫。 */
  stare: boolean;
}

const TAU = Math.PI * 2;

export function wrapAngle(a: number): number {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
}

function approachAngle(current: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/** 朝向约定与 Babylon 一致：yaw 0 看 +Z，yaw = atan2(dx, dz)。 */
export function yawTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

/**
 * 巡考老师：在过道里走，用眼睛看，靠耳朵听。她看没看见你、起没起疑、什么时候抓你，全在这里判。
 * 只有「抓现行」和之后的瞪视会写进 GazeStateMachine（记名 / 注入师视），其余都是她自己的事。
 */
export class InvigilatorPatrol {
  readonly profile: PatrolProfile;
  x: number;
  z: number;
  bodyYaw = 0;
  lookYaw = 0;
  /** 0..1。零 HUD：它只驱动她的动作、心跳声和暗角。 */
  suspicion = 0;
  /** 本场抓了你几次（调试 / 记名册）。 */
  catches = 0;

  private _state: PatrolState = PatrolState.Podium;
  private _stateTime = 0;
  private legs: Leg[] = [];
  private pauseLeft = 0;
  private pauseStare = false;
  private afterPause: PatrolState = PatrolState.Walking;
  private podiumLeft: number;
  private _reading = true;
  private readLeft: number;
  private pageTurnIn: number;
  private stepIn = 0;
  private scanPhase = 0;
  private swayPhase = 0;
  private investigateNext = false;
  private breathLatch = false;
  private returningForListening = false;
  private resumeState: PatrolState = PatrolState.Podium;
  private resumeLegs: Leg[] = [];
  private _watching = false;
  private _rage = 0;
  private _speed = 0;
  private readonly rng: DeterministicRng;

  constructor(readonly layout: ClassroomLayout, profile: PatrolProfile | null, seed: number) {
    this.profile = profile ?? new PatrolProfile();
    this.rng = new DeterministicRng(seed);
    this.x = layout.teacherPost.x;
    this.z = layout.teacherPost.z;
    this.podiumLeft = this.profile.firstPodiumSeconds;
    this.readLeft = this.range(this.profile.readMin, this.profile.readMax);
    this.pageTurnIn = this.range(this.profile.pageTurnMin, this.profile.pageTurnMax);
  }

  get state(): PatrolState { return this._state; }
  get stateTime(): number { return this._stateTime; }
  /** 她的视锥里有你（暗角收紧、心跳）。 */
  get watchingPlayer(): boolean { return this._watching; }
  /** 0..1：暴怒形态的程度。抓现行与瞪视时为 1，走开时慢慢退回常态。 */
  get rage(): number { return this._rage; }
  /** 抓现行的那一下：呈现层接管镜头，玩家输入无效。 */
  get busy(): boolean { return this._state === PatrolState.Caught; }
  /** 讲台上低头看记名册：这时她看不见任何人。 */
  get reading(): boolean { return this._state === PatrolState.Podium && this._reading; }
  /** 当前移动速度（米/秒），给走路动画用。 */
  get speed(): number { return this._speed; }
  get onPlatform(): boolean { return this.layout.isOnPlatform(this.z); }
  get distanceToPlayer(): number {
    const eye = this.layout.playerEye;
    return Math.hypot(eye.x - this.x, eye.z - this.z);
  }

  tick(dt: number, input: PatrolInput, machine: GazeStateMachine, events: PatrolEvent[], results: TickResult[]): void {
    if (!(dt > 0)) return;
    const p = this.profile;
    this._stateTime += dt;
    this._speed = 0;

    if (this._state === PatrolState.Caught) {
      this._rage = 1;
      this._watching = true;
      if (this._stateTime >= p.caughtSeconds) {
        this.setState(PatrolState.Glaring);
        if (!machine.isDead) machine.injectGaze(GazeKind.Teacher, p.glareSeconds);
        this.emit(events, PatrolEventKind.GlareStart);
      }
      return;
    }
    if (this._state === PatrolState.Glaring) {
      this._rage = 1;
      this._watching = true;
      this.faceTarget(this.layout.playerEye, dt);
      if (this._stateTime >= p.glareSeconds || machine.activeGaze !== GazeKind.Teacher) {
        this.emit(events, PatrolEventKind.GlareEnd);
        this.legs = this.route(this.x, this.z, this.layout.teacherPost.x, this.layout.teacherPost.z);
        this.setState(PatrolState.Leaving);
      }
      return;
    }

    this._rage = Math.max(0, this._rage - p.rageFadePerSecond * dt);

    // ---- 看 ----
    const eye = this.layout.playerEye;
    const dist = Math.hypot(eye.x - this.x, eye.z - this.z);
    const toPlayer = yawTo(this.x, this.z, eye.x, eye.z);
    const visionOn = !this.reading;
    const inCone = visionOn && dist <= p.visionRange && Math.abs(wrapAngle(this.lookYaw - toPlayer)) <= (p.visionHalfAngleDeg * Math.PI) / 180;
    this._watching = inCone;

    let activity = 0;
    if (input.gaze === GazeState.Phone) activity = p.phoneActivity;
    else if (input.gaze === GazeState.LookingAround) activity = input.lookingAtTeacher ? p.eyeContactActivity : p.lookActivity;

    if (inCone && activity > 0) {
      let visibility = this.distanceFactor(dist);
      if (input.gaze === GazeState.Phone && dist >= p.frontCoverMinDistance && this.inFrontOfPlayer()) visibility *= p.frontCoverFactor;
      let gain = p.gainRate * activity * visibility * dt;
      if (this._state === PatrolState.Alert) gain *= p.alertGainMultiplier;
      this.suspicion += gain;
    } else {
      this.suspicion = Math.max(0, this.suspicion - p.decayRate * dt);
    }

    // ---- 听 ----
    let heard = false;
    if (input.ringing) {
      this.suspicion += p.ringSuspicion;
      heard = true;
    }
    if (input.keyTones > 0 && dist <= p.keyToneRadius) this.suspicion += p.keyToneSuspicion * input.keyTones;
    if (input.exposure < 0.7) this.breathLatch = false;
    if (input.exposure >= 1 && dist <= p.breathRadius && !this.breathLatch) {
      this.breathLatch = true;
      this.suspicion = Math.max(this.suspicion, p.alertThreshold + 0.05);
      heard = true;
    }
    if (heard) {
      this.investigateNext = true;
      this.emit(events, PatrolEventKind.Heard);
    }
    this.suspicion = Math.min(1, this.suspicion);

    if (this.suspicion >= 1) {
      this.catchPlayer(machine, events, results);
      return;
    }
    if (this._state !== PatrolState.Alert && this.suspicion >= p.alertThreshold) this.enterAlert(events);

    // ---- 动 ----
    if (input.listening && !this.returningForListening && (this._state === PatrolState.Walking || this._state === PatrolState.Pausing)) {
      this.returningForListening = true;
      this.legs = this.route(this.x, this.z, this.layout.teacherPost.x, this.layout.teacherPost.z);
      this.setState(PatrolState.Walking);
    }

    switch (this._state) {
      case PatrolState.Podium: this.tickPodium(dt, input.listening, events); break;
      case PatrolState.Pausing: this.tickPause(dt); break;
      case PatrolState.Alert: this.tickAlert(dt, events); break;
      default: this.tickWalk(dt, events); break;
    }
  }

  // ---- 状态行为 ----

  private tickPodium(dt: number, listening: boolean, events: PatrolEvent[]): void {
    const p = this.profile;
    this.bodyYaw = approachAngle(this.bodyYaw, 0, p.turnSpeed * dt);
    if (!listening) this.podiumLeft -= dt;

    this.readLeft -= dt;
    if (this._reading) {
      this.lookYaw = approachAngle(this.lookYaw, this.bodyYaw, p.headTurnSpeed * dt);
      this.pageTurnIn -= dt;
      if (this.pageTurnIn <= 0) {
        this.emit(events, PatrolEventKind.PageTurn);
        this.pageTurnIn = this.range(p.pageTurnMin, p.pageTurnMax);
      }
      if (this.readLeft <= 0) {
        this._reading = false;
        this.readLeft = this.range(p.scanMin, p.scanMax);
      }
    } else {
      this.scan(dt);
      if (this.readLeft <= 0) {
        this._reading = true;
        this.readLeft = this.range(p.readMin, p.readMax);
      }
    }

    if (this.podiumLeft <= 0 && !listening) {
      this.legs = this.planWalk();
      this._reading = false;
      this.returningForListening = false;
      this.setState(PatrolState.Walking);
    }
  }

  private tickWalk(dt: number, events: PatrolEvent[]): void {
    const p = this.profile;
    const leg = this.legs[0];
    if (!leg) { this.onRouteEnd(); return; }

    const speed = this._state === PatrolState.Investigating ? p.investigateSpeed : this._state === PatrolState.Leaving ? p.leaveSpeed : p.walkSpeed;
    const dx = leg.x - this.x;
    const dz = leg.z - this.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(d, speed * dt);
    if (d > 1e-6) {
      this.x += (dx / d) * step;
      this.z += (dz / d) * step;
      this.bodyYaw = approachAngle(this.bodyYaw, Math.atan2(dx, dz), p.turnSpeed * dt);
    }
    this._speed = step / dt;
    this.swayPhase += dt * 1.3;
    this.lookYaw = approachAngle(this.lookYaw, this.bodyYaw + Math.sin(this.swayPhase) * 0.25, p.headTurnSpeed * dt);

    this.stepIn -= dt * (speed / p.walkSpeed);
    if (this.stepIn <= 0) {
      this.emit(events, PatrolEventKind.Footstep);
      this.stepIn += p.stepInterval;
    }

    if (d - step <= 1e-4) {
      this.legs.shift();
      if (leg.pause > 0) {
        this.pauseLeft = leg.pause;
        this.pauseStare = leg.stare;
        this.afterPause = this._state;
        this.setState(PatrolState.Pausing);
        return;
      }
      if (this.legs.length === 0) this.onRouteEnd();
    }
  }

  private tickPause(dt: number): void {
    this.pauseLeft -= dt;
    if (this.pauseStare) this.faceTarget(this.layout.playerEye, dt);
    else this.scan(dt);
    if (this.pauseLeft > 0) return;
    this.setState(this.afterPause);
    if (this.legs.length === 0) this.onRouteEnd();
  }

  private tickAlert(dt: number, events: PatrolEvent[]): void {
    const p = this.profile;
    this.faceTarget(this.layout.playerEye, dt);
    if (this._stateTime < p.minAlertSeconds || this.suspicion > p.calmThreshold) return;

    this.emit(events, PatrolEventKind.Calmed);
    if (this.investigateNext || this.rng.nextFloat() < p.investigateChance) {
      this.investigateNext = false;
      this.startInvestigate();
      return;
    }
    this.legs = this.resumeLegs;
    this.resumeLegs = [];
    this.setState(this.resumeState);
    if (this._state === PatrolState.Podium) this._reading = false;
  }

  private onRouteEnd(): void {
    if (this._state === PatrolState.Investigating) {
      this.legs = this.route(this.x, this.z, this.layout.teacherPost.x, this.layout.teacherPost.z);
      this.setState(PatrolState.Walking);
      return;
    }
    const p = this.profile;
    this.podiumLeft = this.range(p.podiumMin, p.podiumMax);
    this._reading = true;
    this.readLeft = this.range(p.readMin, p.readMax);
    this.returningForListening = false;
    this.setState(PatrolState.Podium);
  }

  private enterAlert(events: PatrolEvent[]): void {
    const s = this._state;
    if (s === PatrolState.Caught || s === PatrolState.Glaring) return;
    this.resumeState = s === PatrolState.Pausing ? this.afterPause : s;
    this.resumeLegs = this.legs;
    this.legs = [];
    this.setState(PatrolState.Alert);
    this.emit(events, PatrolEventKind.Noticed);
  }

  private startInvestigate(): void {
    const eye = this.layout.playerEye;
    const desk = this.layout.playerDesk;
    const aisles = this.layout.aisles;
    const left = aisles.filter((a) => a < eye.x).pop() ?? aisles[0];
    const right = aisles.find((a) => a > eye.x) ?? aisles[aisles.length - 1];
    const aisle = Math.abs(this.x - left) <= Math.abs(this.x - right) ? left : right;
    this.legs = this.route(this.x, this.z, aisle, desk.z + 0.1);
    const last = this.legs[this.legs.length - 1];
    if (last) {
      last.pause = this.profile.investigateStareSeconds;
      last.stare = true;
    } else {
      this.legs.push({ x: this.x, z: this.z, pause: this.profile.investigateStareSeconds, stare: true });
    }
    this.setState(PatrolState.Investigating);
  }

  private catchPlayer(machine: GazeStateMachine, events: PatrolEvent[], results: TickResult[]): void {
    this.catches++;
    const spot = this.layout.besidePlayer;
    const eye = this.layout.playerEye;
    this.x = spot.x;
    this.z = spot.z;
    this.bodyYaw = this.lookYaw = yawTo(spot.x, spot.z, eye.x, eye.z);
    this.suspicion = 0;
    this.legs = [];
    this.resumeLegs = [];
    this.investigateNext = false;
    this._rage = 1;
    this._watching = true;
    this.setState(PatrolState.Caught);
    if (machine.activeGaze === GazeKind.Anomaly) machine.injectGaze(GazeKind.None);
    this.emit(events, PatrolEventKind.Caught);
    results.push(machine.recordViolation());
  }

  // ---- 路线 ----

  /** 一圈巡视：下讲台 → 一条过道走到后面 → 从后面换一条过道走回前面 → 回讲台。途中随机停下扫视。 */
  private planWalk(): Leg[] {
    const p = this.profile;
    const aisles = this.layout.aisles;
    const ai = this.rng.next(aisles.length);
    let bi = this.rng.next(aisles.length - 1);
    if (bi >= ai) bi++;
    const a = aisles[ai];
    const b = aisles[bi];
    const front = this.layout.aisleFrontZ;
    const back = this.layout.aisleBackZ;
    const post = this.layout.teacherPost;

    const legs: Leg[] = [];
    let cx = this.x;
    let cz = this.z;
    const go = (tx: number, tz: number, pause: number): void => {
      const r = this.route(cx, cz, tx, tz);
      if (r.length > 0) r[r.length - 1].pause = pause;
      legs.push(...r);
      cx = tx;
      cz = tz;
    };
    const maybePause = (): number => (this.rng.nextFloat() < p.pauseChance ? this.range(p.pauseMin, p.pauseMax) : 0);

    go(a, front + (back - front) * (0.2 + 0.5 * this.rng.nextFloat()), maybePause());
    go(a, back, 0);
    go(b, back, maybePause());
    go(b, front + (back - front) * (0.3 + 0.5 * this.rng.nextFloat()), maybePause());
    go(post.x, post.z, 0);
    return legs;
  }

  /** 只走过道和前后两条横道，不穿课桌。 */
  private route(fromX: number, fromZ: number, toX: number, toZ: number): Leg[] {
    const legs: Leg[] = [];
    const push = (x: number, z: number): void => {
      const prev = legs.length > 0 ? legs[legs.length - 1] : { x: fromX, z: fromZ };
      if (Math.hypot(prev.x - x, prev.z - z) > 1e-3) legs.push({ x, z, pause: 0, stare: false });
    };
    const front = this.layout.aisleFrontZ;
    const back = this.layout.aisleBackZ;
    const a0 = this.layout.nearestAisle(fromX);
    const ta = this.layout.nearestAisle(toX);
    push(a0, fromZ);
    let cz = fromZ;
    if (Math.abs(ta - a0) > 1e-3) {
      const viaFront = Math.abs(cz - front) + Math.abs(toZ - front);
      const viaBack = Math.abs(cz - back) + Math.abs(toZ - back);
      const end = viaFront <= viaBack ? front : back;
      push(a0, end);
      push(ta, end);
      cz = end;
    }
    push(ta, toZ);
    push(toX, toZ);
    return legs;
  }

  // ---- 小工具 ----

  private scan(dt: number): void {
    this.scanPhase += this.profile.scanSpeed * dt;
    const target = this.bodyYaw + Math.sin(this.scanPhase) * this.profile.scanAmplitude;
    this.lookYaw = approachAngle(this.lookYaw, target, this.profile.headTurnSpeed * dt);
  }

  private faceTarget(t: Point2, dt: number): void {
    const yaw = yawTo(this.x, this.z, t.x, t.z);
    this.bodyYaw = approachAngle(this.bodyYaw, yaw, this.profile.turnSpeed * dt);
    this.lookYaw = approachAngle(this.lookYaw, yaw, this.profile.headTurnSpeed * dt);
  }

  private distanceFactor(dist: number): number {
    const p = this.profile;
    if (dist <= p.nearDistance) return 1;
    if (dist >= p.farDistance) return p.farFactor;
    const t = (dist - p.nearDistance) / (p.farDistance - p.nearDistance);
    return 1 + (p.farFactor - 1) * t;
  }

  /** 她在你前方（你面朝黑板 -Z）：课桌挡在你的腿和她之间。 */
  private inFrontOfPlayer(): boolean {
    const eye = this.layout.playerEye;
    const dz = eye.z - this.z;
    return dz > 1 && Math.abs(this.x - eye.x) < dz * 1.2;
  }

  private setState(s: PatrolState): void {
    this._state = s;
    this._stateTime = 0;
  }

  private emit(events: PatrolEvent[], kind: PatrolEventKind): void {
    events.push({ kind, x: this.x, z: this.z });
  }

  private range(min: number, max: number): number {
    return min + (max - min) * this.rng.nextFloat();
  }
}
