import { parseCsv, tryParseInt, type CsvFiles } from './csv';

export const Difficulty = { Easy: 'easy', Medium: 'medium', Hard: 'hard' } as const;
export type Difficulty = (typeof Difficulty)[keyof typeof Difficulty];

export const Channel = { Environment: 'environment', Phone: 'phone' } as const;
export type Channel = (typeof Channel)[keyof typeof Channel];

/** sources.csv 的一行（4.2 环境答案源清单的数据化）。 */
export interface AnswerSource {
  id: string;
  name: string;
  channelLabel: string;
  location: string;
  riskLabel: string;
  demo: string;
  notes: string;
  line: number;
  occlusions: string[];
  channel: Channel;
  riskWeight: number;
  isDemo: boolean;
}

/** answer_chain.csv 的一行（4.3 的关卡数据）。 */
export interface AnswerChainRow {
  qId: string;
  answerTypeLabel: string;
  answer: string;
  /** 动态题的机器可读答案（AnswerExpression 语法）；固定题为空，答案就是 answer。 */
  answerExpr: string;
  /** 四选一的干扰项（决策 #38）：字面列表 / auto:偏移 / rest。 */
  distractors: string;
  crossSource: string;
  difficultyLabel: string;
  demo: string;
  notes: string;
  line: number;
  pools: string[];
  occlusions: string[];
  difficulty: Difficulty;
  isDemo: boolean;
  isDynamic: boolean;
}

/** occlusion_ids.csv 的一行：把中文遮挡状态映射成代码可用的 ASCII 枚举名。 */
export interface OcclusionDef {
  label: string;
  id: string;
  kind: string;
  extraSteps: number;
  /** false ⇒ 信息不可得，必须换到该题另一个落位池。 */
  resolvable: boolean;
  note: string;
}

/** enum_labels.csv：中文标签 → ASCII id / 权重。让源码里可以一个中文字面量都没有。 */
export class EnumLabels {
  private readonly ids = new Map<string, string>();
  private readonly weights = new Map<string, number>();
  readonly problems: string[] = [];

  add(domain: string, label: string, id: string, weight: number): void {
    this.ids.set(domain + '|' + label, id);
    this.weights.set(domain + '|' + label, weight);
  }

  id(domain: string, label: string): string {
    const v = this.ids.get(domain + '|' + label);
    if (v !== undefined) return v;
    this.problems.push('enum_labels.csv missing ' + domain + ' -> label(line ' + label.length + ' chars)');
    return 'unknown';
  }

  weight(domain: string, label: string): number {
    const v = this.weights.get(domain + '|' + label);
    if (v !== undefined) return v;
    this.problems.push('enum_labels.csv missing weight for domain ' + domain);
    return 0;
  }

  toDifficulty(label: string): Difficulty {
    const id = this.id('difficulty', label);
    if (id === 'easy') return Difficulty.Easy;
    if (id === 'hard') return Difficulty.Hard;
    return Difficulty.Medium;
  }

  toChannel(label: string): Channel {
    return this.id('channel', label) === 'phone' ? Channel.Phone : Channel.Environment;
  }
}

export const SOURCE_HEADER = ['id', 'name', 'channel', 'location', 'risk', 'demo', 'occlusions', 'notes'];
export const CHAIN_HEADER = ['q_id', 'answer_type', 'answer', 'answer_expr', 'distractors', 'pools', 'cross_source', 'occlusions', 'difficulty', 'demo', 'notes'];
export const OCCLUSION_HEADER = ['occlusion', 'id', 'kind', 'extra_steps', 'resolvable', 'note'];
export const ENUM_LABEL_HEADER = ['domain', 'label', 'id', 'weight', 'note'];

export class GameData {
  readonly sources: AnswerSource[] = [];
  readonly sourceById = new Map<string, AnswerSource>();
  readonly chain: AnswerChainRow[] = [];
  readonly occlusionByLabel = new Map<string, OcclusionDef>();
  readonly labels = new EnumLabels();
  readonly problems: string[] = [];

  /** files 以文件名为 key（例 "sources.csv"），即 Assets/Data/ 下的全部 CSV。 */
  static load(files: CsvFiles): GameData {
    const d = new GameData();
    d.loadEnumLabels(files);
    d.loadOcclusions(files);
    d.loadSources(files);
    d.loadChain(files);
    d.crossCheck();
    return d;
  }

  private read(files: CsvFiles, name: string, header: string[]): string[][] | null {
    const text = files[name];
    if (text === undefined) { this.problems.push('missing file: ' + name); return null; }
    const rows = parseCsv(text);
    if (rows.length === 0) { this.problems.push(name + ': empty'); return null; }
    if (rows[0].join(',') !== header.join(',')) { this.problems.push(name + ': header mismatch'); return null; }
    return rows;
  }

