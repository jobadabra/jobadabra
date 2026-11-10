// The final browser action for a one-shot Full automation permit: recheck the same form and exact named control immediately before clicking.

/** Inspect, or ready the press inside the real page (its own world); only counts/digests leave it, and an ambiguous/invalid/changed page returns ready:false. 'press' tags the button for automaticPress. */
export async function submissionPage(action, {control = '', seal = ''} = {}) {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const fields = [...document.querySelectorAll('input, textarea, select, [role=combobox], [aria-required=true]')].filter(el => visible(el) && !el.disabled && el.type !== 'hidden');
  const requiredComplete = fields.length > 0 && fields.every(el => typeof el.checkValidity !== 'function' || el.checkValidity()) &&
    fields.filter(el => el.required || el.getAttribute?.('aria-required') === 'true').every(el => {
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked || el.type === 'radio' && fields.some(other => other.name === el.name && other.checked);
      if (el.type === 'file') return !!el.files?.length || el.hasAttribute?.('data-jobadabra-filled');
      return !!clean(el.value || el.getAttribute?.('aria-valuetext') || el.textContent);
    });
  const named = [...document.querySelectorAll('button, a, [role=button], input[type=submit], input[type=button]')].filter(el => visible(el) && clean(el.innerText || el.textContent || el.value || el.getAttribute?.('aria-label')).toLowerCase() === clean(control).toLowerCase());
  const button = named.length === 1 ? named[0] : null;
  // Why (2026-10-28, e2e proof of Background automation, measured): a Submit button below the fold has no element at its point, so every filled form read as not safe and went to the person;
  // in view first, then asked what is on top (the live view's own press does the same: desktop/ready-fill/live.mjs BUTTON_AT).
  button?.scrollIntoView?.({block: 'center', behavior: 'instant'});
  const rect = button?.getBoundingClientRect(), onTop = rect && document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const blocked = fields.some(el => el.type === 'password') || [...document.querySelectorAll('[data-jobadabra-draft]')].some(visible);
  const safe = !!button && !button.disabled && button.getAttribute?.('aria-disabled') !== 'true' && (onTop === button || button.contains(onTop)) && !blocked && !globalThis.__jobadabraStopped;
  const factsOnly = document.querySelectorAll('[data-jobadabra-grounding=unknown], [data-jobadabra-guess]').length === 0 && fields.every(el => {
    if (['submit', 'button', 'reset'].includes(el.type)) return true;
    // Why (2026-10-28, found by the Full automation e2e): upload.js writes the input's own mark as dataset.jobadabraInputFile and only the slot's as data-jobadabra-file (read-back.js reads both); reading the slot's attribute on the input matched no CV, so every attachment handed the application over.
    if (el.type === 'file') return !el.files?.length || (el.dataset?.jobadabraInputFile || el.closest?.('[data-jobadabra-file]')?.dataset?.jobadabraFile || el.getAttribute?.('data-jobadabra-file')) === el.files[0].name;
    if (['checkbox', 'radio'].includes(el.type) && !el.checked) return true;
    return !clean(el.value || el.getAttribute?.('aria-valuetext') || el.textContent) || el.getAttribute?.('data-jobadabra-grounding') === 'known';
  });
  // The values never leave the page: their digest detects edits/site replacement during the server round-trip.
  const bytes = new TextEncoder().encode(JSON.stringify([location?.href || '', fields.map(el => [el.id, el.name, el.type, el.value, !!el.checked, [...(el.files || [])].map(file => [file.name, file.size, file.lastModified])]), named.map(el => clean(el.innerText || el.textContent || el.value))]));
  const current = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (action !== 'press') {
    const headings = [...document.querySelectorAll('h1, h2')].map(el => clean(el.innerText)).filter(Boolean).slice(0, 6);
    return {requiredComplete, safe, factsOnly, seal: current, snapshot: {title: clean(document.title).slice(0, 180), headings, text: clean(document.body?.innerText).slice(0, 800), inputs: fields.length}};
  }
  if (!safe || !requiredComplete || !seal || seal !== current) return {ready: false};
  // Why (10 Nov 2026, owner: "Fix it now (Recommended)"): this check runs in the page's own world (it reads Stop there), where page/submit-press.js does not exist, so the floor was skipped and the click was a bare
  // one the panel took for the person's. The button is only tagged here, once; automaticPress below presses it in the extension's world, through the floor.
  document.querySelectorAll('[data-jobadabra-press]').forEach(el => el.removeAttribute('data-jobadabra-press'));   // a tag an earlier press left behind (Stop between the two steps) never makes two
  const token = crypto.randomUUID();
  button.setAttribute('data-jobadabra-press', token);
  return {ready: true, token};
}

/**
 * The press itself, run in the extension's isolated world where page/submit-press.js lives: the one button submissionPage tagged with `token`, through the press floor (a Withdraw, Delete or
 * Decline is never pressed) and marked as the extension's own, so the submit it fires is never the person's. Invariant: no floor, no tag, two tags, a moved or disabled button: not pressed.
 */
export function automaticPress(token) {
  const tagged = [...document.querySelectorAll('[data-jobadabra-press]')];
  const button = tagged.length === 1 && tagged[0].getAttribute('data-jobadabra-press') === token ? tagged[0] : null;
  tagged.forEach(el => el.removeAttribute('data-jobadabra-press'));   // one use
  if (!button || !button.isConnected || button.disabled) return {pressed: false, why: 'changed'};
  const automatic = globalThis.__jobadabraSubmitPress?.automatic;
  if (typeof automatic !== 'function') return {pressed: false, why: 'no_floor'};
  return automatic(button) ? {pressed: true} : {pressed: false, why: 'refused'};
}
