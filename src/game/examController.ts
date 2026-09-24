import { Vector3, type Scene } from '@babylonjs/core';
import {
  DeathCurve, ExamSession, formatTemplate, GazeKind, GazeState, InvigilatorProfile, PatrolEventKind, PatrolState,
  PhoneEventKind, RunState, RunTransition, SessionConfig, SessionEvents, SessionPhase, TickResult, yawTo,
  type DeathPresentation, type GameData, type PhoneKey, type StringTable,
} from '../core';
import { AnomalyView } from './anomalyView';
import { AudioDirector } from './audio';
import { idleTeacherPose, TeacherModel } from './characters';
import type { Classroom } from './classroom';
import { gazeFromPitch } from './lookGaze';
import { PaperView } from './paperView';
import { PhoneView } from './phoneView';
import { PlayerView } from './playerView';

/** 直视异象的角度容差。 */
const STARE_TOLERANCE_DEG = 9;
/** 「和老师对上眼」的角度容差（瞄她的脸）。 */
const TEACHER_EYE_TOLERANCE_DEG = 12;
/** 按住 Enter 多久才交卷：防手滑，也让「交卷」本身成为一个要下决心的动作。 */
const SUBMIT_HOLD_SECONDS = 1.1;
/** 被抓时先黑一下（灯管跳闸），她就在这一黑里到了你身边。 */
const BLACKOUT_SECONDS = 0.14;
const CAPTION_SECONDS = 6;
/** 抓到你时她的脸比你的视线高多少（米）：略高一点 = 她俯下来盯着你，而不是从头顶压下来。 */
const CLOSE_FACE_RISE = 0.07;

interface DeathState {
  presentation: DeathPresentation;
  elapsed: number;
  duration: number;
  stung: boolean;
}

interface CatchState {
  elapsed: number;
  stung: boolean;
}

/**
 * 呈现层的总控：每帧推进 ExamSession，把输入翻译成 setGaze / select / pressPhoneKey，把结果交给各个 View 和声音。
 * 所有判定都在 core 里，这里只读不判。
 */
export class ExamController {
  run: RunState;
  session: ExamSession;
  readonly view: PlayerView;
  readonly paper: PaperView;
  readonly phone: PhoneView;
  readonly anomaly: AnomalyView;
  readonly teacher: TeacherModel;
  readonly audio = new AudioDirector();
  readonly events = new SessionEvents();
  /** 手机上的虚拟光标（CSS 像素，相对画布左上角）。 */
  readonly cursor = { x: 0, y: 0 };
  paused = true;
  runComplete = false;
  hoverKey: PhoneKey | null = null;

