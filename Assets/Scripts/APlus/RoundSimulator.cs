using System;
using System.Collections.Generic;

namespace APlus
{
    public sealed class SimConfig
    {
        public int Rounds = 2000;
        public int Size = 9;
        public int Seed = 20260101;
        public MixSpec Mix;
        public float NoOcclusionProbability = 0.45f;
        public bool DemoOnly = true;
        public AllocationMode Mode = AllocationMode.QuotaJitter;
        public int Jitter = 1;
        /// <summary>只跑 [6] 的分配策略对比时用。</summary>
        public string Tag = "";

        public SimConfig Clone(int size, MixSpec mix)
        {
            SimConfig c = new SimConfig();
            c.Rounds = Rounds; c.Size = size; c.Seed = Seed; c.Mix = mix;
            c.NoOcclusionProbability = NoOcclusionProbability; c.DemoOnly = DemoOnly;
            c.Mode = Mode; c.Jitter = Jitter; c.Tag = Tag;
            return c;
        }
    }

    public sealed class SimResult
    {
        public SimConfig Config;
        public int Rounds;
        public int BankSize;
        public int PoolEasy, PoolMedium, PoolHard;

        public double MeanSize;
        public double MeanEasy, MeanMedium, MeanHard;
        public int RoundsWithShortfall;
        public double MeanPhoneItems, MeanMixedChannelItems;
        public double MeanOccludedItems, MeanUnresolvableItems;
        public double MeanSteps, MeanExposure, MeanMinSteps, MeanMaxSteps;
        public int WithinRoundDuplicates;
        /// <summary>落在 demo=n（正式版专属）源上的题数。Demo 轮次里必须恒为 0。</summary>
        public int NonDemoPlacements;
        /// <summary>每轮「易」题数的波幅（min / max 与平均绝对偏差）——「每轮手感」的量化代理。</summary>
        public int MinEasy = int.MaxValue, MaxEasy;
        public double MeanAbsEasyDev;
        public double MeanCarryoverItems;
        public double ChiSquarePerDf;
        public int DistinctQuestionsSeen;
        public double MeanRoundsToSeeAll;

        public Dictionary<string, int> QuestionCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        public Dictionary<string, int> SourceCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        public Dictionary<string, int> OcclusionCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        public Dictionary<int, int> StepHistogram = new Dictionary<int, int>();

        public List<string> NeverDrawnQuestions = new List<string>();
        public List<string> NeverDrawnSources = new List<string>();
        public List<string> NeverDrawnOcclusions = new List<string>();
        public List<string> NeverDrawnOcclusionIds = new List<string>();

        public double MeanOcclusionRate { get { return MeanSize <= 0 ? 0 : MeanOccludedItems / MeanSize; } }
    }

