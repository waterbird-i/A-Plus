import { DeathCause } from './gazeStateMachine';
import { DeterministicRng, i32Add, i32Mul } from './rng';

export const LedgerEntryKind = { Record: 'record', Death: 'death', HeldBack: 'held_back' } as const;
export type LedgerEntryKind = (typeof LedgerEntryKind)[keyof typeof LedgerEntryKind];

/** 记名册上的一行（2.6）。它是场景里的物件，从不以 UI 形式出现。 */
export interface LedgerEntry {
  attempt: number;
  year: number;
  session: number;
  kind: LedgerEntryKind;
  cause: DeathCause;
}

/** 一场考试结束后，下一步去哪（2.5.4 / 7.1）。 */
export const RunTransition = { Retry: 'retry', NextSession: 'next_session', HeldBack: 'held_back', RunComplete: 'run_complete' } as const;
export type RunTransition = (typeof RunTransition)[keyof typeof RunTransition];

/**
 * 跨轮次的进度：复读次数、场次、留级、年份倒退、记名册。
 *
 * 「第 N 次模拟考试」的 N 是 attempt（每开一场 +1），死亡曲线吃的是 totalDeaths
 * （2.4：N = 累计死亡次数）。两者在只死不过的玩家身上恒差 1。
 */
export class RunState {
  // ---- 规则参数 ----
  startYear = 2026;
  earliestYear = 1998;
  /** 2.5.3：每死一次，年份往前退 1–3 年（随机、不等距）。 */
  yearStepMin = 1;
  yearStepMax = 3;
  /** 2.5.4：同一场死满这么多次 ⇒ 留级（强制换监考）。 */
  deathsToHoldBack = 5;
  /** Demo 只有一位监考（8.1）。 */
  sessionCount = 1;
  /** q.fill.43：从这一轮起，抬头印的是你的考号而不是次数。 */
  headerShowsCandidateFromAttempt = 15;
  /** 2.4：阶段四（N = 10–14）起，记名册上出现「已适应」批注。 */
  adaptedNoteFromDeaths = 10;
  /** q.fill.13：你本人的考号。 */
  candidateNumber = '0713';
  /** q.fill.11：记录本第一页的第一个考号是 0601；广播按轮次往后念。 */
  rosterBase = 600;

  // ---- 状态 ----
  attempt = 1;
  totalDeaths = 0;
  session = 1;
  deathsThisSession = 0;
  year: number;
  heldBackCount = 0;
  isComplete = false;
  readonly ledger: LedgerEntry[] = [];

  constructor(readonly seed = 20260923) {
    this.year = this.startYear;
  }

  /** 本轮抽题用的种子：同一个存档的同一轮永远抽出同一张卷子。 */
  get roundSeed(): number {
    return i32Add(i32Mul(this.seed, 7919), i32Mul(this.attempt, 104729));
  }

  get headerShowsCandidateNumber(): boolean { return this.attempt >= this.headerShowsCandidateFromAttempt; }
  get ledgerShowsAdaptedNote(): boolean { return this.totalDeaths >= this.adaptedNoteFromDeaths; }

  /** 3.4 / q.fill.38：广播念的第 index 个考号。终局（抬头只剩考号时）念的是你自己。 */
  rosterNumber(index: number): string {
    if (this.headerShowsCandidateNumber) return this.candidateNumber;
    return String(this.rosterBase + this.attempt + index).padStart(4, '0');
  }

  /** 下一次死亡是第几次（喂给 DeathCurve）。 */
  get nextDeathOrdinal(): number { return this.totalDeaths + 1; }

  /**
   * 一场考试结束。records = 这一场被记名的次数（逐条写进记名册）。
   * died = false 表示交卷成功。
   */
  completeAttempt(died: boolean, records: number, cause: DeathCause): RunTransition {
    if (this.isComplete) return RunTransition.RunComplete;

    for (let i = 0; i < records; i++) this.addLedger(LedgerEntryKind.Record, DeathCause.None);

    let next: RunTransition;
    if (died) {
      this.addLedger(LedgerEntryKind.Death, cause);
      this.totalDeaths++;
      this.deathsThisSession++;
      this.stepYearBack();
      if (this.deathsThisSession >= this.deathsToHoldBack) {
        this.heldBackCount++;
        this.addLedger(LedgerEntryKind.HeldBack, DeathCause.None);
        next = this.advanceSession(RunTransition.HeldBack);
      } else next = RunTransition.Retry;
    } else {
      next = this.advanceSession(RunTransition.NextSession);
    }

    if (next !== RunTransition.RunComplete) this.attempt++;
    return next;
  }

  private advanceSession(kind: RunTransition): RunTransition {
    this.session++;
    this.deathsThisSession = 0;
    if (this.session > this.sessionCount) {
      this.isComplete = true;
      return RunTransition.RunComplete;
    }
    return kind;
  }

  private stepYearBack(): void {
    const rng = new DeterministicRng(i32Add(i32Mul(this.seed, 31), i32Mul(this.totalDeaths, 131071)));
    const span = Math.max(0, this.yearStepMax - this.yearStepMin);
    const step = this.yearStepMin + rng.next(span + 1);
    this.year = Math.max(this.earliestYear, this.year - step);
  }

  private addLedger(kind: LedgerEntryKind, cause: DeathCause): void {
    this.ledger.push({ attempt: this.attempt, year: this.year, session: this.session, kind, cause });
  }
}
