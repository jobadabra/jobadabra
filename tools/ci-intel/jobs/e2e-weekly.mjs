#!/usr/bin/env node
// Sends the weekly e2e summary (tools/ci-intel/lib/e2e-weekly.mjs) as one Telegram message: the owner's Notifications switchboard first (event e2e-weekly), the CI alerts bot only when it cannot deliver (e2e-weekly.yml, Mondays); the numbers live on the page it links.
//   node tools/ci-intel/jobs/e2e-weekly.mjs [--dry-run]      --dry-run prints the message instead of sending it
// Reads the snapshot /admin/testing/e2e draws (GET /e2e/data?snapshot=1, SELFHEAL_PUBLISH_KEY), so the page and Telegram show the same numbers.
// Why (5 Nov 2026, owner: "turn this pinned issues into dashboards/tabs/pages in Admin … and will remove them from GH issue list"): the weekly issue (E2E root causes · week) repeated
// the page's tables and nothing read it back, so it is not opened any more; before that it was filed here (2 Nov 2026) and by tools/e2e_weekly.py (its own classifier).
import {pathToFileURL} from 'node:url';
import {telegramText, weekly} from '../lib/e2e-weekly.mjs';
import {tellOwner as tellOwnerAbout} from '../lib/ai-refusal.mjs';

const tellOwner = (message, options) => tellOwnerAbout(message, {...options, event: 'e2e-weekly'});   // the registry alert the owner switches in Admin → Notifications (jobadabra-web shared/notify-registry.js)

const base = process.env.E2E_INTEL_URL || 'https://www.jobpilotto.top/e2e/data', key = process.env.SELFHEAL_PUBLISH_KEY;

async function main() {
  if (!key) throw new Error('SELFHEAL_PUBLISH_KEY is not set: the snapshot cannot be read');
  const response = await fetch(`${base}?snapshot=1`, {headers: {Authorization: `Bearer ${key}`}});
  if (!response.ok) throw new Error(`the site answered ${response.status} for the e2e snapshot`);
  const s = weekly(await response.json());
  if (process.argv.includes('--dry-run')) { console.log(telegramText(s).text); return; }
  await deliver(s);
}

/**
 * Sends the Telegram message that links the Admin page. Throws when it did not go out, so the run is red: tellOwner never throws
 * (a missing token, a non-2xx answer, no network → {skipped}). Why (#211, Gitar): a green run with no Monday message went unseen.
 */
export async function deliver(s, {tell = tellOwner} = {}) {
  const told = await tell(telegramText(s));
  console.log(`Telegram: ${JSON.stringify(told)}`);
  if (!told?.sent) throw new Error(`the weekly message did not reach Telegram (${told?.skipped || 'no answer'})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(`::error::${error.message}`); process.exit(1); });
