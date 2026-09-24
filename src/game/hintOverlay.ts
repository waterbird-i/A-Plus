import type { StringTable } from '../core';

/**
 * 「怎么玩」教学 —— 它自己占一屏，平时不出现。
 *
 * 以前这块提示是挂在游玩里的：开局弹、开考后淡出、一暂停又回来，等于一直在打扰玩家。
 * 现在它只在玩家自己要的时候出现：开始按钮旁边那颗「怎么玩」，或游玩中按 H。
 * 游玩中按 H 会顺带退出鼠标锁定（= 暂停），所以它永远不会盖在正在进行的考试上。
 *
 * 文案全部来自 String Table（硬规则 2：源码里一个中文字面量都不留），这里只按顺序点 key。
 */
const HINT_KEYS = [
  'ui.hint.look',
  'ui.hint.paper',
  'ui.hint.flip',
  'ui.hint.answer',
  'ui.hint.phone',
  'ui.hint.search',
  'ui.hint.ask',
  'ui.hint.keys',
  'ui.hint.teacher',
  'ui.hint.gaze',
];

export class HintOverlay {
  private readonly el: HTMLDivElement;
  private readonly onChange: ((visible: boolean) => void) | null;
  visible = false;

  constructor(parent: HTMLElement, table: StringTable, closeKey: string, onChange?: (visible: boolean) => void) {
    this.onChange = onChange ?? null;

    this.el = document.createElement('div');
    this.el.id = 'hint';

    const panel = document.createElement('div');
    panel.className = 'hint-panel';

    const title = document.createElement('div');
    title.className = 'hint-title';
    title.textContent = table.get('ui.hint.title');
    panel.appendChild(title);

    const list = document.createElement('ul');
    for (const key of HINT_KEYS) {
      const li = document.createElement('li');
      li.textContent = table.get(key);
      list.appendChild(li);
    }
    panel.appendChild(list);

    const close = document.createElement('button');
    close.type = 'button';
    close.id = 'hint-close';
    close.textContent = table.get(closeKey);
    close.addEventListener('click', () => this.hide());
    panel.appendChild(close);

    this.el.appendChild(panel);
    // 点面板外面那圈暗背景也算关掉。
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });

    parent.appendChild(this.el);
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.el.classList.add('open');
    this.onChange?.(true);
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.el.classList.remove('open');
    this.onChange?.(false);
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }
}
