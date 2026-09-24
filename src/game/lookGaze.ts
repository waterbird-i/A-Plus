import { GazeState } from '../core';

/**
 * 2.1 三态视线的输入映射。
 *
 * 抬头 / 低头不再是一个按键：玩家把鼠标往哪放，视线就在哪 —— 所以这里只回答一件事，
 * 「按现在的俯仰角，玩家算是在看卷子还是在环视」。角度单位是度，正 = 低头。
 *
 * 两个阈值之间留一条迟滞带（30° 进、22° 出）：视线停在边界上时状态不会来回抖。
 * 手机不进这个函数：它是空格单独管的一档，掏着手机时俯仰角不改变状态（决策 #39）。
 */
export const PaperEnterDeg = 30;
export const PaperExitDeg = 22;

export function gazeFromPitch(current: GazeState, pitchDeg: number): GazeState {
  if (current === GazeState.Phone) return current;
  if (pitchDeg >= PaperEnterDeg) return GazeState.Paper;
  if (pitchDeg <= PaperExitDeg) return GazeState.LookingAround;
  return current;
}