  private loadEnumLabels(files: CsvFiles): void {
    const rows = this.read(files, 'enum_labels.csv', ENUM_LABEL_HEADER);
    if (!rows) return;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (r.length !== ENUM_LABEL_HEADER.length) { this.problems.push('enum_labels.csv:' + (i + 1) + ': bad column count'); continue; }
      this.labels.add(r[0], r[1], r[2], tryParseInt(r[3]) ?? 0);
    }
  }

  private loadOcclusions(files: CsvFiles): void {
    const rows = this.read(files, 'occlusion_ids.csv', OCCLUSION_HEADER);
    if (!rows) return;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (r.length !== OCCLUSION_HEADER.length) { this.problems.push('occlusion_ids.csv:' + (i + 1) + ': bad column count'); continue; }
      const def: OcclusionDef = {
        label: r[0],
        id: r[1],
        kind: r[2],
        extraSteps: tryParseInt(r[3]) ?? 0,
        resolvable: r[4] !== 'n',
        note: r[5],
      };
      if (this.occlusionByLabel.has(def.label)) { this.problems.push('occlusion_ids.csv: duplicate label at line ' + (i + 1)); continue; }
      this.occlusionByLabel.set(def.label, def);
    }
  }

  private loadSources(files: CsvFiles): void {
    const rows = this.read(files, 'sources.csv', SOURCE_HEADER);
    if (!rows) return;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (r.length !== SOURCE_HEADER.length) { this.problems.push('sources.csv:' + (i + 1) + ': bad column count'); continue; }
      const s: AnswerSource = {
        id: r[0],
        name: r[1],
        channelLabel: r[2],
        location: r[3],
        riskLabel: r[4],
        demo: r[5],
        notes: r[7],
        line: i + 1,
        occlusions: splitPipes(r[6]),
        channel: this.labels.toChannel(r[2]),
        riskWeight: this.labels.weight('risk', r[4]),
        isDemo: r[5] === 'y',
      };
      if (this.sourceById.has(s.id)) { this.problems.push('sources.csv: duplicate id ' + s.id); continue; }
      this.sourceById.set(s.id, s);
      this.sources.push(s);
    }
  }

  private loadChain(files: CsvFiles): void {
    const rows = this.read(files, 'answer_chain.csv', CHAIN_HEADER);
    if (!rows) return;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (r.length !== CHAIN_HEADER.length) { this.problems.push('answer_chain.csv:' + (i + 1) + ': bad column count'); continue; }
      const answerType = this.labels.id('answer_type', r[1]);
      this.chain.push({
        qId: r[0],
        answerTypeLabel: answerType,
        answer: r[2],
        answerExpr: r[3],
        distractors: r[4],
        pools: splitPipes(r[5]),
        crossSource: r[6],
        occlusions: splitPipes(r[7]),
        difficultyLabel: r[8],
        demo: r[9],
        notes: r[10],
        line: i + 1,
        difficulty: this.labels.toDifficulty(r[8]),
        isDemo: r[9] === 'y',
        isDynamic: answerType === 'dynamic',
      });
    }
  }

  /** 参照完整性检查：JS 校验器查不到的、跨文件的东西在这里查。 */
  private crossCheck(): void {
    for (const s of this.sources) {
      for (const occ of s.occlusions) {
        if (!this.occlusionByLabel.has(occ)) this.problems.push('sources.csv:' + s.line + ': occlusion not in occlusion_ids.csv -> ' + occ);
      }
    }
    for (const c of this.chain) {
      for (const p of c.pools) {
        if (!this.sourceById.has(p)) this.problems.push('answer_chain.csv:' + c.line + ': unknown pool source -> ' + p);
      }
      for (const occ of c.occlusions) {
        if (!this.occlusionByLabel.has(occ)) this.problems.push('answer_chain.csv:' + c.line + ': occlusion not in occlusion_ids.csv -> ' + occ);
      }
      // Demo 落位可达性：demo=y 的题，落位池里至少要有一个 demo=y 的源，否则它在 Demo 里没有合法落位。
      const demoPools = this.poolSources(c).filter((s) => s.isDemo).length;
      if (c.isDemo && c.pools.length > 0 && demoPools === 0) {
        this.problems.push('answer_chain.csv:' + c.line + ': demo=y but every pool source is demo=n -> no legal placement in the demo: ' + c.qId);
      }
      // cross_source 必须是「源 id」（可带括号说明），否则代码没法解析它。
      if (c.crossSource.length > 0) {
        for (const x of c.crossSource.split('|')) {
          const id = stripDescription(x);
          if (id.length > 0 && !this.sourceById.has(id)) this.problems.push('answer_chain.csv:' + c.line + ': cross_source is not a known source id -> ' + x);
        }
      }
    }
  }

  poolSources(c: AnswerChainRow): AnswerSource[] {
    const list: AnswerSource[] = [];
    for (const p of c.pools) {
      const s = this.sourceById.get(p);
      if (s) list.push(s);
    }
    return list;
  }

  /** 该题的落位池是否跨了两条通道（4.2：两条通道必须互相不可替代）。 */
  isMixedChannel(c: AnswerChainRow): boolean {
    let env = false;
    let phone = false;
    for (const s of this.poolSources(c)) {
      if (s.channel === Channel.Phone) phone = true;
      else env = true;
    }
    return env && phone;
  }

  countByDifficulty(d: Difficulty, demoOnly: boolean): number {
    return this.chain.filter((c) => (!demoOnly || c.isDemo) && c.difficulty === d).length;
  }
}

function splitPipes(raw: string): string[] {
  if (!raw) return [];
  return raw.split('|').map((p) => p.trim()).filter((p) => p.length > 0);
}

const FULLWIDTH_PAREN = String.fromCharCode(0xff08);

/** 取「源 id」本体：允许 "eraser（借橡皮金属反光...）" 这种带说明的写法。 */
function stripDescription(raw: string): string {
  let s = (raw ?? '').trim();
  let cut = s.indexOf('(');
  const full = s.indexOf(FULLWIDTH_PAREN);
  if (cut < 0 || (full >= 0 && full < cut)) cut = full;
  if (cut >= 0) s = s.substring(0, cut);
  return s.trim();
}
