import { describe, expect, it } from 'vitest';
import { DeathCause, GazeKind, GazeState, GazeStateMachine, GazeWarning, TickResult } from '../src/core';
import { tickSeconds } from './support';

describe('2.1 three gaze states', () => {
  it('paper accumulates no exposure', () => {
    const m = new GazeStateMachine();
    for (let i = 0; i < 5; i++) m.tick(1);
    expect(m.exposure).toBe(0);
  });

  it('looking around accumulates exposure and kills peripheral vision', () => {
    const m = new GazeStateMachine();
    m.setState(GazeState.LookingAround);
    for (let i = 0; i < 2; i++) m.tick(1);
    expect(m.exposure).toBeGreaterThan(0);
    expect(m.peripheralReliable).toBe(false);
  });

  it('glowing phone draws more attention than looking around', () => {
    const phone = new GazeStateMachine();
    phone.setState(GazeState.Phone);
    const look = new GazeStateMachine();
    look.setState(GazeState.LookingAround);
    phone.tick(1);
    look.tick(1);
    expect(phone.exposure).toBeGreaterThan(look.exposure);
  });

  it('exposure decays back on paper', () => {
    const m = new GazeStateMachine();
    m.setState(GazeState.LookingAround);
    m.tick(2);
    m.setState(GazeState.Paper);
    const before = m.exposure;
    m.tick(2);
    expect(m.exposure).toBeLessThan(before);
  });

  it('breathing is the exposure variable', () => {
    const m = new GazeStateMachine();
    m.setState(GazeState.LookingAround);
    m.tick(1.3);
    expect(m.breathing).toBeCloseTo(m.exposure, 4);
  });
});

describe('2.2 dual gaze: perception', () => {
  it('warnings are indistinguishable for the first two seconds', () => {
    const t = new GazeStateMachine();
    t.injectGaze(GazeKind.Teacher);
    for (let i = 0; i < 3; i++) t.tick(0.5);
    expect(t.perceived).toBe(GazeWarning.Unknown);
    t.tick(1);
    expect(t.perceived).toBe(GazeWarning.Teacher);
  });
});

describe('2.2 teacher gaze (decision #37)', () => {
  it('looking up under teacher gaze costs a record, not death', () => {
    const m = new GazeStateMachine();
    m.injectGaze(GazeKind.Teacher);
    m.setState(GazeState.LookingAround);
    expect(tickSeconds(m, 1.0, 0.25)).toBe(TickResult.Recorded);
    expect(m.timesRecorded).toBe(1);
    expect(m.isDead).toBe(false);
  });

  it('one gaze event records only once', () => {
    const m = new GazeStateMachine();
    m.injectGaze(GazeKind.Teacher);
    m.setState(GazeState.LookingAround);
    tickSeconds(m, 2.0, 0.25);
    expect(m.timesRecorded).toBe(1);
  });

  it('staying down under teacher gaze is correct', () => {
    const m = new GazeStateMachine();
    m.injectGaze(GazeKind.Teacher);
    tickSeconds(m, 2.0, 0.25);
    expect(m.timesRecorded).toBe(0);
    expect(m.isDead).toBe(false);
  });

  it('using the phone under teacher gaze is a violation', () => {
    const m = new GazeStateMachine();
    m.injectGaze(GazeKind.Teacher);
    m.setState(GazeState.Phone);
    expect(tickSeconds(m, 1.0, 0.25)).toBe(TickResult.Recorded);
    expect(m.timesRecorded).toBe(1);
  });

  it('third record kills', () => {
    const m = new GazeStateMachine();
    for (let pass = 0; pass < 3; pass++) {
      m.injectGaze(GazeKind.None);
      m.injectGaze(GazeKind.Teacher);
      m.setState(GazeState.LookingAround);
      tickSeconds(m, 1.0, 0.25);
      if (pass < 2) expect(m.isDead, 'pass ' + pass).toBe(false);
    }
    expect(m.isDead).toBe(true);
    expect(m.cause).toBe(DeathCause.Records);
    expect(m.timesRecorded).toBe(3);
  });

  it('timed teacher gaze leaves on its own', () => {
    const m = new GazeStateMachine();
    m.injectGaze(GazeKind.Teacher, 1.0);
    tickSeconds(m, 1.5, 0.25);
    expect(m.activeGaze).toBe(GazeKind.None);
  });
});

