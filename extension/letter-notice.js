// The cover-letter panel copy by status, shared by rendering and unit tests.
(() => {
  const t = (...args) => window.__jobadabraPanelI18n.t(...args);
  const PROFILE = () => t('letter.profile', 'Profile');
  const statusCopy = () => ({
    missing: {title: t("letter.needed", 'Cover letter needed'), reason: t("letter.createReason", 'Create and review a cover letter before applying.'), action: t('letter.create', 'Create in {profile}', {profile:PROFILE()})},
    draft: {title: t("letter.review", 'Cover letter needs review'), reason: t("letter.reviewReason", 'Review and approve your draft before applying.'), action: t('letter.reviewAction', 'Review in {profile}', {profile:PROFILE()})},
    invalid: {title: t("letter.attention", 'Cover letter needs attention'), action: t('letter.complete', 'Complete in {profile}', {profile:PROFILE()})},
  });
  const deliveryFailure = () => ({
    title: t("letter.lost", 'Cover letter wasn’t kept'),
    reason: t("letter.paste", 'Paste or attach it manually, then check again.'),
    action: t("panel.showForm", 'Show on form'),
  });

  // Return the title, reason, and next action for one live cover-letter status.
  window.__jobadabraCoverLetterNotice = (status, rejected = false) => {
    if (rejected) return {...deliveryFailure()};
    const copy = statusCopy()[status?.state] || {
      title: t("letter.attention", 'Cover letter needs attention'),
      action: t('letter.open', 'Open {profile}', {profile:PROFILE()}),
    };
    return {title: copy.title, reason: copy.reason || status?.reason || t("letter.check", 'Check your cover letter in Profile before applying.'), action: copy.action};
  };
})();
