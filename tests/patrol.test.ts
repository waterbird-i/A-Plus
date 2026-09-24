import { describe, expect, it } from 'vitest';
import {
  ClassroomLayout, GazeKind, GazeState, GazeStateMachine, InvigilatorPatrol, PatrolEventKind, PatrolState, TickResult,
  quietInput, type PatrolEvent, type PatrolInput,
} from '../src/core';

const DT = 0.05;

function setup(seed = 7): { layout: ClassroomLayout; patrol: InvigilatorPatrol; gaze: GazeStateMachine } {
  const layout = new ClassroomLayout();
  const gaze = new GazeStateMachine();
  gaze.summonOnExposure = false;
  return { layout, patrol: new InvigilatorPatrol(layout, null, seed), gaze };
}

interface Log { events: PatrolEvent[]; results: TickResult[] }

function step(patrol: InvigilatorPatrol, gaze: GazeStateMachine, input: PatrolInput, log: Log): void {
  gaze.setState(input.gaze);
  patrol.tick(DT, input, gaze, log.events, log.results);
  const r = gaze.tick(DT);
  if (r !== TickResult.Idle && r !== TickResult.Safe) log.results.push(r);
}

function runUntil(patrol: InvigilatorPatrol, gaze: GazeStateMachine, input: () => PatrolInput, maxSeconds: number, done: () => boolean, log: Log = { events: [], results: [] }): Log {
  for (let t = 0; t < maxSeconds && !done(); t += DT) step(patrol, gaze, input(), log);
  return log;
}

