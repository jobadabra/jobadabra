// Keep existing English source guards about screen structure, ignoring only explicit translation metadata and generated text slots.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const screen = fileURLToPath(new URL('../renderer/index.html', import.meta.url));

/** Read source as before; for the main HTML only, recover its English fallback markup from translation-only annotations. */
export function readScreenSource(file, ...options) {
  const source = readFileSync(file, ...options);
  const name = file instanceof URL ? fileURLToPath(file) : typeof file === 'string' ? resolve(file) : null;
  if (name !== screen || typeof source !== 'string') return source;
  return source.replace(/<span data-i18n="[^"]+" data-i18n-slot>([^<]*)<\/span>/g, '$1')
    .replace(/ data-i18n(?:-[\w-]+)?="[^"]*"/g, '');
}
