// Caricamento dei contenuti modificabili (content/texts.json, content/config.json) e traduzioni.
// Ogni foglia dei testi è un oggetto { "it": "...", "en": "..." }.

export async function loadJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Impossibile caricare ${url} (${res.status})`);
  return res.json();
}

export class I18n {
  constructor(texts, lang = 'it', available = ['it', 'en']) {
    this.texts = texts;
    this.available = available;
    this.lang = available.includes(lang) ? lang : available[0];
    this.listeners = new Set();
  }

  setLang(lang) {
    if (!this.available.includes(lang) || lang === this.lang) return;
    this.lang = lang;
    document.documentElement.lang = lang;
    this.listeners.forEach((fn) => fn(lang));
  }

  toggle() {
    const i = this.available.indexOf(this.lang);
    this.setLang(this.available[(i + 1) % this.available.length]);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  raw(key) {
    let node = this.texts;
    for (const part of key.split('.')) {
      if (node == null) return undefined;
      node = node[part];
    }
    return node;
  }

  // t('movement.stations.crown.title') → stringa nella lingua corrente (fallback: italiano, poi chiave)
  t(key, vars) {
    const node = this.raw(key);
    let s;
    if (node == null) s = key;
    else if (typeof node === 'string') s = node;
    else s = node[this.lang] ?? node.it ?? node.en ?? key;
    if (Array.isArray(s)) s = s.join('\n');
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
    return s;
  }

  has(key) {
    return this.raw(key) != null;
  }
}

// Testo localizzato da un valore di config (stringa o { it, en })
export function pick(value, lang) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang] ?? value.it ?? value.en ?? '';
}
