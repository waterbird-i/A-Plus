import { describe, expect, it } from 'vitest';
import {
  BAND_PX, BTN_OFFSET_X, BTN_PICK_H, BTN_PICK_W, PAPER_H, PAPER_TEX_H, PAPER_W,
  QUESTION_OFFSET_PX, TEXT_BOTTOM_PX, TEXT_TOP_PX, bandMeters, buttonRect, distanceFromNearEdge, visibleButtonSize,
} from '../src/game/paperLayout';

/**
 * 卷面能不能用的全部依据就是这几条几何不变量 —— 而它们光靠眼睛看是验不出来的
 * （按钮是 3D 子网格、文字画在动态贴图上，两边都没法在 node 环境里渲染）。
 * 注意 buttonRect 返回的是矩形的下边与左边（x / y 是最小边），不是中心。
 */
const HALF_W = PAPER_W / 2;
const HALF_H = PAPER_H / 2;
const SIGNS = [1, -1];
const SIDES = [-1, 1];

/** 一段沿纸面短轴的范围是不是整段落在靠玩家那条长边的按钮带里。 */
function insideBand(d0: number, d1: number): boolean {
  return Math.min(d0, d1) > 0 && Math.max(d0, d1) < bandMeters();
}

describe('paper layout: buttons live inside the reserved band, text never enters it', () => {
  it('the band is the same width at both long edges and holds a whole button', () => {
    expect(bandMeters()).toBeGreaterThan(BTN_PICK_H);
    expect(bandMeters()).toBeCloseTo((BAND_PX / PAPER_TEX_H) * PAPER_H, 10);
  });

  it('every button stays inside the paper', () => {
    for (const near of SIGNS) {
      for (const side of SIDES) {
        const r = buttonRect(near, side);
        expect(Math.abs(r.x + r.w / 2) + r.w / 2).toBeLessThan(HALF_W);
        expect(r.y).toBeGreaterThan(-HALF_H);
        expect(r.y + r.h).toBeLessThan(HALF_H);
      }
    }
  });

  it('every button stays inside the reserved band (pick mesh and drawn box alike)', () => {
    const visible = visibleButtonSize();
    expect(visible.w).toBeLessThan(BTN_PICK_W);
    expect(visible.h).toBeLessThan(BTN_PICK_H);
    const padY = (BTN_PICK_H - visible.h) / 2;
    for (const near of SIGNS) {
      for (const side of SIDES) {
        const r = buttonRect(near, side);
        expect(insideBand(distanceFromNearEdge(r.y, near), distanceFromNearEdge(r.y + r.h, near))).toBe(true);
        const inner = r.y + padY;
        expect(insideBand(distanceFromNearEdge(inner, near), distanceFromNearEdge(inner + visible.h, near))).toBe(true);
      }
    }
  });

  it('the two buttons never overlap each other', () => {
    for (const near of SIGNS) {
      const left = buttonRect(near, -1);
      const right = buttonRect(near, 1);
      expect(left.x + left.w).toBeLessThan(right.x);
      // 也要留出足够的空隙，免得准星在两者之间摇摆
      expect(right.x - (left.x + left.w)).toBeGreaterThan(0.02);
    }
  });

  it('the two buttons sit symmetrically about the paper centre line', () => {
    for (const near of SIGNS) {
      const left = buttonRect(near, -1);
      const right = buttonRect(near, 1);
      expect(left.x + right.x + right.w).toBeCloseTo(0, 10);
      expect(left.y).toBeCloseTo(right.y, 10);
      expect(left.x + left.w / 2).toBeCloseTo(-BTN_OFFSET_X, 10);
    }
  });

  it('the text block clears both bands', () => {
    expect(TEXT_TOP_PX).toBeGreaterThanOrEqual(BAND_PX);
    expect(TEXT_BOTTOM_PX).toBeLessThanOrEqual(PAPER_TEX_H - BAND_PX);
  });

  it('the question block has room for the longest question in the data', () => {
    // 实测（400 个种子 x 9 道题）：最坏 554px。这里留一个更宽的预算守住它。
    const budget = TEXT_BOTTOM_PX - (TEXT_TOP_PX + QUESTION_OFFSET_PX);
    expect(budget).toBeGreaterThanOrEqual(700);
  });
});
