import {
  Color3, DynamicTexture, Mesh, MeshBuilder, PointLight, Quaternion, StandardMaterial, Texture, TransformNode, Vector3,
  VertexBuffer, type AbstractMesh, type Camera, type Scene,
} from '@babylonjs/core';
import {
  formatArgs, formatTemplate, PHONE_MENU, PhoneApp, PhoneKey, PhoneNotice, PhoneScreen, type ExamSession, type FlipPhone, type StringTable,
} from '../core';
import { bone, flatMaterial, hex, Kit, vertexColorMaterial } from './lowpoly';

const SANS = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
/** 逻辑分辨率：一行正好放下 11 个字（短信表 max_chars 的硬约束）。 */
const LCD_W = 160;
const LCD_H = 200;
/** 画布按 2 倍分辨率画，缩小显示时字边才干净。 */
const LCD_RES = 2;
const BG = [224, 176, 78] as const;
const INK = [43, 29, 8] as const;
const BG_CSS = 'rgb(' + BG.join(',') + ')';
const INK_CSS = 'rgb(' + INK.join(',') + ')';

const BODY = hex('#e24b5b');
const BODY_DARK = hex('#b73442');
const PLATE = hex('#d7dbe0');
const CAP = hex('#f3f4f6');
const NAV = hex('#4a4f57');
const BEZEL = hex('#17181b');
const SKIN = hex('#f1c9a5');
const SLEEVE = hex('#2e5ea8');
const CUFF = hex('#f2f2ec');
const CHARM = hex('#ff9ec4');

const APP_LABEL: Record<PhoneApp, string> = {
  [PhoneApp.Search]: 'sms.menu.search',
  [PhoneApp.Ask]: 'sms.menu.ask',
  [PhoneApp.Inbox]: 'sms.inbox.title',
  [PhoneApp.Calc]: 'sms.menu.calc',
  [PhoneApp.Profile]: 'sms.menu.profile',
};

interface KeyDef { key: PhoneKey; x: number; y: number; w: number; h: number; cell: number }

/** 键盘半边的局部坐标（米）：+Y 朝铰链，键面朝 -Z（朝着玩家的眼睛）。 */
const KEYS: KeyDef[] = [
  { key: PhoneKey.Ok, x: -0.0165, y: -0.013, w: 0.011, h: 0.006, cell: 15 },
  { key: PhoneKey.Back, x: 0.0165, y: -0.013, w: 0.011, h: 0.006, cell: 15 },
  { key: PhoneKey.Up, x: 0, y: -0.0105, w: 0.011, h: 0.0055, cell: 12 },
  { key: PhoneKey.Ok, x: 0, y: -0.0185, w: 0.011, h: 0.0075, cell: 14 },
  { key: PhoneKey.Down, x: 0, y: -0.0265, w: 0.011, h: 0.0055, cell: 13 },
];
const GRID: PhoneKey[] = [
  PhoneKey.D1, PhoneKey.D2, PhoneKey.D3, PhoneKey.D4, PhoneKey.D5, PhoneKey.D6,
  PhoneKey.D7, PhoneKey.D8, PhoneKey.D9, PhoneKey.Star, PhoneKey.D0, PhoneKey.Hash,
];
GRID.forEach((key, i) => KEYS.push({ key, x: -0.0155 + (i % 3) * 0.0155, y: -0.039 - Math.floor(i / 3) * 0.0135, w: 0.0125, h: 0.0105, cell: i }));
const LEGENDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const LETTERS = ['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ', '', '+', ''];

interface KeyMesh { def: KeyDef; cap: Mesh; legend: Mesh; down: number }

/**
 * 桌肚下面的翻盖机：摸出来的时候盖子翻开，收起来的时候合上。
 * 屏幕是 240×300 的点阵：先用系统字体画，再逐像素二值化成两种颜色 —— 所以看起来像真的 LCD。
 * 键是真的键：鼠标（屏幕上的虚拟光标）点、数字键按都行，按下去会凹、右手拇指会过去。
 */
