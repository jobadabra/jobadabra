// Keep English source guards meaningful by resolving explicit page catalogs and static screen bindings.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {callArgs, topLevel} from './toast-scan.js';
import '../i18n/screens-pages.js';
import {finalText} from '../i18n/final-pages.js';
import {getLocale, setLocale, t} from '../i18n/index.js';

const renderer = fileURLToPath(new URL('../renderer/', import.meta.url));
const screen = fileURLToPath(new URL('../renderer/index.html', import.meta.url));

// Preserve expressions in translated source so structural guards inspect their actual inputs.
const quoteEnglish = text => text.includes("'") ? JSON.stringify(text) : `'${text.replaceAll('\\', '\\\\').replaceAll('\n', '\\n')}'`;
const templateText = text => text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
function bindingValues(argument) {
  if (!argument) return new Map();
  if (!argument.startsWith('{') || !argument.endsWith('}')) return null;
  const values = new Map();
  for (const property of topLevel(argument.slice(1, -1))) {
    const explicit = property.match(/^(?:['"](\w+)['"]|(\w+))\s*:\s*([\s\S]+)$/);
    if (explicit) values.set(explicit[1] || explicit[2], explicit[3]);
    else if (/^\w+$/.test(property)) values.set(property, property);
    else return null;   // computed names and spreads are executable source, never guessed by the adapter
  }
  return values;
}
function translationCall(source, match) {
  const from = match.index + match[0].indexOf('(') + 1;
  try {
    const args = callArgs(source, from), parts = topLevel(args);
    if (parts.length > 2) return null;
    return {start: match.index, end: from + args.length + 1, key: match[2], values: bindingValues(parts[1])};
  } catch { return null; }   // unsupported source remains unchanged so its existing guards still see it
}
function translationCalls(source) {
  const calls = [...source.matchAll(/\bt\((['"])(pages[A-Z][\w]*\.[\w]+)\1/g)]
    .map(match => translationCall(source, match));
  calls.push(...[...source.matchAll(/\bfinalText\((['"])([\w]+)\1/g)]
    .map(match => ({...translationCall(source, match), final: true})));
  return calls.filter(call => call?.key);
}
function translatedBinding(source, call) {
  const english = call.final ? finalText(call.key) : t(call.key);
  if (english === call.key || english === `finalPages.${call.key}` || !call.values) return source.slice(call.start, call.end);
  let used = false;
  const pieces = english.split(/(\{\w+\})/g).map(piece => {
    const expression = call.values.get(piece.slice(1, -1));
    if (!/^\{\w+\}$/.test(piece) || !expression) return templateText(piece);
    used = true;
    return '${' + englishPageSource(expression) + '}';
  });
  return used ? '`' + pieces.join('') + '`' : quoteEnglish(english);
}
function englishBindings(source, calls) {
  const outer = calls.filter(call => !calls.some(parent => parent !== call && parent.start <= call.start && parent.end >= call.end));
  let text = '', at = 0;
  for (const call of outer.sort((a, b) => a.start - b.start)) {
    text += source.slice(at, call.start) + translatedBinding(source, call);
    at = call.end;
  }
  return text + source.slice(at);
}

// Resolve explicit bundled page bindings; unknown keys and unsupported shapes remain source text.
function englishPageSource(source) {
  if (!/\b(?:t|finalText)\(/.test(source)) return source;
  const locale = getLocale();
  setLocale('en');
  try { return englishBindings(source, translationCalls(source)); }
  finally { setLocale(locale); }   // synchronous reads must not alter the caller's display locale
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
