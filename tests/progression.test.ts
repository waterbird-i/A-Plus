import { describe, expect, it } from 'vitest';
import {
  BroadcastTamper, DeathCause, DeathCurve, ExamClock, GazeDirector, GazeKind, GazeStateMachine, InvigilatorProfile,
  LedgerEntryKind, RunState, RunTransition, type BroadcastCue,
} from '../src/core';

describe('2.4 death curve: the five stages hold', () => {
  it('stage one is a full jump scare', () => {
    const p = new DeathCurve().evaluate(1);
    expect(p.stingerVolume).toBe(1);
    expect(p.flashIntensity).toBe(1);
    expect(p.cameraRush).toBe(1);
    expect(p.leadInSilenceSeconds).toBe(0);
    expect(p.postDeathDwellSeconds).toBe(0);
    expect(p.faceAppears).toBe(true);
    expect(p.eventless).toBe(false);
  });

  it('stage two: rush stops halfway and sound is muffled', () => {
    const p = new DeathCurve().evaluate(4);
    expect(p.cameraRush).toBeGreaterThanOrEqual(0.2);
    expect(p.cameraRush).toBeLessThanOrEqual(0.8);
    expect(p.stingerMuffle).toBeGreaterThan(0);
    expect(p.stingerVolume).toBeGreaterThan(0);
    expect(p.leadInSilenceSeconds).toBeGreaterThanOrEqual(0.3);
    expect(p.leadInSilenceSeconds).toBeLessThanOrEqual(1.0);
  });

  it('stage three stands still with delayed sound', () => {
    const c = new DeathCurve();
    for (let n = 6; n <= 9; n++) {
      const p = c.evaluate(n);
      expect(p.cameraRush, 'n=' + n).toBe(0);
      expect(p.flashIntensity, 'n=' + n).toBe(0);
      expect(p.audioDelaySeconds, 'n=' + n).toBeGreaterThanOrEqual(0.3);
      expect(p.audioDelaySeconds, 'n=' + n).toBeLessThanOrEqual(1.5);
      expect(p.faceAppears, 'n=' + n).toBe(true);
    }
  });

  it('stage four is silent without a face', () => {
    const c = new DeathCurve();
    for (let n = 10; n <= 14; n++) {
      const p = c.evaluate(n);
      expect(p.stingerVolume, 'n=' + n).toBe(0);
      expect(p.faceAppears, 'n=' + n).toBe(false);
      expect(p.eventless, 'n=' + n).toBe(false);
    }
  });

  it('stage five is an eventless death', () => {
    const p = new DeathCurve().evaluate(15);
    expect(p.eventless).toBe(true);
    expect(p.postDeathDwellSeconds).toBeCloseTo(8, 3);
  });

  it('every component moves monotonically', () => {
    const c = new DeathCurve();
    let prev = c.evaluate(1);
    for (let n = 2; n <= 20; n++) {
      const p = c.evaluate(n);
      expect(p.stingerVolume, 'n=' + n).toBeLessThanOrEqual(prev.stingerVolume);
      expect(p.flashIntensity, 'n=' + n).toBeLessThanOrEqual(prev.flashIntensity);
      expect(p.cameraRush, 'n=' + n).toBeLessThanOrEqual(prev.cameraRush);
      expect(p.leadInSilenceSeconds, 'n=' + n).toBeGreaterThanOrEqual(prev.leadInSilenceSeconds);
      expect(p.audioDelaySeconds, 'n=' + n).toBeGreaterThanOrEqual(prev.audioDelaySeconds);
      expect(p.postDeathDwellSeconds, 'n=' + n).toBeGreaterThanOrEqual(prev.postDeathDwellSeconds);
      prev = p;
    }
  });
});

