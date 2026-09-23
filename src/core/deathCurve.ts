/** 一次死亡要怎么演。全部是连续量，呈现层只读不判。 */
export interface DeathPresentation {
  /** 这是第几次死（= 试卷抬头「第 N 次」里被消耗掉的那一次）。 */
  deathOrdinal: number;
  /** t = clamp(N / saturationDeaths, 0, 1)。 */
  t: number;
  stingerVolume: number;
  /** 0 = 原声，1 = 「像隔着一层水」（阶段二）。 */
  stingerMuffle: number;
  flashIntensity: number;
  /** 正脸前冲距离，1 = 贴脸占满屏，0 = 静止站着。 */
  cameraRush: number;
  leadInSilenceSeconds: number;
  /** 音画错位：画面先到，声音晚这么多秒（阶段三）。 */
  audioDelaySeconds: number;
  postDeathDwellSeconds: number;
  faceAppears: boolean;
  /** 阶段五：没有事件的死亡 —— 你抬头，抬头已经换成下一次。 */
  eventless: boolean;
}

/** [from, to] 死亡次数区间上的 0→1 线性爬升。 */
export class DeathWindow {
  constructor(public from: number, public to: number) {}

  ramp(n: number): number {
    if (this.to <= this.from) return n >= this.to ? 1 : 0;
    const x = (n - this.from) / (this.to - this.from);
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }
}

/**
 * 设计文档 2.4「Jump Scare → Dread 五阶段连续退化」。
 *
 * 硬规则：不允许 if (N < 3) jumpScare(); else dread(); —— 每个部件都是死亡次数的连续函数，
 * 唯一的离散量是 faceAppears（且发生在最晚处）与 eventless（t 饱和）。
 *
 * 默认区间按 2.4「五个阶段」表对齐（该表与「参数错峰」表在几处数值上互相矛盾，
 * 以玩家可感知的阶段表为准）；最终由「连死 16 次」真人测试标定。
 */
export class DeathCurve {
  saturationDeaths = 15;
  faceCutoffT = 0.66;
  maxLeadInSilenceSeconds = 4;
  maxAudioDelaySeconds = 1.5;
  maxPostDeathDwellSeconds = 8;

  stingerFade = new DeathWindow(2, 10);
  muffle = new DeathWindow(2, 6);
  flashFade = new DeathWindow(2, 6);
  rushFade = new DeathWindow(2, 6);
  leadInGrowth = new DeathWindow(2, 14);
  audioDelayGrowth = new DeathWindow(5, 9);
  dwellGrowth = new DeathWindow(2, 15);

  evaluate(deathOrdinal: number): DeathPresentation {
    const n = deathOrdinal < 1 ? 1 : deathOrdinal;
    const t = Math.min(1, n / Math.max(1, this.saturationDeaths));
    return {
      deathOrdinal: n,
      t,
      stingerVolume: 1 - this.stingerFade.ramp(n),
      stingerMuffle: this.muffle.ramp(n),
      flashIntensity: 1 - this.flashFade.ramp(n),
      cameraRush: 1 - this.rushFade.ramp(n),
      leadInSilenceSeconds: this.maxLeadInSilenceSeconds * this.leadInGrowth.ramp(n),
      audioDelaySeconds: this.maxAudioDelaySeconds * this.audioDelayGrowth.ramp(n),
      postDeathDwellSeconds: this.maxPostDeathDwellSeconds * this.dwellGrowth.ramp(n),
      faceAppears: t < this.faceCutoffT,
      eventless: t >= 1,
    };
  }
}
