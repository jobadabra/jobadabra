// Display-only bridge for injected extension panels; fetches trusted bundled words and never reads the employer DOM or applicant values.
(() => {
  if (window.__jobadabraPanelI18n) return;
  let bundle = {locale:'en',messages:{},english:{}};
  const listeners = new Set(), roots = new Set();
  let steps = new Map();
  const t = (key, fallback = key, values = {}) => globalThis.__jobadabraFormatDisplayMessage(bundle.messages,bundle.english,bundle.locale,key,values,fallback);
  const translate = root => {
    if (root.host) root.host.lang = bundle.locale;
    for (const node of root.querySelectorAll('[data-jp-i18n]')) node.textContent = t(node.dataset.jpI18n,node.dataset.jpEnglish || node.textContent);
    for (const [attribute,marker] of [['title','jpTitle'],['aria-label','jpAriaLabel'],['placeholder','jpPlaceholder']]) {
      const selector = marker.replace(/[A-Z]/g, char => '-' + char.toLowerCase());
      for (const node of root.querySelectorAll('[data-' + selector + ']')) node.setAttribute(attribute,t(node.dataset[marker],node.getAttribute(attribute) || ''));
    }
  };
  async function refresh() {
    const next = await globalThis.chrome?.runtime?.sendMessage?.({type:'panelLocale'}).catch(() => null);
    if (!next || typeof next.locale !== 'string' || !next.messages || !next.english) return;
    try { new Intl.NumberFormat(next.locale); } catch { return; }
    bundle = next;
    // Explicit fixed worker-step display vocabulary only; no employer text or page classification.
    steps = new Map(Object.entries(bundle.english).filter(([key]) => key.startsWith('step.')).map(([key,value]) => [value,key]));
    for (const root of roots) translate(root);
    for (const listener of listeners) listener();
  }
  const ready = refresh();
  globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && (changes.extensionLanguage || changes.desktopDisplayLocale)) refresh();
  });
  window.__jobadabraPanelI18n = {t,ready,step:text=>steps.has(text) ? t(steps.get(text),text) : text,locale:()=>bundle.locale,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    bind(root) { roots.add(root); translate(root); return () => roots.delete(root); },
    number(value) { return new Intl.NumberFormat(bundle.locale).format(value); }};
})();
