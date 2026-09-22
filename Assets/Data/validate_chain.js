#!/usr/bin/env node
'use strict';
/**
 * 《A+》答案链（关卡设计）校验器
 *
 *   用法：node validate_chain.js
 *   退出码：0 = 通过；1 = 有错误
 *
 * 它校验的不是「文本」，而是「关卡设计」，并强制设计文档里自己定下的约束：
 *   - 每题合法落位池 2–4 个（8.2）
 *   - 至少 3 条跨 2 个信息源拼合（4.2 / 8.2）
 *   - 遮挡状态必须被该题的落位池允许
 *   - 每个题干（questions.csv / world_en.csv）都有且只有一条答案链
 *   - 每条答案链都能找到对应的题干
 */

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const LOC = path.join(DIR, '..', 'Localization');

const SRC_HEAD = ['id', 'name', 'channel', 'location', 'risk', 'demo', 'occlusions', 'notes'];
const CHAIN_HEAD = ['q_id', 'answer_type', 'answer', 'pools', 'cross_source', 'occlusions', 'difficulty', 'demo', 'notes'];
const ANSWER_TYPES = ['固定', '动态'];
const DIFFICULTIES = ['易', '中', '难'];
const CHANNELS = ['环境', '手机'];
const YN = ['y', 'n'];
const ID_RE = /^[a-z][a-z0-9_]*$/;
const MIN_POOLS = 2;
const MAX_POOLS = 4;
const MIN_CROSS = 3;

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const errors = [];
const warnings = [];

function load(file, head) {
  const p = path.join(DIR, file);
  if (!fs.existsSync(p)) { errors.push(`缺少文件：${file}`); return null; }
  const rows = parseCsv(fs.readFileSync(p, 'utf8'));
  if (rows.length === 0) { errors.push(`${file}: 空文件`); return null; }
  if (rows[0].join(',') !== head.join(',')) {
    errors.push(`${file}: 表头不符\n      期望 ${head.join(',')}\n      实际 ${rows[0].join(',')}`);
    return null;
  }
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length !== head.length) {
      errors.push(`${file}:${i + 1}: 列数 ${rows[i].length} ≠ ${head.length} → ${rows[i].join(' | ')}`);
      continue;
    }
    const o = { __line: i + 1, __file: file };
    head.forEach((h, k) => { o[h] = rows[i][k]; });
    out.push(o);
  }
  return out;
}

const sources = load('sources.csv', SRC_HEAD);
const chain = load('answer_chain.csv', CHAIN_HEAD);
if (!sources || !chain) { report(); process.exit(1); }

// ---- sources.csv ----
const srcById = new Map();
for (const s of sources) {
  const at = `${s.__file}:${s.__line}`;
  if (!ID_RE.test(s.id)) errors.push(`${at}: 源 id 命名不合规 → "${s.id}"`);
  if (srcById.has(s.id)) errors.push(`${at}: 源 id 重复 → ${s.id}`);
  srcById.set(s.id, s);
  if (!CHANNELS.includes(s.channel)) errors.push(`${at}: channel 非法 → "${s.channel}"`);
  if (!YN.includes(s.demo)) errors.push(`${at}: demo 必须是 y/n → "${s.demo}"`);
}

