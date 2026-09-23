using System;
using System.Collections.Generic;

namespace APlus
{
    /// <summary>2.1 三态视线：你只能同时处于一档。</summary>
    public enum GazeState { Paper, LookingAround, Phone }

    /// <summary>世界真相：现在落在你身上的是哪一道视线。</summary>
    public enum GazeKind { None, Teacher, Anomaly }

    /// <summary>玩家（在 2 秒模糊窗之后）**能分辨出来**的那一档。</summary>
    public enum GazeWarning { Unknown, Teacher, Anomaly }

    /// <summary>
    /// Summoned：暴露到顶，师视被召来（决策 #37）。它和 Recorded / Died 一样是「事件」，
    /// 呈现层据此放脚步声、写记名册、起死亡表现。
    /// </summary>
    public enum TickResult { Idle, Safe, Repelled, Recorded, Died, Summoned }

    /// <summary>死因。记名册与死亡表现都要知道是哪一种。</summary>
    public enum DeathCause { None, Records, Anomaly }

    /// <summary>
    /// 设计文档 2.1（三态视线）+ 2.2（双重注视）的可执行骨架，按决策 #37 / #39 收口：
    ///
    ///   师视：只有「卷子」算服从。环视或掏手机 ⇒ 违规 ⇒ 记名；同场记满 RecordsToDeath 次 ⇒ 死
    ///         （隐藏规则六「被记名三次者，其名归考场所有」字面应验）。
    ///   异视：只有「环视并直视它」算对抗。低头看卷子或掏手机 ⇒ 躲避 ⇒ 死。
    ///   暴露：到顶不直接死，而是召来一次师视 —— 呼吸声就是它的预警。
    ///
    /// 掏手机在两种视线下都是错的（决策 #39）：它是整个游戏里最危险的一档。
    /// 纯逻辑、不依赖 UnityEngine：Unity 与 dotnet 测试跑的是同一份源码。
    /// </summary>
    public sealed class GazeStateMachine
    {
        // ---- 可标定参数（手感全在这几个数上；必须靠真人测试标定，见 Docs/难度配比标定.md §6）----
        /// <summary>2.2 细节 2：前 2 秒内两种警告应该几乎无法分辨。</summary>
        public float AmbiguitySeconds = 2.0f;
        /// <summary>给你「反应」的时间窗。</summary>
        public float ComplyGraceSeconds = 0.6f;
        /// <summary>2.2：异视必须被直视到「它先移开」。</summary>
        public float AnomalyStareSeconds = 1.5f;
        /// <summary>环视时每秒累积的暴露（0..1）。</summary>
        public float ExposurePerSecond = 0.25f;
        /// <summary>2.1：手机屏幕发光会吸引注视 ⇒ 暴露更快。</summary>
        public float PhoneExposureMultiplier = 1.5f;
        /// <summary>退回卷子后暴露的自然回落（呼吸平复）。</summary>
        public float ExposureDecayPerSecond = 0.08f;
        /// <summary>决策 #37：同场记名满这么多次就死。</summary>
        public int RecordsToDeath = 3;
        /// <summary>决策 #37：暴露到顶召来的师视持续多久。</summary>
        public float SummonedGazeSeconds = 4.0f;

        // ---- 状态（零 HUD ⇒ 这些量不上屏，只驱动声音与画面）----
        public GazeState State { get; private set; }
        /// <summary>2.1 要点 4：暴露时间不显示为进度条，它的唯一表现是呼吸声。</summary>
        public float Exposure { get; private set; }
        /// <summary>2.1：环视 ⇒ 管道视野。周边不可信，老师会在你的盲区里移动。</summary>
        public bool PeripheralReliable { get { return State == GazeState.Paper; } }
        /// <summary>2.1 要点 4：紧张度与暴露时间合并成一个听觉变量。</summary>
        public float Breathing { get { return Exposure; } }
        public int TimesRecorded { get; private set; }
        public bool IsDead { get; private set; }
        public DeathCause Cause { get; private set; }
        /// <summary>世界真相。</summary>
        public GazeKind ActiveGaze { get; private set; }
        public GazeWarning Perceived { get; private set; }
        /// <summary>当前这道视线是暴露到顶召来的（而不是老师自己抬头）。</summary>
        public bool ActiveGazeSummoned { get; private set; }
        /// <summary>2.2 细节 1：注视异象时它必须**立刻可见地**变淡/抖动。判定可以难，绝不能不可读。</summary>
        public float AnomalyRepelProgress { get; private set; }
        public bool IsAimingAtAnomaly { get; private set; }
        public float ActiveGazeSeconds { get; private set; }
        /// <summary>当前视线还剩多久自行移开；≤0 表示不限时（异视只能被瞪走）。</summary>
        public float ActiveGazeRemaining { get; private set; }
        /// <summary>累计暴露秒数（调试/标定用）。</summary>
        public float ExposureSeconds { get; private set; }

        float _nonComplySeconds;
        float _avoidSeconds;
        bool _recordedThisGaze;

        public GazeStateMachine()
        {
            State = GazeState.Paper;
            ActiveGaze = GazeKind.None;
            Perceived = GazeWarning.Unknown;
        }

        // ---- 输入 ----
        public void SetState(GazeState s)
        {
            if (IsDead) return;
            State = s;
        }

        /// <summary>右键：卷子 ↔ 环视。空格：卷子 ↔ 手机。</summary>
        public void ToggleLookingAround()
        {
            SetState(State == GazeState.LookingAround ? GazeState.Paper : GazeState.LookingAround);
        }

        public void TogglePhone()
        {
            SetState(State == GazeState.Phone ? GazeState.Paper : GazeState.Phone);
        }

