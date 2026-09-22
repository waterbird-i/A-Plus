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

    public enum TickResult { Idle, Safe, Repelled, Recorded, Died }

    /// <summary>
    /// 设计文档 2.1（三态视线）+ 2.2（双重注视）的可执行骨架。
    ///
    /// 原型里刻意做成**不依赖 UnityEngine 的纯逻辑**：同一份源码既能在 Unity 里跑，
    /// 也能被 Tools/APlusProto 的命令行原型直接驱动做自检（见 Docs/原型与配比标定.md）。
    ///
    /// 两条设计铁律，都由 _selftest 断言守着：
    ///   1. 安全的状态让你瞎（Paper 不累积暴露，但你在那里拿不到任何环境信息）；
    ///   2. 看得见的状态让你死（环视/手机累积暴露，且周边不可信）。
    ///
    /// 判定优先级（2.2）：师视应对错 → 记名（不是死）；异视应对错 → 死。
    /// 一个写在墙上的规则（第五条）因此变成会杀死你的两难。
    /// </summary>
    public sealed class GazeStateMachine
    {
        // ---- 可标定参数（Demo 的手感全在这几个数上；标定方法见 2.4 / Docs/难度配比标定.md）----
        /// <summary>2.2 细节 2：前 2 秒内两种警告应该几乎无法分辨。</summary>
        public float AmbiguitySeconds = 2.0f;
        /// <summary>给你「反应」的时间窗。原型假设值，必须靠内部测试标定。</summary>
        public float ComplyGraceSeconds = 0.6f;
        /// <summary>2.2：异视必须被直视到「它先移开」。</summary>
        public float AnomalyStareSeconds = 1.5f;
        /// <summary>环视时每秒累积的暴露（0..1）。</summary>
        public float ExposurePerSecond = 0.25f;
        /// <summary>2.1：手机屏幕发光会吸引注视 ⇒ 暴露更快。</summary>
        public float PhoneExposureMultiplier = 1.5f;
        /// <summary>退回卷子后暴露的自然回落（呼吸平复）。</summary>
        public float ExposureDecayPerSecond = 0.08f;
        /// <summary>
        /// 原型假设：掏手机是**低头**，所以不违反「被监考老师注视时不能抬头」，但仍然累积暴露。
        /// 设计文档 2.2 没有明说这一条 —— 待用户确认（已记在交付报告里）。
        /// </summary>
        public bool PhoneCountsAsLookingDown = true;

        // ---- 状态（零 HUD ⇒ 这些量不上屏，只驱动声音与画面）----
        public GazeState State { get; private set; }
        /// <summary>2.1 要点 4：暴露时间不显示为进度条，它的唯一表现是呼吸声。</summary>
        public float Exposure { get; private set; }
        /// <summary>2.1：环视 ⇒ 管道视野。周边不可信，老师会在你的盲区里移动。</summary>
        public bool PeripheralReliable { get { return State == GazeState.Paper; } }
        /// <summary>2.1 要点 4：紧张度与暴露时间合并成一个听觉变量。</summary>
        public float Breathing { get { return Exposure; } }
        /// <summary>2.2：错误应对师视的代价是记名，不是死（2.6 记名册）。</summary>
        public int TimesRecorded { get; private set; }
        public bool IsDead { get; private set; }
        /// <summary>世界真相。</summary>
        public GazeKind ActiveGaze { get; private set; }
        public GazeWarning Perceived { get; private set; }
        /// <summary>2.2 细节 1：注视异象时它必须**立刻可见地**变淡/抖动。判定可以难，绝不能不可读。</summary>
        public float AnomalyRepelProgress { get; private set; }
        public bool IsAimingAtAnomaly { get; private set; }
        public float ActiveGazeSeconds { get; private set; }
        /// <summary>本状态机跑到现在为止的累计暴露秒数（调试/标定用）。</summary>
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

        /// <summary>世界侧触发一道视线（GazeKind.None 表示它移开了）。</summary>
        public void InjectGaze(GazeKind kind)
        {
            if (IsDead) return;
            if (ActiveGaze == kind) return;
            ActiveGaze = kind;
            ActiveGazeSeconds = 0f;
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
            UpdatePerception(dt);

            TickResult result = TickResult.Idle;
            if (ActiveGaze == GazeKind.Teacher) result = TickTeacher(dt);
            else if (ActiveGaze == GazeKind.Anomaly) result = TickAnomaly(dt);
            return result;
        }

        void UpdateExposure(float dt)
        {
            if (State == GazeState.Paper)
            {
                // 安全区：不累积，缓慢回落。这是整个游戏唯一的张力来源（2.1 要点 1）。
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
            // 2.2 细节 2：模糊地带。前 AmbiguitySeconds 秒内，玩家不可能知道这是哪一种。
            if (ActiveGazeSeconds <= AmbiguitySeconds) Perceived = GazeWarning.Unknown;
            else Perceived = ActiveGaze == GazeKind.Teacher ? GazeWarning.Teacher : GazeWarning.Anomaly;
        }

        TickResult TickTeacher(float dt)
        {
            bool complying = State == GazeState.Paper || (State == GazeState.Phone && PhoneCountsAsLookingDown);
            if (complying)
            {
                // 正确应对：注视减弱，获得几秒安全（2.2）。
                _nonComplySeconds = 0f;
                return TickResult.Safe;
            }
            _nonComplySeconds += dt;
            if (_nonComplySeconds >= ComplyGraceSeconds && !_recordedThisGaze)
            {
                // 规则字面成立：被监考老师注视时不能抬头 → 违规 → 记名。（不是死）
                _recordedThisGaze = true;
                TimesRecorded++;
                return TickResult.Recorded;
            }
            return TickResult.Idle;
        }

        TickResult TickAnomaly(float dt)
        {
            bool staring = State == GazeState.LookingAround && IsAimingAtAnomaly;
            if (staring)
            {
                // 2.2 细节 1：从第一帧起就必须可见地变化，否则玩家读不到「起作用了」。
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

            bool hiding = State == GazeState.Paper || (State == GazeState.Phone && PhoneCountsAsLookingDown);
            if (hiding)
            {
                // 错误应对：低头躲避 → 它贴到脸前 → 死（2.2）。
                _avoidSeconds += dt;
                if (_avoidSeconds >= ComplyGraceSeconds)
                {
                    IsDead = true;
                    return TickResult.Died;
                }
            }
            else
            {
                // 环视但没朝它看：它在你的盲区里。设计文档 7.1 第三场专门拿这个当教学点
                // （「无法用视线回应的身后注视」），所以原型里保持中性、不提前杀死玩家。
                _avoidSeconds = 0f;
            }
            return TickResult.Idle;
        }
    }
}