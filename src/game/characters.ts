import { Color3, Mesh, PointLight, StandardMaterial, TransformNode, Vector3, type Scene } from '@babylonjs/core';
import { DeterministicRng, wrapAngle } from '../core';
import { bone, flatMaterial, hex, Kit, mixColor, vertexColorMaterial, type V3 } from './lowpoly';

function pick<T>(rng: DeterministicRng, list: readonly T[]): T {
  return list[rng.next(list.length)]!;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function ease(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}

const WHITE = hex('#f2f2ec');
const BLUE = hex('#2e5ea8');
const NAVY = hex('#262f4a');
const SHOE = hex('#f5f5f2');
const SOLE = hex('#9aa2ac');
const DARK = hex('#171313');
const BLUSH = hex('#f39ca2');
const LIP = hex('#9c3b3b');
const PEN = hex('#2b2b33');
const SHINE = hex('#ffffff');
const SKIN = ['#f6d3b3', '#eec39f', '#f9dcc4', '#e6b995'] as const;
const HAIR = ['#1b1717', '#261d1a', '#322520', '#121114'] as const;
const TIE = ['#e0566b', '#f0b030', '#4fa8d8', '#8a6ad0', '#46b37a'] as const;

// ───────────────────────────── 学生 ─────────────────────────────

export interface StudentMesh {
  readonly body: Mesh;
  /** 头单独一个网格，转轴在脖子上：点名的时候全班可以一起慢慢回头。 */
  readonly head: Mesh;
  /** 脖子（头的转轴），世界坐标。 */
  readonly neck: Vector3;
}

type StudentPose = 'write' | 'think' | 'slump';

/**
 * 坐在椅子上答题的学生。朝 +Z 建模（右手在 +X），root 整体转到面向黑板。
 * seatX / seatZ 是椅面中心；课桌在前方 0.45 m，桌面高 0.765。
 */
export function buildStudent(
  scene: Scene, material: StandardMaterial, seatX: number, seatZ: number, yaw: number, rng: DeterministicRng, index: number,
): StudentMesh {
  const name = 'student.' + index;
  const kit = new Kit(scene, name);
  const headKit = new Kit(scene, name + '.head');
  const root = bone(scene, name + '.root', null, [seatX, 0, seatZ], [0, yaw, 0]);
  const girl = rng.nextFloat() < 0.5;
  const skin = hex(pick(rng, SKIN));
  const hair = hex(pick(rng, HAIR));
  const roll = rng.nextFloat();
  const pose: StudentPose = roll < 0.62 ? 'write' : roll < 0.87 ? 'think' : 'slump';
  const lean = 0.3 + rng.nextFloat() * 0.16 + (pose === 'slump' ? 0.3 : 0);

  // 胯、腿、鞋：坐在椅面上，小腿垂到地面。
  kit.ball(NAVY, [0.34, 0.2, 0.3], [0, 0.54, 0.02], undefined, root);
  for (const s of [-1, 1]) {
    const knee: V3 = [s * 0.1, 0.53, 0.36];
    const ankle: V3 = [s * 0.105, 0.1, 0.4];
    kit.limb(NAVY, 0.072, [s * 0.09, 0.54, 0.02], knee, root);
    kit.limb(NAVY, 0.06, knee, ankle, root);
    kit.box(WHITE, [0.014, 0.34, 0.014], [s * 0.163, 0.32, 0.385], [-0.09, 0, 0], root);
    kit.ball(SHOE, [0.12, 0.08, 0.21], [s * 0.105, 0.045, 0.45], undefined, root);
    kit.box(SOLE, [0.115, 0.022, 0.2], [s * 0.105, 0.011, 0.45], undefined, root);
  }

  // 校服上衣：白身、蓝肩、藏青立领、拉链。
  const spine = bone(scene, name + '.spine', root, [0, 0.56, 0], [lean, 0, 0]);
  kit.capsule(WHITE, 0.5, 0.16, [0, 0.24, 0], undefined, spine, [1.05, 1, 0.74]);
  kit.ball(BLUE, [0.37, 0.16, 0.27], [0, 0.42, -0.005], undefined, spine);
  kit.torus(NAVY, 0.16, 0.04, [0, 0.49, 0], undefined, spine);
  kit.box(hex('#c3c7cf'), [0.012, 0.3, 0.012], [0, 0.29, 0.117], undefined, spine);

  const neck = bone(scene, name + '.neck', spine, [0, 0.49, 0]);
  kit.cyl(skin, 0.085, 0.095, 0.09, [0, 0.03, 0], undefined, neck);
  const tilt = pose === 'slump' ? 0.55 : 0.28 + rng.nextFloat() * 0.22;
  const turn = (rng.nextFloat() - 0.5) * 0.3;
  const tip = pose === 'think' ? 0.22 : (rng.nextFloat() - 0.5) * 0.16;
  const head = bone(scene, name + '.headbone', neck, [0, 0.06, 0.005], [tilt, turn, tip]);
  buildStudentHead(headKit, head, skin, hair, girl, rng);

  // 手臂：从肩到肘到手，手落在桌面（0.765）上。
  root.computeWorldMatrix(true);
  const toRoot = root.getWorldMatrix().clone().invert();
  const local = (node: TransformNode, p: V3): V3 => {
    node.computeWorldMatrix(true);
    const v = Vector3.TransformCoordinates(Vector3.TransformCoordinates(new Vector3(p[0], p[1], p[2]), node.getWorldMatrix()), toRoot);
    return [v.x, v.y, v.z];
  };
  spine.computeWorldMatrix(true);
  neck.computeWorldMatrix(true);
  const arm = (s: number, elbow: V3, hand: V3, flat: boolean): void => {
    const shoulder = local(spine, [s * 0.2, 0.41, 0]);
    kit.limb(BLUE, 0.056, shoulder, elbow, root);
    kit.limb(BLUE, 0.05, elbow, hand, root);
    kit.ball(skin, flat ? [0.085, 0.045, 0.1] : [0.075, 0.07, 0.08], hand, undefined, root);
  };
  if (pose === 'slump') {
    arm(1, [0.26, 0.795, 0.3], [-0.05, 0.81, 0.42], true);
    arm(-1, [-0.26, 0.795, 0.3], [0.05, 0.815, 0.44], true);
  } else {
    arm(1, [0.23, 0.79, 0.29], [0.075, 0.8, 0.52], false);
    kit.cyl(PEN, 0.012, 0.01, 0.15, [0.09, 0.83, 0.55], [0.75, 0, 0.45], root, 6);
    if (pose === 'think') {
      const chin = local(head, [0, 0.0, 0.08]);
      arm(-1, [-0.11, 0.8, 0.31], [chin[0] - 0.01, chin[1] - 0.04, chin[2]], false);
    } else {
      arm(-1, [-0.24, 0.79, 0.3], [-0.13, 0.785, 0.5], true);
    }
  }

  head.computeWorldMatrix(true);
  const pivot = head.getAbsolutePosition().clone();
  const body = kit.merge(name, material);
  const headMesh = headKit.merge(name + '.head', material);
  headMesh.setPivotPoint(pivot);
  root.dispose();
  return { body, head: headMesh, neck: pivot };
}

function buildStudentHead(kit: Kit, head: TransformNode, skin: Color3, hair: Color3, girl: boolean, rng: DeterministicRng): void {
  kit.ball(skin, [0.3, 0.29, 0.29], [0, 0.14, 0.01], undefined, head, 10);
  for (const s of [-1, 1]) {
    kit.ball(skin, [0.045, 0.065, 0.035], [s * 0.148, 0.135, 0], undefined, head, 6);
    kit.ball(DARK, [0.034, 0.046, 0.02], [s * 0.058, 0.14, 0.148], undefined, head, 6);
    kit.ball(SHINE, [0.012, 0.012, 0.006], [s * 0.052 + 0.004, 0.152, 0.158], undefined, head, 4);
    kit.ball(BLUSH, [0.05, 0.022, 0.01], [s * 0.092, 0.105, 0.122], undefined, head, 6);
  }
  kit.ball(mixColor(skin, DARK, 0.08), [0.03, 0.025, 0.025], [0, 0.115, 0.154], undefined, head, 6);
  kit.box(LIP, [0.035, 0.008, 0.01], [0, 0.075, 0.142], undefined, head);
  kit.ball(hair, [0.322, 0.312, 0.322], [0, 0.158, -0.012], [-0.4, 0, 0], head, 10, 0.6);
  if (girl) {
    kit.ball(hair, [0.27, 0.085, 0.1], [0, 0.232, 0.108], [0.3, 0, 0], head, 8);
    if (rng.nextFloat() < 0.6) {
      kit.capsule(hair, 0.24, 0.05, [0, 0.12, -0.19], [0.5, 0, 0], head);
      kit.torus(hex(pick(rng, TIE)), 0.07, 0.024, [0, 0.21, -0.172], [0.5 + Math.PI / 2, 0, 0], head, 10);
    } else {
      for (const s of [-1, 1]) kit.box(hair, [0.05, 0.19, 0.24], [s * 0.152, 0.1, -0.015], undefined, head);
      kit.box(hair, [0.3, 0.2, 0.06], [0, 0.1, -0.135], undefined, head);
    }
  } else {
    kit.box(hair, [0.25, 0.055, 0.075], [0, 0.238, 0.112], [0.32, 0, 0], head);
    if (rng.nextFloat() < 0.5) kit.ball(hair, [0.05, 0.08, 0.04], [0.03, 0.315, -0.02], [0.3, 0, 0.4], head, 6);
  }
  if (rng.nextFloat() < 0.28) {
    for (const s of [-1, 1]) kit.torus(DARK, 0.072, 0.009, [s * 0.058, 0.14, 0.162], [Math.PI / 2, 0, 0], head, 12);
    kit.box(DARK, [0.03, 0.007, 0.007], [0, 0.145, 0.166], undefined, head);
  }
}

// ───────────────────────────── 监考老师 ─────────────────────────────

export interface TeacherPose {
  x: number;
  z: number;
  /** 脚下地面高度（讲台 0.18）。 */
  y: number;
  bodyYaw: number;
  /** 视线的世界 yaw。 */
  lookYaw: number;
  /** 视线俯角，正 = 低头。 */
  lookPitch: number;
  /** 米 / 秒，驱动走路循环。 */
  speed: number;
  reading: boolean;
  /** 0 = 正常巡视，1 = 暴怒。 */
  rage: number;
  /** 0..1：俯身压到学生桌前。 */
  lean: number;
}

export function idleTeacherPose(): TeacherPose {
  return { x: 0, z: -4, y: 0.18, bodyYaw: 0, lookYaw: 0, lookPitch: 0.15, speed: 0, reading: false, rage: 0, lean: 0 };
}

const T_SKIN = hex('#f1c9a5');
const T_DEAD = hex('#98a396');
const T_HAIR = hex('#141111');
const CARDIGAN = hex('#7d2635');
const BLOUSE = hex('#f5f3ee');
const SKIRT = hex('#1f1f25');
const HEELS = hex('#121012');
const RIM = hex('#6b1d24');
const BOOK = hex('#27498a');
const PAGES = hex('#ece6d6');
const BADGE_RED = hex('#c8352f');
const BUTTON = hex('#e6d4b0');
const PEARL = hex('#f4f0e8');
const TEETH = hex('#ebe6d2');
const VOID = hex('#040304');
const CLAW = hex('#2a2622');

const HIP_Y = 0.86;
const NECK_LEN = 0.08;
/** 一个完整步态周期（两步）走过的距离；0.8 m/s 时一步 0.56 s，和巡逻的脚步声对齐。 */
const STRIDE = 0.9;
const SCALE = 0.96;

/**
 * 两种形态共用一副骨架：
 *  - 巡视：酒红开衫、白衬衫、黑色及膝裙、高跟鞋、圆框眼镜、发髻，左手夹着蓝色考场记录本。
 *  - 暴怒：皮肤发灰、眼眶变成两个黑洞（红点瞳孔会发光）、嘴裂开露牙、发髻散开、
 *    眼镜歪掉、脖子拉长、头歪着抽搐、手指变成爪子、脸前一盏红光。
 */
export class TeacherModel {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  readonly glowMeshes: Mesh[] = [];

  private readonly hips: TransformNode;
  private readonly spine: TransformNode;
  private readonly neckBase: TransformNode;
  private readonly neckScale: TransformNode;
  private readonly head: TransformNode;
  private readonly glasses: TransformNode;
  private readonly shoulders: TransformNode[] = [];
  private readonly elbows: TransformNode[] = [];
  private readonly hands: TransformNode[] = [];
  private readonly thighs: TransformNode[] = [];
  private readonly shins: TransformNode[] = [];

  private readonly clothMat: StandardMaterial;
  private readonly skinMat: StandardMaterial;
  private readonly calmParts: Mesh[] = [];
  private readonly rageParts: Mesh[] = [];
  private readonly light: PointLight;

  private phase = 0;
  private walk = 0;
  private read = 0;
  private bend = 0;
  private time = 0;
  private enraged = false;

  constructor(scene: Scene) {
    this.clothMat = vertexColorMaterial(scene, 'teacher.cloth');
    this.clothMat.emissiveColor = new Color3(0.03, 0.03, 0.03);
    this.skinMat = vertexColorMaterial(scene, 'teacher.skin');
    this.skinMat.diffuseColor = T_SKIN.clone();
    const eyeMat = flatMaterial(scene, 'teacher.eyes', new Color3(1, 0.1, 0.05), new Color3(1, 0.12, 0.06));
    eyeMat.disableLighting = true;

    this.root = bone(scene, 'teacher', null, [0, 0, 0]);
    this.root.scaling.setAll(SCALE);
    this.hips = bone(scene, 'teacher.hips', this.root, [0, HIP_Y, 0]);
    this.spine = bone(scene, 'teacher.spine', this.hips, [0, 0.04, 0]);
    this.neckBase = bone(scene, 'teacher.neck', this.spine, [0, 0.52, 0]);
    this.neckScale = bone(scene, 'teacher.neck.scale', this.neckBase, [0, 0, 0]);
    this.head = bone(scene, 'teacher.head', this.neckBase, [0, NECK_LEN, 0]);
    this.glasses = bone(scene, 'teacher.glasses', this.head, [0, 0.172, 0.168]);

    const white = Color3.White();
    const k = new Kit(scene, 'teacher.part');

    // 腿：裙子下面露出小腿，高跟鞋鞋跟翘起。
    for (const s of [-1, 1]) {
      const thigh = bone(scene, 'teacher.thigh' + s, this.hips, [s * 0.095, -0.02, 0]);
      const shin = bone(scene, 'teacher.shin' + s, thigh, [0, -0.41, 0]);
      const foot = bone(scene, 'teacher.foot' + s, shin, [0, -0.4, 0]);
      this.thighs.push(thigh);
      this.shins.push(shin);
      k.capsule(white, 0.43, 0.068, [0, -0.2, 0]);
      this.attach(k, thigh, this.skinMat);
      k.capsule(white, 0.42, 0.055, [0, -0.2, 0]);
      this.attach(k, shin, this.skinMat);
      k.box(HEELS, [0.08, 0.05, 0.19], [0, 0.02, 0.05], [0.2, 0, 0]);
      k.box(HEELS, [0.022, 0.07, 0.022], [0, 0.005, -0.035]);
      this.attach(k, foot, this.clothMat);
    }

    // 裙子 + 腰带。
    k.cyl(SKIRT, 0.33, 0.42, 0.46, [0, -0.2, 0], undefined, undefined, 12);
    k.cyl(DARK, 0.335, 0.335, 0.035, [0, 0.035, 0], undefined, undefined, 12);
    this.attach(k, this.hips, this.clothMat);

    // 上身：开衫、白衬衫领口、扣子、胸前的监考证。
    k.capsule(CARDIGAN, 0.58, 0.17, [0, 0.26, 0], undefined, undefined, [1.06, 1, 0.72]);
    k.box(BLOUSE, [0.1, 0.17, 0.02], [0, 0.4, 0.116], [-0.12, 0, 0]);
    for (const s of [-1, 1]) {
      k.box(BLOUSE, [0.07, 0.035, 0.05], [s * 0.045, 0.5, 0.1], [0.3, 0, s * 0.5]);
      k.ball(CARDIGAN, [0.15, 0.13, 0.15], [s * 0.19, 0.46, 0], undefined, undefined, 8);
    }
    for (let i = 0; i < 3; i++) k.ball(BUTTON, [0.022, 0.022, 0.012], [0.03, 0.3 - i * 0.08, 0.124], undefined, undefined, 4);
    k.box(BLOUSE, [0.065, 0.09, 0.006], [-0.07, 0.27, 0.126]);
    k.box(BADGE_RED, [0.065, 0.022, 0.007], [-0.07, 0.306, 0.127]);
    k.box(BADGE_RED, [0.008, 0.2, 0.006], [-0.1, 0.41, 0.118], [0, 0, 0.35]);
    k.box(BADGE_RED, [0.008, 0.2, 0.006], [-0.04, 0.41, 0.12], [0, 0, -0.25]);
    this.attach(k, this.spine, this.clothMat);

    // 手臂。左手夹着考场记录本。
    for (const s of [-1, 1]) {
      const shoulder = bone(scene, 'teacher.shoulder' + s, this.spine, [s * 0.2, 0.46, 0]);
      const elbow = bone(scene, 'teacher.elbow' + s, shoulder, [0, -0.27, 0]);
      const hand = bone(scene, 'teacher.hand' + s, elbow, [0, -0.25, 0]);
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);
      this.hands.push(hand);
      k.capsule(CARDIGAN, 0.3, 0.058, [0, -0.13, 0]);
      this.attach(k, shoulder, this.clothMat);
      k.capsule(CARDIGAN, 0.27, 0.05, [0, -0.12, 0]);
      k.cyl(BLOUSE, 0.1, 0.1, 0.03, [0, -0.235, 0]);
      this.attach(k, elbow, this.clothMat);
      k.ball(white, [0.075, 0.09, 0.06], [0, -0.03, 0], undefined, undefined, 6);
      k.ball(white, [0.03, 0.045, 0.03], [-s * 0.03, -0.01, 0.025], undefined, undefined, 4);
      this.attach(k, hand, this.skinMat);
      for (let i = 0; i < 4; i++) k.cyl(CLAW, 0.004, 0.014, 0.1, [-0.024 + i * 0.016, -0.11, 0.01], [0.25, 0, 0], undefined, 5);
      this.rageParts.push(this.attach(k, hand, this.clothMat));
      if (s < 0) {
        k.box(BOOK, [0.03, 0.29, 0.21], [0.045, -0.06, 0.03]);
        k.box(PAGES, [0.024, 0.28, 0.2], [0.047, -0.06, 0.035]);
        this.attach(k, hand, this.clothMat);
      }
    }

    // 脖子（暴怒时会被拉长）+ 头。
    k.cyl(white, 0.085, 0.095, NECK_LEN + 0.04, [0, NECK_LEN / 2, 0], undefined, undefined, 8);
    this.attach(k, this.neckScale, this.skinMat);

    k.ball(white, [0.33, 0.34, 0.32], [0, 0.16, 0.01], undefined, undefined, 10);
    k.ball(white, [0.032, 0.03, 0.03], [0, 0.135, 0.17], undefined, undefined, 6);
    for (const s of [-1, 1]) k.ball(white, [0.04, 0.06, 0.03], [s * 0.163, 0.155, 0], undefined, undefined, 6);
    this.attach(k, this.head, this.skinMat);

    k.ball(T_HAIR, [0.35, 0.35, 0.34], [0, 0.18, -0.012], [-0.35, 0, 0], undefined, 10, 0.6);
    for (const s of [-1, 1]) k.ball(PEARL, [0.018, 0.018, 0.018], [s * 0.166, 0.118, 0.006], undefined, undefined, 4);
    this.attach(k, this.head, this.clothMat);

    // 巡视时的脸：细眼、严肃的眉、抿着的嘴、侧分刘海、脑后的发髻。
    for (const s of [-1, 1]) {
      k.ball(DARK, [0.028, 0.034, 0.018], [s * 0.062, 0.168, 0.158], undefined, undefined, 6);
      k.box(DARK, [0.06, 0.012, 0.012], [s * 0.062, 0.215, 0.16], [0, 0, s * 0.12]);
    }
    k.box(hex('#8a3a3a'), [0.06, 0.012, 0.012], [0, 0.09, 0.155]);
    k.ball(T_HAIR, [0.22, 0.07, 0.09], [0.035, 0.27, 0.118], [0.45, 0, -0.22], undefined, 8);
    k.ball(T_HAIR, [0.15, 0.14, 0.13], [0, 0.25, -0.17], undefined, undefined, 8);
    k.box(RIM, [0.1, 0.022, 0.02], [0, 0.28, -0.14], [0.6, 0, 0]);
    this.calmParts.push(this.attach(k, this.head, this.clothMat));

    // 暴怒的脸：黑洞眼眶、裂开的嘴和牙、倒竖的眉、散开的头发。
    for (const s of [-1, 1]) {
      k.ball(VOID, [0.075, 0.09, 0.03], [s * 0.062, 0.165, 0.157], undefined, undefined, 8);
      k.box(DARK, [0.07, 0.016, 0.014], [s * 0.06, 0.212, 0.163], [0, 0, s * 0.5]);
    }
    k.ball(VOID, [0.085, 0.13, 0.03], [0, 0.065, 0.148], undefined, undefined, 8);
    for (let i = 0; i < 4; i++) {
      k.box(TEETH, [0.013, 0.02, 0.01], [-0.027 + i * 0.018, 0.118, 0.158]);
      k.box(TEETH, [0.013, 0.018, 0.01], [-0.027 + i * 0.018, 0.014, 0.155]);
    }
    const strands: [number, number, number][] = [[-0.14, 0.09, -0.14], [-0.085, 0.13, -0.05], [0.1, 0.125, -0.08], [0.15, 0.08, -0.18], [-0.1, -0.13, -0.3], [0.02, -0.15, -0.32], [0.12, -0.12, -0.28]];
    for (const [x, z, bottom] of strands) k.limb(T_HAIR, 0.016, [x, 0.26, z], [x * 1.25, bottom, z * 1.1], undefined);
    this.rageParts.push(this.attach(k, this.head, this.clothMat));

    for (const s of [-1, 1]) k.ball(Color3.White(), [0.022, 0.022, 0.012], [s * 0.062, 0.16, 0.172], undefined, undefined, 6);
    const pupils = this.attach(k, this.head, eyeMat);
    this.rageParts.push(pupils);
    this.glowMeshes.push(pupils);

    // 圆框眼镜挂在单独的节点上：暴怒时歪掉。
    for (const s of [-1, 1]) {
      k.torus(RIM, 0.082, 0.011, [s * 0.062, 0, 0], [Math.PI / 2, 0, 0], undefined, 12);
      k.box(RIM, [0.008, 0.008, 0.17], [s * 0.158, 0.004, -0.08]);
    }
    k.box(RIM, [0.04, 0.008, 0.008], [0, 0.008, 0]);
    this.attach(k, this.glasses, this.clothMat);

    this.light = new PointLight('teacher.rage', new Vector3(0, 0.12, 0.45), scene);
    this.light.parent = this.head;
    this.light.diffuse = new Color3(1, 0.16, 0.08);
    this.light.specular = Color3.Black();
    this.light.range = 3.5;
    this.light.intensity = 0;
    this.showRage(false);
  }

  private attach(kit: Kit, node: TransformNode, material: StandardMaterial): Mesh {
    const mesh = kit.merge(node.name + '.mesh' + this.meshes.length, material);
    mesh.parent = node;
    this.meshes.push(mesh);
    return mesh;
  }

  private showRage(on: boolean): void {
    this.enraged = on;
    for (const m of this.calmParts) m.setEnabled(!on);
    for (const m of this.rageParts) m.setEnabled(on);
  }

  setVisible(visible: boolean): void {
    this.root.setEnabled(visible);
  }

  /** snap：跳过缓动直接摆到位（闪现那一帧用）。 */
  update(dt: number, p: TeacherPose, snap = false): void {
    this.time += dt;
    const rage = clamp(p.rage, 0, 1);
    if (rage >= 0.5 !== this.enraged) this.showRage(rage >= 0.5);

    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.bodyYaw;

    if (snap) {
      this.walk = clamp(p.speed / 0.8, 0, 1);
      this.read = p.reading ? 1 : 0;
      this.bend = clamp(p.lean, 0, 1);
    } else {
      this.walk = ease(this.walk, clamp(p.speed / 0.8, 0, 1), 8, dt);
      this.read = ease(this.read, p.reading ? 1 : 0, 4, dt);
      this.bend = ease(this.bend, clamp(p.lean, 0, 1), 6, dt);
    }
    this.phase = (this.phase + dt * (p.speed / STRIDE) * Math.PI * 2) % (Math.PI * 2);
    const w = this.walk;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);

    // 走路：大腿前后摆，摆腿时膝盖弯，胯随步子起伏，肩膀反向扭。
    this.hips.position.y = HIP_Y - 0.022 * w * Math.abs(s);
    const swing = 0.34 * w;
    this.thighs[0]!.rotation.x = -s * swing;
    this.thighs[1]!.rotation.x = s * swing;
    this.shins[0]!.rotation.x = Math.max(0, -c) * 0.6 * w;
    this.shins[1]!.rotation.x = Math.max(0, c) * 0.6 * w;
    const lean = 0.03 + 0.2 * rage + 0.9 * this.bend;
    this.spine.rotation.set(lean, 0.07 * s * w, 0);

    // 手臂：走路反向摆；左手读记录本；暴怒时双臂朝前伸、微微张开。
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const walkSwing = (i === 0 ? 0.12 : -0.3) * s * w;
      let shoulderX = walkSwing;
      let elbowX = -0.2;
      let handX = 0;
      if (i === 0) {
        shoulderX = lerp(shoulderX, -0.5, this.read);
        elbowX = lerp(elbowX, -1.5, this.read);
        handX = lerp(0, 0.6, this.read);
      }
      shoulderX = lerp(shoulderX, -0.95, rage * 0.85);
      elbowX = lerp(elbowX, -0.35, rage);
      this.shoulders[i]!.rotation.set(shoulderX, 0, side * 0.2 * rage);
      this.elbows[i]!.rotation.x = elbowX;
      this.hands[i]!.rotation.x = handX;
    }

    // 脖子与头：暴怒时脖子拉长、头歪向一边还在抽。
    const stretch = 1 + 1.6 * rage;
    this.neckScale.scaling.y = stretch;
    this.head.position.y = NECK_LEN * stretch;
    const rel = clamp(wrapAngle(p.lookYaw - p.bodyYaw), -1.35, 1.35);
    this.neckBase.rotation.y = rel * 0.35;
    const twitch = rage * (Math.sin(this.time * 23) * 0.04 + Math.sin(this.time * 37.3) * 0.03);
    const pitch = clamp(p.lookPitch - lean + this.read * 0.5, -0.6 - 0.8 * rage, 1.1);
    this.head.rotation.set(pitch + twitch * 0.5, rel * 0.65, 0.45 * rage + twitch);
    this.glasses.rotation.z = 0.28 * rage + twitch * 0.6;
    this.glasses.position.y = 0.172 - 0.018 * rage;

    this.skinMat.diffuseColor = mixColor(T_SKIN, T_DEAD, rage);
    this.clothMat.diffuseColor = mixColor(Color3.White(), hex('#8d8484'), rage);
    this.light.intensity = rage * (2.2 + Math.sin(this.time * 17) * 0.35);
  }

  /** 脸（两眼之间）的世界坐标。 */
  faceWorld(out: Vector3 = new Vector3()): Vector3 {
    this.root.computeWorldMatrix(true);
    for (const n of [this.hips, this.spine, this.neckBase, this.head]) n.computeWorldMatrix(true);
    Vector3.TransformCoordinatesToRef(new Vector3(0, 0.16, 0.12), this.head.getWorldMatrix(), out);
    return out;
  }

  /** 把整个人平移到让脸正好落在 target 上（死亡时的脸部冲镜）。 */
  placeFaceAt(target: Vector3): void {
    const face = this.faceWorld();
    this.root.position.addInPlace(target.subtract(face));
    this.root.computeWorldMatrix(true);
  }
}
