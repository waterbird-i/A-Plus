import { DeterministicRng } from './rng';
import type { RunState } from './runState';
import type { StringTable } from './stringTable';

/** 答案表达式的值：要么是整数，要么是一段文本。四选一只比较 display。 */
export interface AnswerValue {
  isNumber: boolean;
  number: number;
  text: string;
}

export function numberValue(n: number): AnswerValue {
  return { isNumber: true, number: n, text: '' };
}

export function textValue(s: string): AnswerValue {
  return { isNumber: false, number: 0, text: s ?? '' };
}

export function display(v: AnswerValue): string {
  return v.isNumber ? String(v.number) : v.text;
}

export class FormatError extends Error {
  override name = 'FormatError';
}

export function formatTemplate(template: string, arg: string): string {
  return (template ?? '').split('{0}').join(arg ?? '');
}

/**
 * 动态答案求值时能读到的世界状态。同一轮里，场景把同一份上下文画出来，
 * 卷子用它判分 —— 所以挂钟慢几分钟、红榜排第几，场景和答案永远一致。
 */
export class AnswerContext {
  seed = 0;
  year = 0;
  attempt = 0;
  deaths = 0;
  roundSize = 0;
  /** q.fill.07：挂钟比广播慢几分钟（每轮随机 0–15）。 */
  clockOffset = 0;
  readonly strings = new Map<string, string>();
  /** @key 取文本表里的「意思」。 */
  text: (key: string) => string = (key) => '[' + key + ']';

  intVar(name: string): number {
    switch (name) {
      case 'year': return this.year;
      case 'attempt': return this.attempt;
      case 'deaths': return this.deaths;
      case 'round_size': return this.roundSize;
      case 'clock_offset': return this.clockOffset;
    }
    throw new FormatError('unknown variable: ' + name);
  }

  static fromRun(run: RunState, roundSize: number, table: StringTable | null): AnswerContext {
    const c = new AnswerContext();
    c.seed = run.roundSeed;
    c.year = run.year;
    c.attempt = run.attempt;
    c.deaths = run.totalDeaths;
    c.roundSize = roundSize;
    c.clockOffset = new DeterministicRng(run.roundSeed ^ 0x51ed270b).next(16);
    if (table) c.text = (key) => table.get(key);

    const header = run.headerShowsCandidateNumber
      ? run.candidateNumber
      : formatTemplate(c.text('paper.header.count_fmt'), String(run.attempt));
    c.strings.set('header', header);
    c.strings.set('candidate', run.candidateNumber);
    c.strings.set('roster_next', run.rosterNumber(0));
    return c;
  }
}

/**
 * answer_chain.csv 里 answer_expr 与 distractors 中 `=` 项的求值器。语法（参数用 ; 分隔，避开 CSV 的逗号）：
 *
 *   expr    := unary (('+' | '-') unary)*
 *   unary   := '-'? primary
 *   primary := int | var | after(n) | rand(a;b) | oneof(e;e;…) | @key | @key(expr) | $name | 'text' | (expr)
 *
 * rand / oneof 用每题独立的确定性随机：同一轮同一题永远得到同一个值。
 */
export class AnswerExpression {
  private i = 0;
  /** oneof 没被选中的候选（给 distractors = rest 用）。 */
  readonly alternatives: AnswerValue[] = [];

  private constructor(
    private readonly s: string,
    private readonly ctx: AnswerContext,
    private readonly rng: DeterministicRng,
  ) {}

  static evaluate(source: string, ctx: AnswerContext, rng: DeterministicRng, alternatives: AnswerValue[] | null): AnswerValue {
    const e = new AnswerExpression(source ?? '', ctx, rng);
    const v = e.parseExpr();
    e.skipSpace();
    if (e.i !== e.s.length) throw e.error('unexpected trailing input');
    if (alternatives) alternatives.push(...e.alternatives);
    return v;
  }

  private parseExpr(): AnswerValue {
    let left = this.parseUnary();
    for (;;) {
      this.skipSpace();
      if (this.i >= this.s.length) return left;
      const op = this.s[this.i];
      if (op !== '+' && op !== '-') return left;
      this.i++;
      const right = this.parseUnary();
      if (!left.isNumber || !right.isNumber) throw this.error('arithmetic on text');
      left = numberValue(op === '+' ? (left.number + right.number) | 0 : (left.number - right.number) | 0);
    }
  }

