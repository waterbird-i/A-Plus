using System;
using System.Collections.Generic;

namespace APlus
{
    /// <summary>
    /// 自带确定性 PRNG（xorshift32）。
    /// **刻意不用 System.Random**：它在 .NET Framework 与 Unity 的 Mono/IL2CPP 上序列不同，
    /// 同一个种子抽不出同一张卷子 —— 而「按种子复现某一轮」是关卡调试与问题复现的刚需。
    /// </summary>
    public sealed class DeterministicRng
    {
        uint _state;

        public DeterministicRng(int seed)
        {
            _state = (uint)seed;
            if (_state == 0u) _state = 0x9E3779B9u;
        }

        public uint NextUInt()
        {
            uint x = _state;
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            _state = x;
            return x;
        }

        /// <summary>[0, maxExclusive)</summary>
        public int Next(int maxExclusive)
        {
            if (maxExclusive <= 1) return 0;
            return (int)(NextUInt() % (uint)maxExclusive);
        }

        /// <summary>[0, 1)</summary>
        public float NextFloat()
        {
            return (NextUInt() >> 8) * (1.0f / 16777216.0f);
        }

        public void Shuffle<T>(List<T> list)
        {
            for (int i = list.Count - 1; i > 0; i--)
            {
                int j = Next(i + 1);
                T tmp = list[i];
                list[i] = list[j];
                list[j] = tmp;
            }
        }
    }

    /// <summary>
    /// 配比的**分配策略**。这是「每轮手感」的真正开关，比配比数字本身更重要：
    ///   Quota        固定配额：每轮严格 3/4/2 —— 组成完全可预测，但**每轮手感一模一样**。
    ///   QuotaJitter  配额 + 抖动：在配额上随机挪 1–2 道，每轮略有起伏，预算仍受控。
    ///   Weighted     按难度加权、不预先配额：每轮组成天然不同，且当各难度池与权重成比例时
    ///                每道题被抽到的概率自动均匀（磨损均匀）。
    /// 三种策略的实测对比见 Docs/难度配比标定.md。
    /// </summary>
    public enum AllocationMode { Quota, QuotaJitter, Weighted }

    /// <summary>每轮 8–10 道的难度配比（8.2 缺口：`difficulty` 是新加的列，配比还没实测标定）。</summary>
    public sealed class MixSpec
    {
        public string Name = "";
        public int Easy;
        public int Medium;
        public int Hard;

        public MixSpec(string name, int easy, int medium, int hard)
        {
            Name = name; Easy = easy; Medium = medium; Hard = hard;
        }

        public int Total { get { return Easy + Medium + Hard; } }

        /// <summary>解析 "3,4,2"（易,中,难）；名字可选："3,4,2@baseline"。</summary>
        public static MixSpec Parse(string text)
        {
            string name = "";
            int at = text.IndexOf('@');
            if (at >= 0) { name = text.Substring(at + 1); text = text.Substring(0, at); }
            string[] parts = text.Split(',');
            int[] v = new int[] { 0, 0, 0 };
            for (int i = 0; i < parts.Length && i < 3; i++)
            {
                int n;
                if (!int.TryParse(parts[i].Trim(), out n)) n = 0;
                v[i] = n;
            }
            if (name.Length == 0) name = v[0] + "," + v[1] + "," + v[2];
            return new MixSpec(name, v[0], v[1], v[2]);
        }

        public string ToAscii()
        {
            return "easy=" + Easy + " medium=" + Medium + " hard=" + Hard;
        }
    }

    /// <summary>本轮卷子上的一道题，连同它这一轮被随机到的落位与遮挡。</summary>
    public sealed class PlannedItem
    {
        public AnswerChainRow Chain;
        public AnswerSource Source;
        public string OcclusionLabel = "";   // "" = 无遮挡
        public string OcclusionId = "none";  // ASCII，代码/JSON 只用这个
        public string OcclusionKind = "none";
        public bool RequiresSourceSwitch;
        public bool MixedChannel;
        public bool NonDemoPlacement;
        public string DifficultyId = "";
        public int ActionSteps;              // 原型模型：见 Docs
        public float ExposureScore;          // 原型模型：见 Docs
    }

    public sealed class RoundPlan
    {
        public int Seed;
        public int Size;
        public List<PlannedItem> Items = new List<PlannedItem>();
        public int Shortfall;                // 配比没兑现的题数（题库该难度不够）
        public int FilledFromEasy, FilledFromMedium, FilledFromHard;
        public int EasyCount, MediumCount, HardCount;
        public int PhoneItems, EnvItems, MixedChannelItems;
        public int OccludedItems, UnresolvableItems, NonDemoPlacements;
        public int TotalSteps;
        public float TotalExposure;

        public int MinSteps, MaxSteps;