export class PhoneView {
  readonly root: TransformNode;
  private readonly lower: TransformNode;
  private readonly upper: TransformNode;
  private readonly thumb: Mesh;
  private readonly thumbTip: Mesh;
  private readonly keys: KeyMesh[] = [];
  private readonly keyByMesh = new Map<AbstractMesh, KeyMesh>();
  private readonly hover: Mesh;
  private readonly lcd: DynamicTexture;
  private readonly lcdMat: StandardMaterial;
  private readonly light: PointLight;
  private readonly thumbRest = new Vector3(0.019, -0.074, -0.02);
  private readonly thumbAim = new Vector3();
  private readonly thumbRoot = new Vector3(0.034, -0.1, -0.004);
  private shown = 0;
  private open = 0;
  private lastRevision = -1;
  private redrawIn = 0;
  private time = 0;
  private flash = 0;
  private buzz = 0;
  private aimKey: KeyMesh | null = null;
  private aimTime = 0;

  constructor(scene: Scene, camera: Camera, private readonly table: StringTable) {
    const vc = vertexColorMaterial(scene, 'phone.vc');
    this.root = bone(scene, 'phone', null, [0, -0.2, 0.15]);
    this.root.parent = camera;
    this.lower = bone(scene, 'phone.lower', this.root, [0, 0, 0], [-0.75, 0, 0]);
    this.upper = bone(scene, 'phone.upper', this.root, [0, 0, 0], [0.14, 0, 0]);

    // 机身：下半边（键盘）、上半边（屏幕）、铰链、挂饰。
    const k = new Kit(scene, 'phone.part');
    k.box(BODY, [0.05, 0.095, 0.012], [0, -0.0475, 0]);
    k.box(PLATE, [0.044, 0.088, 0.001], [0, -0.047, -0.0063]);
    k.cyl(NAV, 0.03, 0.03, 0.001, [0, -0.0185, -0.0066], [Math.PI / 2, 0, 0], undefined, 16);
    k.box(BODY_DARK, [0.05, 0.004, 0.0125], [0, -0.093, 0]);
    this.attach(k, this.lower, vc);
    k.box(BODY, [0.05, 0.092, 0.01], [0, 0.046, 0]);
    k.box(BEZEL, [0.046, 0.058, 0.001], [0, 0.05, -0.0053]);
    k.box(BEZEL, [0.012, 0.002, 0.001], [0, 0.085, -0.0053]);
    k.box(BODY_DARK, [0.05, 0.004, 0.0105], [0, 0.09, 0]);
    this.attach(k, this.upper, vc);
    k.cyl(BODY_DARK, 0.009, 0.009, 0.052, [0, 0, 0.001], [0, 0, Math.PI / 2], undefined, 10);
    k.cyl(hex('#333333'), 0.0015, 0.0015, 0.03, [-0.027, -0.012, 0.004], [0, 0, 0.2], undefined, 4);
    k.ball(CHARM, [0.012, 0.012, 0.006], [-0.03, -0.03, 0.004], undefined, undefined, 5);
    this.attach(k, this.root, vc);

    // 屏幕。
    const lcdCanvas = document.createElement('canvas');
    lcdCanvas.width = LCD_W * LCD_RES;
    lcdCanvas.height = LCD_H * LCD_RES;
    // 先取一次上下文把 willReadFrequently 定下来：pixelate() 每次重画都要把像素读回来。
    lcdCanvas.getContext('2d', { willReadFrequently: true });
    this.lcd = new DynamicTexture('phone.lcd', lcdCanvas, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    this.lcdMat = new StandardMaterial('phone.lcd.mat', scene);
    this.lcdMat.diffuseColor = Color3.Black();
    this.lcdMat.specularColor = Color3.Black();
    this.lcdMat.emissiveTexture = this.lcd;
    this.lcdMat.disableLighting = true;
    const screen = MeshBuilder.CreatePlane('phone.screen', { width: 0.041, height: 0.05125 }, scene);
    screen.parent = this.upper;
    screen.position.set(0, 0.05, -0.0062);
    screen.material = this.lcdMat;
    screen.isPickable = false;

    // 键：键帽（可点）+ 印字（图集里的一格）。
    const atlas = new DynamicTexture('phone.keys', { width: 256, height: 256 }, scene, true);
    atlas.hasAlpha = true;
    drawKeyAtlas(atlas);
    const legendMat = new StandardMaterial('phone.keys.mat', scene);
    legendMat.diffuseTexture = atlas;
    legendMat.useAlphaFromDiffuseTexture = true;
    legendMat.emissiveColor = new Color3(0.35, 0.35, 0.35);
    legendMat.specularColor = Color3.Black();
    for (const def of KEYS) {
      const nav = def.cell >= 12;
      const cap = MeshBuilder.CreateBox('phone.key.' + def.key, { width: def.w, height: def.h, depth: 0.002 }, scene);
      paintAll(cap, nav ? hex('#c9ced6') : CAP);
      cap.material = vc;
      cap.parent = this.lower;
      cap.position.set(def.x, def.y, -0.0072);
      const legend = MeshBuilder.CreatePlane('phone.legend.' + def.key, { width: def.w * 0.92, height: def.h * 0.92 }, scene);
      const cx = def.cell % 4;
      const cy = Math.floor(def.cell / 4);
      const u0 = cx / 4;
      const u1 = (cx + 1) / 4;
      const v0 = 1 - (cy + 1) / 4;
      const v1 = 1 - cy / 4;
      legend.setVerticesData(VertexBuffer.UVKind, [u0, v0, u1, v0, u1, v1, u0, v1]);
      legend.material = legendMat;
      legend.parent = cap;
      legend.position.z = -0.00105;
      legend.isPickable = false;
      const km: KeyMesh = { def, cap, legend, down: 0 };
      this.keys.push(km);
      this.keyByMesh.set(cap, km);
    }
    this.hover = MeshBuilder.CreateBox('phone.hover', { width: 1, height: 1, depth: 0.0004 }, scene);
    this.hover.material = flatMaterial(scene, 'phone.hover.mat', hex('#ffe08a'), hex('#8a6a20'));
    (this.hover.material as StandardMaterial).alpha = 0.45;
    this.hover.parent = this.lower;
    this.hover.isPickable = false;
    this.hover.setEnabled(false);

    // 两只手从下面托着手机；右手拇指是单独的，会移到要按的那个键上。
    const skin = new Kit(scene, 'phone.hand');
    for (const s of [-1, 1]) {
      skin.ball(SKIN, [0.05, 0.075, 0.03], [s * 0.031, -0.075, 0.022], undefined, undefined, 7);
      for (let f = 0; f < 3; f++) {
        const y = -0.047 - f * 0.013;
        skin.limb(SKIN, 0.0075, [s * 0.037, y, 0.018], [s * 0.029, y + 0.002, -0.004]);
      }
      skin.limb(SLEEVE, 0.024, [s * 0.07, -0.21, 0.07], [s * 0.04, -0.118, 0.034]);
      skin.limb(CUFF, 0.0255, [s * 0.05, -0.145, 0.045], [s * 0.043, -0.126, 0.037]);
      skin.limb(SKIN, 0.017, [s * 0.042, -0.12, 0.034], [s * 0.034, -0.095, 0.025]);
    }
    skin.limb(SKIN, 0.009, [-0.041, -0.1, 0.002], [-0.027, -0.068, -0.009]);
    this.attach(skin, this.lower, vc);
    this.thumb = MeshBuilder.CreateCylinder('phone.thumb', { diameter: 0.018, height: 1, tessellation: 8 }, scene);
    paintAll(this.thumb, SKIN);
    this.thumb.material = vc;
    this.thumb.parent = this.lower;
    this.thumb.rotationQuaternion = new Quaternion();
    this.thumb.isPickable = false;
    this.thumbTip = MeshBuilder.CreateSphere('phone.thumb.tip', { diameterX: 0.018, diameterY: 0.02, diameterZ: 0.014, segments: 6 }, scene);
    paintAll(this.thumbTip, SKIN);
    this.thumbTip.material = vc;
    this.thumbTip.parent = this.lower;
    this.thumbTip.isPickable = false;
    this.thumbAim.copyFrom(this.thumbRest);

    this.light = new PointLight('phone.light', new Vector3(0, 0.03, -0.08), scene);
    this.light.parent = this.root;
    this.light.diffuse = new Color3(1, 0.72, 0.32);
    this.light.specular = Color3.Black();
    this.light.range = 0.7;
    this.light.intensity = 0;
    this.root.setEnabled(false);
  }

  private attach(kit: Kit, node: TransformNode, mat: StandardMaterial): Mesh {
    const m = kit.merge(node.name + '.mesh', mat);
    m.parent = node;
    m.isPickable = false;
    return m;
  }

  /** 光标（CSS 像素，相对画布）下面是哪个键。 */
  keyAt(scene: Scene, x: number, y: number): PhoneKey | null {
    if (this.shown < 0.95) return null;
    const info = scene.pick(x, y, (m) => m.isEnabled() && this.keyByMesh.has(m));
    const km = info?.hit && info.pickedMesh ? this.keyByMesh.get(info.pickedMesh) : undefined;
    return km ? km.def.key : null;
  }

  /** 视觉上的一次按键：键帽凹下去、拇指过去。按的是哪个键就去哪个（Ok 有两个，挑中间那个）。 */
  press(key: PhoneKey): void {
    const km = this.keys.find((k) => k.def.key === key && (key !== PhoneKey.Ok || k.def.cell === 14)) ?? null;
    if (!km) return;
    km.down = 1;
    this.aimKey = km;
    this.aimTime = 0.35;
  }

  /** 来短信：屏幕闪一下；静音时整只手机震。 */
  notify(silent: boolean): void {
    this.flash = 1;
    if (silent) this.buzz = 0.8;
  }

  get buzzing(): number {
    return this.buzz;
  }

  update(dt: number, session: ExamSession, out: boolean, hoverKey: PhoneKey | null): void {
    this.time += dt;
    this.shown += ((out ? 1 : 0) - this.shown) * (1 - Math.exp(-dt * (out ? 11 : 14)));
    if (!out && this.shown < 0.02) this.shown = 0;
    const opening = out ? Math.max(0, (this.shown - 0.35) / 0.65) : this.shown;
    this.open += (opening - this.open) * (1 - Math.exp(-dt * 18));
    this.root.setEnabled(this.shown > 0.01);
    this.flash = Math.max(0, this.flash - dt * 1.4);
    this.buzz = Math.max(0, this.buzz - dt);
    if (this.shown <= 0.01) {
      this.light.intensity = 0;
      return;
    }

    const e = this.shown;
    const shake = this.buzz > 0 ? Math.sin(this.time * 90) * 0.0015 : 0;
    this.root.position.set(shake, -0.2 + (0.182 * e), 0.15 + 0.035 * e);
    this.root.rotation.x = (1 - e) * -0.5;
    this.upper.rotation.x = Math.PI - 0.75 + (0.14 - (Math.PI - 0.75)) * this.open;

    for (const km of this.keys) {
      km.down = Math.max(0, km.down - dt * 8);
      km.cap.position.z = -0.0072 + 0.0012 * Math.min(1, km.down * 2);
    }
    const hovered = hoverKey ? this.keys.find((k) => k.def.key === hoverKey && k.cap.isEnabled()) ?? null : null;
    this.hover.setEnabled(hovered !== null);
    if (hovered) {
      this.hover.position.set(hovered.def.x, hovered.def.y, -0.0085);
      this.hover.scaling.set(hovered.def.w + 0.002, hovered.def.h + 0.002, 1);
    }

    this.aimTime = Math.max(0, this.aimTime - dt);
    const target = this.aimKey && this.aimTime > 0 ? new Vector3(this.aimKey.def.x, this.aimKey.def.y - 0.002, -0.011) : hovered ? new Vector3(hovered.def.x, hovered.def.y - 0.004, -0.015) : this.thumbRest;
    this.thumbAim.addInPlace(target.subtract(this.thumbAim).scale(1 - Math.exp(-dt * 22)));
    this.placeThumb();

    const p = session.phone;
    const lit = !p.dead;
    this.light.intensity = lit ? 0.32 * e + this.flash * 0.3 : 0;
    this.redrawIn -= dt;
    if (p.revision !== this.lastRevision || this.redrawIn <= 0) {
      this.lastRevision = p.revision;
      this.redrawIn = 0.25;
      this.draw(session, p);
    }
    this.lcd.level = lit ? 1 : 0;
  }

  private placeThumb(): void {
    const root = this.thumbRoot.add(this.thumbAim.subtract(this.thumbRest).scale(0.45));
    const tip = this.thumbAim;
    const d = tip.subtract(root);
    const len = Math.max(0.01, d.length());
    this.thumb.position.copyFrom(root.add(tip).scale(0.5));
    this.thumb.scaling.set(1, len, 1);
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), d.normalize(), this.thumb.rotationQuaternion!);
    this.thumbTip.position.copyFrom(tip);
  }

  // ───────────── 屏幕 ─────────────

  private draw(s: ExamSession, p: FlipPhone): void {
    const g = this.lcd.getContext() as CanvasRenderingContext2D;
    g.setTransform(LCD_RES, 0, 0, LCD_RES, 0, 0);
    if (p.dead) {
      g.fillStyle = '#16140f';
      g.fillRect(0, 0, LCD_W, LCD_H);
      this.lcd.update();
      return;
    }
    const t = (key: string): string => this.table.get(key);
    const invert = this.flash > 0.5;
    g.fillStyle = BG_CSS;
    g.fillRect(0, 0, LCD_W, LCD_H);
    g.fillStyle = INK_CSS;
    g.strokeStyle = INK_CSS;
    g.textBaseline = 'top';
    const blink = Math.floor(this.time * 2.5) % 2 === 0;

    // 状态栏：信号、运营商、情景模式、未读、时间、电池。
    for (let i = 0; i < 4; i++) g.fillRect(2 + i * 4, 11 - (i + 1) * 2.4, 3, (i + 1) * 2.4);
    g.font = 'bold 11px ' + SANS;
    g.textAlign = 'left';
    g.fillText(t('sms.carrier'), 19, 1);
    if (p.silent) drawMuted(g, 67, 1.5, 0.72);
    if (p.unread > 0 && blink) drawEnvelope(g, 81, 2.5, true, 0.72);
    g.textAlign = 'right';
    g.fillText(clockText(s.clock.wallClockMinutes(0)), LCD_W - 25, 1);
    g.lineWidth = 1.5;
    g.strokeRect(LCD_W - 22, 2, 17, 9);
    g.fillRect(LCD_W - 5, 4.5, 2, 4);
    const bars = p.batteryBars;
    if (bars > 1 || blink) for (let i = 0; i < bars; i++) g.fillRect(LCD_W - 20.5 + i * 3.4, 3.5, 2.6, 6);

    // 标题栏（反白）。
    const title = this.titleFor(p);
    g.fillRect(0, 14, LCD_W, 19);
    g.fillStyle = BG_CSS;
    g.textAlign = 'center';
    g.font = 'bold 14px ' + SANS;
    g.fillText(title, LCD_W / 2, 16.5);
    g.fillStyle = INK_CSS;

    this.drawBody(g, s, p, blink);

    // 软键。
    g.fillRect(0, LCD_H - 18, LCD_W, 1.5);
    g.font = 'bold 12px ' + SANS;
    g.textAlign = 'left';
    g.fillText(t('sms.softkey.ok'), 4, LCD_H - 14.5);
    g.textAlign = 'right';
    g.fillText(t('sms.softkey.back'), LCD_W - 4, LCD_H - 14.5);

    pixelate(g, invert);
    this.lcd.update();
  }

  private titleFor(p: FlipPhone): string {
    const t = (key: string): string => this.table.get(key);
    switch (p.screen) {
      case PhoneScreen.Search:
      case PhoneScreen.Searching:
      case PhoneScreen.SearchResult: return t('sms.menu.search');
      case PhoneScreen.Ask:
      case PhoneScreen.Sent: return t('sms.menu.ask');
      case PhoneScreen.Inbox: return t('sms.inbox.title');
      case PhoneScreen.Message: return p.openMessage ? t(p.openMessage.senderKey) : t('sms.inbox.title');
      case PhoneScreen.Calc: return t('sms.menu.calc');
      case PhoneScreen.Profile: return t('sms.menu.profile');
      default: return t('sms.carrier');
    }
  }

  private drawBody(g: CanvasRenderingContext2D, s: ExamSession, p: FlipPhone, blink: boolean): void {
    const t = (key: string): string => this.table.get(key);
    const x = 5;
    let y = 37;
    g.textAlign = 'left';
    g.font = 'bold 13px ' + SANS;
    const line = (text: string, size = 13, gap = 16): void => {
      g.font = 'bold ' + size + 'px ' + SANS;
      y = wrapText(g, text, x, y, LCD_W - 2 * x, gap);
    };
    const field = (value: string, length: number): void => {
      g.font = 'bold 22px ' + SANS;
      let text = '';
      for (let i = 0; i < length; i++) text += i < value.length ? value[i] : '_';
      g.fillText(text, x + 3, y);
      if (blink && value.length < length) g.fillRect(x + 3 + g.measureText(value).width, y + 22, 11, 2);
      y += 29;
    };
    const notice = (): void => {
      if (p.notice === PhoneNotice.Balance) line(t('sms.balance.insufficient'));
      else if (p.notice === PhoneNotice.NoSuchQuestion) line(t('sms.ask.none'));
    };
    const balance = (): void => line(formatTemplate(t('sms.balance.fmt'), p.balanceText), 12, 15);

    switch (p.screen) {
      case PhoneScreen.Home: {
        PHONE_MENU.forEach((app, i) => {
          const selected = i === p.menuIndex;
          if (selected) g.fillRect(2, y - 1.5, LCD_W - 4, 20);
          g.fillStyle = selected ? BG_CSS : INK_CSS;
          g.font = 'bold 14px ' + SANS;
          let label = (i + 1) + ' ' + t(APP_LABEL[app]);
          if (app === PhoneApp.Inbox && p.unread > 0) label += '(' + p.unread + ')';
          g.fillText(label, x + 1, y + 1.5);
          g.fillStyle = INK_CSS;
          y += 21;
        });
        y += 3;
        balance();
        if (p.unread > 0 && blink) line(formatTemplate(t('sms.home.unread_fmt'), String(p.unread)), 12, 15);
        break;
      }
      case PhoneScreen.Search:
        line(t('sms.search.prompt'));
        field(p.input, p.codeLength);
        line(t('sms.search.price'), 12, 15);
        balance();
        notice();
        break;
      case PhoneScreen.Searching: {
        line(t('sms.search.loading') + '.'.repeat(1 + (Math.floor(this.time * 3) % 3)), 12, 15);
        field(p.input, p.codeLength);
        g.lineWidth = 1.5;
        g.strokeRect(x, y, LCD_W - 2 * x, 12);
        const segs = Math.floor(p.searchProgress * 12);
        const seg = (LCD_W - 2 * x - 4) / 12;
        for (let i = 0; i < segs; i++) g.fillRect(x + 2 + i * seg, y + 2, seg - 1.5, 8);
        break;
      }
      case PhoneScreen.SearchResult: {
        const r = p.result;
        if (r && r.number > 0) {
          line(formatArgs(t('sms.search.result_fmt'), String(r.number)));
          y += 3;
          line(r.answer, 22, 26);
        } else {
          line(t('sms.search.none'));
        }
        break;
      }
      case PhoneScreen.Ask:
        line(t('sms.ask.prompt'));
        field(p.input, 2);
        line(t('sms.ask.price'), 12, 15);
        balance();
        notice();
        break;
      case PhoneScreen.Sent:
        drawEnvelope(g, LCD_W / 2 - 18, y + 14, false, 2);
        y += 52;
        g.textAlign = 'center';
        g.font = 'bold 15px ' + SANS;
        g.fillText(t('sms.compose.sent'), LCD_W / 2, y);
        break;
      case PhoneScreen.Inbox: {
        if (p.inbox.length === 0) { line(t('sms.inbox.empty')); break; }
        const rows = 6;
        const first = Math.max(0, Math.min(p.inboxIndex - 2, p.inbox.length - rows));
        for (let i = first; i < Math.min(p.inbox.length, first + rows); i++) {
          const m = p.inbox[i]!;
          const selected = i === p.inboxIndex;
          if (selected) g.fillRect(2, y - 1.5, LCD_W - 4, 21);
          g.fillStyle = selected ? BG_CSS : INK_CSS;
          g.strokeStyle = g.fillStyle;
          drawEnvelope(g, x, y + 3.5, !m.read, 0.72);
          g.font = 'bold 13px ' + SANS;
          g.textAlign = 'left';
          g.fillText(t(m.senderKey), x + 18, y + 2);
          g.textAlign = 'right';
          g.font = 'bold 10px ' + SANS;
          g.fillText(clockText(s.clock.startClockMinutes + Math.trunc((m.at * s.clock.timeScale) / 60)), LCD_W - 5, y + 4);
          g.fillStyle = INK_CSS;
          g.strokeStyle = INK_CSS;
          g.textAlign = 'left';
          y += 23;
        }
        break;
      }
      case PhoneScreen.Message: {
        const m = p.openMessage;
        if (!m) break;
        g.font = 'bold 11px ' + SANS;
        g.fillText(clockText(s.clock.startClockMinutes + Math.trunc((m.at * s.clock.timeScale) / 60)), x, y);
        y += 16;
        line(m.text, 13, 17);
        break;
      }
      case PhoneScreen.Calc: {
        g.textAlign = 'right';
        g.font = 'bold 17px ' + SANS;
        const expr = p.calcExpr.replace(/\*/g, '\u00D7').replace(/\//g, '\u00F7').replace(/-/g, '\u2212');
        g.fillText(expr.length > 0 ? expr : '0', LCD_W - 7, y + 5);
        g.fillRect(x, y + 30, LCD_W - 2 * x, 1.5);
        if (p.calcResult.length > 0) {
          g.font = 'bold 22px ' + SANS;
          g.fillText('= ' + p.calcResult, LCD_W - 7, y + 40);
        }
        g.textAlign = 'left';
        y = LCD_H - 36;
        line(t('sms.calc.help'), 11, 14);
        break;
      }
      case PhoneScreen.Profile: {
        const options: [string, boolean][] = [[t('sms.profile.ring'), !p.silent], [t('sms.profile.silent'), p.silent]];
        for (const [label, on] of options) {
          if (on) g.fillRect(2, y - 1.5, LCD_W - 4, 22);
          g.fillStyle = on ? BG_CSS : INK_CSS;
          g.strokeStyle = g.fillStyle;
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(x + 7, y + 9.5, 5.5, 0, Math.PI * 2);
          g.stroke();
          if (on) {
            g.beginPath();
            g.arc(x + 7, y + 9.5, 2.7, 0, Math.PI * 2);
            g.fill();
          }
          g.font = 'bold 14px ' + SANS;
          g.fillText(label, x + 19, y + 2.5);
          g.fillStyle = INK_CSS;
          g.strokeStyle = INK_CSS;
          y += 25;
        }
        break;
      }
      default: break;
    }
  }
}