        /// <summary>环视时你正对着哪边。只有在环视状态下朝**异视**看才算「抬头直视」。</summary>
        public void SetAimingAtAnomaly(bool aiming)
        {
            IsAimingAtAnomaly = aiming;
        }

        /// <summary>世界侧触发一道不限时的视线（GazeKind.None 表示它移开了）。</summary>
        public void InjectGaze(GazeKind kind)
        {
            InjectGaze(kind, 0f);
        }

        /// <summary>世界侧触发一道视线，durationSeconds 秒后自行移开（≤0 = 不限时）。</summary>
        public void InjectGaze(GazeKind kind, float durationSeconds)
        {
            if (IsDead) return;
            if (ActiveGaze == kind && kind != GazeKind.None)
            {
                ActiveGazeRemaining = durationSeconds;
                return;
            }
            ActiveGaze = kind;
            ActiveGazeSeconds = 0f;
            ActiveGazeRemaining = kind == GazeKind.None ? 0f : durationSeconds;
            ActiveGazeSummoned = false;
            Perceived = GazeWarning.Unknown;
            _nonComplySeconds = 0f;
            _avoidSeconds = 0f;
            AnomalyRepelProgress = 0f;
            _recordedThisGaze = false;
        }

        // ---- 每帧推进 ----
        public TickResult Tick(float dt)
        {
            if (IsDead) return TickResult.Died;
            if (dt < 0f) dt = 0f;

            UpdateExposure(dt);

            bool summoned = false;
            if (Exposure >= 1f && ActiveGaze == GazeKind.None)
            {
                InjectGaze(GazeKind.Teacher, SummonedGazeSeconds);
                ActiveGazeSummoned = true;
                summoned = true;
            }

            UpdatePerception(dt);

            TickResult result = TickResult.Idle;
            if (ActiveGaze == GazeKind.Teacher) result = TickTeacher(dt);
            else if (ActiveGaze == GazeKind.Anomaly) result = TickAnomaly(dt);

            if (!IsDead && ActiveGaze != GazeKind.None && ActiveGazeRemaining > 0f)
            {
                ActiveGazeRemaining -= dt;
                if (ActiveGazeRemaining <= 0f) InjectGaze(GazeKind.None);
            }

            if (summoned && (result == TickResult.Idle || result == TickResult.Safe)) return TickResult.Summoned;
            return result;
        }

        void UpdateExposure(float dt)
        {
            if (State == GazeState.Paper)
            {
                Exposure -= ExposureDecayPerSecond * dt;
                if (Exposure < 0f) Exposure = 0f;
            }
            else
            {
                float rate = ExposurePerSecond;
                if (State == GazeState.Phone) rate *= PhoneExposureMultiplier;
                Exposure += rate * dt;
                ExposureSeconds += dt;
                if (Exposure > 1f) Exposure = 1f;
            }
        }

        void UpdatePerception(float dt)
        {
            if (ActiveGaze == GazeKind.None) { ActiveGazeSeconds = 0f; Perceived = GazeWarning.Unknown; return; }
            ActiveGazeSeconds += dt;
            if (ActiveGazeSeconds <= AmbiguitySeconds) Perceived = GazeWarning.Unknown;
            else Perceived = ActiveGaze == GazeKind.Teacher ? GazeWarning.Teacher : GazeWarning.Anomaly;
        }

        TickResult TickTeacher(float dt)
        {
            if (State == GazeState.Paper)
            {
                _nonComplySeconds = 0f;
                return TickResult.Safe;
            }
            _nonComplySeconds += dt;
            if (_nonComplySeconds >= ComplyGraceSeconds && !_recordedThisGaze)
            {
                _recordedThisGaze = true;
                TimesRecorded++;
                if (TimesRecorded >= RecordsToDeath)
                {
                    Die(DeathCause.Records);
                    return TickResult.Died;
                }
                return TickResult.Recorded;
            }
            return TickResult.Idle;
        }

        TickResult TickAnomaly(float dt)
        {
            bool staring = State == GazeState.LookingAround && IsAimingAtAnomaly;
            if (staring)
            {
                AnomalyRepelProgress += dt / Math.Max(0.0001f, AnomalyStareSeconds);
                _avoidSeconds = 0f;
                if (AnomalyRepelProgress >= 1f)
                {
                    AnomalyRepelProgress = 0f;
                    InjectGaze(GazeKind.None);
                    return TickResult.Repelled;
                }
                return TickResult.Safe;
            }

            AnomalyRepelProgress -= dt * 2f;
            if (AnomalyRepelProgress < 0f) AnomalyRepelProgress = 0f;

            if (State == GazeState.LookingAround)
            {
                // 环视但没朝它看：它在你的盲区里。7.1 第三场专门教「无法用视线回应的身后注视」，
                // 所以这里保持中性、不提前杀死玩家。
                _avoidSeconds = 0f;
                return TickResult.Idle;
            }

            _avoidSeconds += dt;
            if (_avoidSeconds >= ComplyGraceSeconds)
            {
                Die(DeathCause.Anomaly);
                return TickResult.Died;
            }
            return TickResult.Idle;
        }

        /// <summary>
        /// 不经过视线的违规（例：A2 听力期间离开卷子）。同样计入记名，同样满 RecordsToDeath 即死。
        /// </summary>
        public TickResult RecordViolation()
        {
            if (IsDead) return TickResult.Died;
            TimesRecorded++;
            if (TimesRecorded >= RecordsToDeath)
            {
                Die(DeathCause.Records);
                return TickResult.Died;
            }
            return TickResult.Recorded;
        }

        void Die(DeathCause cause)
        {
            IsDead = true;
            Cause = cause;
        }
    }
}
