import {
  Color3, Mesh, MeshBuilder, Quaternion, StandardMaterial, TransformNode, Vector3, VertexBuffer, type Scene,
} from '@babylonjs/core';

/**
 * 低多边形积木（参考 How to Fish 的造型语言：粗壮、圆钝、大头、纯色块）。
 *
 * 一件东西 = 一把带顶点色的零件，最后 merge 成一个网格：一个 draw call，一张共享材质。
 * 零件可以挂在临时骨骼（TransformNode）上摆姿势 —— merge 会把世界矩阵烘进顶点。
 */
export type V3 = readonly [number, number, number];

export function hex(h: string): Color3 {
  return Color3.FromHexString(h);
}

export function mixColor(a: Color3, b: Color3, t: number): Color3 {
  return new Color3(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

/** 所有顶点色网格共用的材质：几乎不反光，让色块本身说话。 */
export function vertexColorMaterial(scene: Scene, name = 'lowpoly.vc'): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.White();
  m.specularColor = new Color3(0.06, 0.06, 0.06);
  m.specularPower = 24;
  m.emissiveColor = new Color3(0.07, 0.07, 0.08);
  return m;
}

export function flatMaterial(scene: Scene, name: string, color: Color3, emissive: Color3 = Color3.Black()): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.emissiveColor = emissive;
  m.specularColor = new Color3(0.05, 0.05, 0.05);
  return m;
}

function paint(mesh: Mesh, color: Color3): void {
  const n = mesh.getTotalVertices();
  const data = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = color.r;
    data[i * 4 + 1] = color.g;
    data[i * 4 + 2] = color.b;
    data[i * 4 + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, data, false, 4);
}

/** 摆姿势用的骨骼节点。 */
export function bone(scene: Scene, name: string, parent: TransformNode | null, at: V3, rot?: V3): TransformNode {
  const node = new TransformNode(name, scene);
  if (parent) node.parent = parent;
  node.position.set(at[0], at[1], at[2]);
  if (rot) node.rotation.set(rot[0], rot[1], rot[2]);
  return node;
}

export class Kit {
  readonly parts: Mesh[] = [];
  private count = 0;

  constructor(private readonly scene: Scene, private readonly prefix: string) {}

  private place(m: Mesh, color: Color3 | null, at: V3, rot: V3 | undefined, parent: TransformNode | undefined): Mesh {
    if (parent) m.parent = parent;
    m.position.set(at[0], at[1], at[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (color) paint(m, color);
    this.parts.push(m);
    return m;
  }

  private id(): string {
    return this.prefix + '.' + this.count++;
  }

  box(color: Color3, size: V3, at: V3, rot?: V3, parent?: TransformNode): Mesh {
    return this.place(MeshBuilder.CreateBox(this.id(), { width: size[0], height: size[1], depth: size[2] }, this.scene), color, at, rot, parent);
  }

  /** 圆柱 / 圆台；tessellation 低一点就是低多边形。 */
  cyl(color: Color3, top: number, bottom: number, height: number, at: V3, rot?: V3, parent?: TransformNode, tessellation = 10): Mesh {
    const m = MeshBuilder.CreateCylinder(this.id(), { diameterTop: top, diameterBottom: bottom, height, tessellation }, this.scene);
    return this.place(m, color, at, rot, parent);
  }

  /** 椭球：size 是三个方向的直径。slice < 1 只留上面那一截（头发帽）。 */
  ball(color: Color3, size: V3, at: V3, rot?: V3, parent?: TransformNode, segments = 8, slice = 1): Mesh {
    const m = MeshBuilder.CreateSphere(this.id(), { diameterX: size[0], diameterY: size[1], diameterZ: size[2], segments, slice }, this.scene);
    return this.place(m, color, at, rot, parent);
  }

  /** 胶囊：粗壮圆钝的身子。沿 Y 轴，height 含两端半球。 */
  capsule(color: Color3, height: number, radius: number, at: V3, rot?: V3, parent?: TransformNode, scale?: V3): Mesh {
    const m = MeshBuilder.CreateCapsule(this.id(), { height: Math.max(height, radius * 2.01), radius, tessellation: 10, subdivisions: 1, capSubdivisions: 3 }, this.scene);
    if (scale) m.scaling.set(scale[0], scale[1], scale[2]);
    return this.place(m, color, at, rot, parent);
  }

  /** 两点之间的一截胶囊（手臂、腿）：from / to 写在 parent 的局部坐标里。 */
  limb(color: Color3, radius: number, from: V3, to: V3, parent?: TransformNode): Mesh {
    const a = new Vector3(from[0], from[1], from[2]);
    const b = new Vector3(to[0], to[1], to[2]);
    const d = b.subtract(a);
    const len = d.length();
    const m = MeshBuilder.CreateCapsule(this.id(), { height: len + radius * 1.6, radius, tessellation: 10, subdivisions: 1, capSubdivisions: 3 }, this.scene);
    const mid = a.add(b).scale(0.5);
    const q = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), d.normalize(), q);
    m.rotationQuaternion = q;
    return this.place(m, color, [mid.x, mid.y, mid.z], undefined, parent);
  }

  torus(color: Color3, diameter: number, thickness: number, at: V3, rot?: V3, parent?: TransformNode, tessellation = 14): Mesh {
    return this.place(MeshBuilder.CreateTorus(this.id(), { diameter, thickness, tessellation }, this.scene), color, at, rot, parent);
  }

  /** 把所有零件焊成一个网格（顶点落在世界坐标里；骨骼的姿势一起烘进去）。 */
  merge(name: string, material: StandardMaterial): Mesh {
    for (const p of this.parts) p.computeWorldMatrix(true);
    const merged = Mesh.MergeMeshes(this.parts, true, true, undefined, false, false);
    if (!merged) throw new Error('merge failed: ' + name);
    merged.name = name;
    merged.material = material;
    this.parts.length = 0;
    return merged;
  }
}