function clockText(minutes: number): string {
  const m = ((Math.trunc(minutes) % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
}

function wrapText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  let line = '';
  for (const ch of text) {
    if (g.measureText(line + ch).width > maxWidth && line.length > 0) {
      g.fillText(line, x, y);
      line = ch;
      y += lineHeight;
    } else line += ch;
  }
  if (line.length > 0) {
    g.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

function drawEnvelope(g: CanvasRenderingContext2D, x: number, y: number, filled: boolean, scale = 1): void {
  const w = 18 * scale;
  const h = 12 * scale;
  g.lineWidth = 2 * scale;
  if (filled) g.fillRect(x, y, w, h);
  else g.strokeRect(x, y, w, h);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w / 2, y + h * 0.6);
  g.lineTo(x + w, y);
  if (filled) {
    const fill = g.fillStyle;
    g.strokeStyle = BG_CSS;
    g.stroke();
    g.strokeStyle = fill;
  } else g.stroke();
}

function drawMuted(g: CanvasRenderingContext2D, x: number, y: number, scale = 1): void {
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  g.beginPath();
  g.moveTo(2, 10);
  g.quadraticCurveTo(2, 0, 7, 0);
  g.quadraticCurveTo(12, 0, 12, 10);
  g.closePath();
  g.fill();
  g.fillRect(0, 10, 14, 2);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-1, 13);
  g.lineTo(15, -1);
  g.stroke();
  g.restore();
}

/** 二值化：离墨色近的像素全变墨色，其余全变底色——点阵屏只有两种颜色。 */
function pixelate(g: CanvasRenderingContext2D, invert: boolean): void {
  const img = g.getImageData(0, 0, LCD_W * LCD_RES, LCD_H * LCD_RES);
  const d = img.data;
  const on = invert ? BG : INK;
  const off = invert ? INK : BG;
  const mid = (BG[0] + BG[1] + BG[2] + INK[0] + INK[1] + INK[2]) / 2;
  for (let i = 0; i < d.length; i += 4) {
    const c = d[i]! + d[i + 1]! + d[i + 2]! < mid ? on : off;
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

function drawKeyAtlas(t: DynamicTexture): void {
  const g = t.getContext() as CanvasRenderingContext2D;
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = '#26282c';
  g.strokeStyle = '#26282c';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 12; i++) {
    const cx = (i % 4) * 64 + 32;
    const cy = Math.floor(i / 4) * 64 + 32;
    g.font = 'bold 40px ' + SANS;
    g.fillText(LEGENDS[i]!, cx - (LETTERS[i] ? 10 : 0), cy + 2);
    if (LETTERS[i]) {
      g.font = 'bold 13px ' + SANS;
      g.fillText(LETTERS[i]!, cx + 18, cy + 14);
    }
  }
  const tri = (cx: number, cy: number, dir: number): void => {
    g.beginPath();
    g.moveTo(cx - 14, cy + 8 * dir);
    g.lineTo(cx + 14, cy + 8 * dir);
    g.lineTo(cx, cy - 10 * dir);
    g.closePath();
    g.fill();
  };
  tri(0 * 64 + 32, 3 * 64 + 32, 1);
  tri(1 * 64 + 32, 3 * 64 + 32, -1);
  g.font = 'bold 30px ' + SANS;
  g.fillText('OK', 2 * 64 + 32, 3 * 64 + 34);
  g.fillRect(3 * 64 + 12, 3 * 64 + 28, 40, 8);
  t.update();
}

function paintAll(mesh: Mesh, color: Color3): void {
  const n = mesh.getTotalVertices();
  const data = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) data.set([color.r, color.g, color.b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, data, false, 4);
}