describe('decision #43: the patrolling invigilator', () => {
  it('only ever walks the aisles and the cross-ways — never through a desk', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { layout, patrol, gaze } = setup(seed);
      for (let t = 0; t < 400; t += DT) {
        step(patrol, gaze, quietInput(), { events: [], results: [] });
        for (let c = 0; c < layout.cols.length; c++) {
          for (let r = 0; r < layout.rows.length; r++) {
            const d = layout.desk(c, r);
            const s = layout.seat(c, r);
            const inDesk = Math.abs(patrol.x - d.x) < 0.42 && Math.abs(patrol.z - d.z) < 0.32;
            const inChair = Math.abs(patrol.x - s.x) < 0.38 && Math.abs(patrol.z - s.z) < 0.3;
            if (inDesk || inChair) throw new Error('seed ' + seed + ' walked into desk ' + c + ',' + r + ' at ' + patrol.x.toFixed(2) + ',' + patrol.z.toFixed(2));
          }
        }
        expect(Math.abs(patrol.x)).toBeLessThan(layout.width / 2 - 0.3);
        expect(patrol.z).toBeGreaterThan(-layout.depth / 2);
        expect(patrol.z).toBeLessThan(layout.depth / 2 - 0.3);
      }
    }
  });

  it('she really patrols: leaves the podium, walks, comes back, and her heels are audible', () => {
    const { patrol, gaze } = setup();
    const states = new Set<string>();
    const log: Log = { events: [], results: [] };
    for (let t = 0; t < 240; t += DT) {
      step(patrol, gaze, quietInput(), log);
      states.add(patrol.state);
    }
    expect(states.has(PatrolState.Podium)).toBe(true);
    expect(states.has(PatrolState.Walking)).toBe(true);
    expect(log.events.filter((e) => e.kind === PatrolEventKind.Footstep).length).toBeGreaterThan(50);
    expect(log.events.some((e) => e.kind === PatrolEventKind.PageTurn)).toBe(true);
  });

  it('a student who keeps their head down is never caught', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { patrol, gaze } = setup(seed);
      const log = runUntil(patrol, gaze, () => quietInput(), 600, () => false);
      expect(log.events.some((e) => e.kind === PatrolEventKind.Caught)).toBe(false);
      expect(gaze.timesRecorded).toBe(0);
    }
  });

  it('she cannot see anyone while reading the register at the podium', () => {
    const { patrol, gaze } = setup();
    runUntil(patrol, gaze, () => quietInput(), 10, () => patrol.reading);
    expect(patrol.reading).toBe(true);
    const phone = quietInput(GazeState.Phone);
    runUntil(patrol, gaze, () => phone, 10, () => !patrol.reading);
    expect(patrol.suspicion).toBe(0);
  });

  it('phone in her sight: she notices first (readable), then catches, teleports beside you and records', () => {
    const { layout, patrol, gaze } = setup();
    runUntil(patrol, gaze, () => quietInput(), 60, () => patrol.state === PatrolState.Podium && !patrol.reading);
    const log = runUntil(patrol, gaze, () => quietInput(GazeState.Phone), 60, () => patrol.state === PatrolState.Caught);
    const noticed = log.events.findIndex((e) => e.kind === PatrolEventKind.Noticed);
    const caught = log.events.findIndex((e) => e.kind === PatrolEventKind.Caught);
    expect(noticed).toBeGreaterThanOrEqual(0);
    expect(caught).toBeGreaterThan(noticed);
    expect(patrol.state).toBe(PatrolState.Caught);
    expect(patrol.x).toBeCloseTo(layout.besidePlayer.x, 5);
    expect(patrol.z).toBeCloseTo(layout.besidePlayer.z, 5);
    expect(patrol.rage).toBe(1);
    expect(gaze.timesRecorded).toBe(1);
    expect(log.results).toContain(TickResult.Recorded);
  });

  it('after the scare she glares: head down is safe, looking up costs another record', () => {
    const { patrol, gaze } = setup();
    runUntil(patrol, gaze, () => quietInput(), 60, () => patrol.state === PatrolState.Podium && !patrol.reading);
    runUntil(patrol, gaze, () => quietInput(GazeState.Phone), 60, () => patrol.state === PatrolState.Caught);
    runUntil(patrol, gaze, () => quietInput(), 5, () => patrol.state === PatrolState.Glaring);
    expect(gaze.activeGaze).toBe(GazeKind.Teacher);

    runUntil(patrol, gaze, () => quietInput(GazeState.LookingAround), 1.2, () => false);
    expect(gaze.timesRecorded).toBe(2);
    runUntil(patrol, gaze, () => quietInput(), 30, () => patrol.state === PatrolState.Podium);
    expect(patrol.state).toBe(PatrolState.Podium);
    expect(patrol.rage).toBeLessThan(1);
    expect(gaze.timesRecorded).toBe(2);
  });

  it('a phone ringing makes her turn and come over', () => {
    const { layout, patrol, gaze } = setup();
    runUntil(patrol, gaze, () => quietInput(), 10, () => false);
    const ring: PatrolInput = { ...quietInput(), ringing: true };
    const log: Log = { events: [], results: [] };
    step(patrol, gaze, ring, log);
    expect(log.events.some((e) => e.kind === PatrolEventKind.Heard)).toBe(true);
    expect(patrol.state).toBe(PatrolState.Alert);
    runUntil(patrol, gaze, () => quietInput(), 10, () => patrol.state === PatrolState.Investigating, log);
    expect(patrol.state).toBe(PatrolState.Investigating);
    runUntil(patrol, gaze, () => quietInput(), 20, () => patrol.state === PatrolState.Pausing, log);
    expect(patrol.distanceToPlayer).toBeLessThan(1.2);
    expect(Math.abs(patrol.z - layout.playerEye.z)).toBeLessThan(0.6);
  });

  it('three catches in one exam kill you', () => {
    const { patrol, gaze } = setup();
    const scared = (): boolean => patrol.state === PatrolState.Caught || patrol.state === PatrolState.Glaring;
    runUntil(patrol, gaze, () => quietInput(scared() ? GazeState.Paper : GazeState.Phone), 600, () => gaze.isDead);
    expect(gaze.isDead).toBe(true);
    expect(patrol.catches).toBe(3);
  });
});
