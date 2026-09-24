import { Color4, DefaultRenderingPipeline, UniversalCamera, Vector3, type Scene } from '@babylonjs/core';
import { GazeKind, GazeState, wrapAngle, type GazeStateMachine } from '../core';

const DEG = Math.PI / 180;
/** 坐着面朝黑板（-Z）。 */
const FACING_BOARD = Math.PI;
/** 开局的视线落点：课桌卷子中心（几何上约 51° 俯角）。 */
const START_PITCH = 52 * DEG;
/** 掏手机：低头看腿上（桌肚下面）。 */
const PHONE_PITCH = 60 * DEG;
/** 抬头能抬到吊扇、低头能低到桌沿 —— 异象有一处就在吊扇上，抬不到位就瞪不走它。 */
const PITCH_MIN = -70 * DEG;
const PITCH_MAX = 80 * DEG;
const YAW_RANGE = 165 * DEG;
const BASE_FOV = 70 * DEG;
/** 掏出手机时视野收窄，手机占满画面：屏幕上的字才看得清，周围的教室也就看不见了。 */
const PHONE_FOV = 46 * DEG;

interface Pose { yaw: number; pitch: number }

/** 监考老师给镜头的压力：她在不在看你、有多怀疑、是不是暴怒。 */
export interface Threat {
  watched: boolean;
  suspicion: number;
  rage: number;
}

/**
 * 2.1 三态视线的镜头。
 *
 * 视线永远跟着鼠标：抬头看教室、低头看卷子，玩家不需要按任何键去「切换状态」——
 * 状态由 lookGaze.ts 从俯仰角读出来（卷子 = 低头，环视 = 抬头，手机 = 空格）。
 * 掏手机时低头看腿，鼠标改去移动手机上的光标；被抓时镜头被强行扭到她脸上。
 */
export class PlayerView {
  readonly camera: UniversalCamera;
  readonly pipeline: DefaultRenderingPipeline;
  private look: Pose = { yaw: FACING_BOARD, pitch: START_PITCH };
  private readonly base: Pose = { yaw: FACING_BOARD, pitch: START_PITCH };
  private forced: Vector3 | null = null;
  private phoneOut = false;
  private phoneZoom = 0;
  private vignette = 0;
  private shakeAmount = 0;
  private fovKick = 0;
  private aberration = 0;
  private time = 0;

  constructor(private readonly scene: Scene, eye: Vector3) {
    this.camera = new UniversalCamera('eye', eye.clone(), scene);
    this.camera.minZ = 0.02;
    this.camera.maxZ = 80;
    this.camera.fov = BASE_FOV;
    this.camera.inputs.clear();
    // 抖动会写 rotation.z；不开这个的话，抖完那一刻的 up 会被一直沿用，之后整个视角都是歪的。
    this.camera.updateUpVectorFromRotation = true;
    this.camera.rotation.set(this.look.pitch, this.look.yaw, 0);
    scene.clearColor = new Color4(0, 0, 0, 1);

    const ip = scene.imageProcessingConfiguration;
    ip.vignetteEnabled = true;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.vignetteStretch = 0.6;
    ip.contrast = 1.12;
    ip.exposure = 1.04;

    this.pipeline = new DefaultRenderingPipeline('fx', false, scene, [this.camera]);
    this.pipeline.samples = 4;
    this.pipeline.fxaaEnabled = true;
    this.pipeline.grainEnabled = true;
    this.pipeline.grain.intensity = 5;
    this.pipeline.grain.animated = true;
    this.pipeline.chromaticAberrationEnabled = true;
    this.pipeline.chromaticAberration.aberrationAmount = 0;
    this.pipeline.chromaticAberration.radialIntensity = 0.8;
    this.pipeline.imageProcessingEnabled = true;
  }

  /** 玩家想看的俯仰角（度，正 = 低头）。视线状态就是从这里读出来的。 */
  get pitchDeg(): number { return this.look.pitch / DEG; }

  /** 鼠标增量（Pointer Lock 下的 movementX / movementY）。 */
  addLook(dx: number, dy: number): void {
    if (this.forced || this.phoneOut) return;
    this.look.yaw += dx * 0.0022;
    this.look.pitch = clamp(this.look.pitch + dy * 0.0022, PITCH_MIN, PITCH_MAX);
    this.look.yaw = clamp(this.look.yaw, FACING_BOARD - YAW_RANGE, FACING_BOARD + YAW_RANGE);
  }

