import { parseCsv, tryParseInt, type CsvFiles } from './csv';

/** String Table 的一行（列定义见 Assets/Localization/README.md）。 */
export interface TextRow {
  key: string;
  src: string;
  register: string;
  en: string;
  enStatus: string;
  /** 0 = 未设 */
  maxChars: number;
  /** 0 = 未设 */
  lines: number;
  fontVariant: string;
  note: string;
  file: string;
  line: number;
}

export const STRING_TABLE_HEADER = ['key', 'src', 'register', 'en', 'en_status', 'max_chars', 'lines', 'font_variant', 'note'];

/**
 * 设计文档 5.5.5：把 Assets/Localization/ 下的 CSV 读成一张表。
 *
 * 硬规则是「一个硬编码字符串都不留」。所以这个类只认 key，不认中文；
 * 调用方永远写 table.get('rule.wall.05')，而不是写那句中文。
 *
 * 语义文本 vs 呈现文本：这张表给的是「意思」。试卷抬头 / 规则墙 / 记名册 /
 * 点阵短信的字本身是美术资产 —— 本表只提供 max_chars / lines / font_variant 三个参数。
 */
export class StringTable {
  private readonly rows = new Map<string, TextRow>();
  readonly problems: string[] = [];
  readonly tables: string[] = [];

  get count(): number { return this.rows.size; }
  allRows(): IterableIterator<TextRow> { return this.rows.values(); }

  /** files 以文件名为 key（例 "rules.csv"），即 Assets/Localization/ 下的全部 CSV。 */
  static load(files: CsvFiles): StringTable {
    const table = new StringTable();
    const names = Object.keys(files).sort((a, b) => {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    for (const name of names) table.loadFile(name, files[name]);
    return table;
  }

  loadFile(name: string, text: string): void {
    const rows = parseCsv(text);
    if (rows.length === 0) { this.problems.push(name + ': empty file'); return; }

    const head = rows[0];
    if (head.join(',') !== STRING_TABLE_HEADER.join(',')) {
      this.problems.push(name + ': header mismatch -> ' + head.join(','));
      return;
    }

    let dataRows = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 1;
      if (r.length !== STRING_TABLE_HEADER.length) {
        this.problems.push(name + ':' + line + ': column count ' + r.length + ' != ' + STRING_TABLE_HEADER.length);
        continue;
      }
      const row: TextRow = {
        key: r[0],
        src: r[1],
        register: r[2],
        en: r[3],
        enStatus: r[4],
        maxChars: tryParseInt(r[5]) ?? 0,
        lines: tryParseInt(r[6]) ?? 0,
        fontVariant: r[7],
        note: r[8],
        file: name,
        line,
      };
      if (row.key.length === 0) { this.problems.push(name + ':' + line + ': empty key'); continue; }
      if (this.rows.has(row.key)) { this.problems.push(name + ':' + line + ': duplicate key ' + row.key); continue; }
      this.rows.set(row.key, row);
      dataRows++;
    }
    this.tables.push(name + ' (' + dataRows + ')');
  }

  tryGet(key: string): TextRow | undefined {
    return this.rows.get(key);
  }

  /** 按 key 取「意思」。缺 key 时记问题并回落成 key 本身（不许崩，也不许偷偷给空串）。 */
  get(key: string): string {
    const row = this.rows.get(key);
    if (!row) {
      this.problems.push('missing key: ' + key);
      return '[' + key + ']';
    }
    return this.resolve(row);
  }

  /** 5.5.5：缺值时回落显示 src 并报警。B（界面英文）永不做（决策 #28）⇒ 这里永远走 src。 */
  resolve(row: TextRow): string {
    if (row.en.length > 0) return row.en;
    if (row.enStatus.length > 0 && row.enStatus !== 'n/a') {
      this.problems.push('en_status=' + row.enStatus + ' but en is empty; fell back to src: ' + row.key);
    }
    return row.src;
  }

  /** 所有以某个前缀开头的行（例：getByPrefix('q.') 取整个题库），按 key 排序。 */
  getByPrefix(prefix: string): TextRow[] {
    const hits: TextRow[] = [];
    for (const [k, v] of this.rows) if (k.startsWith(prefix)) hits.push(v);
    hits.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return hits;
  }
}
