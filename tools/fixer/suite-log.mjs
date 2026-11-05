// Streams sandbox test output to Actions and a retained log, redacting credentials, contact details and personal paths before either copy is written.
import fs from 'node:fs';
import {createInterface} from 'node:readline';
import {stripVTControlCharacters} from 'node:util';
import {redact} from '../../desktop/lib/feedback-bundle.js';
import {PHONE, ZERO_WIDTH} from './leaks.mjs';

const [suite, file] = process.argv.slice(2);
if (!['desktop', 'python'].includes(suite) || !file) throw new Error('usage: suite-log.mjs desktop|python LOG_FILE');
const output = fs.openSync(file, 'w', 0o600);
let privateKey = false;
try {
  for await (const raw of createInterface({input: process.stdin, crlfDelay: Infinity})) {
    let line = stripVTControlCharacters(raw).replace(ZERO_WIDTH, '');
    const begins = /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line), ends = /-----END [A-Z ]*PRIVATE KEY-----/.test(line);
    if (begins || privateKey) { privateKey = !ends; line = '<private key withheld>'; }
    line = redact(line, {home: '', lineChars: 2000})
      .replace(PHONE, '<phone>')
      .replaceAll('::', ': :');   // test output is data, never an Actions workflow command
    const safe = `[${suite}] ${line}\n`;
    fs.writeSync(output, safe);
    process.stdout.write(safe);
  }
} finally { fs.closeSync(output); }