describe('2.5 repeat structure', () => {
  it('death retries the same session and bumps the header', () => {
    const run = new RunState(1);
    expect(run.completeAttempt(true, 0, DeathCause.Anomaly)).toBe(RunTransition.Retry);
    expect(run.attempt).toBe(2);
    expect(run.totalDeaths).toBe(1);
    expect(run.session).toBe(1);
  });

  it('each attempt draws a different seed', () => {
    const run = new RunState(1);
    const first = run.roundSeed;
    run.completeAttempt(true, 0, DeathCause.Anomaly);
    expect(run.roundSeed).not.toBe(first);
  });

  it('five deaths in one session hold you back', () => {
    const run = new RunState(1);
    run.sessionCount = 4;
    let last: RunTransition = RunTransition.Retry;
    for (let i = 0; i < 5; i++) last = run.completeAttempt(true, 0, DeathCause.Records);
    expect(last).toBe(RunTransition.HeldBack);
    expect(run.session).toBe(2);
    expect(run.deathsThisSession).toBe(0);
    expect(run.heldBackCount).toBe(1);
  });

  it('the demo ends after its only session', () => {
    const run = new RunState(1);
    expect(run.completeAttempt(false, 1, DeathCause.None)).toBe(RunTransition.RunComplete);
    expect(run.isComplete).toBe(true);
  });

  it('year walks back one to three years per death and stops at 1998', () => {
    const run = new RunState(7);
    run.sessionCount = 100;
    let prev = run.year;
    expect(prev).toBe(2026);
    for (let i = 0; i < 40; i++) {
      run.completeAttempt(true, 0, DeathCause.Anomaly);
      const step = prev - run.year;
      if (prev > run.earliestYear + 3) {
        expect(step, 'death ' + (i + 1)).toBeGreaterThanOrEqual(1);
        expect(step, 'death ' + (i + 1)).toBeLessThanOrEqual(3);
      }
      prev = run.year;
    }
    expect(run.year).toBe(1998);
  });

  it('records and deaths are written into the ledger', () => {
    const run = new RunState(1);
    run.completeAttempt(true, 2, DeathCause.Records);
    expect(run.ledger.length).toBe(3);
    expect(run.ledger[0].kind).toBe(LedgerEntryKind.Record);
    expect(run.ledger[2].kind).toBe(LedgerEntryKind.Death);
    expect(run.ledger[2].year).toBe(2026);
  });

  it('adapted note and candidate header appear late', () => {
    const run = new RunState(1);
    run.sessionCount = 100;
    for (let i = 0; i < 9; i++) run.completeAttempt(true, 0, DeathCause.Anomaly);
    expect(run.ledgerShowsAdaptedNote).toBe(false);
    run.completeAttempt(true, 0, DeathCause.Anomaly);
    expect(run.ledgerShowsAdaptedNote).toBe(true);
    expect(run.headerShowsCandidateNumber).toBe(false);
    for (let i = 0; i < 4; i++) run.completeAttempt(true, 0, DeathCause.Anomaly);
    expect(run.headerShowsCandidateNumber).toBe(true);
  });
});

describe('part 3: clock and broadcast', () => {
  it('twenty game minutes take ten real minutes', () => {
    const clock = new ExamClock();
    clock.build(BroadcastTamper.Normal);
    const fired: BroadcastCue[] = [];
    for (let i = 0; i < 599; i++) clock.tick(1, fired);
    expect(clock.isOver).toBe(false);
    clock.tick(1, fired);
    expect(clock.isOver).toBe(true);
    expect(fired[fired.length - 1].key).toBe('broadcast.collect.stop');
  });

  it('normal broadcast announces 15 / 10 / 5 / 1', () => {
    const clock = new ExamClock();
    clock.build(BroadcastTamper.Normal);
    const got: string[] = [];
    for (const c of clock.cues) {
      if (c.key === 'broadcast.time.remain_fmt') got.push(c.arg);
      if (c.key === 'broadcast.time.remain_last5') got.push('last5');
      if (c.key === 'broadcast.time.remain_last1') got.push('last1');
    }
    expect(got).toEqual(['15', '10', 'last5', 'last1']);
  });

  it('rewound broadcast counts upwards', () => {
    const clock = new ExamClock();
    clock.build(BroadcastTamper.Rewind);
    const got = clock.cues.filter((c) => c.key === 'broadcast.time.remain_fmt').map((c) => parseInt(c.arg, 10));
    expect(got.length).toBe(4);
    for (let i = 1; i < got.length; i++) expect(got[i]).toBeGreaterThan(got[i - 1]);
  });

  it('roster broadcast reads candidate numbers instead of time', () => {
    const clock = new ExamClock();
    clock.rosterNumbers = ['0601', '0713'];
    clock.build(BroadcastTamper.Roster);
    expect(clock.cues.some((c) => c.key === 'broadcast.time.remain_fmt')).toBe(false);
    expect(clock.cues.filter((c) => c.key === 'broadcast.roster_fmt').length).toBe(4);
  });

  it('listening window is open only inside its slot', () => {
    const clock = new ExamClock();
    clock.build(BroadcastTamper.Normal);
    clock.tick(clock.listeningStartGameSecond / clock.timeScale - 1, null);
    expect(clock.inListening).toBe(false);
    clock.tick(2, null);
    expect(clock.inListening).toBe(true);
    clock.tick(clock.listeningDurationGameSeconds / clock.timeScale, null);
    expect(clock.inListening).toBe(false);
  });
});

