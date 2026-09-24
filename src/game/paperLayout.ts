/**
 * 卷面的几何：贴图像素 ↔ 纸面米数 ↔ 文字块与按钮带。
 *
 * 这里只算数、不碰 Babylon —— 因为「按钮在纸面内、可见框在按钮带内、文字块不进按钮带」
 * 这三条不变量是卷面能不能用的全部依据，而它们只靠眼睛看是验不出来的。
 * `tests/paperLayout.test.ts` 把它们钉死；`PaperView` 只负责把结果画出来 / 摆上去。
 */
export const PAPER_TEX_W = 1024;
export const PAPER_TEX_H = 1448;
/** 纸面尺寸（米），与 CreatePlane 的参数一致。 */
export const PAPER_W = 0.297;
export const PAPER_H = 0.42;
/**
 * 卷面上下各留一条空带（贴图像素），按钮落在这条带里。
 * 为什么两边都留：贴图的 v 轴朝哪边是引擎的约定，不该靠猜 —— 两条边都空着，
 * 按钮落在靠玩家那一侧就永远不会压到题干。
 */
export const BAND_PX = 150;
/** 按钮的拾取网格（米）。可见的框画在贴图里，比它小一圈，用准星点的时候宽容一点。 */
export const BTN_PICK_W = 0.078;
export const BTN_PICK_H = 0.034;
/** 按钮贴图的尺寸与可见框的内缩（贴图像素）。 */
export const BTN_TEX_W = 256;
export const BTN_TEX_H = 112;
export const BTN_INSET_X = 14;
export const BTN_INSET_Y = 16;
/**
 * 两个按钮的中心离纸面中线多远（米）。
 * 这个数直接决定「低头读卷 → 抬头点按钮」要转多少度：按钮越靠外，横向要转的头越多
 * （0.098 时要转 41°，0.052 时 25°）。两边之间留出的空隙要够大，别点错。
 */
export const BTN_OFFSET_X = 0.052;
/** 文字块的上下边界（贴图像素）：整体躲开两条按钮带。 */
export const TEXT_TOP_PX = BAND_PX + 60;
export const TEXT_BOTTOM_PX = PAPER_TEX_H - BAND_PX - 60;
/** 题干从文字块顶端往下 270px 开始。 */
export const QUESTION_OFFSET_PX = 270;

export interface LocalRect {
  /** 纸面局部坐标（米），原点在纸心，+Y 是纸的一条长边方向。 */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 按钮带在纸面上的宽度（米）。 */
export function bandMeters(): number {
  return (BAND_PX / PAPER_TEX_H) * PAPER_H;
}

/**
 * 一个翻题按钮在纸面局部坐标里的矩形。
 * nearSign：靠玩家那条长边的符号（±1，由世界矩阵算出，见 PaperView.nearEdgeSign）。
 * side：左 / 右（-1 / +1）。
 */
export function buttonRect(nearSign: number, side: number): LocalRect {
  const y = nearSign * (PAPER_H / 2 - bandMeters() / 2);
  const x = side * BTN_OFFSET_X;
  return { x: x - BTN_PICK_W / 2, y: y - BTN_PICK_H / 2, w: BTN_PICK_W, h: BTN_PICK_H };
}

/** 可见的框（贴图里内缩一圈）在纸面上的尺寸（米）。 */
export function visibleButtonSize(): { w: number; h: number } {
  return {
    w: (BTN_PICK_W * (BTN_TEX_W - BTN_INSET_X * 2)) / BTN_TEX_W,
    h: (BTN_PICK_H * (BTN_TEX_H - BTN_INSET_Y * 2)) / BTN_TEX_H,
  };
}

/** 纸面局部坐标 → 离靠玩家那条长边有多远（米）。 */
export function distanceFromNearEdge(localY: number, nearSign: number): number {
  return PAPER_H / 2 - localY * nearSign;
}
