import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ScanFinding {
  file: string;
  line: number;
  severity: 'error' | 'warning';
  /** cjk-literal | cjk-escape | log-literal */
  code: string;
  detail: string;
}

export interface ScanReport {
  findings: ScanFinding[];
  filesScanned: number;
  literalsScanned: number;
}

/**
 * 设计文档 5.5.5 / 8.3-6 要求的「扫描源码报出硬编码字符串」，TS 版。
 *
 * 规则（两条，不做模糊的启发式）：
 *   1. error · 中文字面量：'…' / "…" / `…` 一旦含 CJK 码点就是错误。
 *      \uXXXX / \u{…} / \xXX 转义会被解出来再判，所以「用转义绕过扫描」这条路是堵死的。
 *   2. warning · 日志字面量：console.log / warn / error / info / debug 直接吃字面量。
 *
 * 已知局限：纯 ASCII 的用户可见文案不会被抓；正则字面量里的引号会干扰判断（源码里别这么写）。
 * 抑制方式：该行任意位置写 st-ok 注释。
 */
export function scanSources(...roots: string[]): ScanReport {
  const report: ScanReport = { findings: [], filesScanned: 0, literalsScanned: 0 };
  for (const root of roots) {
    const st = statSync(root, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) scanDirectory(root, report);
    else scanFile(root, readFileSync(root, 'utf8'), report);
  }
  return report;
}

function scanDirectory(dir: string, report: ScanReport): void {
  const names = readdirSync(dir).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  for (const name of names) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) scanDirectory(path, report);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) scanFile(path, readFileSync(path, 'utf8'), report);
  }
}

export function isCjk(code: number): boolean {
  return (code >= 0x3000 && code <= 0x303f) // CJK 标点（含全角空格）
    || (code >= 0x3400 && code <= 0x4dbf) // 扩展 A
    || (code >= 0x4e00 && code <= 0x9fff) // 基本区
    || (code >= 0xf900 && code <= 0xfaff) // 兼容表意
    || (code >= 0xff01 && code <= 0xff60) // 全角形式
    || (code >= 0xffe0 && code <= 0xffe6); // 全角符号
}

function hasCjk(s: string): boolean {
  for (const ch of s) if (isCjk(ch.codePointAt(0) ?? 0)) return true;
  return false;
}

export function scanFile(file: string, text: string, report: ScanReport): void {
  report.filesScanned++;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const suppressed = new Set<number>();
  lines.forEach((l, i) => { if (l.includes('st-ok')) suppressed.add(i + 1); });

  const src = lines.join('\n');
  let line = 1;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const startLine = line;
      const start = i;
      i++;
      let raw = '';
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < src.length) { raw += src[i] + src[i + 1]; i += 2; continue; }
        if (src[i] === '\n') { if (c !== '`') break; line++; }
        raw += src[i];
        i++;
      }
      i++;
      report.literalsScanned++;
      if (suppressed.has(startLine)) continue;
      if (hasCjk(resolveEscapes(raw))) {
        const code = hasCjk(stripEscapes(raw)) ? 'cjk-literal' : 'cjk-escape';
        add(report, file, startLine, 'error', code, raw);
      }
      const lineStart = src.lastIndexOf('\n', start - 1) + 1;
      if (looksLikeLogCall(src.substring(lineStart, start))) add(report, file, startLine, 'warning', 'log-literal', raw);
      continue;
    }
    i++;
  }
}

function looksLikeLogCall(before: string): boolean {
  const m = /console\.(log|warn|error|info|debug)\s*\(/g;
  let best = -1;
  for (let hit = m.exec(before); hit; hit = m.exec(before)) best = hit.index + hit[0].length;
  if (best < 0) return false;
  // 只认「这个字面量被日志函数直接吃掉」：之间只允许空白、括号、逗号、加号与已闭合的字面量。
  let inString = false;
  for (let i = best; i < before.length; i++) {
    const c = before[i];
    if (c === "'" || c === '"' || c === '`') { inString = !inString; continue; }
    if (inString) continue;
    if (' \t(,+'.includes(c)) continue;
    return false;
  }
  return !inString;
}

function add(report: ScanReport, file: string, line: number, severity: 'error' | 'warning', code: string, detail: string): void {
  report.findings.push({ file, line, severity, code, detail: detail.length > 60 ? detail.substring(0, 57) + '...' : detail });
}

/** 把 \uXXXX / \u{…} / \xXX / \n 等转义解成真实字符（判 CJK 时要用解出来的结果）。 */
export function resolveEscapes(raw: string): string {
  return raw.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|.)/g, (_m, _all, braced, u4, x2) => {
    const hex = braced ?? u4 ?? x2;
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return '';
  });
}

function stripEscapes(raw: string): string {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, '');
}
