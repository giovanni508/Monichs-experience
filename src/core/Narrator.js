// Voce narrante discreta: sottotitoli che compaiono lentamente, uno alla volta.
export class Narrator {
  constructor(ui, i18n) {
    this.ui = ui;
    this.i18n = i18n;
    this.queue = [];
    this.current = null;
    this.timer = 0;
    this.gap = 0;
    this.said = new Set();
    this.paused = false;
    i18n.onChange(() => {
      if (this.current) this.ui.setSubtitle(this.text(this.current));
    });
  }

  text(item) {
    return this.i18n.t(item.key, item.vars);
  }

  // Durata di lettura: ~15 caratteri al secondo + respiro, min 3,8 s
  durationFor(text) {
    return Math.max(3.8, Math.min(11, 1.6 + text.length / 15));
  }

  /**
   * @param {string} key chiave del testo
   * @param {object} opts { delay, hold, once, priority }
   */
  say(key, opts = {}) {
    if (!this.i18n.has(key)) return;
    if (opts.once && this.said.has(key)) return;
    this.said.add(key);
    const item = { key, delay: opts.delay ?? 0, hold: opts.hold, vars: opts.vars };
    if (opts.priority) {
      this.queue.unshift(item);
      if (this.current) this.timer = Math.min(this.timer, 0.4);
    } else this.queue.push(item);
  }

  clear() {
    this.queue.length = 0;
    this.current = null;
    this.timer = 0;
    this.ui.setSubtitle('');
  }

  reset() {
    this.clear();
    this.said.clear();
  }

  get busy() {
    return !!this.current || this.queue.length > 0;
  }

  update(dt) {
    if (this.paused) return;
    if (this.current) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.current = null;
        this.ui.setSubtitle('');
        this.gap = 0.9;
      }
      return;
    }
    if (this.gap > 0) {
      this.gap -= dt;
      return;
    }
    const next = this.queue[0];
    if (!next) return;
    if (next.delay > 0) {
      next.delay -= dt;
      return;
    }
    this.queue.shift();
    this.current = next;
    const text = this.text(next);
    this.timer = next.hold ?? this.durationFor(text);
    this.ui.setSubtitle(text);
  }
}
