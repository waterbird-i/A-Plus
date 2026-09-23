/**
 * RFC4180 CSV 解析器，行为与 Assets/Localization/validate.js、Assets/Data/validate_chain.js
 * 里的解析器保持一致：容忍 UTF-8 BOM、CRLF / LF、双引号包裹、引号内的逗号与换行。
 */
export function parseCsv(text: string): string[][] {
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) text = text.substring(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  return rows.filter((r) => !(r.length === 1 && r[0].trim().length === 0));
}

/** 文件名 → 文本。浏览器侧由 Vite 的 import.meta.glob 提供，Node 侧由 fs 读出。 */
export type CsvFiles = Record<string, string>;

/** C# int.TryParse 的口径：允许首尾空白与正负号，其余一律失败。 */
export function tryParseInt(s: string): number | null {
  return /^\s*[+-]?\d+\s*$/.test(s) ? parseInt(s, 10) : null;
}
