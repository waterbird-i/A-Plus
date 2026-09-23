/** 一条广播。key 指向 broadcast.csv；arg 是填进 {0} 的数（报时的分钟数、考号…）。 */
export interface BroadcastCue {
  gameSecond: number;
  key: string;
  arg: string;
}

/**
 * 3.4 报时的恐怖化程度。它只改广播里的数，不改文本（broadcast.tamper.note）。
 *   normal   报时正常，建立可信度
 *   slow     报的剩余时间比实际多 —— 「我确定刚才才听过十五分钟」
 *   rewind   报的剩余时间在倒退（越报越多）
 *   roster   不再报时，改念考号
 */
export const BroadcastTamper = { Normal: 'normal', Slow: 'slow', Rewind: 'rewind', Roster: 'roster' } as const;
export type BroadcastTamper = (typeof BroadcastTamper)[keyof typeof BroadcastTamper];

/**
 * 第三部分：全局考试倒计时。时间只存在于广播与挂钟里（零 HUD）。
 * 游戏内 20 分钟，2 倍速 ⇒ 实际约 10 分钟（3.5）。
 */
export class ExamClock {
  durationGameSeconds = 20 * 60;
  timeScale = 2;
  /** 挂钟上的开考时刻（q.math.05：考试 9:00 开始）。 */
  startClockMinutes = 9 * 60;
  /** A2：英语听力 —— 不得翻卷、不得张望。游戏内秒。 */
  listeningStartGameSecond = 3 * 60;
  listeningDurationGameSeconds = 4 * 60;
  /** 3.5：剩 15 / 10 / 5 / 1 分钟各报一次。 */
  remainingAnnouncements = [15, 10, 5, 1];
  slowTamperMinutes = 5;
  /** roster 模式下念的考号（按顺序），最后一个通常是你。 */
  rosterNumbers: string[] = [];

  private _gameSeconds = 0;
  private readonly plan: BroadcastCue[] = [];
  private nextIndex = 0;

  get gameSeconds(): number { return this._gameSeconds; }
  get isOver(): boolean { return this._gameSeconds >= this.durationGameSeconds; }
  get remainingGameSeconds(): number { return Math.max(0, this.durationGameSeconds - this._gameSeconds); }
  get inListening(): boolean {
    return this._gameSeconds >= this.listeningStartGameSecond
      && this._gameSeconds < this.listeningStartGameSecond + this.listeningDurationGameSeconds;
  }
  get cues(): readonly BroadcastCue[] { return this.plan; }

  /** 挂钟读数（分钟，从零点起）。wallClockOffsetMinutes 是 q.fill.07「挂钟比广播慢」。 */
  wallClockMinutes(wallClockOffsetMinutes: number): number {
    return this.startClockMinutes + Math.trunc(this._gameSeconds / 60) - wallClockOffsetMinutes;
  }

  build(tamper: BroadcastTamper): void {
    this.plan.length = 0;
    this.nextIndex = 0;
    this._gameSeconds = 0;

    this.plan.push({ gameSecond: 0, key: 'broadcast.check.device', arg: '' });
    this.plan.push({ gameSecond: 5, key: 'broadcast.check.name', arg: '' });
    this.plan.push({ gameSecond: this.listeningStartGameSecond, key: 'broadcast.listening.start', arg: '' });
    this.plan.push({ gameSecond: this.listeningStartGameSecond + this.listeningDurationGameSeconds, key: 'broadcast.listening.end', arg: '' });

    this.remainingAnnouncements.forEach((actual, i) => {
      const at = this.durationGameSeconds - actual * 60;
      if (tamper === BroadcastTamper.Roster) {
        const n = this.rosterNumbers;
        const number = n.length > 0 ? n[Math.min(i, n.length - 1)] : '';
        this.plan.push({ gameSecond: at, key: 'broadcast.roster_fmt', arg: number });
        return;
      }
      const reported = this.reported(actual, i, tamper);
      if (reported === actual && actual === 5) this.plan.push({ gameSecond: at, key: 'broadcast.time.remain_last5', arg: '' });
      else if (reported === actual && actual === 1) this.plan.push({ gameSecond: at, key: 'broadcast.time.remain_last1', arg: '' });
      else this.plan.push({ gameSecond: at, key: 'broadcast.time.remain_fmt', arg: String(reported) });
    });

    this.plan.push({ gameSecond: this.durationGameSeconds, key: 'broadcast.collect.stop', arg: '' });
    this.plan.sort((a, b) => a.gameSecond - b.gameSecond);
  }

  private reported(actual: number, index: number, tamper: BroadcastTamper): number {
    if (tamper === BroadcastTamper.Slow) return actual + this.slowTamperMinutes;
    if (tamper === BroadcastTamper.Rewind) {
      const first = this.remainingAnnouncements.length > 0 ? this.remainingAnnouncements[0] : actual;
      return first + index * 10;
    }
    return actual;
  }

  /** 推进真实时间 realDt 秒；把这段时间内到点的广播追加进 fired。 */
  tick(realDt: number, fired: BroadcastCue[] | null): void {
    if (realDt < 0) realDt = 0;
    this._gameSeconds = Math.min(this.durationGameSeconds, this._gameSeconds + realDt * this.timeScale);
    while (this.nextIndex < this.plan.length && this.plan[this.nextIndex].gameSecond <= this._gameSeconds) {
      if (fired) fired.push(this.plan[this.nextIndex]);
      this.nextIndex++;
    }
  }
}
