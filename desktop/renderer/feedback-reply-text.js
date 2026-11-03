// The words on the card for the owner's answer to a feedback (drawn by pages/feedback-reply.js). Pure, so a test reads it without a window.
const SHORT = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'});

// The owner's line often names the version already ("Fixed in 0.9.12."): the arrival line then adds nothing.
const sameVersion = reply => { const version = String(reply.arrival || '').match(/\d+\.\d+\.\d+/)?.[0]; return !!version && String(reply.message || '').includes(version); };

/** One reply ({on, excerpt, kind, message, arrival}) -> {title, said, answer, tone}. */
export function cardText(reply) {
  const day = reply.on ? SHORT.format(new Date(`${reply.on}T12:00:00`)) : '';
  const fixed = reply.kind === 'fixed';
  return {tone: fixed ? 'good' : 'info', title: fixed ? 'Your feedback was fixed' : 'Your feedback was heard',
    said: `You wrote${day ? ` on ${day}` : ''}: "${reply.excerpt}"`, answer: [reply.message, sameVersion(reply) ? '' : reply.arrival].filter(Boolean).join(' ')};
}
