import { describe, expect, it } from 'vitest';
import {
  DeathCause, ExamSession, GazeKind, GazeState, InvigilatorProfile, PatrolState, PhoneKey, PhoneScreen, RunState,
  SessionEvents, SessionPhase, TickResult,
} from '../src/core';
import { testData, testTable } from './support';

function patrolSession(seed: number): ExamSession {
  const s = new ExamSession(testData(), testTable(), new RunState(seed), InvigilatorProfile.patrol());
  s.begin();
  return s;
}

function press(s: ExamSession, keys: string): void {
  for (const k of keys) s.pressPhoneKey(k as PhoneKey);
}

interface BotResult { catches: number; searches: number; asks: number }

/**
 * 小心的作弊者：先静音；只在她看不见、不在附近、没起疑时掏手机；一有风吹草动就收。
 * 先把每道题都发给学霸（便宜、异步，但可能错），再拿剩下的话费搜题（准但贵）去补没回的、核对回了的。
 * 异象来了就抬头瞪回去。
 * 它证明的是：这套规则下，靠手机拿到答案、活着交卷是做得到的。
 */
function playCarefulCheater(s: ExamSession): BotResult {
  const patrol = s.patrol!;
  const phone = s.phone;
  const ev = new SessionEvents();
  const known = new Map<number, string>();
  const verified = new Set<number>();
  const asked = new Set<number>();
  const out: BotResult = { catches: 0, searches: 0, asks: 0 };
  let target = -1;

  for (let step = 0; step < 20000 && s.phase === SessionPhase.Running; step++) {
    const anomaly = s.gaze.activeGaze === GazeKind.Anomaly;
    const busy = patrol.state !== PatrolState.Podium && patrol.state !== PatrolState.Walking && patrol.state !== PatrolState.Pausing;
    const danger = patrol.watchingPlayer || patrol.suspicion > 0.02 || busy || patrol.distanceToPlayer < 2.5
      || s.gaze.activeGaze === GazeKind.Teacher || s.clock.inListening;

    if (anomaly) {
      s.setGaze(GazeState.LookingAround);
      s.gaze.setAimingAtAnomaly(true);
      target = -1;
    } else if (danger || phone.dead) {
      s.gaze.setAimingAtAnomaly(false);
      s.setGaze(GazeState.Paper);
      target = -1;
    } else {
      s.gaze.setAimingAtAnomaly(false);
      s.setGaze(GazeState.Phone);
      if (!phone.silent) {
        press(s, '5');
        s.pressPhoneKey(PhoneKey.Ok);
        s.pressPhoneKey(PhoneKey.Back);
      } else if (phone.screen === PhoneScreen.SearchResult) {
        if (phone.result && phone.result.number > 0) {
          known.set(phone.result.number - 1, phone.result.answer);
          verified.add(phone.result.number - 1);
        }
        s.pressPhoneKey(PhoneKey.Back);
        target = -1;
      } else if (phone.screen === PhoneScreen.Home) {
        const replies = phone.inbox.filter((m) => m.question > 0 && !m.read);
        if (replies.length > 0) {
          press(s, '3');
          for (const m of replies) {
            m.read = true;
            if (!verified.has(m.question - 1)) known.set(m.question - 1, m.text.slice(m.text.indexOf(' ') + 1));
          }
          s.pressPhoneKey(PhoneKey.Back);
        } else {
          const toAsk = s.questions.findIndex((_, i) => !asked.has(i) && !known.has(i));
          const unanswered = s.questions.findIndex((_, i) => !known.has(i) && !verified.has(i) && asked.has(i) && phone.pendingReplies === 0);
          const unverified = s.questions.findIndex((_, i) => !verified.has(i));
          target = toAsk >= 0 ? toAsk : unanswered >= 0 ? unanswered : unverified;
          if (target < 0) s.setGaze(GazeState.Paper);
          else if (toAsk >= 0 && phone.balanceCents >= phone.smsCostCents) {
            press(s, '2' + String(target + 1));
            s.pressPhoneKey(PhoneKey.Ok);
            asked.add(target);
            out.asks++;
          } else if (phone.balanceCents >= phone.searchCostCents) {
            press(s, '1' + phone.codeFor(target));
            s.pressPhoneKey(PhoneKey.Ok);
            out.searches++;
          } else {
            s.setGaze(GazeState.Paper);
          }
        }
      }
    }

    if (s.gaze.state === GazeState.Paper) {
      for (const [i, a] of known) s.select(i, s.questions[i].choices.indexOf(a));
    }
    ev.clear();
    s.tick(0.1, ev);
    if (ev.caught) out.catches++;
  }
  return out;
}

