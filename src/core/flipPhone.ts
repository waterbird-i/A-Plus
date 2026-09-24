import { display, formatArgs } from './answerExpression';
import type { ExamQuestion } from './choiceBuilder';
import { Difficulty } from './gameData';
import { DeterministicRng } from './rng';

/** 翻盖机的 16 个键：0–9、* #、上下、确定、返回。 */
export const PhoneKey = {
  D0: '0', D1: '1', D2: '2', D3: '3', D4: '4', D5: '5', D6: '6', D7: '7', D8: '8', D9: '9',
  Star: '*', Hash: '#', Up: 'up', Down: 'down', Ok: 'ok', Back: 'back',
} as const;
export type PhoneKey = (typeof PhoneKey)[keyof typeof PhoneKey];

export const PHONE_DIGITS: readonly PhoneKey[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export const PhoneScreen = {
  Home: 'home',
  Search: 'search',
  Searching: 'searching',
  SearchResult: 'search_result',
  Ask: 'ask',
  Sent: 'sent',
  Inbox: 'inbox',
  Message: 'message',
  Calc: 'calc',
  Profile: 'profile',
  Dead: 'dead',
} as const;
export type PhoneScreen = (typeof PhoneScreen)[keyof typeof PhoneScreen];

export const PhoneApp = { Search: 'search', Ask: 'ask', Inbox: 'inbox', Calc: 'calc', Profile: 'profile' } as const;
export type PhoneApp = (typeof PhoneApp)[keyof typeof PhoneApp];

/** 主菜单顺序 = 数字快捷键 1–5。 */
export const PHONE_MENU: readonly PhoneApp[] = [PhoneApp.Search, PhoneApp.Ask, PhoneApp.Inbox, PhoneApp.Calc, PhoneApp.Profile];

export const PhoneEventKind = {
  /** 按了一个键。audible = 响铃模式下有按键音（她在附近能听见）。 */
  Key: 'key',
  /** 响铃模式下来短信：整间教室都听得见。 */
  Ring: 'ring',
  /** 静音模式下来短信：没有任何声音 —— 你得自己掏出来看。 */
  SilentArrival: 'silent_arrival',
  SearchDone: 'search_done',
  Sent: 'sent',
  Denied: 'denied',
  BatteryLow: 'battery_low',
  BatteryDead: 'battery_dead',
} as const;
export type PhoneEventKind = (typeof PhoneEventKind)[keyof typeof PhoneEventKind];

export interface PhoneEvent {
  kind: PhoneEventKind;
  key: PhoneKey | null;
  audible: boolean;
}

export interface PhoneMessage {
  senderKey: string;
  text: string;
  read: boolean;
  /** 到达时刻（开考后的真实秒数）。 */
  at: number;
  /** 回的是第几题（0 = 不是答案短信）。 */
  question: number;
}

/** 卷子上每一道题在手机这头对应的东西。 */
export interface PhoneQuestionTask {
  /** 卷面题号（1 起）。 */
  number: number;
  /** 印在卷面题号旁的 4 位题码：搜题要输它。 */
  code: string;
  /** 搜题结果：永远正确。 */
  answer: string;
  /** 学霸回的答案：大多数时候对，遮挡题 / 难题上更容易错（4.4 可信度）。 */
  askAnswer: string;
  askReliable: boolean;
  /** 学霸多久回信（秒）。 */
  askDelay: number;
}

export interface SearchResult {
  /** 0 = 查无此题。 */
  number: number;
  answer: string;
}

/** 手机上的一次短暂提示（写在当前屏幕上，按任意键消失）。 */
export const PhoneNotice = { None: '', Balance: 'balance', NoSuchQuestion: 'no_such_question' } as const;
export type PhoneNotice = (typeof PhoneNotice)[keyof typeof PhoneNotice];

interface Scheduled {
  at: number;
  message: PhoneMessage;
}

const CALC_OPS = ['+', '-', '*', '/'];

function isDigit(key: PhoneKey): boolean {
  return key.length === 1 && key >= '0' && key <= '9';
}

/**
 * 翻盖机（决策 #42：手机就是解题器）。卷子上的题不是让你真答的 —— 答案都在这台手机里：
 *
 *   1 搜题      输入卷面上的 4 位题码 → 连接移动梦网（要一直掏着）→ 答案。永远对，但贵（0.50 元/次，连上才扣）
 *   2 问学霸    输入题号发短信 → 5–12 秒后回信。便宜（0.10 元/条），会错；回信会「响」
 *   3 收件箱    学霸的回信、10086、家长、广告……和不该出现的短信
 *   4 计算器    合法工具：数学题真的能算出来
 *   5 情景模式  响铃 / 静音。响铃：来短信、按键都有声音，老师听得见。静音：没有声音，也就没有提醒
 *
 * 话费和电量都做在手机里（零 HUD，5.4）。不依赖渲染引擎；呈现层只负责把 screen 画出来。
 */
export class FlipPhone {
  // ---- 可标定参数 ----
  batteryMax = 4;
  /** 屏幕亮着每秒耗多少格。电量管的是「掏着多久」，搜几次由话费管 —— 单次操作的耗电别大到替话费做主。 */
  batteryDrainPerSecond = 1 / 60;
  searchBatteryCost = 0.2;
  sendBatteryCost = 0.1;
  searchCostCents = 50;
  smsCostCents = 10;
  /** 连接移动梦网要多久。这段时间手机必须一直掏着 —— 收起来就断线，白等（连上才扣费）。 */
  searchSeconds = 2.4;
  sentSeconds = 1.0;
  codeLength = 4;
  calcMaxLength = 14;

  // ---- 状态 ----
  battery: number;
  balanceCents = 320;
  silent = false;
  screen: PhoneScreen = PhoneScreen.Home;
  menuIndex = 0;
  input = '';
  searchProgress = 0;
  result: SearchResult | null = null;
  notice: PhoneNotice = PhoneNotice.None;
  /** 新的在前。 */
  readonly inbox: PhoneMessage[] = [];
  inboxIndex = 0;
  openMessage: PhoneMessage | null = null;
  calcExpr = '';
  calcResult = '';
  /** 开考后的真实秒数。 */
  time = 0;
  /** 屏幕上任何可见的东西变了就 +1：呈现层据此决定要不要重画点阵屏。 */
  revision = 0;

  private sentLeft = 0;
  private pendingCode = '';
  private readonly scheduled: Scheduled[] = [];
  private lowWarned = false;
  private deadWarned = false;

  constructor(readonly tasks: PhoneQuestionTask[], private readonly text: (key: string) => string) {
    this.battery = this.batteryMax;
  }

  /** 为一场考试配好手机：每道题一个题码、学霸的（可能错的）答案、以及这场会收到的杂音短信。 */
  static forSession(questions: ExamQuestion[], text: (key: string) => string, seed: number, attempt: number): FlipPhone {
    const rng = new DeterministicRng(seed);
    const used = new Set<string>();
    const tasks = questions.map((q, i): PhoneQuestionTask => {
      let code = '';
      do code = String(1000 + rng.next(9000)); while (used.has(code));
      used.add(code);
      const answer = q.correctIndex >= 0 ? q.choices[q.correctIndex] : display(q.answer);
      const occluded = (q.plan?.occlusionLabel ?? '').length > 0;
      const hard = q.plan?.difficultyId === Difficulty.Hard;
      const wrongChance = 0.1 + (occluded ? 0.25 : 0) + (hard ? 0.1 : 0);
      const wrong = q.choices.filter((_, k) => k !== q.correctIndex);
      const reliable = wrong.length === 0 || rng.nextFloat() >= wrongChance;
      return {
        number: i + 1,
        code,
        answer,
        askAnswer: reliable ? answer : wrong[rng.next(wrong.length)],
        askReliable: reliable,
        askDelay: 5 + 7 * rng.nextFloat(),
      };
    });
    const phone = new FlipPhone(tasks, text);
    phone.scheduleAmbient(rng, attempt);
    return phone;
  }

  get dead(): boolean { return this.battery <= 0; }
  get batteryBars(): number { return Math.max(0, Math.min(this.batteryMax, Math.ceil(this.battery - 1e-9))); }
  get unread(): number { return this.inbox.filter((m) => !m.read).length; }
  get pendingReplies(): number { return this.scheduled.filter((s) => s.message.question > 0).length; }
  get balanceText(): string { return (this.balanceCents / 100).toFixed(2); }

  codeFor(questionIndex: number): string {
    return this.tasks[questionIndex]?.code ?? '';
  }

  /** 安排一条短信在 at 秒到达（text 已经是最终文本）。 */
  schedule(at: number, senderKey: string, text: string, question = 0): void {
    this.scheduled.push({ at, message: { senderKey, text, read: false, at, question } });
    this.scheduled.sort((a, b) => a.at - b.at);
  }

  // ---- 输入 ----

  press(key: PhoneKey, events: PhoneEvent[]): void {
    if (this.dead) return;
    events.push({ kind: PhoneEventKind.Key, key, audible: !this.silent });
    this.revision++;
    this.notice = PhoneNotice.None;
    switch (this.screen) {
      case PhoneScreen.Home: this.pressHome(key); break;
      case PhoneScreen.Search: this.pressSearch(key, events); break;
      case PhoneScreen.Searching:
        if (key === PhoneKey.Back) { this.screen = PhoneScreen.Search; this.searchProgress = 0; }
        break;
      case PhoneScreen.SearchResult:
        if (key === PhoneKey.Ok) { this.input = ''; this.result = null; this.screen = PhoneScreen.Search; }
        else if (key === PhoneKey.Back) this.goHome();
        break;
      case PhoneScreen.Ask: this.pressAsk(key, events); break;
      case PhoneScreen.Inbox: this.pressInbox(key); break;
      case PhoneScreen.Message:
        if (key === PhoneKey.Back || key === PhoneKey.Ok) { this.openMessage = null; this.screen = PhoneScreen.Inbox; }
        break;
      case PhoneScreen.Calc: this.pressCalc(key); break;
      case PhoneScreen.Profile:
        if (key === PhoneKey.Back) this.goHome();
        else if (key === PhoneKey.Ok || key === PhoneKey.Up || key === PhoneKey.Down) this.silent = !this.silent;
        break;
      default: break;
    }
  }

  /** 合上翻盖、塞回桌肚：回到待机屏；正在连的梦网断线（没连上不扣费，但等的那几秒白等了）。 */
  putAway(): void {
    if (this.dead) return;
    this.goHome();
    this.openMessage = null;
    this.searchProgress = 0;
    this.revision++;
  }

  // ---- 每帧推进 ----

  tick(dt: number, screenOn: boolean, events: PhoneEvent[]): void {
    if (dt < 0) dt = 0;
    this.time += dt;

    while (this.scheduled.length > 0 && this.scheduled[0].at <= this.time) {
      const s = this.scheduled.shift()!;
      this.deliver(s.message, events);
    }
    if (this.dead) return;

    if (screenOn) this.battery = Math.max(0, this.battery - this.batteryDrainPerSecond * dt);
    this.checkBattery(events);
    if (this.dead) return;

    if (this.screen === PhoneScreen.Searching && screenOn) {
      this.searchProgress += dt / this.searchSeconds;
      this.revision++;
      if (this.searchProgress >= 1) {
        this.balanceCents = Math.max(0, this.balanceCents - this.searchCostCents);
        const task = this.tasks.find((t) => t.code === this.pendingCode);
        this.result = task ? { number: task.number, answer: task.answer } : { number: 0, answer: '' };
        this.screen = PhoneScreen.SearchResult;
        events.push({ kind: PhoneEventKind.SearchDone, key: null, audible: !this.silent });
      }
    }
    if (this.screen === PhoneScreen.Sent) {
      this.sentLeft -= dt;
      if (this.sentLeft <= 0) this.goHome();
    }
  }

  // ---- 各屏的按键 ----

  private pressHome(key: PhoneKey): void {
    const n = PHONE_MENU.length;
    if (key === PhoneKey.Up) this.menuIndex = (this.menuIndex + n - 1) % n;
    else if (key === PhoneKey.Down) this.menuIndex = (this.menuIndex + 1) % n;
    else if (key === PhoneKey.Ok) this.open(PHONE_MENU[this.menuIndex]);
    else if (isDigit(key)) {
      const d = Number(key);
      if (d >= 1 && d <= n) {
        this.menuIndex = d - 1;
        this.open(PHONE_MENU[d - 1]);
      }
    }
  }

  private open(app: PhoneApp): void {
    this.input = '';
    this.result = null;
    switch (app) {
      case PhoneApp.Search: this.screen = PhoneScreen.Search; break;
      case PhoneApp.Ask: this.screen = PhoneScreen.Ask; break;
      case PhoneApp.Inbox: this.screen = PhoneScreen.Inbox; this.inboxIndex = 0; break;
      case PhoneApp.Calc: this.screen = PhoneScreen.Calc; this.calcExpr = ''; this.calcResult = ''; break;
      case PhoneApp.Profile: this.screen = PhoneScreen.Profile; break;
    }
  }

  private pressSearch(key: PhoneKey, events: PhoneEvent[]): void {
    if (isDigit(key)) {
      if (this.input.length < this.codeLength) this.input += key;
      return;
    }
    if (key === PhoneKey.Back) {
      if (this.input.length > 0) this.input = this.input.slice(0, -1);
      else this.goHome();
      return;
    }
    if (key !== PhoneKey.Ok || this.input.length < this.codeLength) return;
    if (this.balanceCents < this.searchCostCents) {
      this.notice = PhoneNotice.Balance;
      events.push({ kind: PhoneEventKind.Denied, key: null, audible: !this.silent });
      return;
    }
    this.battery = Math.max(0, this.battery - this.searchBatteryCost);
    this.pendingCode = this.input;
    this.searchProgress = 0;
    this.screen = PhoneScreen.Searching;
  }

  private pressAsk(key: PhoneKey, events: PhoneEvent[]): void {
    if (isDigit(key)) {
      if (this.input.length < 2 && !(this.input.length === 0 && key === PhoneKey.D0)) this.input += key;
      return;
    }
    if (key === PhoneKey.Back) {
      if (this.input.length > 0) this.input = this.input.slice(0, -1);
      else this.goHome();
      return;
    }
    if (key !== PhoneKey.Ok || this.input.length === 0) return;
    const n = Number(this.input);
    const task = this.tasks.find((t) => t.number === n);
    if (!task) {
      this.notice = PhoneNotice.NoSuchQuestion;
      events.push({ kind: PhoneEventKind.Denied, key: null, audible: !this.silent });
      return;
    }
    if (this.balanceCents < this.smsCostCents) {
      this.notice = PhoneNotice.Balance;
      events.push({ kind: PhoneEventKind.Denied, key: null, audible: !this.silent });
      return;
    }
    this.balanceCents -= this.smsCostCents;
    this.battery = Math.max(0, this.battery - this.sendBatteryCost);
    this.schedule(this.time + task.askDelay, 'sms.sender.ace', formatArgs(this.text('sms.answer.fmt'), String(n), task.askAnswer), n);
    this.input = '';
    this.screen = PhoneScreen.Sent;
    this.sentLeft = this.sentSeconds;
    events.push({ kind: PhoneEventKind.Sent, key: null, audible: !this.silent });
  }

  private pressInbox(key: PhoneKey): void {
    const n = this.inbox.length;
    if (key === PhoneKey.Back) { this.goHome(); return; }
    if (n === 0) return;
    if (key === PhoneKey.Up) this.inboxIndex = (this.inboxIndex + n - 1) % n;
    else if (key === PhoneKey.Down) this.inboxIndex = (this.inboxIndex + 1) % n;
    else if (key === PhoneKey.Ok) this.openAt(this.inboxIndex);
    else if (isDigit(key)) {
      const d = Number(key);
      if (d >= 1 && d <= n) this.openAt(d - 1);
    }
  }

  private openAt(index: number): void {
    const m = this.inbox[index];
    if (!m) return;
    this.inboxIndex = index;
    m.read = true;
    this.openMessage = m;
    this.screen = PhoneScreen.Message;
  }

  /** 计算器：* 换运算符（+ − × ÷），# 小数点，确定 = 求值（从左到右，像真的计算器那样）。 */
  private pressCalc(key: PhoneKey): void {
    if (key === PhoneKey.Back) {
      if (this.calcResult.length > 0) { this.calcResult = ''; return; }
      if (this.calcExpr.length > 0) this.calcExpr = this.calcExpr.slice(0, -1);
      else this.goHome();
      return;
    }
    if (isDigit(key) || key === PhoneKey.Hash) {
      if (this.calcResult.length > 0) { this.calcExpr = ''; this.calcResult = ''; }
      if (this.calcExpr.length >= this.calcMaxLength) return;
      if (key === PhoneKey.Hash) {
        const current = this.calcExpr.split(/[+\-*/]/).pop() ?? '';
        if (current.includes('.')) return;
        this.calcExpr += current.length === 0 ? '0.' : '.';
      } else {
        this.calcExpr += key;
      }
      return;
    }
    if (key === PhoneKey.Star) {
      if (this.calcResult.length > 0 && this.calcResult !== 'E') { this.calcExpr = this.calcResult; this.calcResult = ''; }
      if (this.calcExpr.length === 0) return;
      const last = this.calcExpr[this.calcExpr.length - 1];
      const at = CALC_OPS.indexOf(last);
      if (at >= 0) this.calcExpr = this.calcExpr.slice(0, -1) + CALC_OPS[(at + 1) % CALC_OPS.length];
      else if (this.calcExpr.length < this.calcMaxLength) this.calcExpr += CALC_OPS[0];
      return;
    }
    if (key === PhoneKey.Ok && this.calcExpr.length > 0) this.calcResult = evaluateCalc(this.calcExpr);
  }

  private goHome(): void {
    this.screen = PhoneScreen.Home;
    this.input = '';
    this.result = null;
    this.notice = PhoneNotice.None;
  }

  private deliver(message: PhoneMessage, events: PhoneEvent[]): void {
    if (this.dead) return;
    this.inbox.unshift(message);
    if (this.screen === PhoneScreen.Inbox && this.inbox.length > 1) this.inboxIndex++;
    this.revision++;
    events.push({ kind: this.silent ? PhoneEventKind.SilentArrival : PhoneEventKind.Ring, key: null, audible: !this.silent });
  }

  private checkBattery(events: PhoneEvent[]): void {
    if (!this.lowWarned && this.battery <= 1) {
      this.lowWarned = true;
      this.revision++;
      events.push({ kind: PhoneEventKind.BatteryLow, key: null, audible: !this.silent });
    }
    if (!this.deadWarned && this.battery <= 0) {
      this.deadWarned = true;
      this.screen = PhoneScreen.Dead;
      this.revision++;
      events.push({ kind: PhoneEventKind.BatteryDead, key: null, audible: false });
    }
  }

  /**
   * 这场考试会收到的「杂音」短信。第一条永远是 10086 的话费提醒，在开考半分钟左右到：
   * 响铃模式下，它就是整间教室都听得见的那一声 —— 「该静音了」的零提示教学（决策 #18）。
   * 复读次数越多，混进来的恐怖短信越多（6.2）。
   */
  private scheduleAmbient(rng: DeterministicRng, attempt: number): void {
    const add = (at: number, sender: string, key: string): void => this.schedule(at, sender, this.text(key));
    add(24 + 10 * rng.nextFloat(), 'sms.sender.operator', 'sms.operator.balance');

    const horrorChance = Math.min(0.85, 0.15 + 0.1 * Math.max(0, attempt - 1));
    const normal: [string, string][] = [
      ['sms.sender.parent', 'sms.parent.01'],
      ['sms.sender.teacher', 'sms.teacher.01'],
      ['sms.sender.unknown', 'sms.spam.01'],
    ];
    const horror: [string, string][] = [
      ['sms.sender.unknown', 'sms.unknown.03'],
      ['sms.sender.unknown', 'sms.unknown.04'],
      ['sms.sender.unknown', 'sms.unknown.05'],
      ['sms.sender.unknown', 'sms.unknown.06'],
      ['sms.sender.self', 'sms.blank.01'],
    ];
    const count = 2 + rng.next(3);
    for (let i = 0; i < count; i++) {
      const pool = rng.nextFloat() < horrorChance ? horror : normal;
      const [sender, key] = pool[rng.next(pool.length)];
      const at = 70 + 460 * rng.nextFloat();
      add(at, sender, key);
      // 广告正文超出点阵屏 11 字，按真实短信的拆条习惯拆成两条，前后脚到（sms.spam.02 的注释）
      if (key === 'sms.spam.01') add(at + 1.2, sender, 'sms.spam.02');
    }
  }
}

/** 从左到右求值（真计算器的习惯，不讲先乘除）。除以 0 或无法解析 ⇒ 'E'。 */
export function evaluateCalc(expr: string): string {
  const tokens = expr.match(/\d+\.?\d*|\.\d+|[+\-*/]/g);
  if (!tokens || tokens.length === 0) return 'E';
  let acc = Number(tokens[0]);
  if (!Number.isFinite(acc)) return 'E';
  for (let i = 1; i + 1 < tokens.length; i += 2) {
    const op = tokens[i];
    const v = Number(tokens[i + 1]);
    if (!Number.isFinite(v)) return 'E';
    if (op === '+') acc += v;
    else if (op === '-') acc -= v;
    else if (op === '*') acc *= v;
    else if (op === '/') {
      if (v === 0) return 'E';
      acc /= v;
    }
  }
  const rounded = Math.round(acc * 1e6) / 1e6;
  return Number.isFinite(rounded) ? String(rounded) : 'E';
}
