import { Difficulty, type GameData } from './gameData';
import { AllocationMode, ExamRoundGenerator, MixSpec } from './roundGenerator';

export class SimConfig {
  rounds = 2000;
  size = 9;
  seed = 20260101;
  mix = new MixSpec('3,3,3', 3, 3, 3);
  noOcclusionProbability = 0.45;
  demoOnly = true;
  mode: AllocationMode = AllocationMode.QuotaJitter;
  jitter = 1;
}

export interface SimResult {
  config: SimConfig;
  rounds: number;
  bankSize: number;
  poolEasy: number;
  poolMedium: number;
  poolHard: number;
  meanSize: number;
  meanEasy: number;
  meanMedium: number;
  meanHard: number;
  roundsWithShortfall: number;
  meanPhoneItems: number;
  meanMixedChannelItems: number;
  meanOccludedItems: number;
  meanUnresolvableItems: number;
  meanSteps: number;
  meanExposure: number;
  meanMinSteps: number;
  meanMaxSteps: number;
  withinRoundDuplicates: number;
  /** 落在 demo=n（正式版专属）源上的题数。Demo 轮次里必须恒为 0。 */
  nonDemoPlacements: number;
  /** 每轮「易」题数的波幅 —— 「每轮手感」的量化代理。 */
  minEasy: number;
  maxEasy: number;
  meanAbsEasyDev: number;
  meanCarryoverItems: number;
  chiSquarePerDf: number;
  distinctQuestionsSeen: number;
  meanRoundsToSeeAll: number;
  questionCounts: Map<string, number>;
  sourceCounts: Map<string, number>;
  occlusionCounts: Map<string, number>;
  stepHistogram: Map<number, number>;
  neverDrawnQuestions: string[];
  neverDrawnSources: string[];
  neverDrawnOcclusions: string[];
  neverDrawnOcclusionIds: string[];
}

function generatorFor(data: GameData, cfg: SimConfig): ExamRoundGenerator {
  const gen = new ExamRoundGenerator(data);
  gen.demoOnly = cfg.demoOnly;
  gen.noOcclusionProbability = cfg.noOcclusionProbability;
  gen.mode = cfg.mode;
  gen.jitter = cfg.jitter;
  return gen;
}

function bump<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * 把 4.3 的抽题流程跑很多轮，量出题库到底能撑几轮：
 *   meanRoundsToSeeAll   全部题目都出现过所需的轮数（coupon collector）
 *   meanCarryoverItems   相邻两轮重复的题数（期望约 k*k/N）
 *   chiSquarePerDf       题目出现频次是否均匀（≈1 就是均匀）
 *   neverDrawn*          跑完 N 轮从未被抽到过的题 / 源 / 遮挡 —— 那就是白做的内容
 */
