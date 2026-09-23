import { Channel, Difficulty, type AnswerChainRow, type AnswerSource, type GameData, type OcclusionDef } from './gameData';
import { DeterministicRng } from './rng';

/**
 * 配比的分配策略。这是「每轮手感」的真正开关，比配比数字本身更重要：
 *   quota         固定配额：组成完全可预测，但每轮手感一模一样。
 *   quota_jitter  配额 + 抖动：在配额上随机挪 1–2 道，每轮略有起伏，预算仍受控。
 *   weighted      按难度加权、不预先配额：每轮组成天然不同。
 * 三种策略的实测对比见 Docs/难度配比标定.md。
 */
export const AllocationMode = { Quota: 'quota', QuotaJitter: 'quota_jitter', Weighted: 'weighted' } as const;
export type AllocationMode = (typeof AllocationMode)[keyof typeof AllocationMode];

/** 每轮 8–10 道的难度配比。 */
export class MixSpec {
  constructor(public name: string, public easy: number, public medium: number, public hard: number) {}

  get total(): number { return this.easy + this.medium + this.hard; }

  /** 解析 "3,4,2"（易,中,难）；名字可选："3,4,2@baseline"。 */
  static parse(text: string): MixSpec {
    let name = '';
    const at = text.indexOf('@');
    if (at >= 0) { name = text.substring(at + 1); text = text.substring(0, at); }
    const v = [0, 0, 0];
    text.split(',').slice(0, 3).forEach((p, i) => {
      const n = parseInt(p.trim(), 10);
      v[i] = /^\s*[+-]?\d+\s*$/.test(p) ? n : 0;
    });
    if (name.length === 0) name = v.join(',');
    return new MixSpec(name, v[0], v[1], v[2]);
  }

  toAscii(): string {
    return 'easy=' + this.easy + ' medium=' + this.medium + ' hard=' + this.hard;
  }
}

/** 本轮卷子上的一道题，连同它这一轮被随机到的落位与遮挡。 */
export interface PlannedItem {
  chain: AnswerChainRow;
  source: AnswerSource | null;
  /** "" = 无遮挡 */
  occlusionLabel: string;
  /** ASCII，代码 / JSON 只用这个 */
  occlusionId: string;
  occlusionKind: string;
  requiresSourceSwitch: boolean;
  mixedChannel: boolean;
  nonDemoPlacement: boolean;
  difficultyId: Difficulty;
  /** 原型模型：见 Docs */
  actionSteps: number;
  /** 原型模型：见 Docs */
  exposureScore: number;
}

export class RoundPlan {
  seed = 0;
  size = 0;
  items: PlannedItem[] = [];
  /** 配比没兑现的题数（题库该难度不够） */
  shortfall = 0;
  filledFromEasy = 0;
  filledFromMedium = 0;
  filledFromHard = 0;
  easyCount = 0;
  mediumCount = 0;
  hardCount = 0;
  phoneItems = 0;
  envItems = 0;
  mixedChannelItems = 0;
  occludedItems = 0;
  unresolvableItems = 0;
  nonDemoPlacements = 0;
  totalSteps = 0;
  totalExposure = 0;
  minSteps = 0;
  maxSteps = 0;

  finish(): void {
    this.size = this.items.length;
    for (const it of this.items) {
      if (it.difficultyId === Difficulty.Easy) this.easyCount++;
      else if (it.difficultyId === Difficulty.Hard) this.hardCount++;
      else this.mediumCount++;

      if (it.source && it.source.channel === Channel.Phone) this.phoneItems++;
      else this.envItems++;
      if (it.mixedChannel) this.mixedChannelItems++;
      if (it.occlusionLabel.length > 0) this.occludedItems++;
      if (it.requiresSourceSwitch) this.unresolvableItems++;
      if (it.nonDemoPlacement) this.nonDemoPlacements++;

      this.totalSteps += it.actionSteps;
      this.totalExposure += it.exposureScore;
    }
    this.minSteps = this.items.length === 0 ? 0 : Math.min(...this.items.map((i) => i.actionSteps));
    this.maxSteps = this.items.length === 0 ? 0 : Math.max(...this.items.map((i) => i.actionSteps));
  }
}

/**
 * 设计文档 4.3「三层随机」的可执行实现：
 *   1. 题目从题库抽（保证恐怖文本的作者质量，不程序生成文本）
 *   2. 答案源位置从那道题的合法落位池里抽
 *   3. 该源的遮挡状态随机 —— 让同一道题每次的获取路径长度不同
 *
 * 「合法落位池」是手工限定的（8.2 要求 2–4 个），所以答案永远藏在合理的地方。
 */
export class ExamRoundGenerator {
  demoOnly = true;
  /** 4.3 只说「部分答案源附加随机遮挡状态」，所以无遮挡要有自己的概率。 */
  noOcclusionProbability = 0.45;
  mode: AllocationMode = AllocationMode.QuotaJitter;
  /** quota_jitter 模式下每次挪几道题（1 = 只挪一道）。 */
  jitter = 1;

  constructor(readonly data: GameData) {}

