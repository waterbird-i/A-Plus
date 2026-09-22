#!/usr/bin/env node
'use strict';
/**
 * 《A+》String Table 校验器
 *
 *   用法：node validate.js
 *   退出码：0 = 通过；1 = 有错误
 *
 * 对应设计文档 5.5.5。这个脚本是「文本表的守门人」：
 * 它保证 key 唯一、枚举合法、列数正确，并拒绝 en 列被意外填写（B 永不做）。
 */

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const HEAD = ['key', 'src', 'register', 'en', 'en_status', 'max_chars', 'lines', 'font_variant', 'note'];
const REGISTERS = ['公文', '广播', '卷面', '短信', '手写', '教材', '界面', '内部'];
const EN_STATUS = ['n/a', 'todo', 'rewritten', 'approved'];
const FONT_VARIANTS = ['印刷体', '粉笔', '手写', '点阵', ''];
const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/** RFC4180 解析（支持 BOM、引号、引号内换行） */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const errors = [];
const warnings = [];
const seen = new Map();

const files = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
if (files.length === 0) {
  console.error('✗ 没有找到任何 CSV 文件：' + DIR);
  process.exit(1);
}

let totalRows = 0;
console.log('《A+》String Table 校验 —— ' + DIR + '\n');

for (const file of files) {
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
  if (raw.charCodeAt(0) !== 0xfeff) {
    warnings.push(`${file}: 缺少 UTF-8 BOM（Excel / WPS 打开中文可能乱码）`);
  }
  const rows = parseCsv(raw);
  if (rows.length === 0) { errors.push(`${file}: 空文件`); continue; }

  const head = rows[0];
  if (head.join(',') !== HEAD.join(',')) {
    errors.push(`${file}: 表头不符\n      期望 ${HEAD.join(',')}\n      实际 ${head.join(',')}`);
    continue;
  }

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    if (r.length !== HEAD.length) {
      errors.push(`${file}:${line}: 列数 ${r.length} ≠ ${HEAD.length} → ${r.join(' | ')}`);
      continue;
    }
    const o = {};
    HEAD.forEach((h, k) => { o[h] = r[k]; });

    if (!o.key) {
      errors.push(`${file}:${line}: key 为空`);
    } else {
      if (!KEY_RE.test(o.key)) errors.push(`${file}:${line}: key 命名不合规 → ${o.key}`);
      if (seen.has(o.key)) errors.push(`${file}:${line}: key 重复（另见 ${seen.get(o.key)}）→ ${o.key}`);
      else seen.set(o.key, `${file}:${line}`);
    }

    if (!o.src) errors.push(`${file}:${line}: src 为空 → ${o.key}`);
    if (!REGISTERS.includes(o.register)) errors.push(`${file}:${line}: register 非法 → "${o.register}"`);
    if (!EN_STATUS.includes(o.en_status)) errors.push(`${file}:${line}: en_status 非法 → "${o.en_status}"`);
    if (!FONT_VARIANTS.includes(o.font_variant)) errors.push(`${file}:${line}: font_variant 非法 → "${o.font_variant}"`);

    for (const n of ['max_chars', 'lines']) {
      if (o[n] && !/^\d+$/.test(o[n])) errors.push(`${file}:${line}: ${n} 必须是整数 → "${o[n]}"`);
    }

    if (o.max_chars && o.src.length > Number(o.max_chars)) {
      warnings.push(`${file}:${line}: src 长 ${o.src.length} 超 max_chars ${o.max_chars} → ${o.key}`);
    }
    if (o.en) warnings.push(`${file}:${line}: en 列有内容（B 永不做）→ ${o.key}`);
    if (o.en_status !== 'n/a' && o.en_status !== '') {
      warnings.push(`${file}:${line}: en_status="${o.en_status}"（B 永不做 ⇒ 应为 n/a）→ ${o.key}`);
    }
    totalRows++;
  }

  console.log(`  ${file.padEnd(16)} ${String(rows.length - 1).padStart(3)} 行`);
}

console.log(`\n合计 ${totalRows} 行 · ${seen.size} 个唯一 key · ${files.length} 张表`);

if (warnings.length) {
  console.log(`\n⚠ 警告 ${warnings.length} 条`);
  for (const w of warnings) console.log('  - ' + w);
}
if (errors.length) {
  console.log(`\n✗ 错误 ${errors.length} 条`);
  for (const e of errors) console.log('  - ' + e);
  process.exit(1);
}
console.log('\n✓ 通过');