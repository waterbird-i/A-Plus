/**
 * 自带确定性 PRNG（xorshift32），与原 C# 版逐位一致。
 * 刻意不用 Math.random：「按种子复现某一轮」是关卡调试与问题复现的刚需。
 */
export class DeterministicRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  nextUInt(): number {
    let x = this.state;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.state = x;
    return x;
  }

  /** [0, maxExclusive) */
  next(maxExclusive: number): number {
    if (maxExclusive <= 1) return 0;
    return this.nextUInt() % maxExclusive;
  }

  /** [0, 1) */
  nextFloat(): number {
    return (this.nextUInt() >>> 8) * (1.0 / 16777216.0);
  }

  shuffle<T>(list: T[]): void {
    for (let i = list.length - 1; i > 0; i--) {
      const j = this.next(i + 1);
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
  }
}

/** 32 位有符号整数运算（C# unchecked 语义）。种子派生全部走这里，才能和存档 / 原型复现同一张卷子。 */
export function i32Mul(a: number, b: number): number {
  return Math.imul(a, b);
}

export function i32Add(a: number, b: number): number {
  return (a + b) | 0;
}

const utf8 = new TextEncoder();

/** FNV-1a（按 UTF-8 字节），跨运行时稳定。 */
export function stableHash(s: string): number {
  let h = 2166136261;
  const bytes = utf8.encode(s ?? '');
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h | 0;
}