describe('decision #43: patrol mode inside a whole exam', () => {
  it('no scheduled teacher gazes, and maxed exposure does not summon one', () => {
    const s = patrolSession(3);
    expect(s.patrol).not.toBeNull();
    expect(s.gaze.summonOnExposure).toBe(false);
    const ev = new SessionEvents();
    let teacherWithoutCatch = 0;
    for (let step = 0; step < 150; step++) {
      s.setGaze(GazeState.LookingAround);
      ev.clear();
      s.tick(0.1, ev);
      if (s.gaze.activeGaze === GazeKind.Teacher && s.patrol!.state !== PatrolState.Glaring) teacherWithoutCatch++;
    }
    expect(s.gaze.exposure).toBe(1);
    expect(teacherWithoutCatch).toBe(0);
    expect(ev.gaze).not.toContain(TickResult.Summoned);
  });

  it('phone keys only work with the phone out; putting it away resets the phone', () => {
    const s = patrolSession(3);
    expect(s.pressPhoneKey(PhoneKey.D1)).toBe(false);
    s.setGaze(GazeState.Phone);
    expect(s.pressPhoneKey(PhoneKey.D1)).toBe(true);
    expect(s.phone.screen).toBe(PhoneScreen.Search);
    s.setGaze(GazeState.Paper);
    expect(s.phone.screen).toBe(PhoneScreen.Home);
  });

  it('when she catches you the phone is snatched away and input is locked for the scare', () => {
    const s = patrolSession(4);
    const ev = new SessionEvents();
    let caughtAt = -1;
    for (let step = 0; step < 6000 && caughtAt < 0; step++) {
      s.setGaze(GazeState.Phone);
      ev.clear();
      s.tick(0.1, ev);
      if (ev.caught) caughtAt = step;
    }
    expect(caughtAt).toBeGreaterThan(0);
    expect(s.gaze.state).toBe(GazeState.Paper);
    expect(s.gaze.timesRecorded).toBe(1);
    expect(s.inputLocked).toBe(true);
    s.setGaze(GazeState.Phone);
    expect(s.gaze.state).toBe(GazeState.Paper);
    expect(s.pressPhoneKey(PhoneKey.D1)).toBe(false);
  });

  it('a reckless cheater is caught again and again and dies of the register', () => {
    const s = patrolSession(5);
    const ev = new SessionEvents();
    let catches = 0;
    for (let step = 0; step < 20000 && s.phase === SessionPhase.Running; step++) {
      s.setGaze(GazeState.Phone);
      ev.clear();
      s.tick(0.1, ev);
      if (ev.caught) catches++;
    }
    expect(s.phase).toBe(SessionPhase.Died);
    expect(s.gaze.cause).toBe(DeathCause.Records);
    expect(catches).toBeGreaterThanOrEqual(2);
  });

  it('a careful cheater gets the answers from the phone and hands in the paper alive', () => {
    const scores: number[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const s = patrolSession(seed);
      const wallet = s.phone.balanceCents;
      const r = playCarefulCheater(s);
      expect(s.phase, 'seed ' + seed + ' ' + JSON.stringify(r)).toBe(SessionPhase.Submitted);
      expect(r.searches).toBeGreaterThan(0);
      // 电量不该替话费做主：小心的人电撑得到交卷，钱真的花在了搜题上。
      expect(s.phone.dead, 'seed ' + seed).toBe(false);
      expect(s.phone.balanceCents, 'seed ' + seed).toBeLessThan(wallet - r.asks * s.phone.smsCostCents);
      scores.push(s.score);
    }
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(mean, 'scores ' + scores.join(',')).toBeGreaterThanOrEqual(6);
  });
});