  buildRound(seed: number, size: number, mix: MixSpec): RoundPlan {
    const rng = new DeterministicRng(seed);
    const plan = new RoundPlan();
    plan.seed = seed;

    const pool = this.data.chain.filter((c) => !this.demoOnly || c.isDemo);
    if (pool.length === 0) { plan.finish(); return plan; }
    if (size > pool.length) size = pool.length;

    const easy = pool.filter((c) => c.difficulty === Difficulty.Easy);
    const medium = pool.filter((c) => c.difficulty === Difficulty.Medium);
    const hard = pool.filter((c) => c.difficulty === Difficulty.Hard);
    rng.shuffle(easy);
    rng.shuffle(medium);
    rng.shuffle(hard);

    const chosen: AnswerChainRow[] = [];

    if (this.mode === AllocationMode.Weighted) {
      // 加权、不放回：每抽一题，按难度权重在各桶的剩余池里选。不预先分配配额，
      // 所以每轮的难度组成天然不同（「每轮手感一样」正是固定配额造成的）。
      for (let n = 0; n < size; n++) {
        const we = easy.length > 0 ? mix.easy : 0;
        const wm = medium.length > 0 ? mix.medium : 0;
        const wh = hard.length > 0 ? mix.hard : 0;
        const all = we + wm + wh;
        if (all <= 0) break;
        const roll = rng.next(all);
        const pick = roll < we ? easy : roll < we + wm ? medium : hard;
        const idx = rng.next(pick.length);
        chosen.push(pick[idx]);
        pick.splice(idx, 1);
      }
    } else {
      let qe = mix.easy;
      let qm = mix.medium;
      let qh = mix.hard;
      if (this.mode === AllocationMode.QuotaJitter && this.jitter > 0) {
        // 在配额上挪动 jitter 次（总数不变），让每轮略有起伏但难度预算仍受控。
        for (let j = 0; j < this.jitter; j++) {
          const roll = rng.next(3);
          if (roll === 0 && qe > 0) { qe--; qm++; }
          else if (roll === 1 && qm > 0) { qm--; qh++; }
          else if (qh > 0) { qh--; qe++; }
        }
      }
      plan.shortfall += take(easy, qe, chosen);
      plan.shortfall += take(medium, qm, chosen);
      plan.shortfall += take(hard, qh, chosen);

      // 配比兑现不了时，从还有余量的桶里补（优先「中」，因为它是手感的基线）。
      if (chosen.length < size) {
        plan.filledFromMedium += fill(medium, size - chosen.length, chosen);
        plan.filledFromEasy += fill(easy, size - chosen.length, chosen);
        plan.filledFromHard += fill(hard, size - chosen.length, chosen);
      }
    }

    for (const c of chosen) plan.items.push(this.plan(c, rng));
    rng.shuffle(plan.items);
    plan.finish();
    return plan;
  }

  private plan(c: AnswerChainRow, rng: DeterministicRng): PlannedItem {
    // 第 2 层：答案源位置随机。Demo 轮次只能落在 demo=y 的源上。若一题的池里一个 demo 源都没有，
    // 那是数据问题（GameData.crossCheck 会报出来），这里仍然放一个进去让模拟跑下去，
    // 并把这次落位记进 nonDemoPlacements —— 它在 Demo 轮次里必须恒为 0。
    let candidates: AnswerSource[] = [];
    for (const id of c.pools) {
      const cand = this.data.sourceById.get(id);
      if (!cand) continue;
      if (this.demoOnly && !cand.isDemo) continue;
      candidates.push(cand);
    }
    if (candidates.length === 0) candidates = this.data.poolSources(c);
    const src = candidates.length > 0 ? candidates[rng.next(candidates.length)] : null;

    const it: PlannedItem = {
      chain: c,
      source: src,
      occlusionLabel: '',
      occlusionId: 'none',
      occlusionKind: 'none',
      requiresSourceSwitch: false,
      mixedChannel: this.data.isMixedChannel(c),
      nonDemoPlacement: src !== null && !src.isDemo,
      difficultyId: c.difficulty,
      actionSteps: 0,
      exposureScore: 0,
    };

    // 第 3 层：该源的遮挡状态随机（或无）
    let def: OcclusionDef | undefined;
    if (src) {
      const occ = intersect(src.occlusions, c.occlusions);
      if (occ.length > 0 && rng.nextFloat() >= this.noOcclusionProbability) {
        it.occlusionLabel = occ[rng.next(occ.length)];
        def = this.data.occlusionByLabel.get(it.occlusionLabel);
      }
    }
    if (def) {
      it.occlusionId = def.id;
      it.occlusionKind = def.kind;
      it.requiresSourceSwitch = !def.resolvable;
    }

    // 「动作步数」与「暴露分」是透明模型，不是实测手感：它把 4.3 的「有时秒答，有时要绕 3 步」
    // 变成一个可比较的数，用来挑难度配比。真机标定时应当用真人耗时替换它（见 Docs/难度配比标定.md）。
    const phone = src !== null && src.channel === Channel.Phone;
    let steps = 1; // 离开卷子（环视或掏手机）
    if (def) steps += def.extraSteps;
    if (c.crossSource.length > 0) steps += 1; // 还要读第二个源（跨源拼合）
    if (phone) steps += 1;
    if (it.requiresSourceSwitch) steps += 2; // 信息不可得 ⇒ 换到另一个落位池
    steps += 1; // 退回卷子作答
    it.actionSteps = steps;

    let exposure = src ? src.riskWeight : 0;
    if (def) exposure += 0.5 * def.extraSteps;
    if (c.crossSource.length > 0) exposure += 1;
    if (phone) exposure += 1.5;
    if (it.requiresSourceSwitch) exposure += 1;
    it.exposureScore = exposure;

    return it;
  }
}

function take(bucket: AnswerChainRow[], want: number, into: AnswerChainRow[]): number {
  if (want <= 0) return 0;
  const n = Math.min(want, bucket.length);
  into.push(...bucket.splice(0, n));
  return want - n;
}

function fill(bucket: AnswerChainRow[], want: number, into: AnswerChainRow[]): number {
  if (want <= 0) return 0;
  const n = Math.min(want, bucket.length);
  into.push(...bucket.splice(0, n));
  return n;
}

export function intersect(a: string[], b: string[]): string[] {
  return a.filter((x) => b.includes(x));
}