function countAnomalies(intensity: number): number {
  const m = new GazeStateMachine();
  const d = new GazeDirector(InvigilatorProfile.podium(), 5, intensity);
  let n = 0;
  for (let i = 0; i < 1200 * 4; i++) {
    d.tick(0.25, m);
    if (m.activeGaze === GazeKind.Anomaly) { n++; m.injectGaze(GazeKind.None); }
    if (m.activeGaze === GazeKind.Teacher) m.injectGaze(GazeKind.None);
  }
  return n;
}

describe('2.3 director', () => {
  it('injects one gaze at a time and teacher gazes expire', () => {
    const m = new GazeStateMachine();
    const d = new GazeDirector(InvigilatorProfile.podium(), 99, 0);
    let teacher = 0;
    let anomaly = 0;
    let prev: GazeKind = GazeKind.None;
    for (let i = 0; i < 600 * 4; i++) {
      d.tick(0.25, m);
      m.tick(0.25);
      if (m.activeGaze !== prev) {
        if (m.activeGaze === GazeKind.Teacher) teacher++;
        if (m.activeGaze === GazeKind.Anomaly) {
          anomaly++;
          m.injectGaze(GazeKind.None);
        }
        prev = m.activeGaze;
      }
    }
    expect(teacher, 'teacher gazes in 10 minutes').toBeGreaterThanOrEqual(10);
    expect(teacher).toBeLessThanOrEqual(30);
    expect(anomaly, 'anomalies in 10 minutes').toBeGreaterThanOrEqual(5);
    expect(anomaly).toBeLessThanOrEqual(14);
    expect(m.isDead).toBe(false);
  });

  it('higher anomaly intensity means more anomalies', () => {
    expect(countAnomalies(1)).toBeGreaterThan(countAnomalies(0));
  });

  it('cues before a gaze lands', () => {
    const m = new GazeStateMachine();
    const d = new GazeDirector(InvigilatorProfile.podium(), 3, 0);
    let cuedBeforeFirst = false;
    while (m.activeGaze === GazeKind.None) {
      if (d.isCueing) cuedBeforeFirst = true;
      d.tick(0.1, m);
    }
    expect(cuedBeforeFirst).toBe(true);
  });

  it('listening slows anomalies and silences the teacher', () => {
    const p = InvigilatorProfile.podium();
    const m = new GazeStateMachine();
    const d = new GazeDirector(p, 11, 1);
    d.listening = true;
    expect(d.upcomingKind).toBe(GazeKind.Anomaly);
    expect(d.secondsToNext).toBeCloseTo(p.firstAnomalyDelay / p.listeningAnomalyRate, 2);

    let t = 0;
    while (m.activeGaze === GazeKind.None && t < 1000) {
      d.tick(0.1, m);
      t += 0.1;
    }
    expect(m.activeGaze).toBe(GazeKind.Anomaly);
    expect(Math.abs(t - p.firstAnomalyDelay / p.listeningAnomalyRate)).toBeLessThanOrEqual(0.2);
  });
});
