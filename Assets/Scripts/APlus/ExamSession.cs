using System;
using System.Collections.Generic;

namespace APlus
{
    public enum SessionPhase { NotStarted, Running, Died, Submitted }

    /// <summary>一场考试的可调参数。三条推进线（异象强度 / 报时污染 / 死亡退化）刻意错峰（2.4 丝滑技术 4）。</summary>
    [Serializable]
    public sealed class SessionConfig
    {
        public int RoundSize = 9;
        /// <summary>4.3：推荐 3,3,3 + 抖动 1（Docs/难度配比标定.md §5）。</summary>
        public int MixEasy = 3, MixMedium = 3, MixHard = 3;
        public AllocationMode Mode = AllocationMode.QuotaJitter;
        public int Jitter = 1;

        /// <summary>6.2：异象强度随累计死亡在这个区间里从 0 爬到 1。</summary>
        public DeathWindow AnomalyIntensity = new DeathWindow(3, 15);
        /// <summary>3.4：第几次模拟考试起，报时开始变慢 / 倒退 / 改念考号。</summary>
        public int SlowFromAttempt = 4;
        public int RewindFromAttempt = 8;
        public int RosterFromAttempt = 12;

        /// <summary>A2：听力期间离开卷子多久算违规。</summary>
        public float ListeningViolationGrace = 0.6f;

        public MixSpec Mix { get { return new MixSpec("session", MixEasy, MixMedium, MixHard); } }

        public BroadcastTamper TamperFor(int attempt)
        {
            if (attempt >= RosterFromAttempt) return BroadcastTamper.Roster;
            if (attempt >= RewindFromAttempt) return BroadcastTamper.Rewind;
            if (attempt >= SlowFromAttempt) return BroadcastTamper.Slow;
            return BroadcastTamper.Normal;
        }
    }

    /// <summary>一帧里发生的事。呈现层据此放声音、翻记名册、起死亡表现。</summary>
    public sealed class SessionEvents
    {
        public readonly List<BroadcastCue> Broadcasts = new List<BroadcastCue>();
        public readonly List<TickResult> Gaze = new List<TickResult>();
        public bool Died;
        public bool TimeUp;

        public void Clear()
        {
            Broadcasts.Clear();
            Gaze.Clear();
            Died = false;
            TimeUp = false;
        }
    }

    /// <summary>
    /// 一场考试的全部逻辑：抽卷 → 注视调度 → 计时与广播 → 作答 → 交卷或死亡 → 写回 RunState。
    /// 不依赖 UnityEngine；Unity 侧的 MonoBehaviour 每帧调 Tick，并把输入转成 SetGaze / Select。
    /// </summary>
    public sealed class ExamSession
    {
        public readonly GameData Data;
        public readonly StringTable Table;
        public readonly RunState Run;
        public readonly InvigilatorProfile Profile;
        public readonly SessionConfig Config;
        public readonly DeathCurve Curve;

        public SessionPhase Phase { get; private set; }
        public RoundPlan Plan { get; private set; }
        public AnswerContext Context { get; private set; }
        public List<ExamQuestion> Questions { get; private set; }
        public GazeStateMachine Gaze { get; private set; }
        public GazeDirector Director { get; private set; }
        public ExamClock Clock { get; private set; }
        public BroadcastTamper Tamper { get; private set; }
        public DeathPresentation Death { get; private set; }

        float _listeningOffPaper;
        bool _listeningRecorded;

        public ExamSession(GameData data, StringTable table, RunState run, InvigilatorProfile profile, SessionConfig config, DeathCurve curve)
        {
            Data = data;
            Table = table;
            Run = run;
            Profile = profile ?? InvigilatorProfile.Podium();
            Config = config ?? new SessionConfig();
            Curve = curve ?? new DeathCurve();
            Questions = new List<ExamQuestion>();
            Phase = SessionPhase.NotStarted;
        }