  private death: DeathState | null = null;
  private caught: CatchState | null = null;
  private closeLean = 1;
  private submitHeld = false;
  private submitHold = 0;
  private lights = 1;
  private flicker = 0;
  private flashLevel = 0;
  private flashColor = '#ffffff';
  private captionLeft = 0;
  private wasPhoneOut = false;
  private readonly pose = idleTeacherPose();
  private readonly face = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly room: Classroom,
    private readonly data: GameData,
    private readonly table: StringTable,
    private readonly flash: HTMLElement,
    private readonly caption: HTMLElement,
    seed: number,
  ) {
    this.view = new PlayerView(scene, room.eye);
    this.paper = new PaperView(scene, room.desk, table);
    this.phone = new PhoneView(scene, this.view.camera, table);
    this.anomaly = new AnomalyView(scene, room.anomalySpots, room.eye);
    this.teacher = new TeacherModel(scene);
    for (const m of this.teacher.meshes) {
      m.receiveShadows = true;
      room.addCaster(m);
    }
    for (const m of this.teacher.glowMeshes) room.glow.addIncludedOnlyMesh(m);
    this.run = new RunState(seed);
    this.session = this.beginSession();
  }

  private beginSession(): ExamSession {
    const s = new ExamSession(this.data, this.table, this.run, InvigilatorProfile.patrol(), new SessionConfig(), new DeathCurve(), this.room.layout);
    s.begin();
    this.session = s;
    this.anomaly.reseed(this.run.roundSeed);
    this.paper.current = 0;
    this.paper.draw(s);
    this.room.refresh(this.table.get('paper.header.title'), s.context.strings.get('header') ?? '', this.run.totalDeaths > 0);
    this.view.forceLook(null);
    this.view.setPhoneOut(false);
    this.view.resetToPaper();
    this.caught = null;
    this.submitHold = 0;
    this.lights = 1;
    this.wasPhoneOut = false;
    this.teacher.setVisible(true);
    return s;
  }

  restartRun(seed: number): void {
    this.run = new RunState(seed);
    this.runComplete = false;
    this.death = null;
    this.flashLevel = 0;
    this.beginSession();
  }

  // ---- 输入 ----

  private get interactive(): boolean {
    return !this.paused && !this.runComplete && this.death === null && !this.session.inputLocked;
  }

  get phoneOut(): boolean {
    return this.session.gaze.state === GazeState.Phone;
  }

  /** 左键：手机掏着 = 点光标下的键；看着卷子 = 点准星下的翻题按钮。 */
  click(): void {
    if (!this.interactive) return;
    if (this.phoneOut) {
      const key = this.phone.keyAt(this.scene, this.cursor.x, this.cursor.y);
      if (key) this.pressPhone(key);
      return;
    }
    if (this.session.gaze.state !== GazeState.Paper) return;
    const delta = this.paper.hitTestAtCenter();
    if (delta !== 0) this.paper.flip(delta, this.session);
  }

  togglePhone(): void {
    if (!this.interactive) return;
    this.session.setGaze(this.phoneOut ? GazeState.Paper : GazeState.Phone);
  }

  /** 鼠标：平时转头；手机掏着时移动手机上的光标。 */
  look(dx: number, dy: number): void {
    if (this.phoneOut && !this.caught) {
      const canvas = this.scene.getEngine().getRenderingCanvas();
      const w = canvas?.clientWidth ?? 1;
      const h = canvas?.clientHeight ?? 1;
      this.cursor.x = Math.max(0, Math.min(w, this.cursor.x + dx));
      this.cursor.y = Math.max(0, Math.min(h, this.cursor.y + dy));
      return;
    }
    this.view.addLook(dx, dy);
  }

  pressPhone(key: PhoneKey): boolean {
    if (!this.interactive) return false;
    return this.session.pressPhoneKey(key);
  }

  select(choice: number): void {
    if (!this.interactive || this.session.gaze.state !== GazeState.Paper) return;
    if (this.session.select(this.paper.current, choice)) {
      this.paper.draw(this.session);
      this.audio.pen();
    }
  }

  flip(delta: number): void {
    if (this.interactive && this.session.gaze.state === GazeState.Paper) this.paper.flip(delta, this.session);
  }

  /** Enter 按下 / 松开：按满 SUBMIT_HOLD_SECONDS 才交卷。 */
  setSubmitHeld(held: boolean): void {
    this.submitHeld = held;
  }

  // ---- 每帧 ----

  update(dt: number): void {
    // 暂停 / 一轮结束时把按钮一起收起来：这里提前返回，不主动收就会停在最后一帧的状态上。
    if (this.paused || this.runComplete) {
      this.paper.setButtonsVisible(false);
      return;
    }
    dt = Math.min(dt, 0.1);
    if (this.death) {
      this.updateDeath(dt);
      return;
    }

    const s = this.session;
    if (!s.inputLocked) s.setGaze(gazeFromPitch(s.gaze.state, this.view.pitchDeg));
    const out = this.phoneOut;
    if (out !== this.wasPhoneOut) {
      this.wasPhoneOut = out;
      this.view.setPhoneOut(out);
      this.audio.flip(out);
      if (out) this.centerCursor();
    }
    this.teacher.faceWorld(this.face);
    s.setLookingAtTeacher(s.gaze.state === GazeState.LookingAround && this.view.isAimingAt(this.face, TEACHER_EYE_TOLERANCE_DEG));
    const aim = this.anomaly.spot !== null && this.view.isAimingAt(this.anomaly.spot, STARE_TOLERANCE_DEG);
    s.gaze.setAimingAtAnomaly(s.gaze.state === GazeState.LookingAround && aim);

    const canSubmit = this.submitHeld && this.interactive && s.gaze.state === GazeState.Paper;
    this.submitHold = canSubmit ? this.submitHold + dt : Math.max(0, this.submitHold - dt * 3);
    if (this.submitHold >= SUBMIT_HOLD_SECONDS) {
      this.submitHold = 0;
      this.submitHeld = false;
      s.submit();
    }

    this.events.clear();
    s.tick(dt, this.events);
    this.handleEvents();
    this.updateCatch(dt);
    this.present(dt);

    if (s.phase === SessionPhase.Died && s.death) this.startDeath(s.death);
    else if (s.phase === SessionPhase.Submitted) this.advance(s.finish());
  }

  private centerCursor(): void {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    this.cursor.x = (canvas?.clientWidth ?? 0) / 2;
    this.cursor.y = (canvas?.clientHeight ?? 0) * 0.79;
  }

  private handleEvents(): void {
    const e = this.events;
    const layout = this.room.layout;
    const patrol = this.session.patrol;
    for (const p of e.patrol) {
      switch (p.kind) {
        case PatrolEventKind.Footstep:
          this.audio.footstep(p.x, p.z, layout.isOnPlatform(p.z), patrol?.state === PatrolState.Investigating ? 1.3 : 1);
          break;
        case PatrolEventKind.PageTurn:
          this.audio.pageTurn(p.x, p.z);
          break;
        case PatrolEventKind.Noticed:
        case PatrolEventKind.Heard:
          this.audio.hmm(this.face.x, this.face.y, this.face.z);
          break;
        case PatrolEventKind.Caught:
          this.startCatch();
          break;
        case PatrolEventKind.GlareStart:
          this.view.forceLook(null);
          this.view.resetToPaper();
          break;
        default:
          break;
      }
    }
    for (const ph of e.phone) {
      switch (ph.kind) {
        case PhoneEventKind.Key:
          if (ph.key) {
            this.audio.key(ph.key, ph.audible);
            this.phone.press(ph.key);
          }
          break;
        case PhoneEventKind.Ring:
          this.audio.ring();
          this.phone.notify(false);
          break;
        case PhoneEventKind.SilentArrival:
          this.audio.vibrate();
          this.phone.notify(true);
          if (!this.phoneOut) this.view.kick(0.3, 0, 0);
          break;
        case PhoneEventKind.SearchDone:
        case PhoneEventKind.Sent:
          this.audio.searchDone(ph.audible);
          break;
        case PhoneEventKind.Denied:
        case PhoneEventKind.BatteryLow:
        case PhoneEventKind.BatteryDead:
          this.audio.denied(ph.audible);
          break;
        default:
          break;
      }
    }
    for (const cue of e.broadcasts) {
      const text = formatTemplate(this.table.get(cue.key), cue.arg);
      this.audio.broadcast(text);
      this.caption.textContent = text;
      this.captionLeft = CAPTION_SECONDS;
    }
    // 记名：她在记录本上写你的名字 —— 一阵笔尖声，画面边缘红一下。
    if (e.gaze.includes(TickResult.Recorded)) {
      this.audio.pen();
      this.pulse('#8a0000', 0.3);
    }
  }

  private pulse(color: string, level: number): void {
    this.flashColor = color;
    this.flashLevel = Math.max(this.flashLevel, level);
  }

  // ---- 被抓：黑一下 → 她已经站在你身边 → 镜头被扭到她脸上 + 惊吓音 → 回到卷子，她盯着你 ----

  private startCatch(): void {
    this.caught = { elapsed: 0, stung: false };
    this.closeLean = this.solveCloseLean();
    this.audio.whoosh();
    this.lights = 0;
    this.submitHold = 0;
  }

  /** 弯腰越深脸越低：二分出让她的脸刚好比你视线高一点的那个弯腰量。 */
  private solveCloseLean(): number {
    const p = this.session.patrol;
    if (!p) return 1;
    const eye = this.room.eye;
    const pose = this.pose;
    pose.x = p.x;
    pose.z = p.z;
    pose.y = this.room.layout.isOnPlatform(p.z) ? this.room.layout.platformHeight : 0;
    pose.bodyYaw = pose.lookYaw = yawTo(p.x, p.z, eye.x, eye.z);
    pose.speed = 0;
    pose.reading = false;
    pose.rage = 1;
    pose.lookPitch = 0.15;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 12; i++) {
      pose.lean = (lo + hi) / 2;
      this.teacher.update(0, pose, true);
      this.teacher.faceWorld(this.face);
      if (this.face.y > eye.y + CLOSE_FACE_RISE) lo = pose.lean;
      else hi = pose.lean;
    }
    return (lo + hi) / 2;
  }

  private updateCatch(dt: number): void {
    const c = this.caught;
    if (!c) {
      this.lights += (1 - this.lights) * (1 - Math.exp(-dt * 8));
      return;
    }
    c.elapsed += dt;
    if (c.elapsed < BLACKOUT_SECONDS) {
      this.lights = 0;
      return;
    }
    this.teacher.faceWorld(this.face);
    if (!c.stung) {
      c.stung = true;
      this.audio.sting(0.85, 0);
      this.pulse('#b00000', 0.55);
      this.view.kick(1, 1, 1);
      this.flicker = 0.7;
    }
    this.lights = this.flicker > 0 ? 0.55 + 0.45 * Math.random() : 1;
    if (this.session.patrol?.state === PatrolState.Caught) {
      this.view.forceLook(this.face);
    } else {
      this.view.forceLook(null);
      this.caught = null;
    }
  }

  // ---- 画面、声音 ----

  private present(dt: number): void {
    const s = this.session;
    const p = s.patrol;
    const L = this.room.layout;
    const eye = this.room.eye;
    const pose = this.pose;
    const close = p !== null && (p.state === PatrolState.Caught || p.state === PatrolState.Glaring);
    if (p) {
      pose.x = p.x;
      pose.z = p.z;
      pose.y = L.isOnPlatform(p.z) ? L.platformHeight : 0;
      pose.bodyYaw = p.bodyYaw;
      pose.lookYaw = close ? yawTo(p.x, p.z, eye.x, eye.z) : p.lookYaw;
      pose.speed = p.speed;
      pose.reading = p.reading;
      pose.rage = p.rage;
      pose.lean = close ? this.closeLean : 0;
      const eyeOnYou = close || p.watchingPlayer || p.state === PatrolState.Alert || p.state === PatrolState.Investigating;
      const faceDistance = Math.max(0.2, Math.hypot(eye.x - this.face.x, eye.z - this.face.z));
      pose.lookPitch = eyeOnYou ? Math.atan2(this.face.y - eye.y, faceDistance) : p.reading ? 0.25 : 0.12;
    } else {
      pose.x = L.teacherPost.x;
      pose.z = L.teacherPost.z;
      pose.y = L.platformHeight;
    }
    this.teacher.update(dt, pose);

    this.flicker = Math.max(0, this.flicker - dt);
    const anomaly = s.gaze.activeGaze === GazeKind.Anomaly;
    const lights = this.lights * (anomaly && Math.random() < 0.08 ? 0.6 : 1);
    this.room.update(dt, {
      wallClockMinutes: s.clock.wallClockMinutes(s.context.clockOffset),
      lights,
      stare: close ? 1 : 0,
      eye,
    });

    const suspicion = p?.suspicion ?? 0;
    const rage = p?.rage ?? 0;
    const watched = p?.watchingPlayer ?? false;
    this.view.update(dt, s.gaze, { watched, suspicion, rage });
    this.paper.setButtonsVisible(s.gaze.state === GazeState.Paper && !s.inputLocked);
    this.paper.setSubmitProgress(this.submitHold / SUBMIT_HOLD_SECONDS);
    this.anomaly.update(dt, s.gaze);

    const out = this.phoneOut;
    this.hoverKey = out ? this.phone.keyAt(this.scene, this.cursor.x, this.cursor.y) : null;
    this.phone.update(dt, s, out, this.hoverKey);

    const pressure = watched && s.gaze.state !== GazeState.Paper ? 0.35 : 0;
    this.audio.update(dt, {
      listener: this.view.camera.position,
      forward: this.view.forward(),
      up: this.view.up(),
      heartbeat: Math.min(1, suspicion * 1.2 + pressure + rage),
      breath: s.gaze.exposure,
      anomaly,
      lights,
      rage,
    });
    this.presentOverlay(dt);
  }

  private presentOverlay(dt: number): void {
    this.flashLevel = Math.max(0, this.flashLevel - dt * 1.3);
    this.flash.style.background = this.flashColor;
    this.flash.style.opacity = String(this.flashLevel);
    this.captionLeft = Math.max(0, this.captionLeft - dt);
    this.caption.style.opacity = String(Math.min(1, this.captionLeft));
  }

  // ---- 死亡：先静 → 她的脸冲到你面前 → 惊吓音（按 DeathCurve 错开）→ 白闪 → 余韵 → 黑 ----

  private startDeath(p: DeathPresentation): void {
    this.death = { presentation: p, elapsed: 0, duration: Math.max(1.6, p.leadInSilenceSeconds + p.postDeathDwellSeconds + 1.2), stung: false };
    this.audio.silence(p.leadInSilenceSeconds);
    this.caught = null;
    this.view.forceLook(null);
    this.submitHold = 0;
  }

  private updateDeath(dt: number): void {
    const d = this.death!;
    const p = d.presentation;
    d.elapsed += dt;
    const after = d.elapsed - p.leadInSilenceSeconds;
    const cam = this.view.camera.position;
    const fwd = this.view.forward();

    if (p.faceAppears && !p.eventless && after >= 0) {
      const rush = Math.min(1, after / 0.22);
      const near = 1.1 + (0.22 - 1.1) * p.cameraRush;
      const distance = 1.1 + (near - 1.1) * rush;
      const pose = this.pose;
      pose.rage = 1;
      pose.lean = 0.45;
      pose.speed = 0;
      pose.reading = false;
      pose.bodyYaw = Math.atan2(-fwd.x, -fwd.z);
      pose.lookYaw = pose.bodyYaw;
      pose.lookPitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
      this.teacher.update(dt, pose);
      this.teacher.placeFaceAt(cam.add(fwd.scale(distance)));
      this.teacher.setVisible(true);
    } else if (p.eventless) {
      this.teacher.setVisible(false);
    }
    if (!d.stung && after >= p.audioDelaySeconds) {
      d.stung = true;
      if (!p.eventless) this.audio.sting(p.stingerVolume, p.stingerMuffle);
      if (!p.eventless) this.view.kick(0.8, 0.6, 1);
    }

    const flash = p.eventless ? 0 : after >= 0 ? p.flashIntensity * Math.exp(-after * 6) : 0;
    const dark = Math.min(1, Math.max(0, after - p.postDeathDwellSeconds) / 0.8);
    this.flash.style.background = flash > dark ? '#fff' : '#000';
    this.flash.style.opacity = String(Math.max(flash, dark));
    this.room.update(dt, {
      wallClockMinutes: this.session.clock.wallClockMinutes(this.session.context.clockOffset),
      lights: after < 0 ? 0.3 + 0.7 * Math.random() : 1,
      stare: 1,
      eye: this.room.eye,
    });
    this.view.update(dt, this.session.gaze, { watched: true, suspicion: 1, rage: after >= 0 ? 1 : 0 });
    this.phone.update(dt, this.session, false, null);
    this.paper.setButtonsVisible(false);
    this.paper.setSubmitProgress(0);
    if (d.elapsed < d.duration) return;

    this.death = null;
    this.flashLevel = 0;
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
    return this.session.patrol?.watchingPlayer ?? this.session.gaze.activeGaze === GazeKind.Teacher;
  }

  get dying(): boolean {
    return this.death !== null;
  }
}
