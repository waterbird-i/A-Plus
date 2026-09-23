using System;

namespace APlus
{
    /// <summary>
    /// 一位监考的注视规则（2.3「四位监考，四套注视规则」）。秒数都是真实时间。
    /// Demo 只用 Podium（一直坐在讲台：缓慢、稳定、可预判）。
    /// </summary>
    [Serializable]
    public sealed class InvigilatorProfile
    {
        public string Id = "podium";
        public float FirstTeacherDelay = 20f;
        public float TeacherIntervalMin = 22f;
        public float TeacherIntervalMax = 38f;
        public float TeacherGazeMin = 3f;
        public float TeacherGazeMax = 5f;

        public float FirstAnomalyDelay = 60f;
        public float AnomalyIntervalMin = 45f;
        public float AnomalyIntervalMax = 75f;
        /// <summary>6.2：异象越往后越频繁。强度 1 时间隔乘以这个数。</summary>
        public float AnomalyIntervalAtFullIntensity = 0.6f;

        /// <summary>
        /// 听力时段异象计时走得多快（1 = 不变）。听力时离开试卷会被记名，抬头瞪异象也算离开，
        /// 所以这段时间来的每一道异象都必然换走一次记名 —— 让它少来。
        /// </summary>
        public float ListeningAnomalyRate = 0.35f;

        /// <summary>视线落下之前，世界先给出的声音预警有多长（皮鞋声 / 日光灯变调）。</summary>
        public float CueLeadSeconds = 2.5f;

        public static InvigilatorProfile Podium() { return new InvigilatorProfile(); }
    }

    /// <summary>
    /// 调度谁在什么时候看你。它只往 GazeStateMachine 里注入视线，不做任何判定。
    /// 一道视线在场时两条计时都暂停 —— 同一时刻只落一道视线（2.2）。
    /// </summary>
    public sealed class GazeDirector
    {
        public InvigilatorProfile Profile;
        /// <summary>0..1，来自复读进度（6.2 异象强度）。</summary>
        public float AnomalyIntensity;
        /// <summary>听力时段：老师不抬头（听力规则本身就是监视，A2），异象按 ListeningAnomalyRate 放慢。</summary>
        public bool Listening;

        readonly DeterministicRng _rng;
        float _teacherIn;
        float _anomalyIn;

        public GazeDirector(InvigilatorProfile profile, int seed, float anomalyIntensity)
        {
            Profile = profile ?? InvigilatorProfile.Podium();
            _rng = new DeterministicRng(seed);
            AnomalyIntensity = Clamp01(anomalyIntensity);
            _teacherIn = Profile.FirstTeacherDelay;
            _anomalyIn = Profile.FirstAnomalyDelay;
        }

        /// <summary>下一道视线是谁、还有多久。呈现层用它起声音预警。</summary>
        public GazeKind UpcomingKind { get { return AnomalyInReal < TeacherInReal ? GazeKind.Anomaly : GazeKind.Teacher; } }
        public float SecondsToNext { get { return Math.Min(TeacherInReal, AnomalyInReal); } }

        float TeacherInReal { get { return Listening ? float.PositiveInfinity : _teacherIn; } }
        float AnomalyInReal
        {
            get
            {
                if (!Listening) return _anomalyIn;
                return Profile.ListeningAnomalyRate > 0f ? _anomalyIn / Profile.ListeningAnomalyRate : float.PositiveInfinity;
            }
        }
        public bool IsCueing { get { return SecondsToNext <= Profile.CueLeadSeconds; } }

        public void Tick(float dt, GazeStateMachine machine)
        {
            if (machine.IsDead || machine.ActiveGaze != GazeKind.None) return;
            if (dt < 0f) dt = 0f;

            if (!Listening) _teacherIn -= dt;
            _anomalyIn -= Listening ? dt * Profile.ListeningAnomalyRate : dt;

            if (_anomalyIn <= 0f)
            {
                machine.InjectGaze(GazeKind.Anomaly);
                _anomalyIn = NextAnomalyInterval();
                if (_teacherIn < Profile.CueLeadSeconds) _teacherIn = Profile.CueLeadSeconds;
                return;
            }
            if (_teacherIn <= 0f)
            {
                machine.InjectGaze(GazeKind.Teacher, Range(Profile.TeacherGazeMin, Profile.TeacherGazeMax));
                _teacherIn = Range(Profile.TeacherIntervalMin, Profile.TeacherIntervalMax);
                if (_anomalyIn < Profile.CueLeadSeconds) _anomalyIn = Profile.CueLeadSeconds;
            }
        }

        float NextAnomalyInterval()
        {
            float scale = 1f + (Profile.AnomalyIntervalAtFullIntensity - 1f) * AnomalyIntensity;
            return Range(Profile.AnomalyIntervalMin, Profile.AnomalyIntervalMax) * scale;
        }

        float Range(float min, float max)
        {
            return min + (max - min) * _rng.NextFloat();
        }

        static float Clamp01(float v) { return v < 0f ? 0f : (v > 1f ? 1f : v); }
    }
}