        public void Begin()
        {
            ExamRoundGenerator gen = new ExamRoundGenerator(Data);
            gen.Mode = Config.Mode;
            gen.Jitter = Config.Jitter;
            Plan = gen.BuildRound(Run.RoundSeed, Config.RoundSize, Config.Mix);

            Context = AnswerContext.FromRun(Run, Plan.Items.Count, Table);
            Questions = new List<ExamQuestion>();
            for (int i = 0; i < Plan.Items.Count; i++)
            {
                ExamQuestion q = ChoiceBuilder.Build(Plan.Items[i].Chain, Context);
                q.Plan = Plan.Items[i];
                Questions.Add(q);
            }

            Gaze = new GazeStateMachine();
            Director = new GazeDirector(Profile, unchecked(Run.RoundSeed ^ 0x2545F491), Config.AnomalyIntensity.Ramp(Run.TotalDeaths));

            Clock = new ExamClock();
            Tamper = Config.TamperFor(Run.Attempt);
            string[] roster = new string[Clock.RemainingAnnouncements.Length];
            for (int i = 0; i < roster.Length; i++) roster[i] = Run.RosterNumber(i);
            Clock.RosterNumbers = roster;
            Clock.Build(Tamper);

            _listeningOffPaper = 0f;
            _listeningRecorded = false;
            Phase = SessionPhase.Running;
        }

        public void SetGaze(GazeState state)
        {
            if (Phase == SessionPhase.Running) Gaze.SetState(state);
        }

        /// <summary>作答只能在「卷子」状态（2.1：这是安全区，也是唯一能写字的地方）。</summary>
        public bool Select(int questionIndex, int choiceIndex)
        {
            if (Phase != SessionPhase.Running || Gaze.State != GazeState.Paper) return false;
            if (questionIndex < 0 || questionIndex >= Questions.Count) return false;
            ExamQuestion q = Questions[questionIndex];
            if (choiceIndex < 0 || choiceIndex >= q.Choices.Length) return false;
            q.Selected = choiceIndex;
            return true;
        }

        public void Tick(float dt, SessionEvents events)
        {
            if (Phase != SessionPhase.Running) return;
            if (dt < 0f) dt = 0f;

            Clock.Tick(dt, events.Broadcasts);
            Director.Listening = Clock.InListening;
            Director.Tick(dt, Gaze);

            TickResult r = Gaze.Tick(dt);
            if (r != TickResult.Idle && r != TickResult.Safe) events.Gaze.Add(r);

            if (!Gaze.IsDead) TickListeningRule(dt, events);

            if (Gaze.IsDead)
            {
                Phase = SessionPhase.Died;
                Death = Curve.Evaluate(Run.NextDeathOrdinal);
                events.Died = true;
                return;
            }
            if (Clock.IsOver)
            {
                events.TimeUp = true;
                Submit();
            }
        }

        void TickListeningRule(float dt, SessionEvents events)
        {
            if (!Clock.InListening || _listeningRecorded) return;
            if (Gaze.State == GazeState.Paper) { _listeningOffPaper = 0f; return; }
            _listeningOffPaper += dt;
            if (_listeningOffPaper < Config.ListeningViolationGrace) return;
            _listeningRecorded = true;
            events.Gaze.Add(Gaze.RecordViolation());
        }

        public void Submit()
        {
            if (Phase == SessionPhase.Running) Phase = SessionPhase.Submitted;
        }

        public int Score
        {
            get
            {
                int n = 0;
                for (int i = 0; i < Questions.Count; i++) if (Questions[i].IsCorrect) n++;
                return n;
            }
        }

        /// <summary>把这一场的结果写回 RunState，返回下一步去哪。只能调一次。</summary>
        public RunTransition Finish()
        {
            if (Phase != SessionPhase.Died && Phase != SessionPhase.Submitted)
                throw new InvalidOperationException("session is still " + Phase);
            bool died = Phase == SessionPhase.Died;
            Phase = SessionPhase.NotStarted;
            return Run.CompleteAttempt(died, Gaze.TimesRecorded, Gaze.Cause);
        }
    }
}
