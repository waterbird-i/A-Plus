import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExamRoundGenerator, MixSpec } from '../src/core';
import { scanSources } from '../scripts/hardcodedStringScanner';
import { DATA_DIR, LOCALIZATION_DIR, ROOT, testData, testTable } from './support';

const mix = new MixSpec('test', 3, 3, 3);

describe('4.3 three-layer randomization, 5.5.5 string table, data integrity', () => {
  it('data tables load without problems', () => {
    expect(testTable().problems, 'string table').toEqual([]);
    expect(testData().problems, 'game data').toEqual([]);
    expect(testData().labels.problems, 'enum labels').toEqual([]);
  });

  it('every answer chain resolves to question text', () => {
    const missing = testData().chain.filter((c) => !testTable().tryGet(c.qId)).map((c) => c.qId);
    expect(missing).toEqual([]);
  });

  it('hidden English clause question matches the clause itself', () => {
    const clause = testTable().tryGet('world.rule.hidden_07');
    expect(clause).toBeDefined();
    const row = testData().chain.find((c) => c.qId === 'q.fill.28');
    expect(row).toBeDefined();
    expect(row!.answer).toBe(clause!.src.split(' ')[0]);
  });

  it('every occlusion has an ASCII id', () => {
    for (const def of testData().occlusionByLabel.values()) expect(def.id).toMatch(/^[a-z0-9_]+$/);
  });

  it('every CSV carries a UTF-8 BOM', () => {
    const missing: string[] = [];
    for (const dir of [DATA_DIR, LOCALIZATION_DIR]) {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.csv')) continue;
        const head = readFileSync(join(dir, name)).subarray(0, 3);
        if (head.length < 3 || head[0] !== 0xef || head[1] !== 0xbb || head[2] !== 0xbf) missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it('no Chinese literals in source code', () => {
    const report = scanSources(join(ROOT, 'src'), join(ROOT, 'scripts'), join(ROOT, 'tests'));
    const errors = report.findings.filter((f) => f.severity === 'error').map((f) => f.file + ':' + f.line + ' ' + f.code);
    expect(report.filesScanned).toBeGreaterThan(10);
    expect(errors).toEqual([]);
  });

  it('round size and mix are honored', () => {
    const gen = new ExamRoundGenerator(testData());
    expect(gen.buildRound(4242, 9, mix).items.length).toBe(9);
    expect(gen.buildRound(1, 9, mix).shortfall).toBe(0);
  });

  it('no question repeats inside a round', () => {
    const plan = new ExamRoundGenerator(testData()).buildRound(4242, 9, mix);
    const ids = plan.items.map((i) => i.chain.qId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('placements and occlusions are legal', () => {
    const gen = new ExamRoundGenerator(testData());
    for (let seed = 1; seed <= 200; seed++) {
      const plan = gen.buildRound(seed, 9, mix);
      expect(plan.nonDemoPlacements, 'seed ' + seed).toBe(0);
      for (const it of plan.items) {
        expect(it.chain.pools, it.chain.qId).toContain(it.source!.id);
        if (it.occlusionLabel.length === 0) continue;
        expect(it.source!.occlusions, it.chain.qId).toContain(it.occlusionLabel);
        expect(it.chain.occlusions, it.chain.qId).toContain(it.occlusionLabel);
      }
    }
  });

  it('the same seed reproduces the same round', () => {
    const gen = new ExamRoundGenerator(testData());
    const a = gen.buildRound(777, 9, mix);
    const b = gen.buildRound(777, 9, mix);
    expect(b.items.map((i) => [i.chain.qId, i.source?.id, i.occlusionId])).toEqual(a.items.map((i) => [i.chain.qId, i.source?.id, i.occlusionId]));
  });
});

describe('core stays engine-free', () => {
  it('src/core imports neither Babylon nor Node', () => {
    const dir = join(ROOT, 'src', 'core');
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      const text = readFileSync(join(dir, name), 'utf8');
      if (/from\s+['"](@babylonjs\/|node:|fs['"]|path['"])/.test(text)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
