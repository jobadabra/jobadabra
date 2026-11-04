// The store on this Mac, desktop side: the user's texts are Markdown files in the app's folder (profile.md, answers.md, knowledge.md),
// the same files the engine's sqlite adapter reads (lib/pipeline-env.js passes their paths). Tracked records (applications, runs…) live
// in the engine's data/tracker.sqlite and are reached through engine commands, never opened here. Spec:
// docs/superpowers/specs/2026-10-09-store-adapters.md. Guarded by desktop/test/unit/main/store-contract.test.js.
import * as engine from './engine.js';
import * as md from './markdown-page.js';
import {fromRecord} from '../run-rows.js';
import {TEXT_FILES} from './text-files.js';

export const NAME = 'sqlite';
export const CAPS = new Set();
export const LABEL = 'This Mac';   // what the window calls this store
export const FILES = TEXT_FILES;
// Recent activity reads two weeks back (the list shows the latest 25).
const RUN_DAYS = 14;
// A run's id from its link (store:cron_runs/<id>, run-rows.js recordLink), or the id itself.
const runId = link => String(link || '').replace(/^store:cron_runs\//, '');
const lines = value => (Array.isArray(value) ? value : String(value || '').split('\n')).filter(line => String(line).trim());
// Inline Markdown a report can hold, the marks src/stores/notion_blocks.py INLINE reads: an escape, code, bold, italic, a link.
const INLINE = /\\(.)|`([^`]*)`|\*\*(.+?)\*\*|\*(.+?)\*|\[((?:\\.|[^\]\\])*)\]\(([^)\s]*)\)/gs;
const plainText = text => String(text).replace(INLINE, (_, escaped, code, bold, italic, label) => escaped ?? code ?? plainText(bold ?? italic ?? label));
// Why (5 Nov 2026, owner: "Fix it, then film"): the engine stores a report as Markdown, and every reader expects the lines a Notion run gives (notion-runs.js detail),
// so a Gmail check on this Mac drew 1 card for 7 emails. The same rule as src/stores/notion_cron_runs.py _body: with sections its bullets, plain; else each line.
const reportLines = value => {
  const rows = lines(value);
  return rows.some(row => /^#{1,3} /.test(row))
    ? rows.filter(row => row.startsWith('- ')).map(row => plainText(row.slice(2)))
    : rows.map(row => row.replace(/^- /, ''));
};

export function open(storage, {call = engine.call} = {}) {
  const page = name => {
    const file = FILES[name];
    if (!file) throw new Error(`No text called ${name}`);
    const read = () => storage.readText(file);
    const edit = change => storage.writeText(file, change(read()));
    return {
      blocks: async () => md.blocks(read()),
      outline: async () => md.outline(read()),
      text: async () => md.readable(read()),
      write: async markdown => storage.writeText(file, String(markdown).replace(/\s*$/, '\n')),
      setText: async (block, value) => edit(text => md.setText(text, block, value)),
      async remove(block, {ifUnchanged = false} = {}) {
        const text = read();
        if (ifUnchanged) {
          const outline = md.outline(text), current = outline.flatMap(item => item.rows || [item]).find(item => item.id === block.id);
          if (!current || JSON.stringify(current.cells ?? current.text) !== JSON.stringify(block.cells ?? block.text)) return false;
        }
        storage.writeText(file, md.remove(text, block));
        return true;
      },
      append: async values => { if (values.length) edit(text => md.append(text, values)); },
      insertAfter: async (blockId, values) => edit(text => md.insertAfter(text, blockId, values)),
      async appendHeading(value) {
        const [text, id] = md.appendHeading(read(), value);
        storage.writeText(file, text);
        return id;
      },
      setCell: async (row, index, value) => edit(text => md.setCell(text, row, index, value)),
    };
  };
  // The run history (src/stores cron_runs), through the engine.
  const runs = {
    async list({size = 25} = {}) {
      const since = new Date(Date.now() - RUN_DAYS * 86400000).toISOString();
      return (await call(storage, 'cron_runs', 'list', {since})).slice(0, size).map(row => fromRecord(row));
    },
    async close(link, reason) {
      const id = runId(link);
      const row = id && await call(storage, 'cron_runs', 'get', {run_id: id});
      if (row?.status !== 'Running') return false;
      await call(storage, 'cron_runs', 'finish', {run_id: id, status: 'Failed', summary: String(reason).slice(0, 1900)});
      return true;
    },
    async detail(link) {
      const row = await call(storage, 'cron_runs', 'get', {run_id: runId(link)});
      const report = reportLines(row?.report), log = lines(row?.log);
      return {message: row?.result || null, log: log.length ? log : report, report};
    },
  };
  return {name: NAME, label: LABEL, caps: CAPS, page, runs, link: () => null, textLink: () => null};
}
