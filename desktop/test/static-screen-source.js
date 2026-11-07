// Keep English source guards meaningful by resolving explicit page catalogs and static screen bindings.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import '../i18n/screens-pages.js';
import {getLocale, setLocale, t} from '../i18n/index.js';

const renderer = fileURLToPath(new URL('../renderer/', import.meta.url));
const screen = fileURLToPath(new URL('../renderer/index.html', import.meta.url));

// Only literal no-argument page bindings are resolved; unknown keys and executable expressions remain source text.
function englishPageSource(source) {
  const locale = getLocale();
  setLocale('en');
  try {
    return source.replace(/\bt\((['"])(pages[A-Z][\w]*\.[\w]+)\1\)/g, (call, quote, key) => {
      const text = t(key);
      return text === key ? call : `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`;
    });
  } finally { setLocale(locale); }   // source reads are synchronous and must not change the caller's display locale
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
