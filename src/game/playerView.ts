import { Color4, MeshBuilder, StandardMaterial, Color3, UniversalCamera, Vector3, type Mesh, type Scene } from '@babylonjs/core';
import { GazeKind, GazeState, type GazeStateMachine } from '../core';

const DEG = Math.PI / 180;
/** 坐着面朝黑板（-Z）。 */
const FACING_BOARD = Math.PI;

interface Pose { yaw: number; pitch: number }

/**
 * 2.1 三态视线的镜头：卷子 = 低头看桌面；环视 = 鼠标自由看、视野收窄成管道；手机 = 只剩屏幕。
 * 管道视野先用 image processing 的暗角顶着，M1 换成边缘扭曲 / 滞后的自定义后处理。
 */
export class PlayerView {
  readonly camera: UniversalCamera;
  readonly phone: Mesh;
  private look: Pose = { yaw: FACING_BOARD, pitch: 5 * DEG };
  private readonly paperPose: Pose = { yaw: FACING_BOARD, pitch: 58 * DEG };
  private readonly phonePose: Pose = { yaw: FACING_BOARD + 12 * DEG, pitch: 48 * DEG };
  private vignette = 0;

  constructor(private readonly scene: Scene, eye: Vector3) {
    this.camera = new UniversalCamera('eye', eye.clone(), scene);
    this.camera.minZ = 0.02;
    this.camera.fov = 70 * DEG;
    this.camera.inputs.clear();
    this.camera.rotation.set(this.paperPose.pitch, this.paperPose.yaw, 0);
    scene.clearColor = new Color4(0, 0, 0, 1);

    this.phone = MeshBuilder.CreateBox('phone', { width: 0.05, height: 0.1, depth: 0.012 }, scene);
    const screen = new StandardMaterial('phone.screen', scene);
    screen.diffuseColor = Color3.Black();
    screen.emissiveColor = new Color3(0.95, 0.55, 0.15);
    this.phone.material = screen;
    this.phone.parent = this.camera;
    this.phone.position.set(0.03, -0.02, 0.22);
    this.phone.rotation.x = -20 * DEG;
    this.phone.setEnabled(false);

    const ip = scene.imageProcessingConfiguration;
    ip.vignetteEnabled = true;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.vignetteStretch = 0.6;
  }

  /** 环视时的鼠标增量（Pointer Lock 下的 movementX / movementY）。 */
  addLook(dx: number, dy: number): void {
    this.look.yaw += dx * 0.0022;
    this.look.pitch = clamp(this.look.pitch + dy * 0.0022, -40 * DEG, 70 * DEG);
    this.look.yaw = clamp(this.look.yaw, FACING_BOARD - 165 * DEG, FACING_BOARD + 165 * DEG);
  }

  forward(): Vector3 {
    return this.camera.getDirection(Vector3.Forward());
  }

  /** 视线是否落在某个点上（直视判定的容差是角度）。 */
  isAimingAt(point: Vector3, toleranceDeg: number): boolean {
    const to = point.subtract(this.camera.position).normalize();
    return Vector3.Dot(this.forward(), to) >= Math.cos(toleranceDeg * DEG);
  }

  update(dt: number, gaze: GazeStateMachine): void {
    const target = gaze.state === GazeState.LookingAround ? this.look : gaze.state === GazeState.Phone ? this.phonePose : this.paperPose;
    const k = 1 - Math.exp(-dt * 12);
    this.camera.rotation.x += (target.pitch - this.camera.rotation.x) * k;
    this.camera.rotation.y += (target.yaw - this.camera.rotation.y) * k;
    this.phone.setEnabled(gaze.state === GazeState.Phone);

    // 师视的视觉线索：边缘由外向内收拢，随注视时长加深。
    let want = gaze.state === GazeState.LookingAround ? 9 : gaze.state === GazeState.Phone ? 14 : 1.2;
    if (gaze.activeGaze === GazeKind.Teacher) want += Math.min(6, gaze.activeGazeSeconds * 2);
    want += gaze.exposure * 3;
    this.vignette += (want - this.vignette) * (1 - Math.exp(-dt * 6));
    this.scene.imageProcessingConfiguration.vignetteWeight = this.vignette;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
