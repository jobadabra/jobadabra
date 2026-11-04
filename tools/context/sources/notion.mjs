// Context fetcher: one Notion page (title and its top-level text blocks) by two GET calls; ref "page id=<32 hex digits, dashes allowed>".
import {LIMITS, finish, guarded, json, token, unavailable} from '../lib.mjs';

export const name = 'notion';
const API = 'https://api.notion.com/v1';
const TEXT_BLOCKS = {paragraph: '', heading_1: '# ', heading_2: '## ', heading_3: '### ', bulleted_list_item: '- ', numbered_list_item: '1. ', to_do: '- [ ] ', quote: '> ', callout: '> ', toggle: '- ', code: ''};

/** Why (3 Nov 2026, harness map spec): GET only; the token is a Notion internal integration with the single capability "Read content", from env NOTION_READ_TOKEN. It sees only the pages the owner connected to it, so a page it cannot see is "unavailable", never a guess. Only the page's top-level text blocks are read (no child pages, files, comments or users). */
export async function fetch(ref, {limits = LIMITS, env = {}, fetchImpl = globalThis.fetch} = {}) {
  return guarded(async () => {
    // Why (3 Nov 2026, review of 7/8): the id is 32 hex digits or the 8-4-4-4-12 form, nothing else; dashes anywhere are not normalised away.
    const m = /^page\s+id=([0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(String(ref || '').trim());
    if (!m) return unavailable('a Notion ref is "page id=<32 hex digits>"');
    const id = m[1].replace(/-/g, '').toLowerCase();
    const init = {method: 'GET', headers: {authorization: `Bearer ${token(env, 'NOTION_READ_TOKEN')}`, 'notion-version': '2022-06-28'}};
    // Why (3 Nov 2026, review of 7/8): Notion answers 404 for a page that exists but was never connected to the integration; say so, or a wrong id and an unshared page look the same.
    const [page, blocks] = await Promise.all([
      json(fetchImpl, `${API}/pages/${id}`, init, limits.timeoutMs),
      json(fetchImpl, `${API}/blocks/${id}/children?page_size=100`, init, limits.timeoutMs),
    ]).catch(error => { throw /HTTP (403|404)\b/.test(String(error?.message)) ? new Error('page not found, or not shared with the integration (HTTP 404/403)') : error; });
    if (!Array.isArray(blocks?.results)) return unavailable('Notion answered in an unexpected shape');
    if (page?.archived || page?.in_trash) return unavailable('the page is in the trash');
    const plain = rich => (Array.isArray(rich) ? rich : []).map(t => String(t?.plain_text ?? '')).join('');
    const title = plain(Object.values(page?.properties || {}).find(p => p?.type === 'title')?.title) || '(untitled)';
    const lines = [], skipped = new Set();
    for (const b of blocks.results) {
      const type = b?.type, prefix = typeof type === 'string' ? TEXT_BLOCKS[type] : undefined;
      if (prefix === undefined) { skipped.add(String(type).replace(/[^\w]/g, '').slice(0, 30) || 'unknown'); continue; }
      const text = plain(b[type]?.rich_text);
      if (!text) continue;
      if (type === 'to_do') lines.push(`- [${b.to_do.checked ? 'x' : ' '}] ${text}`);
      else if (type === 'code') lines.push(`\`\`\`${/^[\w+#-]{1,20}$/.test(String(b.code?.language)) ? b.code.language : ''}\n${text}\n\`\`\``);
      else lines.push(`${prefix}${text}`);
    }
    return finish(`# Notion: ${title}`, [
      lines.join('\n') || '(no text blocks)',
      skipped.size ? `\nNot read: blocks of type ${[...skipped].sort().join(', ')} (only text blocks are read, and not their children).` : '',
      blocks.has_more ? '\nCut: the page has more than 100 top-level blocks; the rest is not read.' : '',
    ].join('\n'), limits);
  });
}