    /// <summary>
    /// 把 4.3 的抽题流程跑很多轮，量出「这 35 道到底能撑几轮」。
    ///
    /// 这是 8.2 那句「35 道撑不了一局 8-10 道 x 无限轮次」的**量化**：
    ///   - MeanRoundsToSeeAll：全部题目都出现过所需的轮数（coupon collector）。
    ///     过了这个轮数，后面每一轮都是「已经见过的题」的重排 —— 复读感就是这么来的。
    ///   - MeanCarryoverItems：相邻两轮重复的题数（期望约 k*k/N）。
    ///   - ChiSquarePerDf：题目出现频次是否均匀（≈1 就是均匀）。
    ///   - NeverDrawn*：跑完 N 轮从未被抽到过的题/源/遮挡 —— 那就是**白做**的内容。
    /// </summary>
    public sealed class RoundSimulator
    {
        public static SimResult Run(GameData data, SimConfig cfg)
        {
            ExamRoundGenerator gen = new ExamRoundGenerator(data);
            gen.DemoOnly = cfg.DemoOnly;
            gen.NoOcclusionProbability = cfg.NoOcclusionProbability;
            gen.Mode = cfg.Mode;
            gen.Jitter = cfg.Jitter;

            SimResult r = new SimResult();
            r.Config = cfg;
            r.Rounds = cfg.Rounds;
            r.BankSize = cfg.DemoOnly ? CountDemo(data) : data.Chain.Count;
            r.PoolEasy = data.CountByDifficulty(Difficulty.Easy, cfg.DemoOnly);
            r.PoolMedium = data.CountByDifficulty(Difficulty.Medium, cfg.DemoOnly);
            r.PoolHard = data.CountByDifficulty(Difficulty.Hard, cfg.DemoOnly);

            HashSet<string> previous = null;
            for (int i = 0; i < cfg.Rounds; i++)
            {
                RoundPlan plan = gen.BuildRound(cfg.Seed + i * 7919, cfg.Size, cfg.Mix);

                r.MeanSize += plan.Size;
                r.MeanEasy += plan.EasyCount;
                r.MeanMedium += plan.MediumCount;
                r.MeanHard += plan.HardCount;
                if (plan.Shortfall > 0) r.RoundsWithShortfall++;
                r.MeanPhoneItems += plan.PhoneItems;
                r.MeanMixedChannelItems += plan.MixedChannelItems;
                r.MeanOccludedItems += plan.OccludedItems;
                r.MeanUnresolvableItems += plan.UnresolvableItems;
                r.NonDemoPlacements += plan.NonDemoPlacements;
                r.MeanAbsEasyDev += Math.Abs(plan.EasyCount - cfg.Mix.Easy);
                if (i == 0 || plan.EasyCount < r.MinEasy) r.MinEasy = plan.EasyCount;
                if (i == 0 || plan.EasyCount > r.MaxEasy) r.MaxEasy = plan.EasyCount;
                r.MeanSteps += plan.TotalSteps;
                r.MeanExposure += plan.TotalExposure;
                r.MeanMinSteps += plan.MinSteps;
                r.MeanMaxSteps += plan.MaxSteps;

                HashSet<string> current = new HashSet<string>(StringComparer.Ordinal);
                for (int j = 0; j < plan.Items.Count; j++)
                {
                    PlannedItem it = plan.Items[j];
                    if (!current.Add(it.Chain.QId)) r.WithinRoundDuplicates++;
                    Bump(r.QuestionCounts, it.Chain.QId);
                    if (it.Source != null) Bump(r.SourceCounts, it.Source.Id);
                    Bump(r.OcclusionCounts, it.OcclusionId);
                    if (it.Source != null && !it.MixedChannel) { }
                    int hist;
                    r.StepHistogram.TryGetValue(it.ActionSteps, out hist);
                    r.StepHistogram[it.ActionSteps] = hist + 1;
                }

                if (previous != null)
                {
                    int overlap = 0;
                    foreach (string q in current) if (previous.Contains(q)) overlap++;
                    r.MeanCarryoverItems += overlap;
                }
                previous = current;
            }

            double n = Math.Max(1, cfg.Rounds);
            r.MeanSize /= n; r.MeanEasy /= n; r.MeanMedium /= n; r.MeanHard /= n;
            r.MeanPhoneItems /= n; r.MeanMixedChannelItems /= n;
            r.MeanOccludedItems /= n; r.MeanUnresolvableItems /= n;
            r.MeanSteps /= n; r.MeanExposure /= n;
            r.MeanMinSteps /= n; r.MeanMaxSteps /= n;
            r.MeanCarryoverItems /= Math.Max(1, cfg.Rounds - 1);
            r.MeanAbsEasyDev /= n;
            if (cfg.Rounds <= 0) { r.MinEasy = 0; r.MaxEasy = 0; }
            r.DistinctQuestionsSeen = r.QuestionCounts.Count;

            double total = 0;
            foreach (KeyValuePair<string, int> kv in r.QuestionCounts) total += kv.Value;
            double expected = total / Math.Max(1, r.BankSize);
            double chi2 = 0;
            for (int i = 0; i < data.Chain.Count; i++)
            {
                AnswerChainRow c = data.Chain[i];
                if (cfg.DemoOnly && !c.IsDemo) continue;
                int obs;
                r.QuestionCounts.TryGetValue(c.QId, out obs);
                double d = obs - expected;
                chi2 += d * d / Math.Max(0.0001, expected);
                if (obs == 0) r.NeverDrawnQuestions.Add(c.QId);
            }
            r.ChiSquarePerDf = r.BankSize > 1 ? chi2 / (r.BankSize - 1) : 0;

            for (int i = 0; i < data.Sources.Count; i++)
            {
                AnswerSource s = data.Sources[i];
                if (cfg.DemoOnly && !s.IsDemo) continue;
                if (!r.SourceCounts.ContainsKey(s.Id)) r.NeverDrawnSources.Add(s.Id);
            }
            foreach (KeyValuePair<string, OcclusionDef> kv in data.OcclusionByLabel)
            {
                if (!r.OcclusionCounts.ContainsKey(kv.Value.Id))
                {
                    r.NeverDrawnOcclusions.Add(kv.Key);
                    r.NeverDrawnOcclusionIds.Add(kv.Value.Id);
                }
            }

            r.MeanRoundsToSeeAll = MeasureRoundsToSeeAll(data, cfg, 300);
            return r;
        }

        static int CountDemo(GameData data)
        {
            int n = 0;
            for (int i = 0; i < data.Chain.Count; i++) if (data.Chain[i].IsDemo) n++;
            return n;
        }

        static void Bump(Dictionary<string, int> map, string key)
        {
            int v;
            map.TryGetValue(key, out v);
            map[key] = v + 1;
        }

        /// <summary>
        /// coupon collector：抽多少轮才能把题库里的每一道都至少见到一次。
        /// 这个数是「题库规模够不够」的硬指标 —— 35 道撑不了「无限轮次」就是因为它。
        /// </summary>
        public static double MeasureRoundsToSeeAll(GameData data, SimConfig cfg, int trials)
        {
            ExamRoundGenerator gen = new ExamRoundGenerator(data);
            gen.DemoOnly = cfg.DemoOnly;
            gen.NoOcclusionProbability = cfg.NoOcclusionProbability;
            gen.Mode = cfg.Mode;
            gen.Jitter = cfg.Jitter;

            int bank = cfg.DemoOnly ? CountDemo(data) : data.Chain.Count;
            if (bank == 0) return 0;

            double sum = 0;
            int limit = bank * 20;
            for (int t = 0; t < trials; t++)
            {
                HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
                int round = 0;
                while (seen.Count < bank && round < limit)
                {
                    RoundPlan plan = gen.BuildRound(cfg.Seed + t * 104729 + round * 7919, cfg.Size, cfg.Mix);
                    for (int j = 0; j < plan.Items.Count; j++) seen.Add(plan.Items[j].Chain.QId);
                    round++;
                }
                sum += round;
            }
            return sum / Math.Max(1, trials);
        }

        public static List<SimResult> Sweep(GameData data, int rounds, int seed, float noOcc, int[] sizes, MixSpec[] mixes)
        {
            List<SimResult> list = new List<SimResult>();
            for (int s = 0; s < sizes.Length; s++)
            {
                for (int m = 0; m < mixes.Length; m++)
                {
                    if (mixes[m].Total != sizes[s]) continue;
                    SimConfig cfg = new SimConfig();
                    cfg.Rounds = rounds; cfg.Seed = seed; cfg.Size = sizes[s];
                    cfg.Mix = mixes[m]; cfg.NoOcclusionProbability = noOcc;
                    list.Add(Run(data, cfg));
                }
            }
            return list;
        }
    }
}
