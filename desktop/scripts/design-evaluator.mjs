// The rendered design-system rules as small functions that run inside the app window (like cut-fields.mjs): scripts/design-check.mjs sends `designEval` through shot.mjs --eval.
// Owner, 7 Nov 2026 ("Measured check"): "one primary button per card, no ghost/link buttons, no card inside a card, no clipped or overflowing text, AA contrast, spacing on the scale".
// They only measure and return [{rule, at, note}]; whether a hit is new is decided against the base render (design-table.mjs), never here.
// Every function takes `win` and `doc` (never a global) and calls only the others in PARTS: `designEval` is their source text plus one call, so nothing is imported in the page.

const CARD = '.card, .insight-card, .summary-card';
const SCALE = [0, 4, 8, 12, 16, 24, 32];

/** The element as a short selector: `tag#id`, else `tag.class1.class2`. */
function selectorOf(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const classes = [...el.classList].slice(0, 2).join('.');
  return classes ? `${tag}.${classes}` : tag;
}

/** Whether the element takes part in the layout (a fixed box counts, a hidden one does not). */
function isVisible(win, el) { return el.offsetParent !== null || win.getComputedStyle(el).position === 'fixed'; }

/** Spacing (padding or gap off the scale), primary (2+ `button.primary` in one card) and nested (a card inside a card; a `details` wrapper or `.is-plain` is not a card). */
function cardHits(win, doc, add) {
  const cards = [...doc.querySelectorAll(CARD)].filter(card => isVisible(win, card));
  for (const card of cards) {
    const primaries = [...card.querySelectorAll('button.primary')].filter(button => isVisible(win, button) && button.closest(CARD) === card);
    if (primaries.length > 1) add('primary', card, `${primaries.length} primary buttons`);
    const parent = card.parentElement && card.parentElement.closest(CARD);
    if (parent && parent.tagName !== 'DETAILS' && !parent.classList.contains('is-plain') && !card.classList.contains('is-plain')) add('nested', card, `inside ${selectorOf(parent)}`);
    const style = win.getComputedStyle(card);
    for (const property of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap']) {
      const value = parseFloat(style[property]);
      if (!Number.isNaN(value) && !SCALE.includes(Math.round(value))) add('spacing', card, `${property} ${value}px`);
    }
  }
  return cards.length;
}

/** `rgb()` / `rgba()` text as {r, g, b, a}, or null. */
function colorOf(text) {
  const match = text.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const [r, g, b, a = 1] = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return {r, g, b, a};
}

/** A colour laid over another, by its alpha. */
function mixColors(top, under) { return {r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a)}; }

/** WCAG relative luminance. */
function luminanceOf({r, g, b}) {
  const part = value => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * part(r) + 0.7152 * part(g) + 0.0722 * part(b);
}

/** What is behind an element's text: its background layers up to the first opaque one, over white. */
function backgroundOf(win, el) {
  const layers = [];
  for (let node = el; node; node = node.parentElement) {
    const layer = colorOf(win.getComputedStyle(node).backgroundColor);
    if (layer && layer.a > 0) { layers.push(layer); if (layer.a >= 1) break; }
  }
  return layers.reverse().reduce((under, layer) => mixColors(layer, under), {r: 255, g: 255, b: 255});
}

/** The contrast note ("4.12 text…") when the element's text is under WCAG AA (4.5, or 3 for large text), else ''. */
function lowContrast(win, el, style, text) {
  const fg = colorOf(style.color);
  if (el.disabled || !fg) return '';
  const background = backgroundOf(win, el), a = luminanceOf(mixColors(fg, background)), b = luminanceOf(background);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const size = parseFloat(style.fontSize), large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
  return ratio < (large ? 3 : 4.5) ? `${ratio.toFixed(2)} ${text.slice(0, 30)}` : '';
}

/** The clipped note when the text is cut by `overflow: hidden|clip` without an ellipsis or line clamp, or lies outside the window, else ''. */
function clippedNote(win, el, style, box, text) {
  const clamped = /^\d/.test(style.webkitLineClamp || '');
  if (['hidden', 'clip'].includes(style.overflowX) && style.textOverflow !== 'ellipsis' && !clamped && el.scrollWidth > el.clientWidth + 1) return text.slice(0, 40);
  return box.right > win.innerWidth + 1 || box.left < -1 ? `outside the window: ${text.slice(0, 40)}` : '';
}

/** Ghost (a `button.ghost` or `button.link`), clipped and contrast over every visible element with its own text; the page scrolling sideways is clipped too. Returns the texts measured. */
function textHits(win, doc, add) {
  for (const button of doc.querySelectorAll('button.ghost, button.link')) if (isVisible(win, button)) add('ghost', button, button.textContent.trim().slice(0, 30));
  let texts = 0;
  for (const el of doc.querySelectorAll('body *')) {
    const style = isVisible(win, el) ? win.getComputedStyle(el) : null;
    if (!style || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const text = [...el.childNodes].filter(node => node.nodeType === 3 && node.textContent.trim()).map(node => node.textContent.trim()).join(' ');
    const box = el.getBoundingClientRect();
    if (!text || box.width < 1 || box.height < 1) continue;
    texts++;
    const clipped = clippedNote(win, el, style, box, text), contrast = lowContrast(win, el, style, text);
    if (clipped) add('clipped', el, clipped);
    if (contrast) add('contrast', el, contrast);
  }
  const root = doc.documentElement;
  if (root.scrollWidth > win.innerWidth + 1) add('clipped', root, `page scrolls sideways ${root.scrollWidth} > ${win.innerWidth}`);
  return texts;
}

/** Measure the open screen: {out: [{rule, at, note}], cards, texts}. */
function evaluate(win, doc) {
  const out = [];
  const add = (rule, el, note = '') => out.push({rule, at: selectorOf(el), note});
  const cards = cardHits(win, doc, add);
  const texts = textHits(win, doc, add);
  return {out, cards, texts};
}

const PARTS = [selectorOf, isVisible, cardHits, colorOf, mixColors, luminanceOf, backgroundOf, lowContrast, clippedNote, textHits, evaluate];
/** The expression for `shot.mjs --eval`: the constants, the functions' source and the call. */
export const designEval = `(() => { const CARD = ${JSON.stringify(CARD)}, SCALE = ${JSON.stringify(SCALE)}; ${PARTS.map(part => part.toString()).join('\n')}\nreturn evaluate(window, document); })()`;
