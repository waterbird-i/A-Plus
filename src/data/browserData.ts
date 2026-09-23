import { GameData, StringTable, type CsvFiles } from '../core';

const localization = import.meta.glob('/Assets/Localization/*.csv', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const levelData = import.meta.glob('/Assets/Data/*.csv', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function byFileName(files: Record<string, string>): CsvFiles {
  const out: CsvFiles = {};
  for (const [path, text] of Object.entries(files)) out[path.substring(path.lastIndexOf('/') + 1)] = text;
  return out;
}

/** CSV 在构建时被打进包里（唯一真源仍是 Assets/ 下的文件）。 */
export function loadBundledData(): { table: StringTable; data: GameData } {
  return {
    table: StringTable.load(byFileName(localization)),
    data: GameData.load(byFileName(levelData)),
  };
}
