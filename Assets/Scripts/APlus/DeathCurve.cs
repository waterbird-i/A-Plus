using System;

namespace APlus
{
    /// <summary>一次死亡要怎么演。全部是连续量，呈现层只读不判。</summary>
    public struct DeathPresentation
    {
        /// <summary>这是第几次死（= 试卷抬头「第 N 次」里被消耗掉的那一次）。</summary>
        public int DeathOrdinal;
        /// <summary>t = clamp(N / SaturationDeaths, 0, 1)。</summary>
        public float T;
        public float StingerVolume;
        /// <summary>0 = 原声，1 = 「像隔着一层水」（阶段二）。</summary>
        public float StingerMuffle;
        public float FlashIntensity;
        /// <summary>正脸前冲距离，1 = 贴脸占满屏，0 = 静止站着。</summary>
        public float CameraRush;
        public float LeadInSilenceSeconds;
        /// <summary>音画错位：画面先到，声音晚这么多秒（阶段三）。</summary>
        public float AudioDelaySeconds;
        public float PostDeathDwellSeconds;
        public bool FaceAppears;
        /// <summary>阶段五：没有事件的死亡 —— 你抬头，抬头已经换成下一次。</summary>
        public bool Eventless;
    }

    /// <summary>[From, To] 死亡次数区间上的 0→1 线性爬升。</summary>
    [Serializable]
    public struct DeathWindow
    {
        public float From;
        public float To;

        public DeathWindow(float from, float to) { From = from; To = to; }

        public float Ramp(int n)
        {
            if (To <= From) return n >= To ? 1f : 0f;
            float x = (n - From) / (To - From);
            return x < 0f ? 0f : (x > 1f ? 1f : x);
        }
    }

    /// <summary>
    /// 设计文档 2.4「Jump Scare → Dread 五阶段连续退化」。
    ///
    /// 硬规则：不允许 if (N &lt; 3) JumpScare(); else Dread(); —— 每个部件都是死亡次数的连续函数，
    /// 唯一的离散量是 FaceAppears（且发生在最晚处）与 Eventless（t 饱和）。
    ///
    /// 默认区间按 2.4「五个阶段」表对齐（该表与「参数错峰」表在几处数值上互相矛盾，
    /// 以玩家可感知的阶段表为准）；最终由「连死 16 次」真人测试标定。
    /// </summary>
    [Serializable]
    public sealed class DeathCurve
    {
        public int SaturationDeaths = 15;
        public float FaceCutoffT = 0.66f;
        public float MaxLeadInSilenceSeconds = 4f;
        public float MaxAudioDelaySeconds = 1.5f;
        public float MaxPostDeathDwellSeconds = 8f;

        public DeathWindow StingerFade = new DeathWindow(2, 10);
        public DeathWindow Muffle = new DeathWindow(2, 6);
        public DeathWindow FlashFade = new DeathWindow(2, 6);
        public DeathWindow RushFade = new DeathWindow(2, 6);
        public DeathWindow LeadInGrowth = new DeathWindow(2, 14);
        public DeathWindow AudioDelayGrowth = new DeathWindow(5, 9);
        public DeathWindow DwellGrowth = new DeathWindow(2, 15);

        public DeathPresentation Evaluate(int deathOrdinal)
        {
            int n = deathOrdinal < 1 ? 1 : deathOrdinal;
            float t = Math.Min(1f, n / (float)Math.Max(1, SaturationDeaths));

            DeathPresentation p = new DeathPresentation();
            p.DeathOrdinal = n;
            p.T = t;
            p.StingerVolume = 1f - StingerFade.Ramp(n);
            p.StingerMuffle = Muffle.Ramp(n);
            p.FlashIntensity = 1f - FlashFade.Ramp(n);
            p.CameraRush = 1f - RushFade.Ramp(n);
            p.LeadInSilenceSeconds = MaxLeadInSilenceSeconds * LeadInGrowth.Ramp(n);
            p.AudioDelaySeconds = MaxAudioDelaySeconds * AudioDelayGrowth.Ramp(n);
            p.PostDeathDwellSeconds = MaxPostDeathDwellSeconds * DwellGrowth.Ramp(n);
            p.FaceAppears = t < FaceCutoffT;
            p.Eventless = t >= 1f;
            return p;
        }
    }
}
