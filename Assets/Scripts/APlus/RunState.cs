using System;
using System.Collections.Generic;

namespace APlus
{
    public enum LedgerEntryKind { Record, Death, HeldBack }

    /// <summary>记名册上的一行（2.6）。它是场景里的物件，从不以 UI 形式出现。</summary>
    [Serializable]
    public struct LedgerEntry
    {
        public int Attempt;
        public int Year;
        public int Session;
        public LedgerEntryKind Kind;
        public DeathCause Cause;
    }

    /// <summary>一场考试结束后，下一步去哪（2.5.4 / 7.1）。</summary>
    public enum RunTransition { Retry, NextSession, HeldBack, RunComplete }

    /// <summary>
    /// 跨轮次的进度：复读次数、场次、留级、年份倒退、记名册。
    ///
    /// 「第 N 次模拟考试」的 N 是 Attempt（每开一场 +1），死亡曲线吃的是 TotalDeaths
    /// （2.4：N = 累计死亡次数）。两者在只死不过的玩家身上恒差 1。
    /// </summary>
    [Serializable]
    public sealed class RunState
    {
        // ---- 规则参数 ----
        public int StartYear = 2026;
        public int EarliestYear = 1998;
        /// <summary>2.5.3：每死一次，年份往前退 1–3 年（随机、不等距）。</summary>
        public int YearStepMin = 1;
        public int YearStepMax = 3;
        /// <summary>2.5.4：同一场死满这么多次 ⇒ 留级（强制换监考）。</summary>
        public int DeathsToHoldBack = 5;
        /// <summary>Demo 只有一位监考（8.1）。</summary>
        public int SessionCount = 1;
        /// <summary>q.fill.43：从这一轮起，抬头印的是你的考号而不是次数。</summary>
        public int HeaderShowsCandidateFromAttempt = 15;
        /// <summary>2.4：阶段四（N = 10–14）起，记名册上出现「已适应」批注。</summary>
        public int AdaptedNoteFromDeaths = 10;
        /// <summary>q.fill.13：你本人的考号。</summary>
        public string CandidateNumber = "0713";
        /// <summary>q.fill.11：记录本第一页的第一个考号是 0601；广播按轮次往后念。</summary>
        public int RosterBase = 600;

        // ---- 状态 ----
        public int Seed;
        public int Attempt = 1;
        public int TotalDeaths;
        public int Session = 1;
        public int DeathsThisSession;
        public int Year;
        public int HeldBackCount;
        public bool IsComplete;
        public List<LedgerEntry> Ledger = new List<LedgerEntry>();

        public RunState() : this(20260923) { }

        public RunState(int seed)
        {
            Seed = seed;
            Year = StartYear;
        }

        /// <summary>本轮抽题用的种子：同一个存档的同一轮永远抽出同一张卷子。</summary>
        public int RoundSeed { get { return unchecked(Seed * 7919 + Attempt * 104729); } }

        public bool HeaderShowsCandidateNumber { get { return Attempt >= HeaderShowsCandidateFromAttempt; } }
        public bool LedgerShowsAdaptedNote { get { return TotalDeaths >= AdaptedNoteFromDeaths; } }

        /// <summary>
        /// 3.4 / q.fill.38：广播念的第 index 个考号。终局（抬头只剩考号时）念的是你自己。
        /// </summary>
        public string RosterNumber(int index)
        {
            if (HeaderShowsCandidateNumber) return CandidateNumber;
            return (RosterBase + Attempt + index).ToString("D4", System.Globalization.CultureInfo.InvariantCulture);
        }

        /// <summary>下一次死亡是第几次（喂给 DeathCurve）。</summary>
        public int NextDeathOrdinal { get { return TotalDeaths + 1; } }

        /// <summary>
        /// 一场考试结束。records = 这一场被记名的次数（逐条写进记名册）。
        /// died = false 表示交卷成功。
        /// </summary>
        public RunTransition CompleteAttempt(bool died, int records, DeathCause cause)
        {
            if (IsComplete) return RunTransition.RunComplete;

            for (int i = 0; i < records; i++) AddLedger(LedgerEntryKind.Record, DeathCause.None);

            RunTransition next;
            if (died)
            {
                AddLedger(LedgerEntryKind.Death, cause);
                TotalDeaths++;
                DeathsThisSession++;
                StepYearBack();
                if (DeathsThisSession >= DeathsToHoldBack)
                {
                    HeldBackCount++;
                    AddLedger(LedgerEntryKind.HeldBack, DeathCause.None);
                    next = AdvanceSession(RunTransition.HeldBack);
                }
                else next = RunTransition.Retry;
            }
            else
            {
                next = AdvanceSession(RunTransition.NextSession);
            }

            if (next != RunTransition.RunComplete) Attempt++;
            return next;
        }

        RunTransition AdvanceSession(RunTransition kind)
        {
            Session++;
            DeathsThisSession = 0;
            if (Session > SessionCount)
            {
                IsComplete = true;
                return RunTransition.RunComplete;
            }
            return kind;
        }

        void StepYearBack()
        {
            DeterministicRng rng = new DeterministicRng(unchecked(Seed * 31 + TotalDeaths * 131071));
            int span = Math.Max(0, YearStepMax - YearStepMin);
            int step = YearStepMin + rng.Next(span + 1);
            Year = Math.Max(EarliestYear, Year - step);
        }

        void AddLedger(LedgerEntryKind kind, DeathCause cause)
        {
            LedgerEntry e = new LedgerEntry();
            e.Attempt = Attempt;
            e.Year = Year;
            e.Session = Session;
            e.Kind = kind;
            e.Cause = cause;
            Ledger.Add(e);
        }
    }
}
