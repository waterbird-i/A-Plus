import { DynamicTexture, MeshBuilder, StandardMaterial, Color3, type Mesh, type Scene, type Vector3 } from '@babylonjs/core';
import { formatTemplate, type ExamSession, type StringTable } from '../core';

const TEX_W = 1024;
const TEX_H = 1448;
const FONT_FAMILY = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';

/**
 * 桌上的卷子：一次只翻到一道题（↑↓ 翻页，1–4 作答）。
 * 灰盒阶段用系统字体画在动态贴图上；正式的「呈现文本」按 Docs/字体决策.md 换成字体与贴图资产。
 */
export class PaperView {
  readonly mesh: Mesh;
  private readonly texture: DynamicTexture;
  current = 0;

  constructor(scene: Scene, deskTop: Vector3, private readonly table: StringTable) {
    this.mesh = MeshBuilder.CreatePlane('paper', { width: 0.297, height: 0.42 }, scene);
    this.mesh.position.set(deskTop.x, deskTop.y + 0.002, deskTop.z + 0.02);
    this.mesh.rotation.x = Math.PI / 2;
    this.mesh.rotation.y = Math.PI;
    this.texture = new DynamicTexture('paper.tex', { width: TEX_W, height: TEX_H }, scene, true);
    const m = new StandardMaterial('paper.mat', scene);
    m.diffuseTexture = this.texture;
    m.emissiveColor = new Color3(0.35, 0.35, 0.33);
    m.specularColor = Color3.Black();
    this.mesh.material = m;
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
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.fillStyle = '#1b1b1b';
    ctx.textAlign = 'center';

    const t = (key: string) => this.table.get(key);
    ctx.font = '40px ' + FONT_FAMILY;
    ctx.fillText(formatTemplate(t('paper.header.year_fmt'), String(session.run.year)) + '  ' + t('paper.header.title'), TEX_W / 2, 110);
    ctx.font = 'bold 56px ' + FONT_FAMILY;
    ctx.fillText(session.context.strings.get('header') ?? '', TEX_W / 2, 190);
    ctx.font = '34px ' + FONT_FAMILY;
    ctx.fillText(formatTemplate(t('paper.header.id_fmt'), session.run.candidateNumber), TEX_W / 2, 250);
    ctx.fillRect(80, 285, TEX_W - 160, 3);

    const q = session.questions[this.current];
    if (!q) { this.texture.update(); return; }

    ctx.textAlign = 'left';
    ctx.font = '38px ' + FONT_FAMILY;
    let y = wrap(ctx, (this.current + 1) + '. ' + t(q.qId), 90, 380, TEX_W - 180, 56);
    y += 50;
    q.choices.forEach((choice, i) => {
      const mark = q.selected === i ? '\u25A0 ' : '\u25A1 ';
      y = wrap(ctx, mark + String.fromCharCode(65 + i) + '. ' + choice, 120, y, TEX_W - 220, 54) + 30;
    });

    ctx.textAlign = 'center';
    ctx.font = '30px ' + FONT_FAMILY;
    ctx.fillText((this.current + 1) + ' / ' + session.questions.length, TEX_W / 2, TEX_H - 70);
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
