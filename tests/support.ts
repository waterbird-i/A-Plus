import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameData, StringTable, TickResult, type CsvFiles, type GazeStateMachine } from '../src/core';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LOCALIZATION_DIR = join(ROOT, 'Assets', 'Localization');
export const DATA_DIR = join(ROOT, 'Assets', 'Data');

export function readCsvDir(dir: string): CsvFiles {
  const files: CsvFiles = {};
  for (const name of readdirSync(dir)) if (name.endsWith('.csv')) files[name] = readFileSync(join(dir, name), 'utf8');
  return files;
}

let table: StringTable | null = null;
let data: GameData | null = null;

export function testTable(): StringTable {
  return (table ??= StringTable.load(readCsvDir(LOCALIZATION_DIR)));
}

export function testData(): GameData {
  return (data ??= GameData.load(readCsvDir(DATA_DIR)));
}

/** 按固定步长推进；死亡或驱散时提前停。返回最后一个非 idle 的结果。 */
export function tickSeconds(m: GazeStateMachine, seconds: number, dt: number): TickResult {
  let last: TickResult = TickResult.Idle;
  for (let el = 0; el < seconds; el += dt) {
    const r = m.tick(dt);
    if (r !== TickResult.Idle && r !== TickResult.Safe) last = r;
    if (m.isDead || r === TickResult.Repelled) return r;
  }
  return last;
}
