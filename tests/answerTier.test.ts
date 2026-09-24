import { describe, expect, it } from 'vitest';
import { AnswerContext, AnswerTier, DeathCause, RunState, answerTierFor, buildChoice, display } from '../src/core';
import { testData, testTable } from './support';

/**
 * #34：answer_chain.csv 的 answer_chars 列（答案字符数范围）。
 *
 * JS 校验器只能静态查固定题；动态题的答案要跑求值器才知道多长。
 * 这里按**真实答案求值**把 Demo 能走到的每一轮都枚举一遍，然后要求：
 *   1. 每题的答案字符数**始终落在**声明的区间里（声明不能撒谎）；
 *   2. 声明的两端**都真的取到过**（区间是紧的，不能随手写 1-99 糊过去）。
 * 所以改 deathsToHoldBack / sessionCount / 任何 answer_expr，都必须回来重标这一列。
 */

/** Demo 域：单场考试、死满 5 次留级（attempt 1–5）。这个假设由下面的 attempts 断言守住。 */
function roundsForSeed(seed: number): { attempt: number; ctx: AnswerContext }[] {
  const run = new RunState(seed);
  const out: { attempt: number; ctx: AnswerContext }[] = [];
  for (let i = 0; i < 10 && !run.isComplete; i++) {
    out.push({ attempt: run.attempt, ctx: AnswerContext.fromRun(run, 9, testTable()) });
    run.completeAttempt(true, 0, DeathCause.Anomaly);
  }
  return out;
}

const SEEDS = Array.from({ length: 48 }, (_, i) => 1000 + i * 7919);

const observed = new Map<string, { min: number; max: number }>();
const attemptsSeen = new Set<number>();
for (const seed of SEEDS) {
  for (const { attempt, ctx } of roundsForSeed(seed)) {
    attemptsSeen.add(attempt);
    for (const row of testData().chain) {
      const n = [...display(buildChoice(row, ctx).answer)].length;
      const cur = observed.get(row.qId);
      if (!cur) observed.set(row.qId, { min: n, max: n });
      else {
        cur.min = Math.min(cur.min, n);
        cur.max = Math.max(cur.max, n);
      }
    }
  }
}

describe('decision #34: answer_chars', () => {
  it('the simulated domain really is attempt 1-5', () => {
    expect([...attemptsSeen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('every declared range holds, and both ends are reached', () => {
    const failures: string[] = [];
    for (const row of testData().chain) {
      const seen = observed.get(row.qId);
      if (!seen) { failures.push(row.qId + ': never evaluated'); continue; }
      const declared = row.answerCharsMin + '-' + row.answerCharsMax;
      const actual = seen.min + '-' + seen.max;
      if (declared !== actual) failures.push(row.qId + ': declared ' + declared + ' but observed ' + actual);
      if (row.answerCharsMin > row.answerCharsMax) failures.push(row.qId + ': inverted range ' + declared);
    }
    expect(failures).toEqual([]);
  });

  it('fixed answers declare exactly their own character count', () => {
    const failures: string[] = [];
    for (const row of testData().chain) {
      if (row.isDynamic) continue;
      const n = [...row.answer].length;
      if (row.answerCharsMin !== n || row.answerCharsMax !== n) {
        failures.push(row.qId + ': answer is ' + n + ' chars but declares ' + row.answerCharsMin + '-' + row.answerCharsMax);
      }
    }
    expect(failures).toEqual([]);
  });

  it('tier boundaries follow occlusion spec 2.1', () => {
    expect(answerTierFor(1)).toBe(AnswerTier.A);
    expect(answerTierFor(2)).toBe(AnswerTier.A);
    expect(answerTierFor(3)).toBe(AnswerTier.B);
    expect(answerTierFor(4)).toBe(AnswerTier.B);
    expect(answerTierFor(5)).toBe(AnswerTier.C);
    expect(answerTierFor(19)).toBe(AnswerTier.C);
  });

  it('every question maps to a tier', () => {
    const byTier = { a: 0, b: 0, c: 0 };
    for (const row of testData().chain) byTier[answerTierFor(row.answerCharsMin)] += 1;
    expect(byTier.a + byTier.b + byTier.c).toBe(testData().chain.length);
  });
});
