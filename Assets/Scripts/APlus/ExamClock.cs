using System;
using System.Collections.Generic;

namespace APlus
{
    /// <summary>一条广播。Key 指向 broadcast.csv；Arg 是填进 {0} 的数（报时的分钟数、考号…）。</summary>
    public struct BroadcastCue
    {
        public float GameSecond;
        public string Key;
        public string Arg;

        public BroadcastCue(float gameSecond, string key, string arg)
        {
            GameSecond = gameSecond;
            Key = key;
            Arg = arg;
        }
    }

    /// <summary>
    /// 3.4 报时的恐怖化程度。它只改广播里的数，不改文本（broadcast.tamper.note）。
    ///   Normal   报时正常，建立可信度
    ///   Slow     报的剩余时间比实际多 —— 「我确定刚才才听过十五分钟」
    ///   Rewind   报的剩余时间在倒退（越报越多）
    ///   Roster   不再报时，改念考号
    /// </summary>
    public enum BroadcastTamper { Normal, Slow, Rewind, Roster }

    /// <summary>
    /// 第三部分：全局考试倒计时。时间只存在于广播与挂钟里（零 HUD）。
    /// 游戏内 20 分钟，2 倍速 ⇒ 实际约 10 分钟（3.5）。
    /// </summary>
    public sealed class ExamClock
    {
        public float DurationGameSeconds = 20f * 60f;
        public float TimeScale = 2f;
        /// <summary>挂钟上的开考时刻（q.math.05：考试 9:00 开始）。</summary>
        public int StartClockMinutes = 9 * 60;
        /// <summary>A2：英语听力 —— 不得翻卷、不得张望。游戏内秒。</summary>
        public float ListeningStartGameSecond = 3f * 60f;
        public float ListeningDurationGameSeconds = 4f * 60f;
        /// <summary>3.5：剩 15 / 10 / 5 / 1 分钟各报一次。</summary>
        public int[] RemainingAnnouncements = new int[] { 15, 10, 5, 1 };
        public int SlowTamperMinutes = 5;
        /// <summary>Roster 模式下念的考号（按顺序），最后一个通常是你。</summary>
        public string[] RosterNumbers = new string[0];

        public float GameSeconds { get; private set; }
        public bool IsOver { get { return GameSeconds >= DurationGameSeconds; } }
        public float RemainingGameSeconds { get { return Math.Max(0f, DurationGameSeconds - GameSeconds); } }
        public bool InListening
        {
            get { return GameSeconds >= ListeningStartGameSecond && GameSeconds < ListeningStartGameSecond + ListeningDurationGameSeconds; }
        }

        /// <summary>挂钟读数（分钟，从零点起）。WallClockOffsetMinutes 是 q.fill.07「挂钟比广播慢」。</summary>
        public int WallClockMinutes(int wallClockOffsetMinutes)
        {
            return StartClockMinutes + (int)(GameSeconds / 60f) - wallClockOffsetMinutes;
        }

        readonly List<BroadcastCue> _plan = new List<BroadcastCue>();
        int _next;

        public List<BroadcastCue> Plan { get { return _plan; } }

        public void Build(BroadcastTamper tamper)
        {
            _plan.Clear();
            _next = 0;
            GameSeconds = 0f;

            _plan.Add(new BroadcastCue(0f, "broadcast.check.device", ""));
            _plan.Add(new BroadcastCue(5f, "broadcast.check.name", ""));
            _plan.Add(new BroadcastCue(ListeningStartGameSecond, "broadcast.listening.start", ""));
            _plan.Add(new BroadcastCue(ListeningStartGameSecond + ListeningDurationGameSeconds, "broadcast.listening.end", ""));

            for (int i = 0; i < RemainingAnnouncements.Length; i++)
            {
                int actual = RemainingAnnouncements[i];
                float at = DurationGameSeconds - actual * 60f;
                if (tamper == BroadcastTamper.Roster)
                {
                    string number = RosterNumbers.Length > 0 ? RosterNumbers[Math.Min(i, RosterNumbers.Length - 1)] : "";
                    _plan.Add(new BroadcastCue(at, "broadcast.roster_fmt", number));
                    continue;
                }
                int reported = Reported(actual, i, tamper);
                if (reported == actual && actual == 5) _plan.Add(new BroadcastCue(at, "broadcast.time.remain_last5", ""));
                else if (reported == actual && actual == 1) _plan.Add(new BroadcastCue(at, "broadcast.time.remain_last1", ""));
                else _plan.Add(new BroadcastCue(at, "broadcast.time.remain_fmt", reported.ToString()));
            }

            _plan.Add(new BroadcastCue(DurationGameSeconds, "broadcast.collect.stop", ""));
            _plan.Sort(delegate (BroadcastCue a, BroadcastCue b) { return a.GameSecond.CompareTo(b.GameSecond); });
        }

        int Reported(int actual, int index, BroadcastTamper tamper)
        {
            if (tamper == BroadcastTamper.Slow) return actual + SlowTamperMinutes;
            if (tamper == BroadcastTamper.Rewind)
            {
                int first = RemainingAnnouncements.Length > 0 ? RemainingAnnouncements[0] : actual;
                return first + index * 10;
            }
            return actual;
        }

        /// <summary>推进真实时间 realDt 秒；把这段时间内到点的广播追加进 fired。</summary>
        public void Tick(float realDt, List<BroadcastCue> fired)
        {
            if (realDt < 0f) realDt = 0f;
            GameSeconds = Math.Min(DurationGameSeconds, GameSeconds + realDt * TimeScale);
            while (_next < _plan.Count && _plan[_next].GameSecond <= GameSeconds)
            {
                if (fired != null) fired.Add(_plan[_next]);
                _next++;
            }
        }
    }
}
