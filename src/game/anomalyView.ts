import { Color3, MeshBuilder, StandardMaterial, type Mesh, type Scene, type Vector3 } from '@babylonjs/core';
import { DeterministicRng, GazeKind, type GazeStateMachine } from '../core';

/**
 * 异视的占位表现：一团「不对」的东西落在某个异象位上。
 * 2.2 细节 1：被直视时它必须立刻可见地变淡、抖动 —— 判定可以难，绝不能不可读。
 */
export class AnomalyView {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private rng = new DeterministicRng(1);
  private wasActive = false;
  private time = 0;
  spot: Vector3 | null = null;

  constructor(scene: Scene, private readonly spots: Vector3[]) {
    this.mesh = MeshBuilder.CreateSphere('anomaly', { diameter: 0.35, segments: 12 }, scene);
    this.material = new StandardMaterial('anomaly.mat', scene);
    this.material.diffuseColor = Color3.Black();
    this.material.emissiveColor = new Color3(0.08, 0.0, 0.0);
    this.material.alpha = 1;
    this.mesh.material = this.material;
    this.mesh.setEnabled(false);
  }

  reseed(seed: number): void {
    this.rng = new DeterministicRng(seed);
  }

  update(dt: number, gaze: GazeStateMachine): void {
    const active = gaze.activeGaze === GazeKind.Anomaly;
    if (active && !this.wasActive) {
      this.spot = this.spots[this.rng.next(this.spots.length)];
      this.mesh.position.copyFrom(this.spot);
    }
    if (!active) this.spot = null;
    this.wasActive = active;
    this.mesh.setEnabled(active);
    if (!active) return;

    this.time += dt;
    const p = gaze.anomalyRepelProgress;
    const shake = p > 0 ? 0.02 + p * 0.05 : 0.004;
    this.mesh.position.set(
      this.spot!.x + Math.sin(this.time * 53) * shake,
      this.spot!.y + Math.sin(this.time * 41) * shake,
      this.spot!.z,
    );
    this.material.alpha = 1 - 0.85 * p;
  }
}
