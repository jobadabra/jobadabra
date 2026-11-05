// The words on the card for the owner's answer to a feedback (drawn by pages/feedback-reply.js). Pure, so a test reads it without a window.
const SHORT = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'});

// The owner's line often names the version already ("Fixed in 0.9.12."): the arrival line then adds nothing.
const sameVersion = reply => { const version = String(reply.arrival || '').match(/\d+\.\d+\.\d+/)?.[0]; return !!version && String(reply.message || '').includes(version); };

/** The refs of fixed cards in `replies` that `seen` (a Set) does not hold yet; adds them to it. A fixed card can carry free applications, so the first sight of one is when the allowance chip must be read again. */
export function newFixedRefs(replies, seen) {
  const fresh = replies.filter(reply => reply.kind === 'fixed' && !seen.has(reply.ref)).map(reply => reply.ref);
  for (const ref of fresh) seen.add(ref);
  return fresh;
}

/** One reply ({on, excerpt, kind, message, arrival}) -> {title, said, answer, tone}. */
export function cardText(reply) {
  const day = reply.on ? SHORT.format(new Date(`${reply.on}T12:00:00`)) : '';
  const fixed = reply.kind === 'fixed';
  return {tone: fixed ? 'good' : 'info', title: fixed ? 'Your feedback was fixed' : 'Your feedback was heard',
    said: `You wrote${day ? ` on ${day}` : ''}: "${reply.excerpt}"`, answer: [reply.message, sameVersion(reply) ? '' : reply.arrival].filter(Boolean).join(' ')};
}
