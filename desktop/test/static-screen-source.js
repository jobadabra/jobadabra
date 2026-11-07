// Keep English source guards meaningful by resolving explicit page catalogs and static screen bindings.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import '../i18n/screens-pages.js';
import {getLocale, setLocale, t} from '../i18n/index.js';

const {parse} = createRequire(new URL('../package.json', import.meta.url))('acorn');
const renderer = fileURLToPath(new URL('../renderer/', import.meta.url));
const screen = fileURLToPath(new URL('../renderer/index.html', import.meta.url));

// Preserve expressions in translated source so existing structural guards still inspect their actual inputs.
const quoteEnglish = text => text.includes("'") ? JSON.stringify(text) : `'${text.replaceAll('\\', '\\\\').replaceAll('\n', '\\n')}'`;
const templateText = text => text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
function translationCalls(source) {
  const calls = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.name === 't' && /^pages[A-Z][\w]*\.[\w]+$/.test(node.arguments[0]?.value || '')) calls.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  };
  walk(parse(source, {ecmaVersion: 'latest', sourceType: 'module'}));
  return calls;
}
function englishBindings(source, calls) {
  const span = (start, end) => {
    const inside = calls.filter(call => call.start >= start && call.end <= end)
      .filter(call => !calls.some(parent => parent !== call && parent.start >= start && parent.end <= end && parent.start <= call.start && parent.end >= call.end));
    let text = '', at = start;
    for (const call of inside.sort((a, b) => a.start - b.start)) { text += source.slice(at, call.start) + translated(call); at = call.end; }
    return text + source.slice(at, end);
  };
  const translated = call => {
    const [key, vars] = call.arguments, english = t(key.value);
    if (english === key.value || (vars && (vars.type !== 'ObjectExpression' || vars.properties.some(prop => prop.type !== 'Property' || prop.computed)))) return source.slice(call.start, call.end);
    const values = new Map((vars?.properties || []).map(prop => [prop.key.name || prop.key.value, prop.value]));
    let used = false;
    const pieces = english.split(/(\{\w+\})/g).map(piece => {
      const value = values.get(piece.slice(1, -1));
      if (!/^\{\w+\}$/.test(piece) || !value) return templateText(piece);
      used = true;
      return '${' + span(value.start, value.end) + '}';
    });
    return used ? '`' + pieces.join('') + '`' : quoteEnglish(english);
  };
  return span(0, source.length);
}

// Resolve only explicit page bindings; unknown keys and unsupported argument shapes remain executable source text.
function englishPageSource(source) {
  if (!/\bt\(/.test(source)) return source;
  const locale = getLocale();
  setLocale('en');
  try { return englishBindings(source, translationCalls(source)); }
  finally { setLocale(locale); }   // these reads are synchronous and must not alter the caller's display locale
}

/** Read guarded renderer source, resolving explicit page bindings and static HTML annotations to their real English copy. */
export function readScreenSource(file, ...options) {
  const source = readFileSync(file, ...options);
  const name = file instanceof URL ? fileURLToPath(file) : typeof file === 'string' ? resolve(file) : null;
  if (typeof source !== 'string') return source;
  if (name?.startsWith(renderer) && name.endsWith('.js')) return englishPageSource(source);
  if (name !== screen) return source;
  return source.replace(/<span data-i18n="[^"]+" data-i18n-slot>([^<]*)<\/span>/g, '$1')
    .replace(/ data-i18n(?:-[\w-]+)?="[^"]*"/g, '');
}
