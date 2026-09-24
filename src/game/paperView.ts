import { DynamicTexture, MeshBuilder, StandardMaterial, Color3, Vector3, type Mesh, type Scene } from '@babylonjs/core';
import { formatTemplate, type ExamSession, type StringTable } from '../core';
import {
  BTN_INSET_X, BTN_INSET_Y, BTN_TEX_H, BTN_TEX_W, PAPER_H, PAPER_TEX_H, PAPER_TEX_W, PAPER_W,
  QUESTION_OFFSET_PX, TEXT_BOTTOM_PX, TEXT_TOP_PX, buttonRect,
} from './paperLayout';

const FONT_FAMILY = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';

/**
 * 桌上的卷子：一次只翻到一道题。
 * 翻题有两个入口 —— 卷面上的「上一题 / 下一题」按钮（准星对准 + 左键），或者滚轮 / W·S。
 * 几何（按钮带、文字块边界）全在 paperLayout.ts 里，这里只负责画和摆。
 * 灰盒阶段用系统字体画在动态贴图上；正式的「呈现文本」按 Docs/字体决策.md 换成字体与贴图资产。
 */
export class PaperView {
  readonly mesh: Mesh;
  private readonly texture: DynamicTexture;
  private readonly prevButton: Mesh;
  private readonly nextButton: Mesh;
  private readonly submitBar: Mesh;
  private buttonsVisible = false;
  current = 0;

  constructor(scene: Scene, deskTop: Vector3, private readonly table: StringTable) {
    this.mesh = MeshBuilder.CreatePlane('paper', { width: PAPER_W, height: PAPER_H }, scene);
    this.mesh.position.set(deskTop.x, deskTop.y + 0.002, deskTop.z + 0.02);
    this.mesh.rotation.x = Math.PI / 2;
    this.mesh.rotation.y = Math.PI;
    this.texture = new DynamicTexture('paper.tex', { width: PAPER_TEX_W, height: PAPER_TEX_H }, scene, true);
    const m = new StandardMaterial('paper.mat', scene);
    m.diffuseTexture = this.texture;
    m.emissiveColor = new Color3(0.35, 0.35, 0.33);
    m.specularColor = Color3.Black();
    this.mesh.material = m;

    // 按钮是卷子的子网格：朝向自动跟卷子一致，纸面位置直接写局部坐标。
    const near = this.nearEdgeSign();
    this.prevButton = this.buildButton(scene, 'ui.paper.prev', -1, buttonRect(near, -1));
    this.nextButton = this.buildButton(scene, 'ui.paper.next', 1, buttonRect(near, 1));
    this.setButtonsVisible(false);

    // 按住交卷的进度：卷子远端的一道红线，越按越长。
    this.submitBar = MeshBuilder.CreatePlane('paper.submit', { width: PAPER_W * 0.8, height: 0.006 }, scene);
    this.submitBar.parent = this.mesh;
    this.submitBar.position.set(0, -near * (PAPER_H / 2 - 0.012), -0.001);
    const bar = new StandardMaterial('paper.submit.mat', scene);
    bar.diffuseColor = new Color3(0.75, 0.1, 0.08);
    bar.emissiveColor = new Color3(0.45, 0.05, 0.04);
    bar.specularColor = Color3.Black();
    this.submitBar.material = bar;
    this.submitBar.isPickable = false;
    this.submitBar.setEnabled(false);
  }

  /** 0..1：按住 Enter 交卷的进度。 */
  setSubmitProgress(progress: number): void {
    this.submitBar.setEnabled(progress > 0);
    this.submitBar.scaling.x = Math.max(0.001, Math.min(1, progress));
  }

  /** 卷子的哪一条长边离玩家更近（局部 +Y 还是 -Y）。按钮放这一侧，低头就能点到。 */
  private nearEdgeSign(): number {
    const world = this.mesh.computeWorldMatrix(true);
    const zPlus = Vector3.TransformCoordinates(new Vector3(0, PAPER_H / 2, 0), world).z;
    const zMinus = Vector3.TransformCoordinates(new Vector3(0, -PAPER_H / 2, 0), world).z;
    return zPlus >= zMinus ? 1 : -1;
  }