  private parseUnary(): AnswerValue {
    this.skipSpace();
    if (this.peek('-')) {
      this.i++;
      const v = this.parsePrimary();
      if (!v.isNumber) throw this.error('negating text');
      return numberValue(-v.number | 0);
    }
    return this.parsePrimary();
  }

  private parsePrimary(): AnswerValue {
    this.skipSpace();
    if (this.i >= this.s.length) throw this.error('unexpected end');
    const c = this.s[this.i];

    if (c >= '0' && c <= '9') {
      const start = this.i;
      while (this.i < this.s.length && this.s[this.i] >= '0' && this.s[this.i] <= '9') this.i++;
      return numberValue(parseInt(this.s.substring(start, this.i), 10));
    }
    if (c === '(') {
      this.i++;
      const v = this.parseExpr();
      this.expect(')');
      return v;
    }
    if (c === "'") {
      this.i++;
      const end = this.s.indexOf("'", this.i);
      if (end < 0) throw this.error('unterminated text');
      const text = this.s.substring(this.i, end);
      this.i = end + 1;
      return textValue(text);
    }
    if (c === '$') {
      this.i++;
      const name = this.readName(false);
      const value = this.ctx.strings.get(name);
      if (value === undefined) throw this.error('unknown string variable ' + name);
      return textValue(value);
    }
    if (c === '@') {
      this.i++;
      const key = this.readName(true);
      let text = this.ctx.text(key);
      this.skipSpace();
      if (this.peek('(')) {
        this.i++;
        const arg = this.parseExpr();
        this.expect(')');
        text = formatTemplate(text, display(arg));
      }
      return textValue(text);
    }

    const ident = this.readName(false);
    this.skipSpace();
    if (!this.peek('(')) return numberValue(this.ctx.intVar(ident));
    this.i++;
    const args: AnswerValue[] = [];
    this.skipSpace();
    if (!this.peek(')')) {
      for (;;) {
        args.push(this.parseExpr());
        this.skipSpace();
        if (this.peek(';')) { this.i++; continue; }
        break;
      }
    }
    this.expect(')');
    return this.call(ident, args);
  }

  private call(name: string, args: AnswerValue[]): AnswerValue {
    if (name === 'after') {
      this.requireNumbers(name, args, 1);
      return numberValue(this.ctx.attempt >= args[0].number ? 1 : 0);
    }
    if (name === 'rand') {
      this.requireNumbers(name, args, 2);
      const lo = Math.min(args[0].number, args[1].number);
      const hi = Math.max(args[0].number, args[1].number);
      return numberValue(lo + this.rng.next(hi - lo + 1));
    }
    if (name === 'oneof') {
      if (args.length < 2) throw this.error('oneof needs at least 2 choices');
      const pick = this.rng.next(args.length);
      for (let k = 0; k < args.length; k++) if (k !== pick) this.alternatives.push(args[k]);
      return args[pick];
    }
    throw this.error('unknown function ' + name);
  }

  private requireNumbers(name: string, args: AnswerValue[], count: number): void {
    if (args.length !== count) throw this.error(name + ' expects ' + count + ' argument(s)');
    if (args.some((a) => !a.isNumber)) throw this.error(name + ' expects numbers');
  }

  private readName(allowDots: boolean): string {
    const start = this.i;
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      const ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || (allowDots && c === '.');
      if (!ok) break;
      this.i++;
    }
    if (this.i === start) throw this.error('expected a name');
    return this.s.substring(start, this.i);
  }

  private skipSpace(): void {
    while (this.i < this.s.length && this.s[this.i] === ' ') this.i++;
  }

  private peek(c: string): boolean {
    return this.i < this.s.length && this.s[this.i] === c;
  }

  private expect(c: string): void {
    this.skipSpace();
    if (!this.peek(c)) throw this.error("expected '" + c + "'");
    this.i++;
  }

  private error(message: string): FormatError {
    return new FormatError(message + ' at ' + this.i + ' in: ' + this.s);
  }
}
