import { describe, expect, it } from 'vitest';
import {
  AnswerContext, AnswerExpression, BroadcastTamper, DeathCause, DeathCurve, DeterministicRng, ExamSession, FormatError,
  GazeKind, GazeState, InvigilatorProfile, RunState, RunTransition, SessionConfig, SessionEvents, SessionPhase, TickResult,
  buildChoice, display, formatTemplate, type AnswerChainRow, type AnswerValue,
} from '../src/core';
import { testData, testTable } from './support';

function contextFor(attempt: number, deaths: number): AnswerContext {
  const run = new RunState(11);
  run.sessionCount = 100;
  for (let i = 0; i < deaths; i++) run.completeAttempt(true, 0, DeathCause.Anomaly);
  while (run.attempt < attempt) run.completeAttempt(false, 0, DeathCause.None);
  return AnswerContext.fromRun(run, 9, testTable());
}

function find(qid: string): AnswerChainRow {
  const row = testData().chain.find((r) => r.qId === qid);
  if (!row) throw new Error('missing ' + qid);
  return row;
}

describe('decision #38: four-choice', () => {
  it('every question builds four distinct choices across thirty rounds', () => {
    const failures: string[] = [];
    for (let attempt = 1; attempt <= 30; attempt++) {
      const ctx = contextFor(attempt, attempt - 1);
      for (const row of testData().chain) {
        let q;
        try { q = buildChoice(row, ctx); }
        catch (e) { failures.push(row.qId + ': ' + (e as Error).message); continue; }
        if (q.choices.length !== 4 || new Set(q.choices).size !== 4) failures.push(row.qId + ' attempt ' + attempt + ': ' + q.choices.join(' / '));
        else if (q.correctIndex < 0 || q.choices[q.correctIndex] !== display(q.answer)) failures.push(row.qId + ': correct index');
        for (const c of q.choices) if (c.startsWith('[')) failures.push(row.qId + ': unresolved text key ' + c);
      }
    }
    expect(failures).toEqual([]);
  });

  it('fixed answers are the literal answer', () => {
    const ctx = contextFor(1, 0);
    for (const row of testData().chain) {
      if (row.answerExpr.length > 0) continue;
      expect(display(buildChoice(row, ctx).answer), row.qId).toBe(row.answer);
    }
  });

  it('year questions follow the receding year', () => {
    const thisYear = find('q.news.01');
    const founded = find('q.fill.01');
    const early = contextFor(1, 0);
    const late = contextFor(8, 7);
    expect(buildChoice(thisYear, early).answer.number).toBe(2026);
    expect(buildChoice(thisYear, late).answer.number).toBe(late.year);
    expect(late.year).toBeLessThan(2026);
    expect(buildChoice(founded, late).answer.number).toBe(late.year - 45);
  });

  it('header question switches to the candidate number late', () => {
    const header = find('q.fill.43');
    const expected = formatTemplate(testTable().get('paper.header.count_fmt'), '3');
    expect(display(buildChoice(header, contextFor(3, 0)).answer)).toBe(expected);
    expect(display(buildChoice(header, contextFor(15, 14)).answer)).toBe('0713');
  });

  it('listening question draws from its four options', () => {
    const row = find('q.en.03');
    const pool = ['a', 'b', 'c', 'd'].map((k) => testTable().get('world.listening.q3.opt.' + k)).sort();
    const answers = new Set<string>();
    for (let attempt = 1; attempt <= 12; attempt++) {
      const q = buildChoice(row, contextFor(attempt, 0));
      expect([...q.choices].sort()).toEqual(pool);
      answers.add(display(q.answer));
    }
    expect(answers.size, 'the listening answer changes between rounds').toBeGreaterThan(1);
  });

  it('the same context builds the same question', () => {
    const row = find('q.fill.17');
    const a = buildChoice(row, contextFor(4, 3));
    const b = buildChoice(row, contextFor(4, 3));
    expect(b.choices).toEqual(a.choices);
    expect(b.correctIndex).toBe(a.correctIndex);
  });

  it('expression grammar', () => {
    const ctx = new AnswerContext();
    ctx.year = 2020;
    ctx.attempt = 5;
    ctx.strings.set('who', 'x');
    ctx.text = (key) => (key === 'k.fmt' ? '<{0}>' : '?');
    const rng = new DeterministicRng(1);
    const ev = (s: string, alt: AnswerValue[] | null = null) => AnswerExpression.evaluate(s, ctx, rng, alt);
    expect(ev('year-45').number).toBe(1975);
    expect(ev('21+after(4)').number).toBe(22);
    expect(ev('21+after(6)').number).toBe(21);
    expect(ev('@k.fmt(attempt+1)').text).toBe('<6>');
    expect(ev('$who').text).toBe('x');
    const r = ev('rand(1;3)').number;
    expect(r).toBeGreaterThanOrEqual(1);
    expect(r).toBeLessThanOrEqual(3);
    const rest: AnswerValue[] = [];
    ev("oneof('a';'b';'c')", rest);
    expect(rest.length).toBe(2);
    expect(() => ev('nope')).toThrow(FormatError);
    expect(() => ev('$who+1')).toThrow(FormatError);
  });
});

