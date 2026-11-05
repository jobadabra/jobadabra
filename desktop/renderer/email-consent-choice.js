// What the e-mail switch (CV step, Always on) means when the person moves on: on by default when the CV has an address; on at Continue = the consent, off = nothing sent.
// Why (5 Nov 2026, owner): "Let it be on by default"; the record keeps how it was given (default when it was left on, switched when the person turned it on), so the two stay apart.
// Pure (no DOM): pages/cv-email-consent.js and pages/hosted-email-ask.js draw it; guard test/unit/main/email-consent.test.js.

/** The switch's first position: on when there is an address to send and no answer yet. */
export const startsOn = view => !!view?.address && !view.consented;

/** At Continue (or the second Turn on press): -> {give: {given}} when the switch is on, {asked: true} when it is off. `touched`: the person moved the switch at least once. */
export const atContinue = ({on, touched}) => (on ? {give: {given: touched ? 'switched' : 'default'}} : {asked: true});

/** Settings → Notifications: the address a save sends. The typed one; else the CV's offered address only when e-mail is switched on (that switch is the consent); else none.
 * Why (5 Nov 2026, co review): the offered address as the field's value went out with every auto-save of another switch. */
export const addressToSave = ({typed = '', offered = '', by = []}) => String(typed).trim() || (by.includes('email') ? offered : '');