        public void Finish()
        {
            Size = Items.Count;
            for (int i = 0; i < Items.Count; i++)
            {
                PlannedItem it = Items[i];
                if (it.DifficultyId == "easy") EasyCount++;
                else if (it.DifficultyId == "hard") HardCount++;
                else MediumCount++;

                if (it.Source != null && it.Source.Channel == Channel.Phone) PhoneItems++;
                else EnvItems++;
                if (it.MixedChannel) MixedChannelItems++;
                if (it.OcclusionLabel.Length > 0) OccludedItems++;
                if (it.RequiresSourceSwitch) UnresolvableItems++;
                if (it.NonDemoPlacement) NonDemoPlacements++;

                TotalSteps += it.ActionSteps;
                TotalExposure += it.ExposureScore;
            }
            MinSteps = int.MaxValue;
            MaxSteps = 0;
            for (int i = 0; i < Items.Count; i++)
            {
                if (Items[i].ActionSteps < MinSteps) MinSteps = Items[i].ActionSteps;
                if (Items[i].ActionSteps > MaxSteps) MaxSteps = Items[i].ActionSteps;
            }
            if (Items.Count == 0) { MinSteps = 0; }
        }
    }

    /// <summary>
    /// 设计文档 4.3「三层随机」的可执行实现：
    ///   1. 题目从题库抽（保证恐怖文本的作者质量，不程序生成文本）
    ///   2. 答案源位置从那道题的合法落位池里抽
    ///   3. 该源的遮挡状态随机 —— 让同一道题每次的获取路径长度不同
    ///
    /// 「合法落位池」是手工限定的（8.2 要求 2–4 个），所以答案永远藏在合理的地方。
    /// </summary>
    public sealed class ExamRoundGenerator
    {
        public GameData Data;
        public bool DemoOnly = true;
        /// <summary>4.3 只说「**部分**答案源附加随机遮挡状态」，所以无遮挡要有自己的概率。</summary>
        public float NoOcclusionProbability = 0.45f;
        public AllocationMode Mode = AllocationMode.QuotaJitter;
        /// <summary>QuotaJitter 模式下每次挪几道题（1 = 只挪一道）。</summary>
        public int Jitter = 1;

        public ExamRoundGenerator(GameData data)
        {
            Data = data;
        }

        List<AnswerChainRow> Bucket(List<AnswerChainRow> pool, Difficulty d)
        {
            List<AnswerChainRow> list = new List<AnswerChainRow>();
            for (int i = 0; i < pool.Count; i++)
            {
                if (pool[i].Difficulty == d) list.Add(pool[i]);
            }
            return list;
        }

        public RoundPlan BuildRound(int seed, int size, MixSpec mix)
        {
            DeterministicRng rng = new DeterministicRng(seed);
            RoundPlan plan = new RoundPlan();
            plan.Seed = seed;

            List<AnswerChainRow> pool = new List<AnswerChainRow>();
            for (int i = 0; i < Data.Chain.Count; i++)
            {
                if (DemoOnly && !Data.Chain[i].IsDemo) continue;
                pool.Add(Data.Chain[i]);
            }
            if (pool.Count == 0) { plan.Finish(); return plan; }
            if (size > pool.Count) size = pool.Count;

            List<AnswerChainRow> easy = Bucket(pool, Difficulty.Easy);
            List<AnswerChainRow> medium = Bucket(pool, Difficulty.Medium);
            List<AnswerChainRow> hard = Bucket(pool, Difficulty.Hard);
            rng.Shuffle(easy); rng.Shuffle(medium); rng.Shuffle(hard);

            List<AnswerChainRow> chosen = new List<AnswerChainRow>();

            if (Mode == AllocationMode.Weighted)
            {
                // 加权、不放回：每抽一题，按难度权重在各桶的**剩余**池里选。不预先分配配额，
                // 所以每轮的难度组成天然不同（用户担心的「每轮手感一样」正是固定配额造成的）。
                for (int n = 0; n < size; n++)
                {
                    int we = easy.Count > 0 ? mix.Easy : 0;
                    int wm = medium.Count > 0 ? mix.Medium : 0;
                    int wh = hard.Count > 0 ? mix.Hard : 0;
                    int all = we + wm + wh;
                    if (all <= 0) break;
                    int roll = rng.Next(all);
                    List<AnswerChainRow> pick = roll < we ? easy : (roll < we + wm ? medium : hard);
                    int idx = rng.Next(pick.Count);
                    chosen.Add(pick[idx]);
                    pick.RemoveAt(idx);
                }
            }
            else
            {
                int qe = mix.Easy, qm = mix.Medium, qh = mix.Hard;
                if (Mode == AllocationMode.QuotaJitter && Jitter > 0)
                {
                    // 在配额上挪动 Jitter 次（总数不变），让每轮略有起伏但难度预算仍受控。
                    for (int j = 0; j < Jitter; j++)
                    {
                        int roll = rng.Next(3);
                        if (roll == 0 && qe > 0) { qe--; qm++; }
                        else if (roll == 1 && qm > 0) { qm--; qh++; }
                        else if (qh > 0) { qh--; qe++; }
                    }
                }
                plan.Shortfall += Take(easy, qe, chosen);
                plan.Shortfall += Take(medium, qm, chosen);
                plan.Shortfall += Take(hard, qh, chosen);

                // 配比兑现不了时，从还有余量的桶里补（优先「中」，因为它是手感的基线）。
                if (chosen.Count < size)
                {
                    plan.FilledFromMedium += Fill(medium, size - chosen.Count, chosen, rng);
                    plan.FilledFromEasy += Fill(easy, size - chosen.Count, chosen, rng);
                    plan.FilledFromHard += Fill(hard, size - chosen.Count, chosen, rng);
                }
            }

            for (int i = 0; i < chosen.Count; i++) plan.Items.Add(Plan(chosen[i], rng));
            rng.Shuffle(plan.Items);
            plan.Finish();
            return plan;
        }

