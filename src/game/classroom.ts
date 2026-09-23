import { Color3, HemisphericLight, MeshBuilder, PointLight, StandardMaterial, TransformNode, Vector3, type Mesh, type Scene } from '@babylonjs/core';

/** 灰盒教室：1 间教室、4 × 5 个座位、讲台、黑板、后墙挂钟、窗。尺寸单位是米，黑板在 -Z。 */
export interface Classroom {
  /** 玩家的眼睛位置（坐着）。 */
  eye: Vector3;
  /** 玩家课桌桌面中心。 */
  desk: Vector3;
  teacher: Mesh;
  /** 异象可能出现的位置（窗外、吊扇、空座位、黑板角）。 */
  anomalySpots: Vector3[];
}

const ROOM_W = 8;
const ROOM_D = 9;
const ROOM_H = 3.2;

function mat(scene: Scene, name: string, color: Color3, emissive = Color3.Black()): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.emissiveColor = emissive;
  m.specularColor = new Color3(0.05, 0.05, 0.05);
  m.backFaceCulling = false;
  return m;
}

export function buildClassroom(scene: Scene): Classroom {
  const wall = mat(scene, 'wall', new Color3(0.72, 0.74, 0.7));
  const floor = mat(scene, 'floor', new Color3(0.36, 0.33, 0.3));
  const wood = mat(scene, 'wood', new Color3(0.5, 0.38, 0.26));
  const board = mat(scene, 'board', new Color3(0.12, 0.22, 0.16));
  const dark = mat(scene, 'silhouette', new Color3(0.02, 0.02, 0.02));
  const glass = mat(scene, 'glass', new Color3(0.3, 0.38, 0.45), new Color3(0.12, 0.16, 0.2));

  const light = new HemisphericLight('fluorescent', new Vector3(0, 1, 0), scene);
  light.intensity = 0.75;
  light.groundColor = new Color3(0.25, 0.25, 0.25);
  const tube = new PointLight('tube', new Vector3(0, ROOM_H - 0.2, 0), scene);
  tube.intensity = 0.35;

  const ground = MeshBuilder.CreateGround('floor', { width: ROOM_W, height: ROOM_D }, scene);
  ground.material = floor;
  const ceiling = MeshBuilder.CreatePlane('ceiling', { width: ROOM_W, height: ROOM_D }, scene);
  ceiling.rotation.x = -Math.PI / 2;
  ceiling.position.y = ROOM_H;
  ceiling.material = wall;

  const walls: [string, number, number, number, number][] = [
    ['wall.front', 0, -ROOM_D / 2, ROOM_W, Math.PI],
    ['wall.back', 0, ROOM_D / 2, ROOM_W, 0],
    ['wall.left', -ROOM_W / 2, 0, ROOM_D, -Math.PI / 2],
    ['wall.right', ROOM_W / 2, 0, ROOM_D, Math.PI / 2],
  ];
  for (const [name, x, z, width, rotY] of walls) {
    const w = MeshBuilder.CreatePlane(name, { width, height: ROOM_H }, scene);
    w.position.set(x, ROOM_H / 2, z);
    w.rotation.y = rotY;
    w.material = wall;
  }

  const blackboard = MeshBuilder.CreatePlane('blackboard', { width: 4, height: 1.2 }, scene);
  blackboard.position.set(0, 1.6, -ROOM_D / 2 + 0.02);
  blackboard.rotation.y = Math.PI;
  blackboard.material = board;

  const podium = MeshBuilder.CreateBox('podium', { width: 1.4, height: 1.0, depth: 0.6 }, scene);
  podium.position.set(0, 0.5, -ROOM_D / 2 + 1.3);
  podium.material = wood;

  const teacher = MeshBuilder.CreateCapsule('teacher', { height: 1.65, radius: 0.22 }, scene);
  teacher.position.set(0, 0.83, -ROOM_D / 2 + 0.85);
  teacher.material = dark;

  const clock = MeshBuilder.CreateCylinder('clock', { diameter: 0.4, height: 0.04 }, scene);
  clock.rotation.x = Math.PI / 2;
  clock.position.set(0, 2.3, ROOM_D / 2 - 0.03);
  clock.material = mat(scene, 'clockface', new Color3(0.9, 0.9, 0.85));

  for (let i = 0; i < 3; i++) {
    const win = MeshBuilder.CreatePlane('window.' + i, { width: 1.6, height: 1.4 }, scene);
    win.position.set(ROOM_W / 2 - 0.02, 1.7, -2.5 + i * 2.5);
    win.rotation.y = Math.PI / 2;
    win.material = glass;
  }

  const fan = new TransformNode('fan', scene);
  fan.position.set(0, ROOM_H - 0.35, 0.5);
  const hub = MeshBuilder.CreateCylinder('fan.hub', { diameter: 0.18, height: 0.12 }, scene);
  hub.parent = fan;
  hub.material = dark;
  for (let i = 0; i < 3; i++) {
    const blade = MeshBuilder.CreateBox('fan.blade.' + i, { width: 0.7, height: 0.02, depth: 0.12 }, scene);
    blade.parent = fan;
    blade.rotation.y = (i * Math.PI * 2) / 3;
    blade.position.set(Math.cos(blade.rotation.y) * 0.4, 0, -Math.sin(blade.rotation.y) * 0.4);
    blade.material = wood;
  }
  scene.onBeforeRenderObservable.add(() => { fan.rotation.y += 0.02; });

  // 4 列 × 5 排。玩家坐第 3 列第 4 排；第 2 列第 2 排是「没人记得那里坐过人」的空座位。
  const cols = [-2.4, -0.8, 0.8, 2.4];
  const rows = [-2.2, -1.0, 0.2, 1.4, 2.6];
  const playerCol = 2;
  const playerRow = 3;
  const emptyCol = 1;
  const emptyRow = 1;
  let desk = Vector3.Zero();
  let emptySeat = Vector3.Zero();
  rows.forEach((z, r) => cols.forEach((x, c) => {
    const d = MeshBuilder.CreateBox('desk.' + r + '.' + c, { width: 0.6, height: 0.05, depth: 0.45 }, scene);
    d.position.set(x, 0.75, z);
    d.material = wood;
    const isPlayer = c === playerCol && r === playerRow;
    const isEmpty = c === emptyCol && r === emptyRow;
    if (isPlayer) desk = d.position.clone();
    if (isEmpty) emptySeat = new Vector3(x, 1.1, z + 0.45);
    if (isPlayer || isEmpty) return;
    const student = MeshBuilder.CreateCapsule('student.' + r + '.' + c, { height: 1.25, radius: 0.2 }, scene);
    student.position.set(x, 0.62, z + 0.45);
    student.material = dark;
  }));

  return {
    eye: new Vector3(desk.x, 1.15, desk.z + 0.32),
    desk: desk.add(new Vector3(0, 0.03, 0)),
    teacher,
    anomalySpots: [
      new Vector3(ROOM_W / 2 + 0.4, 1.6, 0),
      new Vector3(fan.position.x, fan.position.y - 0.15, fan.position.z),
      emptySeat,
      new Vector3(-1.7, 2.0, -ROOM_D / 2 + 0.05),
    ],
  };
}
