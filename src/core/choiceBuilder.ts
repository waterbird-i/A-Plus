import { AnswerExpression, FormatError, display, textValue, type AnswerContext, type AnswerValue } from './answerExpression';
import type { AnswerChainRow } from './gameData';
import { DeterministicRng, i32Mul, stableHash } from './rng';
import type { PlannedItem } from './roundGenerator';

/** 卷子上的一道四选一（决策 #38）。按 1/2/3/4 作答。 */
export class ExamQuestion {
  plan: PlannedItem | null = null;
  choices: string[] = [];
  correctIndex = -1;
  selected = -1;

  constructor(readonly qId: string, readonly answer: AnswerValue) {}

  get isCorrect(): boolean {
    return this.selected >= 0 && this.selected === this.correctIndex;
  }
}

export const CHOICE_COUNT = 4;

/**
 * 把一条答案链变成一道四选一。答案先按 answer_expr 求值，干扰项再按 distractors 生成：
 *   字面列表   固定题的干扰项；以 = 开头的项按表达式求值
 *   auto:±n    数字答案的偏移（像被挡住了最后一位 / 看错了一个年代）
 *   rest       oneof 没被选中的那几个候选
 * 与答案相同或彼此重复的干扰项会被跳过，所以列表可以多写几个备用。
 * 干扰项是惰性生成的：凑满四个就停，后面的 `=` 项不会再消耗随机数。
 */
export function buildChoice(row: AnswerChainRow, ctx: AnswerContext): ExamQuestion {
  const rng = new DeterministicRng(i32Mul(ctx.seed, 16777619) ^ stableHash(row.qId));
  const alternatives: AnswerValue[] = [];

  const answer = row.answerExpr.length === 0
    ? textValue(row.answer)
    : AnswerExpression.evaluate(row.answerExpr, ctx, rng, alternatives);
  const q = new ExamQuestion(row.qId, answer);

  const choices: string[] = [display(answer)];
  for (const d of distractors(row, answer, ctx, rng, alternatives)) {
    if (choices.length >= CHOICE_COUNT) break;
    if (d.length === 0 || choices.includes(d)) continue;
    choices.push(d);
  }
  if (answer.isNumber) fillNumeric(choices, answer.number);

  rng.shuffle(choices);
  q.choices = choices;
  q.correctIndex = choices.indexOf(display(answer));
  return q;
}

function* distractors(row: AnswerChainRow, answer: AnswerValue, ctx: AnswerContext, rng: DeterministicRng, alternatives: AnswerValue[]): Generator<string> {
  const spec = row.distractors ?? '';
  if (spec === 'rest') {
    for (const a of alternatives) yield display(a);
    return;
  }
  if (spec.startsWith('auto:')) {
    if (!answer.isNumber) throw new FormatError(row.qId + ': auto distractors need a numeric answer');
    for (const raw of spec.substring(5).split('|')) {
      const text = raw.trim();
      if (!/^[+-]?\d+$/.test(text)) throw new FormatError(row.qId + ': bad auto offset ' + text);
      const v = answer.number + parseInt(text, 10);
      if (plausible(answer.number, v)) yield String(v);
    }
    return;
  }
  for (const item of spec.split('|')) {
    if (item.startsWith('=')) yield display(AnswerExpression.evaluate(item.substring(1), ctx, rng, null));
    else yield item;
  }
}

/** 题号、人数、年份都不会是负数；答案 ≥1 时干扰项也不该是 0。 */
function plausible(answer: number, candidate: number): boolean {
  if (candidate < 0) return false;
  if (answer >= 1 && candidate < 1) return false;
  return true;
}

function fillNumeric(choices: string[], answer: number): void {
  for (let k = 2; choices.length < CHOICE_COUNT && k < 100; k++) {
    for (const t of [answer + k, answer - k]) {
      if (choices.length >= CHOICE_COUNT) break;
      if (!plausible(answer, t)) continue;
      const s = String(t);
      if (!choices.includes(s)) choices.push(s);
    }
  }
}