function newSession(run: RunState): ExamSession {
  const s = new ExamSession(testData(), testTable(), run, InvigilatorProfile.podium(), new SessionConfig(), new DeathCurve());
  s.begin();
  return s;
}

/** 知道真相且永远应对正确：师视低头，异视直视。返回听力时段以外的记名次数。 */
function playPerfectly(s: ExamSession, ev: SessionEvents): number {
  let recordsOutsideListening = 0;
  for (let step = 0; step < 20000 && s.phase === SessionPhase.Running; step++) {
    const anomaly = s.gaze.activeGaze === GazeKind.Anomaly;
    s.setGaze(anomaly ? GazeState.LookingAround : GazeState.Paper);
    s.gaze.setAimingAtAnomaly(anomaly);
    if (!anomaly) s.questions.forEach((q, i) => s.select(i, q.correctIndex));
    const listening = s.clock.inListening;
    ev.clear();
    s.tick(0.1, ev);
    if (!listening && ev.gaze.includes(TickResult.Recorded)) recordsOutsideListening++;
  }
  return recordsOutsideListening;
}

describe('the whole exam', () => {
  it('a perfect player survives the whole exam and scores full', () => {
    const s = newSession(new RunState(3));
    expect(s.questions.length).toBe(9);
    const outside = playPerfectly(s, new SessionEvents());
    expect(s.phase).toBe(SessionPhase.Submitted);
    expect(s.score).toBe(9);
    // A2：听力时段来的异象逼你在「记名（直视）」与「死（躲避）」之间选。
    expect(outside).toBe(0);
    expect(s.gaze.timesRecorded).toBeLessThanOrEqual(1);
    expect(s.finish()).toBe(RunTransition.RunComplete);
  });

  it('announces every broadcast in order', () => {
    const s = newSession(new RunState(3));
    const ev = new SessionEvents();
    const keys: string[] = [];
    for (let step = 0; step < 20000 && s.phase === SessionPhase.Running; step++) {
      const anomaly = s.gaze.activeGaze === GazeKind.Anomaly;
      s.setGaze(anomaly ? GazeState.LookingAround : GazeState.Paper);
      s.gaze.setAimingAtAnomaly(anomaly);
      ev.clear();
      s.tick(0.1, ev);
      for (const c of ev.broadcasts) keys.push(c.key);
    }
    expect(keys.length).toBe(s.clock.cues.length);
    expect(keys[0]).toBe('broadcast.check.device');
    expect(keys[keys.length - 1]).toBe('broadcast.collect.stop');
  });

  it('always hiding in the paper eventually dies to an anomaly', () => {
    const run = new RunState(3);
    const s = newSession(run);
    const ev = new SessionEvents();
    for (let step = 0; step < 20000 && s.phase === SessionPhase.Running; step++) { ev.clear(); s.tick(0.1, ev); }
    expect(s.phase).toBe(SessionPhase.Died);
    expect(s.gaze.cause).toBe(DeathCause.Anomaly);
    expect(s.death!.deathOrdinal).toBe(1);
    expect(s.finish()).toBe(RunTransition.Retry);
    expect(run.attempt).toBe(2);
  });

  it('answering is only possible on the paper', () => {
    const s = newSession(new RunState(3));
    s.setGaze(GazeState.LookingAround);
    expect(s.select(0, 0)).toBe(false);
    s.setGaze(GazeState.Paper);
    expect(s.select(0, 0)).toBe(true);
  });

  it('leaving the paper during listening is recorded', () => {
    const s = newSession(new RunState(3));
    const ev = new SessionEvents();
    const toListening = s.clock.listeningStartGameSecond / s.clock.timeScale;
    for (let t = 0; t < toListening + 0.5 && s.phase === SessionPhase.Running; t += 0.1) {
      const anomaly = s.gaze.activeGaze === GazeKind.Anomaly;
      s.setGaze(anomaly ? GazeState.LookingAround : GazeState.Paper);
      s.gaze.setAimingAtAnomaly(anomaly);
      ev.clear();
      s.tick(0.1, ev);
    }
    expect(s.clock.inListening).toBe(true);
    const before = s.gaze.timesRecorded;
    s.gaze.injectGaze(GazeKind.None);
    s.setGaze(GazeState.Phone);
    for (let i = 0; i < 10; i++) { ev.clear(); s.tick(0.1, ev); }
    expect(s.gaze.timesRecorded).toBe(before + 1);
  });

  it('later attempts corrupt the broadcast', () => {
    const run = new RunState(3);
    run.sessionCount = 100;
    expect(newSession(run).tamper).toBe(BroadcastTamper.Normal);
    while (run.attempt < 12) run.completeAttempt(true, 0, DeathCause.Anomaly);
    expect(newSession(run).tamper).toBe(BroadcastTamper.Roster);
  });
});