  private buildButton(scene: Scene, key: string, delta: number, rect: { x: number; y: number; w: number; h: number }): Mesh {
    const tex = new DynamicTexture('paper.btn.tex.' + delta, { width: BTN_TEX_W, height: BTN_TEX_H }, scene, true);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, BTN_TEX_W, BTN_TEX_H);
    roundedRect(ctx, BTN_INSET_X, BTN_INSET_Y, BTN_TEX_W - BTN_INSET_X * 2, BTN_TEX_H - BTN_INSET_Y * 2, 12);
    ctx.fillStyle = '#e6e1d2';
    ctx.fill();
    ctx.strokeStyle = '#4a463c';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#1b1b1b';
    ctx.font = 'bold 46px ' + FONT_FAMILY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.table.get(key), BTN_TEX_W / 2, BTN_TEX_H / 2);
    tex.update();

    const mesh = MeshBuilder.CreatePlane('paper.btn.' + delta, { width: rect.w, height: rect.h }, scene);
    mesh.parent = this.mesh;
    // 卷面的正面是局部 -Z（朝上）：按钮要往 -Z 抬，+Z 会藏到纸底下去。
    mesh.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2, -0.002);
    const mat = new StandardMaterial('paper.btn.mat.' + delta, scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveColor = new Color3(0.45, 0.45, 0.42);
    mat.specularColor = Color3.Black();
    mesh.material = mat;
    return mesh;
  }

  /** 只在「看着卷子」的时候把按钮亮出来 —— 状态外它们不该存在。 */
  setButtonsVisible(visible: boolean): void {
    if (visible === this.buttonsVisible) return;
    this.buttonsVisible = visible;
    this.prevButton.setEnabled(visible);
    this.nextButton.setEnabled(visible);
  }

  /** 准星（屏幕正中）落在哪个按钮上：-1 上一题 / +1 下一题 / 0 没点中。 */
  hitTestAtCenter(): number {
    const scene = this.mesh.getScene();
    const canvas = scene.getEngine().getRenderingCanvas();
    if (!canvas) return 0;
    // 谓词一旦给了，Babylon 就不再自己判 enabled / visible / pickable —— 所以这里必须自己判，
    // 否则藏起来的按钮照样点得中（Culling/ray.core.js 的 _internalPick）。
    const info = scene.pick(canvas.clientWidth / 2, canvas.clientHeight / 2, (m) => {
      if (!m.isEnabled()) return false;
      return m === this.prevButton || m === this.nextButton;
    });
    if (!info || !info.hit || !info.pickedMesh) return 0;
    return info.pickedMesh === this.nextButton ? 1 : -1;
  }

  flip(delta: number, session: ExamSession): void {
    const n = session.questions.length;
    if (n === 0) return;
    this.current = (this.current + delta + n) % n;
    this.draw(session);
  }

  draw(session: ExamSession): void {
    const ctx = this.texture.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#f2efe6';
    ctx.fillRect(0, 0, PAPER_TEX_W, PAPER_TEX_H);
    ctx.fillStyle = '#1b1b1b';
    ctx.textAlign = 'center';

    // 文字块整体躲开上下两条按钮带。
    const top = TEXT_TOP_PX;
    const bottom = TEXT_BOTTOM_PX;

    const t = (key: string) => this.table.get(key);
    ctx.font = '40px ' + FONT_FAMILY;
    ctx.fillText(formatTemplate(t('paper.header.year_fmt'), String(session.run.year)) + '  ' + t('paper.header.title'), PAPER_TEX_W / 2, top);
    ctx.font = 'bold 56px ' + FONT_FAMILY;
    ctx.fillText(session.context.strings.get('header') ?? '', PAPER_TEX_W / 2, top + 80);
    ctx.font = '34px ' + FONT_FAMILY;
    ctx.fillText(formatTemplate(t('paper.header.id_fmt'), session.run.candidateNumber), PAPER_TEX_W / 2, top + 140);
    ctx.fillRect(80, top + 175, PAPER_TEX_W - 160, 3);

    const q = session.questions[this.current];
    if (!q) { this.texture.update(); return; }

    // 题码：题不是让你答的 —— 把这四位数输进手机的「搜题」，答案才出来。
    const code = session.phone ? session.phone.codeFor(this.current) : '';
    if (code) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 32px ' + FONT_FAMILY;
      const label = formatTemplate(t('paper.question.code_fmt'), code);
      const w = ctx.measureText(label).width;
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = 3;
      ctx.strokeRect(PAPER_TEX_W - 110 - w, top + 188, w + 40, 48);
      ctx.fillText(label, PAPER_TEX_W - 90, top + 224);
    }

    ctx.textAlign = 'left';
    ctx.font = '38px ' + FONT_FAMILY;
    let y = wrap(ctx, (this.current + 1) + '. ' + t(q.qId), 90, top + QUESTION_OFFSET_PX, PAPER_TEX_W - 180, 56);
    y += 50;
    q.choices.forEach((choice, i) => {
      const mark = q.selected === i ? '\u25A0 ' : '\u25A1 ';
      y = wrap(ctx, mark + String.fromCharCode(65 + i) + '. ' + choice, 120, y, PAPER_TEX_W - 220, 54) + 30;
    });

    ctx.textAlign = 'center';
    ctx.font = '30px ' + FONT_FAMILY;
    ctx.fillText((this.current + 1) + ' / ' + session.questions.length, PAPER_TEX_W / 2, bottom);
    this.texture.update();
  }
}

/** 逐字折行（中文没有空格可断）。返回下一行的 y。 */
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, y);
      line = ch;
      y += lineHeight;
    } else line += ch;
  }
  if (line.length > 0) { ctx.fillText(line, x, y); y += lineHeight; }
  return y;
}

/** 圆角矩形路径（不依赖 ctx.roundRect 的可用性）。 */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