  forward(): Vector3 {
    return this.camera.getDirection(Vector3.Forward());
  }

  up(): Vector3 {
    return this.camera.getDirection(Vector3.Up());
  }

  /** 视线是否落在某个点上（直视判定的容差是角度）。 */
  isAimingAt(point: Vector3, toleranceDeg: number): boolean {
    const to = point.subtract(this.camera.position).normalize();
    return Vector3.Dot(this.forward(), to) >= Math.cos(toleranceDeg * DEG);
  }

  /** 掏出手机 = 低头看腿；收起 = 回到卷子上（不会一收起就变成抬头张望）。 */
  setPhoneOut(out: boolean): void {
    if (out === this.phoneOut) return;
    this.phoneOut = out;
    this.look = out ? { yaw: FACING_BOARD, pitch: PHONE_PITCH } : { yaw: FACING_BOARD, pitch: START_PITCH };
  }

  /** 被抓的那一下：镜头被扭到 target 上，松开以前鼠标不管用。 */
  forceLook(target: Vector3 | null): void {
    this.forced = target ? target.clone() : null;
  }

  /** 回到低头看卷子的姿势。 */
  resetToPaper(): void {
    this.look = { yaw: FACING_BOARD, pitch: START_PITCH };
  }

  /** 一次冲击：抖动、推近（FOV 变窄）、色散。 */
  kick(shake: number, fov: number, aberration: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, shake);
    this.fovKick = Math.max(this.fovKick, fov);
    this.aberration = Math.max(this.aberration, aberration);
  }

  update(dt: number, gaze: GazeStateMachine, threat: Threat): void {
    this.time += dt;
    let yaw = this.look.yaw;
    let pitch = this.look.pitch;
    if (this.forced) {
      const d = this.forced.subtract(this.camera.position);
      yaw = Math.atan2(d.x, d.z);
      pitch = Math.atan2(-d.y, Math.hypot(d.x, d.z));
    }
    const k = 1 - Math.exp(-dt * (this.forced ? 28 : 12));
    this.base.yaw += wrapAngle(yaw - this.base.yaw) * k;
    this.base.pitch += (pitch - this.base.pitch) * k;
    if (this.forced) {
      this.look.yaw = this.base.yaw;
      this.look.pitch = clamp(this.base.pitch, PITCH_MIN, PITCH_MAX);
    }

    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.6);
    this.fovKick = Math.max(0, this.fovKick - dt * 1.2);
    this.aberration = Math.max(0, this.aberration - dt * 1.5);
    const s = this.shakeAmount * this.shakeAmount * 0.05;
    this.camera.rotation.set(
      this.base.pitch + Math.sin(this.time * 71) * s,
      this.base.yaw + Math.sin(this.time * 53 + 1.3) * s,
      Math.sin(this.time * 37) * s * 0.6,
    );
    this.phoneZoom += ((this.phoneOut ? 1 : 0) - this.phoneZoom) * (1 - Math.exp(-dt * 7));
    this.camera.fov = (BASE_FOV + (PHONE_FOV - BASE_FOV) * this.phoneZoom) * (1 - 0.22 * this.fovKick);

    // 被看着的压力：边缘由外向内收拢；她越起疑越紧；她暴怒时发红。
    let want = gaze.state === GazeState.LookingAround ? 2.2 : gaze.state === GazeState.Phone ? 3.5 : 1.2;
    if (gaze.activeGaze === GazeKind.Teacher) want += Math.min(3, gaze.activeGazeSeconds);
    if (threat.watched) want += 1.2;
    want += threat.suspicion * 3.5 + gaze.exposure * 1.5 + threat.rage * 4;
    this.vignette += (want - this.vignette) * (1 - Math.exp(-dt * 6));
    const ip = this.scene.imageProcessingConfiguration;
    ip.vignetteWeight = this.vignette;
    ip.vignetteColor = new Color4(0.35 * threat.rage, 0, 0, 0);
    this.pipeline.chromaticAberration.aberrationAmount = 60 * this.aberration + 6 * threat.rage;
    this.pipeline.grain.intensity = 5 + 30 * this.aberration + 8 * threat.suspicion;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
