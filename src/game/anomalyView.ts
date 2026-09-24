import { Color3, StandardMaterial, TransformNode, type Mesh, type Scene, type Vector3 } from '@babylonjs/core';
import { DeterministicRng, GazeKind, yawTo, type GazeStateMachine } from '../core';
import { hex, Kit } from './lowpoly';

/**
 * 异视：一个人形的「洞」—— 头、肩膀，往下慢慢没了；两个针尖大的白点是眼睛，永远朝着你。
 * 2.2 细节 1：被直视时它必须立刻可见地变淡、抖动 —— 判定可以难，绝不能不可读。
 */
export class AnomalyView {
  private readonly root: TransformNode;
  private readonly body: Mesh;
  private readonly eyes: Mesh;
  private readonly material: StandardMaterial;
  private readonly eyeMat: StandardMaterial;
  private rng = new DeterministicRng(1);
  private wasActive = false;
  private time = 0;
  spot: Vector3 | null = null;

  constructor(scene: Scene, private readonly spots: Vector3[], private readonly eye: Vector3) {
    this.material = new StandardMaterial('anomaly.mat', scene);
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    this.material.emissiveColor = new Color3(0.01, 0, 0);
    this.material.disableLighting = true;
    this.eyeMat = new StandardMaterial('anomaly.eyes', scene);
    this.eyeMat.disableLighting = true;
    this.eyeMat.emissiveColor = Color3.White();

    const black = hex('#000000');
    const k = new Kit(scene, 'anomaly');
    k.ball(black, [0.26, 0.31, 0.27], [0, 0.02, 0], undefined, undefined, 10);
    k.cyl(black, 0.11, 0.13, 0.12, [0, -0.15, 0], undefined, undefined, 8);
    k.capsule(black, 0.52, 0.11, [0, -0.24, 0], [0, 0, Math.PI / 2], undefined, [1, 1, 0.8]);
    k.cyl(black, 0.4, 0.12, 0.6, [0, -0.56, 0], undefined, undefined, 10);
    this.body = k.merge('anomaly.body', this.material);
    for (const s of [-1, 1]) k.ball(Color3.White(), [0.018, 0.018, 0.01], [s * 0.05, 0.05, 0.13], undefined, undefined, 5);
    this.eyes = k.merge('anomaly.eyes', this.eyeMat);

    this.root = new TransformNode('anomaly', scene);
    this.body.parent = this.root;
    this.eyes.parent = this.root;
    this.body.isPickable = false;
    this.eyes.isPickable = false;
    this.root.setEnabled(false);
  }

  reseed(seed: number): void {
    this.rng = new DeterministicRng(seed);
  }

  update(dt: number, gaze: GazeStateMachine): void {
    const active = gaze.activeGaze === GazeKind.Anomaly;
    if (active && !this.wasActive) this.spot = this.spots[this.rng.next(this.spots.length)] ?? null;
    if (!active) this.spot = null;
    this.wasActive = active;
    this.root.setEnabled(active && this.spot !== null);
    if (!active || !this.spot) return;

    this.time += dt;
    const p = gaze.anomalyRepelProgress;
    const shake = p > 0 ? 0.02 + p * 0.05 : 0.004;
    this.root.position.set(
      this.spot.x + Math.sin(this.time * 53) * shake,
      this.spot.y + Math.sin(this.time * 41) * shake,
      this.spot.z,
    );
    this.root.rotation.y = yawTo(this.spot.x, this.spot.z, this.eye.x, this.eye.z);
    this.root.rotation.z = Math.sin(this.time * 0.7) * 0.08;
    const alpha = 1 - 0.85 * p;
    this.material.alpha = alpha;
    this.eyeMat.alpha = Math.random() < 0.04 ? 0 : alpha;
  }
}
