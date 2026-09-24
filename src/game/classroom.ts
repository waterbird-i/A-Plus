import {
  Color3, DirectionalLight, DynamicTexture, GlowLayer, HemisphericLight, Mesh, MeshBuilder, ShadowGenerator,
  StandardMaterial, TransformNode, Vector3, type AbstractMesh, type Scene,
} from '@babylonjs/core';
import { ClassroomLayout, DeterministicRng, wrapAngle, yawTo, type StringTable } from '../core';
import { buildStudent, type StudentMesh } from './characters';
import { bone, flatMaterial, hex, Kit, vertexColorMaterial } from './lowpoly';
import { drawBlackboard, drawBoardNewspaper, drawClockFace, drawRules, drawSky, terrazzoTexture } from './roomTextures';

/** 每帧喂给教室的东西。 */
export interface RoomFrame {
  /** 挂钟上的时刻（从午夜起的分钟数）。 */
  wallClockMinutes: number;
  /** 0..1：灯光（被抓前那一下跳闸就是把它拉到 0）。 */
  lights: number;
  /** 0..1：全班慢慢回头看你。 */
  stare: number;
  /** 玩家眼睛（回头看的目标）。 */
  eye: Vector3;
}

const C = {
  wall: hex('#efe6cf'), wainscot: hex('#6aa283'), trim: hex('#3f7a5a'), ceiling: hex('#f3f0e8'),
  frame: hex('#cfd5d8'), sill: hex('#e9e5dc'), curtain: hex('#8dbde0'), curtainDark: hex('#76a8cf'), rail: hex('#9aa3a9'),
  door: hex('#8f4b36'), doorFrame: hex('#6b3526'), doorGlass: hex('#2c3a44'), metal: hex('#b9bec2'),
  deskTop: hex('#e8c089'), deskBox: hex('#c9996a'), steel: hex('#46597a'), seat: hex('#dba86b'),
  paper: hex('#f4f1e8'), podium: hex('#a8784e'), podiumEdge: hex('#7e5636'),
  lectern: hex('#9a6a43'), lecternTop: hex('#c28f5f'), lecternPanel: hex('#86583a'),
  boardFrame: hex('#aab1b6'), flag: hex('#d7261e'), star: hex('#ffd83a'), speaker: hex('#b07a4a'), grille: hex('#3b2c24'),
  handle: hex('#5b6770'), bin: hex('#3a78c2'), broom: hex('#c9a15e'), bristle: hex('#6b5a3e'),
  fixture: hex('#e4e7e8'), fan: hex('#e8ecec'), fanBlade: hex('#d6e3dc'), clockRim: hex('#2a2a2e'),
  trunk: hex('#6b4f3a'), navy: hex('#262f4a'), shoe: hex('#f5f5f2'), red: hex('#c8352f'), white: hex('#f7f7f2'),
};
const LOCKERS = [hex('#9ccbe6'), hex('#f1e2bd')];
const LEAVES = [hex('#4f9a55'), hex('#3f8547'), hex('#5aa85c')];
const CASES = ['#e26d5a', '#4f8fd6', '#f2c14e', '#7cc47f', '#b77ad6', '#f08fb0'].map(hex);
const BOOKS = ['#d9534f', '#5b8def', '#f0ad4e', '#5cb85c', '#9b59b6', '#ecf0f1'].map(hex);
const BOTTLES = ['#79c7e3', '#f5a3b5', '#b7e07f'].map(hex);
const CHALK = ['#ffffff', '#fff3a6', '#ffc2d1'].map(hex);

const WINDOWS = [-2.6, 0, 2.6];
const WIN_W = 1.8;
const SILL = 0.9;
const WIN_TOP = 2.5;
const FANS: [number, number][] = [[-1.6, -1.0], [1.6, 0.6]];
const FAN_RPS = 0.7;

