/** 平面上的一个点（米）：x 横向（+X 是窗户那侧，也就是坐着的你的左手边），z 纵向（黑板在 -Z）。 */
export interface Point2 {
  x: number;
  z: number;
}

/**
 * 教室的平面布局。呈现层按它摆桌椅，巡考按它走路 —— 两边读同一份数，
 * 老师才不会穿过课桌，「她闪现到你身边」也才真的是你身边。
 *
 * 考场排法：4 列 × 5 排单人单桌，列与列之间、两侧靠墙各一条过道。
 * 玩家坐第 3 列第 4 排；第 2 列第 2 排是空座位（6.3）。
 */
export class ClassroomLayout {
  readonly width = 8;
  readonly depth = 9;
  readonly height = 3.2;

  readonly cols: readonly number[] = [-2.4, -0.8, 0.8, 2.4];
  readonly rows: readonly number[] = [-2.2, -1.0, 0.2, 1.4, 2.6];
  readonly playerCol = 2;
  readonly playerRow = 3;
  readonly emptyCol = 1;
  readonly emptyRow = 1;

  readonly deskTopY = 0.75;
  /** 桌心到椅心。 */
  readonly seatBehind = 0.45;
  /** 玩家坐着、身子前倾：眼睛在桌心后 0.32 m、离地 1.15 m。 */
  readonly eyeBehind = 0.32;
  readonly eyeHeight = 1.15;

  /** 讲台：黑板前抬高的一条台子；老师平时站在讲桌后面。 */
  readonly platformDepth = 1.2;
  readonly platformHeight = 0.18;
  readonly lectern: Point2 = { x: 0, z: -3.72 };
  readonly teacherPost: Point2 = { x: 0, z: -4.08 };

  /** 过道两端：第一排之前 / 最后一排之后，老师在这里换过道。 */
  readonly aisleFrontZ = -3.0;
  readonly aisleBackZ = 3.75;

  /** 过道中线：两侧靠墙各一条，列与列之间各一条。 */
  get aisles(): number[] {
    const out = [-(this.width / 2 - 0.7)];
    for (let i = 0; i + 1 < this.cols.length; i++) out.push((this.cols[i] + this.cols[i + 1]) / 2);
    out.push(this.width / 2 - 0.7);
    return out;
  }

  desk(col: number, row: number): Point2 {
    return { x: this.cols[col], z: this.rows[row] };
  }

  seat(col: number, row: number): Point2 {
    return { x: this.cols[col], z: this.rows[row] + this.seatBehind };
  }

  get playerDesk(): Point2 { return this.desk(this.playerCol, this.playerRow); }
  get playerSeat(): Point2 { return this.seat(this.playerCol, this.playerRow); }
  get playerEye(): Point2 {
    const d = this.playerDesk;
    return { x: d.x, z: d.z + this.eyeBehind };
  }

  /** 离 x 最近的那条过道。 */
  nearestAisle(x: number): number {
    let best = this.aisles[0];
    for (const a of this.aisles) if (Math.abs(a - x) < Math.abs(best - x)) best = a;
    return best;
  }

  /**
   * 她闪现时站的位置：你左前方（窗户那侧）那条过道里，跟你前桌并排。
   * 得站这么远，她整个上身折过你的桌角时脸才正好落在你眼前；窗户在她身后 ⇒ 逆光。
   */
  get besidePlayer(): Point2 {
    const eye = this.playerEye;
    const aisle = this.aisles.find((a) => a > eye.x) ?? this.nearestAisle(eye.x);
    return { x: aisle - 0.15, z: eye.z - 0.95 };
  }

  isOnPlatform(z: number): boolean {
    return z < -this.depth / 2 + this.platformDepth;
  }

  isEmptySeat(col: number, row: number): boolean {
    return col === this.emptyCol && row === this.emptyRow;
  }

  isPlayerSeat(col: number, row: number): boolean {
    return col === this.playerCol && row === this.playerRow;
  }
}