        static int Take(List<AnswerChainRow> bucket, int want, List<AnswerChainRow> into)
        {
            if (want <= 0) return 0;
            int take = Math.Min(want, bucket.Count);
            for (int i = 0; i < take; i++) into.Add(bucket[i]);
            bucket.RemoveRange(0, take);
            return want - take;
        }

        static int Fill(List<AnswerChainRow> bucket, int want, List<AnswerChainRow> into, DeterministicRng rng)
        {
            if (want <= 0) return 0;
            int take = Math.Min(want, bucket.Count);
            for (int i = 0; i < take; i++) into.Add(bucket[i]);
            bucket.RemoveRange(0, take);
            return take;
        }

        PlannedItem Plan(AnswerChainRow c, DeterministicRng rng)
        {
            PlannedItem it = new PlannedItem();
            it.Chain = c;
            it.DifficultyId = DifficultyId(c.Difficulty);
            it.MixedChannel = Data.IsMixedChannel(c);

            // 第 2 层：答案源位置随机。
            // Demo 轮次只能落在 demo=y 的源上（8.3 的排期口径）。若一题的池里一个 demo 源都没有，
            // 那是**数据问题**（GameData.CrossCheck 会报出来），这里仍然放一个进去让模拟跑下去，
            // 并把这次落位记进 NonDemoPlacements —— 它在 Demo 轮次里必须恒为 0。
            List<AnswerSource> poolCandidates = new List<AnswerSource>();
            for (int pi = 0; pi < c.Pools.Count; pi++)
            {
                AnswerSource cand;
                if (!Data.SourceById.TryGetValue(c.Pools[pi], out cand)) continue;
                if (DemoOnly && !cand.IsDemo) continue;
                poolCandidates.Add(cand);
            }
            if (poolCandidates.Count == 0) poolCandidates = Data.PoolSources(c);
            AnswerSource src = poolCandidates.Count > 0 ? poolCandidates[rng.Next(poolCandidates.Count)] : null;
            it.Source = src;
            if (src != null && !src.IsDemo) it.NonDemoPlacement = true;

            // 第 3 层：该源的遮挡状态随机（或无）
            OcclusionDef def = null;
            if (src != null)
            {
                List<string> candidates = Intersect(src.Occlusions, c.Occlusions);
                if (candidates.Count > 0 && rng.NextFloat() >= NoOcclusionProbability)
                {
                    it.OcclusionLabel = candidates[rng.Next(candidates.Count)];
                    Data.OcclusionByLabel.TryGetValue(it.OcclusionLabel, out def);
                }
            }
            if (def != null)
            {
                it.OcclusionId = def.Id;
                it.OcclusionKind = def.Kind;
                it.RequiresSourceSwitch = !def.Resolvable;
            }

            // 「动作步数」与「暴露分」是**透明模型**，不是实测手感：它把 4.3 的
            // 「有时秒答，有时要绕 3 步」变成一个可比较的数，用来挑难度配比。
            // 真机标定时应当用真人耗时替换它（见 Docs/难度配比标定.md）。
            int steps = 1;                                        // 离开卷子（环视或掏手机）
            if (def != null) steps += def.ExtraSteps;
            if (c.CrossSource.Length > 0) steps += 1;             // 还要读第二个源（跨源拼合）
            if (src != null && src.Channel == Channel.Phone) steps += 1;
            if (it.RequiresSourceSwitch) steps += 2;              // 信息不可得 ⇒ 换到另一个落位池
            steps += 1;                                           // 退回卷子作答
            it.ActionSteps = steps;

            float exposure = src != null ? src.RiskWeight : 0f;
            if (def != null) exposure += 0.5f * def.ExtraSteps;
            if (c.CrossSource.Length > 0) exposure += 1f;
            if (src != null && src.Channel == Channel.Phone) exposure += 1.5f;
            if (it.RequiresSourceSwitch) exposure += 1f;
            it.ExposureScore = exposure;

            return it;
        }

        public static string DifficultyId(Difficulty d)
        {
            if (d == Difficulty.Easy) return "easy";
            if (d == Difficulty.Hard) return "hard";
            return "medium";
        }

        public static List<string> Intersect(List<string> a, List<string> b)
        {
            List<string> hits = new List<string>();
            for (int i = 0; i < a.Count; i++)
            {
                for (int j = 0; j < b.Count; j++)
                {
                    if (string.Equals(a[i], b[j], StringComparison.Ordinal)) { hits.Add(a[i]); break; }
                }
            }
            return hits;
        }
    }
}