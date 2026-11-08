// The three store-failure notices (Chrome Web Store publish, Microsoft Store publish, the weekly Microsoft Store submission) in the shared shape of lib/notice.mjs.
//   storeNotice('msix-store', {TAG: 'v1.2.3', GITHUB_REPOSITORY: 'o/r', RUN: url}) -> {message, event, level?}
// Why (8 Nov 2026, owner: "let's improve the text formatting/style"): each workflow built "⚠️ … failed.\nRun: <url>\nOnce its cause is fixed: gh workflow run …" as a plain string; they now say the same things as title, verdict, the fix command and "Open the run".
// Job: report health
import {notice} from './notice.mjs';

const KINDS = {
  'chrome-store-publish': {event: 'chrome-store-failed', level: 'problem', title: 'Chrome Web Store publish failed', workflow: 'extension-store-publish.yml', tagged: true,
    verdict: tag => `${tag} is stable, but its Chrome Web Store publish failed`},
  'msix-store': {event: 'msstore-status', title: 'Microsoft Store publish failed', workflow: 'msix-store.yml', tagged: true,
    verdict: tag => `${tag} is stable, but its Microsoft Store publish failed`},
  'msix-store-weekly': {event: 'msstore-status', title: 'Microsoft Store submission did not start', workflow: 'msix-store-weekly.yml', tagged: false,
    verdict: () => "This week's Microsoft Store submission did not start"},
};
export const STORE_KINDS = Object.keys(KINDS);

/** Takes a kind (STORE_KINDS) and env {TAG?, RUN, GITHUB_REPOSITORY}; returns {message, event, level?} or null for an unknown kind. */
export function storeNotice(kind, env = process.env) {
  const one = KINDS[kind];
  if (!one || !env.GITHUB_REPOSITORY || (one.tagged && !env.TAG)) return null;   // a fix command with "undefined" in it is worse than no notice (the CLI says so in the log)
  const fix = `gh workflow run ${one.workflow} -R ${env.GITHUB_REPOSITORY} --ref main${one.tagged ? ` -f tag=${env.TAG}` : ''}`;
  return {event: one.event, ...(one.level ? {level: one.level} : {}),
    message: notice({title: one.title, verdict: one.verdict(env.TAG), bullets: [`${one.tagged ? 'Once its cause is fixed' : 'By hand'}: ${fix}`], run: env.RUN})};
}