export function runSimulation(data: GameData, cfg: SimConfig): SimResult {
  const gen = generatorFor(data, cfg);
  const bankSize = cfg.demoOnly ? data.chain.filter((c) => c.isDemo).length : data.chain.length;
  const r: SimResult = {
    config: cfg,
    rounds: cfg.rounds,
    bankSize,
    poolEasy: data.countByDifficulty(Difficulty.Easy, cfg.demoOnly),
    poolMedium: data.countByDifficulty(Difficulty.Medium, cfg.demoOnly),
    poolHard: data.countByDifficulty(Difficulty.Hard, cfg.demoOnly),
    meanSize: 0, meanEasy: 0, meanMedium: 0, meanHard: 0,
    roundsWithShortfall: 0,
    meanPhoneItems: 0, meanMixedChannelItems: 0, meanOccludedItems: 0, meanUnresolvableItems: 0,
    meanSteps: 0, meanExposure: 0, meanMinSteps: 0, meanMaxSteps: 0,
    withinRoundDuplicates: 0, nonDemoPlacements: 0,
    minEasy: 0, maxEasy: 0, meanAbsEasyDev: 0,
    meanCarryoverItems: 0, chiSquarePerDf: 0, distinctQuestionsSeen: 0, meanRoundsToSeeAll: 0,
    questionCounts: new Map(), sourceCounts: new Map(), occlusionCounts: new Map(), stepHistogram: new Map(),
    neverDrawnQuestions: [], neverDrawnSources: [], neverDrawnOcclusions: [], neverDrawnOcclusionIds: [],
  };

  let previous: Set<string> | null = null;
  for (let i = 0; i < cfg.rounds; i++) {
    const plan = gen.buildRound(cfg.seed + i * 7919, cfg.size, cfg.mix);

    r.meanSize += plan.size;
    r.meanEasy += plan.easyCount;
    r.meanMedium += plan.mediumCount;
    r.meanHard += plan.hardCount;
    if (plan.shortfall > 0) r.roundsWithShortfall++;
    r.meanPhoneItems += plan.phoneItems;
    r.meanMixedChannelItems += plan.mixedChannelItems;
    r.meanOccludedItems += plan.occludedItems;
    r.meanUnresolvableItems += plan.unresolvableItems;
    r.nonDemoPlacements += plan.nonDemoPlacements;
    r.meanAbsEasyDev += Math.abs(plan.easyCount - cfg.mix.easy);
    if (i === 0 || plan.easyCount < r.minEasy) r.minEasy = plan.easyCount;
    if (i === 0 || plan.easyCount > r.maxEasy) r.maxEasy = plan.easyCount;
    r.meanSteps += plan.totalSteps;
    r.meanExposure += plan.totalExposure;
    r.meanMinSteps += plan.minSteps;
    r.meanMaxSteps += plan.maxSteps;

    const current = new Set<string>();
    for (const it of plan.items) {
      if (current.has(it.chain.qId)) r.withinRoundDuplicates++;
      current.add(it.chain.qId);
      bump(r.questionCounts, it.chain.qId);
      if (it.source) bump(r.sourceCounts, it.source.id);
      bump(r.occlusionCounts, it.occlusionId);
      bump(r.stepHistogram, it.actionSteps);
    }

    if (previous) {
      let overlap = 0;
      for (const q of current) if (previous.has(q)) overlap++;
      r.meanCarryoverItems += overlap;
    }
    previous = current;
  }

  const n = Math.max(1, cfg.rounds);
  r.meanSize /= n; r.meanEasy /= n; r.meanMedium /= n; r.meanHard /= n;
  r.meanPhoneItems /= n; r.meanMixedChannelItems /= n;
  r.meanOccludedItems /= n; r.meanUnresolvableItems /= n;
  r.meanSteps /= n; r.meanExposure /= n;
  r.meanMinSteps /= n; r.meanMaxSteps /= n;
  r.meanCarryoverItems /= Math.max(1, cfg.rounds - 1);
  r.meanAbsEasyDev /= n;
  r.distinctQuestionsSeen = r.questionCounts.size;

  let total = 0;
  for (const v of r.questionCounts.values()) total += v;
  const expected = total / Math.max(1, r.bankSize);
  let chi2 = 0;
  for (const c of data.chain) {
    if (cfg.demoOnly && !c.isDemo) continue;
    const obs = r.questionCounts.get(c.qId) ?? 0;
    const d = obs - expected;
    chi2 += (d * d) / Math.max(0.0001, expected);
    if (obs === 0) r.neverDrawnQuestions.push(c.qId);
  }
  r.chiSquarePerDf = r.bankSize > 1 ? chi2 / (r.bankSize - 1) : 0;

  for (const s of data.sources) {
    if (cfg.demoOnly && !s.isDemo) continue;
    if (!r.sourceCounts.has(s.id)) r.neverDrawnSources.push(s.id);
  }
  for (const [label, def] of data.occlusionByLabel) {
    if (!r.occlusionCounts.has(def.id)) {
      r.neverDrawnOcclusions.push(label);
      r.neverDrawnOcclusionIds.push(def.id);
    }
  }

  r.meanRoundsToSeeAll = measureRoundsToSeeAll(data, cfg, 300);
  return r;
}

/** coupon collector：抽多少轮才能把题库里的每一道都至少见到一次 —— 题库规模够不够的硬指标。 */
export function measureRoundsToSeeAll(data: GameData, cfg: SimConfig, trials: number): number {
  const gen = generatorFor(data, cfg);
  const bank = cfg.demoOnly ? data.chain.filter((c) => c.isDemo).length : data.chain.length;
  if (bank === 0) return 0;

  let sum = 0;
  const limit = bank * 20;
  for (let t = 0; t < trials; t++) {
    const seen = new Set<string>();
    let round = 0;
    while (seen.size < bank && round < limit) {
      const plan = gen.buildRound(cfg.seed + t * 104729 + round * 7919, cfg.size, cfg.mix);
      for (const it of plan.items) seen.add(it.chain.qId);
      round++;
    }
    sum += round;
  }
  return sum / Math.max(1, trials);
}