/**
 * 教室（参考 How to Fish 的低多边形：大色块、圆钝、没有描边，光影靠一盏从窗外斜射进来的太阳）。
 * 黑板在 -Z，窗在 +X（玩家的左手边），门在 -X。所有尺寸来自 core 的 ClassroomLayout ——
 * 老师的巡逻路线和这里的桌椅用的是同一套数。
 */
export class Classroom {
  readonly eye: Vector3;
  readonly desk: Vector3;
  readonly anomalySpots: Vector3[];
  readonly material: StandardMaterial;
  readonly shadows: ShadowGenerator;
  readonly glow: GlowLayer;
  readonly students: StudentMesh[] = [];

  private readonly hemi: HemisphericLight;
  private readonly sun: DirectionalLight;
  private readonly tubeMat: StandardMaterial;
  private readonly skyTex: DynamicTexture;
  private readonly fans: Mesh[] = [];
  private readonly hourHand: TransformNode;
  private readonly minuteHand: TransformNode;
  private readonly boardTex: DynamicTexture;
  private readonly rulesTex: DynamicTexture;
  private stare = 0;

  constructor(scene: Scene, private readonly table: StringTable, readonly layout: ClassroomLayout = new ClassroomLayout()) {
    const L = layout;
    const W = L.width;
    const D = L.depth;
    const H = L.height;
    const x0 = -W / 2;
    const x1 = W / 2;
    const z0 = -D / 2;
    const z1 = D / 2;
    const vc = vertexColorMaterial(scene);
    this.material = vc;

    // ── 光：天光 + 窗外斜射进来的太阳（带阴影）+ 只让灯管发光的 glow。
    this.hemi = new HemisphericLight('room.fill', new Vector3(0.15, 1, -0.2), scene);
    this.hemi.intensity = 0.62;
    this.hemi.diffuse = hex('#fff8ec');
    this.hemi.groundColor = hex('#6d6a64');
    this.hemi.specular = Color3.Black();
    this.sun = new DirectionalLight('room.sun', new Vector3(-0.62, -0.68, 0.39), scene);
    this.sun.position = new Vector3(9, 10, -5.5);
    this.sun.intensity = 1.05;
    this.sun.diffuse = hex('#ffefd2');
    this.sun.specular = hex('#2a251c');
    this.shadows = new ShadowGenerator(2048, this.sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.bias = 0.0012;
    this.shadows.normalBias = 0.012;
    this.shadows.setDarkness(0.38);
    this.glow = new GlowLayer('room.glow', scene, { mainTextureRatio: 0.5, blurKernelSize: 48 });
    this.glow.intensity = 0.55;

    // ── 墙、天花、护墙板、门、窗框、窗帘。
    const T = 0.2;
    const shell = new Kit(scene, 'shell');
    shell.box(C.wall, [W + 2 * T, H, T], [0, H / 2, z0 - T / 2]);
    shell.box(C.wall, [W + 2 * T, H, T], [0, H / 2, z1 + T / 2]);
    shell.box(C.wall, [T, H, D], [x0 - T / 2, H / 2, 0]);
    let from = z0;
    for (const w of WINDOWS) {
      const a = w - WIN_W / 2;
      shell.box(C.wall, [T, H, a - from], [x1 + T / 2, H / 2, (from + a) / 2]);
      shell.box(C.wall, [T, SILL, WIN_W], [x1 + T / 2, SILL / 2, w]);
      shell.box(C.wall, [T, H - WIN_TOP, WIN_W], [x1 + T / 2, (WIN_TOP + H) / 2, w]);
      from = w + WIN_W / 2;
    }
    shell.box(C.wall, [T, H, z1 - from], [x1 + T / 2, H / 2, (from + z1) / 2]);
    shell.box(C.ceiling, [W + 2 * T, 0.1, D + 2 * T], [0, H + 0.05, 0]);

    shell.box(C.wainscot, [W, SILL, 0.02], [0, SILL / 2, z0 + 0.01]);
    shell.box(C.wainscot, [W, SILL, 0.02], [0, SILL / 2, z1 - 0.01]);
    shell.box(C.wainscot, [0.02, SILL, D], [x0 + 0.01, SILL / 2, 0]);
    shell.box(C.wainscot, [0.02, SILL, D], [x1 - 0.01, SILL / 2, 0]);
    shell.box(C.trim, [W, 0.04, 0.035], [0, SILL + 0.02, z0 + 0.017]);
    shell.box(C.trim, [W, 0.04, 0.035], [0, SILL + 0.02, z1 - 0.017]);
    shell.box(C.trim, [0.035, 0.04, D], [x0 + 0.017, SILL + 0.02, 0]);

    for (const dz of [-3.75, 3.7]) {
      shell.box(C.doorFrame, [0.08, 2.16, 1.06], [x0 + 0.03, 1.08, dz]);
      shell.box(C.door, [0.06, 2.06, 0.92], [x0 + 0.05, 1.03, dz]);
      shell.box(C.doorFrame, [0.065, 0.18, 0.92], [x0 + 0.052, 0.09, dz]);
      shell.box(C.doorGlass, [0.02, 0.44, 0.32], [x0 + 0.085, 1.55, dz]);
      shell.box(C.metal, [0.06, 0.03, 0.12], [x0 + 0.1, 1.0, dz + 0.34]);
    }

    const glassMat = new StandardMaterial('room.glass', scene);
    glassMat.diffuseColor = hex('#cfe6f2');
    glassMat.specularColor = new Color3(0.5, 0.5, 0.5);
    glassMat.alpha = 0.12;
    glassMat.backFaceCulling = false;
    shell.box(C.rail, [0.03, 0.03, D - 0.6], [x1 - 0.14, 2.64, 0]);
    for (const w of WINDOWS) {
      const fx = x1 + 0.06;
      shell.box(C.frame, [0.05, 0.05, WIN_W], [fx, SILL + 0.025, w]);
      shell.box(C.frame, [0.05, 0.05, WIN_W], [fx, WIN_TOP - 0.025, w]);
      shell.box(C.frame, [0.05, 0.04, WIN_W], [fx, 2.02, w]);
      for (const dz of [-WIN_W / 2 + 0.025, 0, WIN_W / 2 - 0.025]) shell.box(C.frame, [0.05, WIN_TOP - SILL, 0.04], [fx, (SILL + WIN_TOP) / 2, w + dz]);
      shell.box(C.sill, [0.3, 0.04, WIN_W + 0.12], [x1 - 0.05, SILL + 0.005, w]);
      for (const side of [-1, 1]) {
        const zc = w + side * (WIN_W / 2 + 0.1);
        for (let k = 0; k < 4; k++) shell.box(k % 2 ? C.curtainDark : C.curtain, [0.06, 2.0, 0.09], [x1 - 0.14 + (k % 2) * 0.025, 1.63, zc + (k - 1.5) * 0.07 * side]);
      }
      const pane = MeshBuilder.CreatePlane('room.glass.' + w, { width: WIN_W, height: WIN_TOP - SILL, sideOrientation: Mesh.DOUBLESIDE }, scene);
      pane.position.set(fx, (SILL + WIN_TOP) / 2, w);
      pane.rotation.y = Math.PI / 2;
      pane.material = glassMat;
      pane.isPickable = false;
    }

    // ── 前墙：黑板、粉笔槽、国旗、广播喇叭、考场规则。
    shell.box(C.boardFrame, [4.34, 1.39, 0.05], [0, 1.575, z0 + 0.025]);
    shell.box(C.boardFrame, [4.2, 0.03, 0.1], [0, 0.9, z0 + 0.08]);
    for (let i = 0; i < 5; i++) shell.cyl(CHALK[i % CHALK.length]!, 0.013, 0.013, 0.07, [-1.4 + i * 0.13, 0.922, z0 + 0.09], [0, 0.3 * i, Math.PI / 2], undefined, 6);
    shell.box(hex('#a0673a'), [0.15, 0.035, 0.06], [1.2, 0.93, z0 + 0.08]);
    shell.box(C.flag, [0.66, 0.44, 0.012], [0, 2.66, z0 + 0.01]);
    shell.cyl(C.star, 0.1, 0.1, 0.006, [-0.22, 2.77, z0 + 0.018], [Math.PI / 2, 0, 0], undefined, 5);
    for (const [sx, sy] of [[-0.12, 2.84], [-0.085, 2.8], [-0.085, 2.74], [-0.12, 2.7]] as const) shell.cyl(C.star, 0.035, 0.035, 0.006, [sx, sy, z0 + 0.018], [Math.PI / 2, 0, 0], undefined, 5);
    shell.box(C.speaker, [0.36, 0.26, 0.15], [2.9, 2.7, z0 + 0.075]);
    shell.box(C.grille, [0.28, 0.18, 0.01], [2.9, 2.7, z0 + 0.152]);

    this.boardTex = new DynamicTexture('tex.board', { width: 2048, height: 610 }, scene, true);
    const board = this.texturedPlane(scene, 'room.board', 4.2, 1.25, this.boardTex, new Color3(0.14, 0.14, 0.14));
    board.position.set(0, 1.575, z0 + 0.052);
    board.rotation.y = Math.PI;
    this.rulesTex = new DynamicTexture('tex.rules', { width: 512, height: 726 }, scene, true);
    this.rulesTex.hasAlpha = true;
    const rules = this.texturedPlane(scene, 'room.rules', 0.6, 0.85, this.rulesTex, new Color3(0.2, 0.2, 0.19));
    rules.position.set(-3.05, 1.55, z0 + 0.012);
    rules.rotation.y = Math.PI;

    // ── 讲台：台阶、讲桌、点名册、粉笔盒、搪瓷杯、一摞空白卷子、椅子。
    shell.box(C.podium, [3.8, L.platformHeight, L.platformDepth], [0, L.platformHeight / 2, z0 + L.platformDepth / 2]);
    shell.box(C.podiumEdge, [3.82, 0.035, 0.035], [0, L.platformHeight - 0.015, z0 + L.platformDepth]);
    const lx = L.lectern.x;
    const lz = L.lectern.z;
    const top = L.platformHeight + 0.97;
    shell.box(C.lectern, [1.2, 0.93, 0.56], [lx, L.platformHeight + 0.465, lz]);
    shell.box(C.lecternTop, [1.28, 0.04, 0.62], [lx, top - 0.02, lz]);
    shell.box(C.lecternPanel, [1.0, 0.66, 0.02], [lx, L.platformHeight + 0.47, lz + 0.285]);
    shell.box(hex('#27498a'), [0.42, 0.012, 0.3], [lx - 0.05, top + 0.006, lz]);
    for (const s of [-1, 1]) shell.box(C.paper, [0.2, 0.012, 0.28], [lx - 0.05 + s * 0.105, top + 0.014, lz], [0, 0, -s * 0.04]);
    shell.box(C.white, [0.12, 0.08, 0.08], [lx + 0.45, top + 0.04, lz - 0.08]);
    shell.box(hex('#3a6ab8'), [0.122, 0.025, 0.082], [lx + 0.45, top + 0.05, lz - 0.08]);
    shell.cyl(C.red, 0.08, 0.075, 0.1, [lx - 0.46, top + 0.05, lz - 0.06], undefined, undefined, 12);
    shell.torus(C.white, 0.076, 0.01, [lx - 0.46, top + 0.1, lz - 0.06], undefined, undefined, 12);
    shell.box(C.paper, [0.22, 0.04, 0.3], [lx + 0.24, top + 0.02, lz + 0.1], [0, 0.1, 0]);

    // ── 后墙：一排储物柜、黑板报、挂钟、垃圾桶、扫把。
    for (let i = 0; i < 10; i++) {
      const x = -3.24 + i * 0.72;
      shell.box(LOCKERS[i % 2]!, [0.7, 0.82, 0.34], [x, 0.41, z1 - 0.17]);
      shell.box(C.handle, [0.01, 0.78, 0.006], [x, 0.41, z1 - 0.342]);
      for (const s of [-1, 1]) shell.box(C.handle, [0.02, 0.1, 0.02], [x + s * 0.04, 0.55, z1 - 0.35]);
    }
    const shelfRng = new DeterministicRng(9);
    for (let i = 0; i < 9; i++) {
      const h = 0.18 + shelfRng.nextFloat() * 0.1;
      shell.box(BOOKS[shelfRng.next(BOOKS.length)]!, [0.05, h, 0.24], [-3.4 + i * 0.8 + shelfRng.nextFloat() * 0.2, 0.82 + h / 2, z1 - 0.18], [0, 0, (shelfRng.nextFloat() - 0.5) * 0.3]);
    }
    shell.box(C.boardFrame, [3.42, 1.32, 0.03], [0, 1.62, z1 - 0.015]);
    const backTex = new DynamicTexture('tex.backboard', { width: 1024, height: 372 }, scene, true);
    drawBoardNewspaper(backTex);
    const backBoard = this.texturedPlane(scene, 'room.backboard', 3.3, 1.2, backTex, new Color3(0.14, 0.14, 0.14));
    backBoard.position.set(0, 1.62, z1 - 0.032);
    shell.cyl(C.clockRim, 0.42, 0.42, 0.05, [0, 2.62, z1 - 0.025], [Math.PI / 2, 0, 0], undefined, 24);
    const faceTex = new DynamicTexture('tex.clock', { width: 256, height: 256 }, scene, true);
    faceTex.hasAlpha = true;
    drawClockFace(faceTex);
    const face = this.texturedPlane(scene, 'room.clock', 0.37, 0.37, faceTex, new Color3(0.3, 0.3, 0.3));
    face.position.set(0, 2.62, z1 - 0.052);
    const handMat = flatMaterial(scene, 'room.clock.hand', hex('#1c1c20'));
    this.hourHand = this.clockHand(scene, 'hour', 0.1, 0.02, handMat, new Vector3(0, 2.62, z1 - 0.058));
    this.minuteHand = this.clockHand(scene, 'minute', 0.15, 0.012, handMat, new Vector3(0, 2.62, z1 - 0.062));
    shell.cyl(C.bin, 0.3, 0.24, 0.38, [3.78, 0.19, z1 - 0.2], undefined, undefined, 12);
    shell.cyl(C.broom, 0.025, 0.025, 1.2, [-3.86, 0.62, z1 - 0.12], [0.12, 0, -0.1], undefined, 6);
    shell.box(C.bristle, [0.26, 0.14, 0.06], [-3.8, 0.07, z1 - 0.2], [0.12, 0, -0.1]);

    // ── 天花：六盏日光灯（灯管单独一个发光网格）、两台吊扇。
    const tubes = new Kit(scene, 'tubes');
    for (const fx of [-1.6, 1.6]) {
      for (const fz of [-2.6, 0, 2.6]) {
        shell.box(C.fixture, [0.16, 0.05, 1.3], [fx, H - 0.3, fz]);
        for (const s of [-1, 1]) shell.cyl(C.metal, 0.008, 0.008, 0.28, [fx, H - 0.14, fz + s * 0.5], undefined, undefined, 4);
        for (const s of [-1, 1]) tubes.cyl(C.white, 0.032, 0.032, 1.2, [fx + s * 0.035, H - 0.335, fz], [Math.PI / 2, 0, 0], undefined, 8);
      }
    }
    this.tubeMat = flatMaterial(scene, 'room.tube', Color3.White(), hex('#eef6ff'));
    this.tubeMat.disableLighting = true;
    const tubeMesh = tubes.merge('room.tubes', this.tubeMat);
    this.glow.addIncludedOnlyMesh(tubeMesh);
    for (const [fx, fz] of FANS) {
      shell.cyl(C.metal, 0.03, 0.03, 0.3, [fx, H - 0.15, fz], undefined, undefined, 6);
      shell.cyl(C.fan, 0.26, 0.22, 0.1, [fx, H - 0.33, fz], undefined, undefined, 12);
      shell.ball(C.fan, [0.14, 0.08, 0.14], [fx, H - 0.39, fz], undefined, undefined, 8);
      const blades = new Kit(scene, 'fan');
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3;
        blades.box(C.fanBlade, [0.8, 0.012, 0.13], [fx + Math.cos(a) * 0.48, H - 0.35, fz - Math.sin(a) * 0.48], [0, a, 0.04]);
        blades.box(C.metal, [0.14, 0.016, 0.04], [fx + Math.cos(a) * 0.12, H - 0.345, fz - Math.sin(a) * 0.12], [0, a, 0]);
      }
      const mesh = blades.merge('room.fan', vc);
      mesh.setPivotPoint(new Vector3(fx, H - 0.35, fz));
      mesh.rotation.y = fx * 0.7;
      this.fans.push(mesh);
    }

    // ── 课桌椅、每张桌上的卷子和文具、坐着的学生、玩家自己的腿。
    const desks = new Kit(scene, 'desks');
    const rng = new DeterministicRng(20260923);
    const temp: TransformNode[] = [];
    const chair = (x: number, z: number, yaw: number): void => {
      const b = bone(scene, 'chair', null, [x, 0, z], [0, yaw, 0]);
      temp.push(b);
      desks.box(C.seat, [0.38, 0.024, 0.36], [0, 0.44, 0], undefined, b);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) desks.box(C.steel, [0.024, 0.43, 0.024], [sx * 0.17, 0.215, sz * 0.15], undefined, b);
        desks.box(C.steel, [0.024, 0.46, 0.024], [sx * 0.17, 0.67, 0.165], undefined, b);
      }
      desks.box(C.seat, [0.38, 0.15, 0.02], [0, 0.8, 0.17], [0.08, 0, 0], b);
      desks.box(C.steel, [0.34, 0.02, 0.02], [0, 0.12, 0.15], undefined, b);
    };
    let student = 0;
    L.rows.forEach((_, r) => L.cols.forEach((__, c) => {
      const d = L.desk(c, r);
      const seat = L.seat(c, r);
      const isPlayer = L.isPlayerSeat(c, r);
      const isEmpty = L.isEmptySeat(c, r);
      desks.box(C.deskTop, [0.6, 0.03, 0.42], [d.x, 0.75, d.z]);
      desks.box(C.deskBox, [0.56, 0.012, 0.36], [d.x, 0.62, d.z - 0.02]);
      desks.box(C.deskBox, [0.58, 0.13, 0.012], [d.x, 0.68, d.z - 0.2]);
      for (const s of [-1, 1]) {
        desks.box(C.deskBox, [0.012, 0.13, 0.38], [d.x + s * 0.284, 0.68, d.z - 0.01]);
        for (const sz of [-1, 1]) desks.box(C.steel, [0.03, 0.735, 0.03], [d.x + s * 0.27, 0.3675, d.z + sz * 0.18]);
        desks.box(C.steel, [0.025, 0.025, 0.36], [d.x + s * 0.27, 0.09, d.z]);
      }
      const books = rng.next(4);
      for (let k = 0; k < books; k++) desks.box(BOOKS[rng.next(BOOKS.length)]!, [0.2, 0.022, 0.27], [d.x - 0.12 + k * 0.05, 0.638 + k * 0.022, d.z - 0.03], [0, (rng.nextFloat() - 0.5) * 0.2, 0]);
      if (isEmpty) chair(seat.x + 0.07, seat.z + 0.2, 0.28);
      else chair(seat.x, seat.z, 0);

      if (!isPlayer) desks.box(C.paper, [0.21, 0.003, 0.297], [d.x + (rng.nextFloat() - 0.5) * 0.06, 0.7665, d.z + 0.02], [0, (rng.nextFloat() - 0.5) * 0.25, 0]);
      if (isPlayer || (!isEmpty && rng.nextFloat() < 0.8)) {
        desks.box(CASES[rng.next(CASES.length)]!, [0.19, 0.035, 0.055], [d.x - 0.19, 0.783, d.z - 0.15], [0, (rng.nextFloat() - 0.5) * 0.3, 0]);
      }
      if (!isPlayer && !isEmpty && rng.nextFloat() < 0.35) desks.cyl(BOTTLES[rng.next(BOTTLES.length)]!, 0.06, 0.065, 0.2, [d.x + 0.24, 0.865, d.z - 0.15], undefined, undefined, 10);
      if (isPlayer) {
        desks.box(C.white, [0.045, 0.012, 0.025], [d.x + 0.2, 0.772, d.z - 0.14], [0, 0.4, 0]);
        desks.cyl(hex('#2b2b33'), 0.011, 0.011, 0.15, [d.x + 0.19, 0.772, d.z + 0.05], [Math.PI / 2, 0.35, 0], undefined, 6);
        for (const s of [-1, 1]) {
          desks.limb(C.navy, 0.072, [seat.x + s * 0.09, 0.54, seat.z - 0.02], [seat.x + s * 0.1, 0.53, seat.z - 0.36]);
          desks.limb(C.navy, 0.06, [seat.x + s * 0.1, 0.53, seat.z - 0.36], [seat.x + s * 0.105, 0.1, seat.z - 0.4]);
          desks.ball(C.shoe, [0.12, 0.08, 0.21], [seat.x + s * 0.105, 0.045, seat.z - 0.45]);
        }
      }
      if (!isPlayer && !isEmpty) this.students.push(buildStudent(scene, vc, seat.x, seat.z, Math.PI, rng, student++));
    }));
    const deskMesh = desks.merge('room.desks', vc);
    for (const b of temp) b.dispose();

    // ── 窗外：几棵近处的樟树 + 一块远景板（天、对面教学楼、树梢）。
    const outside = new Kit(scene, 'outside');
    for (const [tx, tz, s] of [[5.6, -3.8, 1.1], [6.4, -0.9, 1.3], [5.8, 1.9, 1.0], [6.8, 4.2, 1.2]] as const) {
      outside.cyl(C.trunk, 0.16 * s, 0.22 * s, 3.4, [tx, -1.3, tz], undefined, undefined, 8);
      for (let k = 0; k < 4; k++) {
        const a = k * 1.7;
        outside.ball(LEAVES[k % LEAVES.length]!, [1.5 * s, 1.2 * s, 1.5 * s], [tx + Math.cos(a) * 0.5 * s, 1.1 + (k % 2) * 0.55 * s, tz + Math.sin(a) * 0.6 * s], undefined, undefined, 7);
      }
    }
    outside.merge('room.trees', vc);
    this.skyTex = new DynamicTexture('tex.sky', { width: 1024, height: 512 }, scene, true);
    drawSky(this.skyTex);
    const skyMat = new StandardMaterial('room.sky', scene);
    skyMat.diffuseColor = Color3.Black();
    skyMat.specularColor = Color3.Black();
    skyMat.emissiveTexture = this.skyTex;
    skyMat.disableLighting = true;
    const sky = MeshBuilder.CreatePlane('room.skyboard', { width: 36, height: 18 }, scene);
    sky.position.set(16, 3.5, 0);
    sky.rotation.y = Math.PI / 2;
    sky.material = skyMat;
    sky.isPickable = false;

    // ── 地面。
    const floorMat = new StandardMaterial('room.floor', scene);
    const floorTex = terrazzoTexture(scene);
    floorTex.uScale = W / 1.2;
    floorTex.vScale = D / 1.2;
    floorMat.diffuseTexture = floorTex;
    floorMat.specularColor = new Color3(0.12, 0.12, 0.11);
    floorMat.specularPower = 40;
    const floor = MeshBuilder.CreateGround('room.floor', { width: W, height: D }, scene);
    floor.material = floorMat;

    const shellMesh = shell.merge('room.shell', vc);
    for (const m of [floor, shellMesh, deskMesh]) m.receiveShadows = true;
    this.addCaster(shellMesh);
    this.addCaster(deskMesh);
    for (const s of this.students) {
      s.body.receiveShadows = true;
      s.head.receiveShadows = true;
      this.addCaster(s.body);
      this.addCaster(s.head);
    }

    const pd = L.playerDesk;
    this.desk = new Vector3(pd.x, 0.766, pd.z);
    const pe = L.playerEye;
    this.eye = new Vector3(pe.x, L.eyeHeight, pe.z);
    const empty = L.seat(L.emptyCol, L.emptyRow);
    const [fanX, fanZ] = FANS[1]!;
    this.anomalySpots = [
      new Vector3(x1 + 0.45, 1.6, 0),
      new Vector3(fanX, H - 0.75, fanZ),
      new Vector3(empty.x, 1.08, empty.z),
      new Vector3(-1.75, 2.02, z0 + 0.1),
    ];
  }

  private texturedPlane(scene: Scene, name: string, w: number, h: number, tex: DynamicTexture, emissive: Color3): Mesh {
    const mesh = MeshBuilder.CreatePlane(name, { width: w, height: h }, scene);
    const mat = new StandardMaterial(name + '.mat', scene);
    mat.diffuseTexture = tex;
    mat.emissiveColor = emissive;
    mat.specularColor = Color3.Black();
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    return mesh;
  }

  private clockHand(scene: Scene, name: string, length: number, width: number, mat: StandardMaterial, at: Vector3): TransformNode {
    const pivot = new TransformNode('room.clock.' + name, scene);
    pivot.position.copyFrom(at);
    const hand = MeshBuilder.CreateBox('room.clock.' + name + '.mesh', { width, height: length, depth: 0.005 }, scene);
    hand.parent = pivot;
    hand.position.y = length / 2 - 0.015;
    hand.material = mat;
    hand.isPickable = false;
    return pivot;
  }

  addCaster(mesh: AbstractMesh): void {
    this.shadows.addShadowCaster(mesh, false);
  }

  /**
   * 开考时重画板书与规则墙。黑板写的是卷头那两行；规则墙的第六条只有在你死过之后才会出现。
   */
  refresh(title: string, header: string, hiddenRule: boolean): void {
    drawBlackboard(this.boardTex, title, header);
    drawRules(this.rulesTex, this.table, hiddenRule);
  }

  update(dt: number, f: RoomFrame): void {
    for (const fan of this.fans) fan.rotation.y += dt * FAN_RPS * Math.PI * 2;

    const minutes = ((f.wallClockMinutes % 720) + 720) % 720;
    this.minuteHand.rotation.z = -((minutes % 60) / 60) * Math.PI * 2;
    this.hourHand.rotation.z = -(minutes / 720) * Math.PI * 2;

    const level = Math.max(0, Math.min(1, f.lights));
    this.hemi.intensity = 0.04 + 0.58 * level;
    this.sun.intensity = 1.05 * level;
    this.tubeMat.emissiveColor.set(0.93 * level, 0.96 * level, level);
    this.skyTex.level = 0.25 + 0.75 * level;

    // 回头：每个人慢慢地、错开一点时间，把脸转向你（头的转轴在脖子上）。
    const rate = f.stare > this.stare ? 0.9 : 2.2;
    this.stare += (f.stare - this.stare) * (1 - Math.exp(-dt * rate));
    this.students.forEach((s, i) => {
      const t = Math.max(0, Math.min(1, this.stare * 1.5 - (i % 6) * 0.08));
      const eased = t * t * (3 - 2 * t);
      const target = wrapAngle(yawTo(s.neck.x, s.neck.z, f.eye.x, f.eye.z) - Math.PI);
      s.head.rotation.y = target * eased;
    });
  }
}