describe('exposure summons the teacher (decision #37)', () => {
  it('maxed exposure summons the teacher instead of killing', () => {
    const m = new GazeStateMachine();
    m.setState(GazeState.LookingAround);
    let summoned = false;
    for (let i = 0; i < 20 && !summoned; i++) summoned = m.tick(0.25) === TickResult.Summoned;
    expect(summoned).toBe(true);
    expect(m.activeGaze).toBe(GazeKind.Teacher);
    expect(m.activeGazeSummoned).toBe(true);
    expect(m.isDead).toBe(false);
  });

  it('going back to paper survives a summoned gaze', () => {
    const m = new GazeStateMachine();
    m.setState(GazeState.LookingAround);
    while (m.activeGaze === GazeKind.None) m.tick(0.25);
    m.setState(GazeState.Paper);
    tickSeconds(m, m.summonedGazeSeconds + 0.5, 0.25);
    expect(m.timesRecorded).toBe(0);
    expect(m.activeGaze).toBe(GazeKind.None);
  });

  it('exposure does not summon over an active anomaly', () => {
    const m = new GazeStateMachine();
    m.injectGaze(GazeKind.Anomaly);
    m.setState(GazeState.LookingAround);
    m.setAimingAtAnomaly(false);
    tickSeconds(m, 6.0, 0.25);
    expect(m.activeGaze).toBe(GazeKind.Anomaly);
  });
});

describe('2.2 anomaly gaze', () => {
  it('hiding from an anomaly in the paper kills', () => {
    const m = new GazeStateMachine();
    m.injectGaze(GazeKind.Anomaly);
    expect(tickSeconds(m, 1.0, 0.25)).toBe(TickResult.Died);
    expect(m.cause).toBe(DeathCause.Anomaly);
  });

  it('using the phone under anomaly gaze kills', () => {
    const m = new GazeStateMachine();
    m.injectGaze(GazeKind.Anomaly);
    m.setState(GazeState.Phone);
    expect(tickSeconds(m, 1.0, 0.25)).toBe(TickResult.Died);
    expect(m.cause).toBe(DeathCause.Anomaly);
  });

  it('staring back gives feedback from the first tick and repels', () => {
    const m = new GazeStateMachine();
    m.injectGaze(GazeKind.Anomaly);
    m.setState(GazeState.LookingAround);
    m.setAimingAtAnomaly(true);
    m.tick(0.05);
    expect(m.anomalyRepelProgress).toBeGreaterThan(0);
    expect(tickSeconds(m, 3.0, 0.05)).toBe(TickResult.Repelled);
    expect(m.activeGaze).toBe(GazeKind.None);
  });

  it('an anomaly behind you is neutral', () => {
    const m = new GazeStateMachine();
    m.injectGaze(GazeKind.Anomaly);
    m.setState(GazeState.LookingAround);
    m.setAimingAtAnomaly(false);
    tickSeconds(m, 3.0, 0.25);
    expect(m.isDead).toBe(false);
    expect(m.anomalyRepelProgress).toBe(0);
  });

  it('a dead machine stays dead and ignores input', () => {
    const m = new GazeStateMachine();
    m.injectGaze(GazeKind.Anomaly);
    tickSeconds(m, 1.0, 0.25);
    m.setState(GazeState.LookingAround);
    expect(m.tick(1)).toBe(TickResult.Died);
    expect(m.state).toBe(GazeState.Paper);
  });
});