// ---- answer_chain.csv ----
const chainById = new Map();
let crossCount = 0;
for (const c of chain) {
  const at = `${c.__file}:${c.__line}`;
  if (chainById.has(c.q_id)) errors.push(`${at}: q_id 重复 → ${c.q_id}`);
  chainById.set(c.q_id, c);

  if (!ANSWER_TYPES.includes(c.answer_type)) errors.push(`${at}: answer_type 非法 → "${c.answer_type}"`);
  if (!DIFFICULTIES.includes(c.difficulty)) errors.push(`${at}: difficulty 非法 → "${c.difficulty}"`);
  if (!YN.includes(c.demo)) errors.push(`${at}: demo 必须是 y/n → "${c.demo}"`);
  if (!c.answer) errors.push(`${at}: answer 为空 → ${c.q_id}`);

  const pools = c.pools ? c.pools.split('|').filter(Boolean) : [];
  if (pools.length < MIN_POOLS || pools.length > MAX_POOLS) {
    errors.push(`${at}: 落位池 ${pools.length} 个；设计文档 8.2 要求 ${MIN_POOLS}–${MAX_POOLS} 个 → ${c.q_id}`);
  }
  if (new Set(pools).size !== pools.length) errors.push(`${at}: 落位池有重复项 → ${c.q_id}`);

  const allowed = new Set();
  for (const p of pools) {
    const s = srcById.get(p);
    if (!s) { errors.push(`${at}: 落位池引用了不存在的源 → "${p}"`); continue; }
    (s.occlusions ? s.occlusions.split('|') : []).forEach((o) => o && allowed.add(o));
  }

  const ocs = c.occlusions ? c.occlusions.split('|').filter(Boolean) : [];
  for (const o of ocs) {
    if (!allowed.has(o)) errors.push(`${at}: 遮挡状态 "${o}" 不被本题落位池允许 → ${c.q_id}`);
  }
  if (new Set(ocs).size !== ocs.length) errors.push(`${at}: 遮挡状态有重复项 → ${c.q_id}`);

  if (c.cross_source) crossCount++;
}

// ---- 与题干做参照完整性 ----
const questionKeys = new Set();
for (const f of ['questions.csv', 'world_en.csv']) {
  const p = path.join(LOC, f);
  if (!fs.existsSync(p)) { warnings.push(`找不到题干文件：${f}（跳过参照检查）`); continue; }
  const rows = parseCsv(fs.readFileSync(p, 'utf8'));
  for (let i = 1; i < rows.length; i++) {
    const k = rows[i][0];
    if (k && /^q\./.test(k)) questionKeys.add(k);
  }
}

if (questionKeys.size) {
  for (const q of questionKeys) {
    if (!chainById.has(q)) errors.push(`题干 ${q} 没有对应的答案链`);
  }
  for (const q of chainById.keys()) {
    if (!questionKeys.has(q)) errors.push(`答案链 ${q} 找不到对应的题干`);
  }
}

// ---- 设计约束 ----
if (crossCount < MIN_CROSS) {
  errors.push(`跨信息源拼合的题只有 ${crossCount} 条；设计文档 4.2 / 8.2 要求至少 ${MIN_CROSS} 条`);
}

// ---- 报告 ----
function report() {
  const demoQ = chain.filter((c) => c.demo === 'y').length;
  console.log('《A+》答案链校验 —— ' + DIR + '\n');
  console.log(`  答案源        ${sources.length} 个（Demo ${sources.filter((s) => s.demo === 'y').length} 个）`);
  console.log(`  题干          ${questionKeys.size} 道`);
  console.log(`  答案链        ${chain.length} 条（Demo ${demoQ} 条）`);
  console.log(`  跨源拼合      ${crossCount} 条（要求 ≥ ${MIN_CROSS}）`);

  const byDiff = {};
  for (const c of chain) byDiff[c.difficulty] = (byDiff[c.difficulty] || 0) + 1;
  console.log(`  难度分布      易 ${byDiff['易'] || 0} · 中 ${byDiff['中'] || 0} · 难 ${byDiff['难'] || 0}`);

  const byChan = {};
  for (const c of chain) {
    const chans = new Set(c.pools.split('|').map((p) => srcById.get(p)).filter(Boolean).map((s) => s.channel));
    byChan[chans.size === 2 ? '环境＋手机' : [...chans][0] || '?'] = (byChan[chans.size === 2 ? '环境＋手机' : [...chans][0] || '?'] || 0) + 1;
  }
  console.log(`  通道分布      ${Object.entries(byChan).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

  if (warnings.length) {
    console.log(`\n⚠ 警告 ${warnings.length} 条`);
    for (const w of warnings) console.log('  - ' + w);
  }
  if (errors.length) {
    console.log(`\n✗ 错误 ${errors.length} 条`);
    for (const e of errors) console.log('  - ' + e);
    return;
  }
  console.log('\n✓ 通过');
}
report();
process.exit(errors.length ? 1 : 0);