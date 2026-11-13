// Draw the form panel's review card, progress pill and actions without owning application state.
(() => {
  const t = (...args) => window.__jobadabraPanelI18n.t(...args);
  // Create drawing helpers bound to this panel's root and existing field actions.
  window.__jobadabraPanelView = ({$, jp, night, MARK_WORDS, KNOCKOUT, AGREE, flash, written, stoppedCard, send}) => {
    // The form judge says a later step follows this one (extension/form-ready.js marks it): a filled step is ready to continue, never to submit. No word from the judge: the count's wording.
    // Why (13 Nov 2026, owner, LinkedIn Easy Apply 4a: "Two PRs (Recommended)", the panel names the step, not "Ready to submit", before the step whose button sends).
    const middleStep = () => document.documentElement.getAttribute('data-jobadabra-form-step') === 'middle';

    // Return the ready wording for the page's current account or person-needed state.
    function readyLabel(needsYou, account) {
      return needsYou ? t('panel.needsYou', 'Needs you: {detail}', {detail:needsYou === '1' ? t('panel.seePage', 'see what the page asks') : needsYou}) : account ? (document.documentElement.getAttribute('data-jobadabra-account-step') === 'sign_up' ? t("panel.createReady", 'Ready to create the account') : document.documentElement.getAttribute('data-jobadabra-account-step') === 'sign_in' ? t("panel.signInReady", 'Ready to sign in') : t("panel.continueReady", 'Ready to continue')) : middleStep() ? t("panel.continueReady", 'Ready to continue') : t("panel.submitReady", 'Ready to submit');   // the AI's veto (account-step.js, form-ready.js): a consent link or a widget the count cannot see
    }

    // Return the review instruction for a ready form or account step.
    function reviewWords(account) {
      return (account ? (document.documentElement.getAttribute('data-jobadabra-account-step') === 'sign_up' ? t("panel.reviewCreate", 'Review, then create it') : document.documentElement.getAttribute('data-jobadabra-account-step') === 'sign_in' ? t("panel.reviewSignIn", 'Review, then sign in') : t("panel.reviewContinue", 'Review, then continue')) : middleStep() ? t("panel.reviewContinue", 'Review, then continue') : t("panel.reviewSubmit", 'Review, then submit'));
    }

    // Return the pill's primary line, keeping moved and page-mark states ahead of counts.
    function pillTitle({moved, pageMark, ready, needsYou, readyWords, letterMissing, total, left}) {
      return moved ? t("panel.moved", 'Continues in another tab') : pageMark ? (window.__jobadabraPanelI18n.step(MARK_WORDS[pageMark]) || t("panel.redirect", 'Apply button detected. Redirecting…')) : ready || needsYou ? readyWords : letterMissing ? t("panel.letterSetup", 'Cover letter needs setup') : total ? t('panel.left', '{count} left', {count:left}) : 'Jobadabra';
    }

    // Return the pill's company, restored-fill note or review instruction.
    function pillSubtitle({pageMark, moved, job, session, ready, account}) {
      return night() && !pageMark && !moved ? t('panel.night', 'Last night’s fill is back') + ((job?.company || session?.company) ? ` · ${job?.company || session?.company}` : '') : (job?.company || session?.company) ? (job?.company || session?.company) : ready ? reviewWords(account) : t("panel.required", 'required fields');
    }

    // Draw the collapsed progress state and return the ready wording used in the open card.
    function drawPill(state) {
      const {moved, pageMark, ready, needsYou, total, left, done, account} = state;
      jp.classList.toggle('ready', ready && !needsYou);
      $('.ring').style.setProperty('--done', done);
      $('.ring span').textContent = moved ? '↗' : pageMark ? '…' : ready && !needsYou ? '✓' : total ? window.__jobadabraPanelI18n.number(left) : '–';
      const readyWords = readyLabel(needsYou, account);
      // A tab the application has moved on from (the app bound another tab of it) never says Ready or counts: only the tab with the form does.
      $('.pill b').textContent = pillTitle({...state, readyWords});
      $('.pill small').textContent = pillSubtitle(state);
      return readyWords;
    }

    // Draw the job identity and the person-needed card before the AI session line.
    function renderHeader({pageMark, needsYou, job, session, moved, movedTab, filling}) {
      // job + Claude
      const title = job?.title || session?.title, company = job?.company || session?.company;
      $('.job').hidden = !title;
      $('.job-title').textContent = title || '';
      $('.job-meta').replaceChildren(...[company && Object.assign(document.createElement('span'), {textContent: company}),
        Object.assign(document.createElement('span'), {className: `tag ${/applied/i.test(job?.stage || '') ? 'good' : ''}`, textContent: job?.stage || t("panel.notSubmitted", 'Not submitted')})].filter(Boolean));
      $('.go-there').hidden = !(moved && Number.isInteger(movedTab));
      const verify = $('.verify');
      verify.hidden = !needsYou || moved || filling;
      if (!verify.hidden) { stoppedCard(false); $('.verify .v-title').textContent = needsYou === '1' ? t("panel.yourAction", 'Your action is needed') : needsYou; }   // the AI's own words for what the page waits on
      renderClaude({pageMark, moved, session});
      return {title, company};
    }

    // Draw the existing AI session status for this page.
    function renderClaude({pageMark, moved, session}) {
      const claude = claudeWords({pageMark, moved, session});
      $('.claude').hidden = !claude;
      $('.claude span').textContent = claude;
    }

    // Return the AI session line after the moved-page and extension-only session checks.
    function claudeWords({pageMark, moved, session}) {
      return pageMark ? '' : moved ? t("panel.movedSentence", 'This application continues in another tab.')   // an older tab of the session: it no longer reports
        : session?.kind === 'form' ? ''   // the Apply button's session: the extension fills it, there is no Claude to name
        : liveClaudeWords(session);
    }

    // Return the running, input, done or empty wording for an AI session.
    function liveClaudeWords(session) {
      return session?.live && session.status === 'running' ? t('panel.aiFilling', 'AI is filling this form · {note}', {note:session.note || t('panel.working', 'working')})
        : session?.live && session.status === 'input' ? t("panel.aiWaiting", 'AI is waiting for you in Jobadabra.')
        : session?.status === 'done' ? t("panel.aiDone", 'AI filled this form. Review it, then submit it yourself.') : '';
    }

    // Return whether a remaining field is flagged as a knockout question.
    const knockout = field => KNOCKOUT.test(field.label) || field.category === 'knockout';

    // Return the remaining fields in their original stable knockout-first order.
    const rank = shown => [...shown].sort((a, b) => knockout(b) - knockout(a));   // or the AI, any language

    // Build one remaining-field button with its original draft-review child and click targets.
    function remainingRow(field) {
      const row = Object.assign(document.createElement('button'), {className: 'item'});
      const label = window.__jobadabraPanelForm.isSyntheticCaptcha(field) ? t('panel.syntheticCaptcha', 'Confirm you are not a robot') : field.label;   // words-ok: bundled display projection, never page classification
      row.append(Object.assign(document.createElement('i'), {textContent: knockout(field) ? '⛔' : AGREE.test(field.label) || field.category === 'legal' ? '⚖️' : field.draft ? '✍️' : '○'}),
        Object.assign(document.createElement('span'), {textContent: label.slice(0, 120) || t("panel.requiredField", 'A required field')}),
        ...(field.draft ? [Object.assign(document.createElement('span'), {className: 'tag warn', textContent: field.draft === 'outline' ? t("panel.outlineComplete", 'Outline: complete it') : t("panel.drafted", 'Drafted for you: review')}),   // typed by us, never counted as done until read (owner, 16 Oct 2026)
          Object.assign(document.createElement('span'), {className: 'tag', textContent: t("panel.reviewAnswer", 'Review my answer'), onclick: event => { event.stopPropagation(); flash(field.el); written.review(field); }})] : []),
        Object.assign(document.createElement('span'), {className: 'go', textContent: '›'}));
      row.onclick = () => flash(field.el);
      return row;
    }

    // Replace the remaining-field rows, preserving the thirty-row display limit.
    function drawRows(ranked) {
      $('.list').replaceChildren(...ranked.slice(0, 30).map(remainingRow));
    }

    // Return the open card's heading for a moved, working, marked, ready or counted page.
    function progressTitle({pageMark, ready, readyWords, total, left, moved, markStepWords}, {title, company}) {
      return moved ? t("panel.moved", 'Continues in another tab') : markStepWords ? (title || company || 'Jobadabra') : pageMark ? (window.__jobadabraPanelI18n.step(MARK_WORDS[pageMark]) || t("panel.redirect", 'Apply button detected. Redirecting…')) : ready ? readyWords : total ? t('panel.of', '{done} of {total}', {done:total-left,total}) : t("panel.noRequired", 'No required fields');
    }

    // Draw the open card's progress line and completion bar.
    function renderProgress({pageMark, ready, readyWords, done, moved, markStepWords, state: {total, left}}, heading) {
      // progress
      $('.progress-line b').textContent = progressTitle({pageMark, ready, readyWords, total, left, moved, markStepWords}, heading);
      $('.progress-line span').textContent = moved || pageMark ? '' : ready ? t("panel.allFilled", 'every required field is filled') : total ? t("panel.requiredFilled", 'required fields filled') : '';
      $('.bar i').style.width = `${moved || pageMark ? 0 : ready ? 100 : done}%`;
    }

    // Draw whether the fill control is available for this form state.
    function renderFill({ready, pageMark, session, connection, cv, moved, filling, state: {account}}) {
      // fill (not while Claude is filling this form: it would fight it)
      const claudeFilling = session?.live && session.status === 'running';
      // A sign-in or sign-up page (a password box) is not the application: no CV goes there, so no CV line (owner, 8 Oct 2026).
      const canTailor = !!session && !!connection?.connected && !!connection.app && !!cv && !account && !pageMark;
      $('.fill-box').hidden = moved || claudeFilling || (ready && !filling);  // nothing left to fill
      $('.fill').disabled = filling;
      return canTailor;
    }

    // Draw the ranked remaining fields and return the knockout count for tip selection.
    function renderRemaining({pageMark, moved, shown, state: {left, busy, over}}) {
      // What's left for you, once the filling is over: before and during it, nearly every field is still to be filled
      // by the extension or Claude, not by you (the ring and the bar show the progress meanwhile).
      $('.left h4').textContent = t('panel.remaining',left === 1 ? 'Remaining field' : 'Remaining fields',{count:left});
      $('.left').hidden = moved || !!pageMark || !left || busy || !over;
      const ranked = rank(shown), knockouts = ranked.filter(knockout).length;
      $('.knock').hidden = !knockouts;
      $('.knock').textContent = t("panel.knockout", 'Some of these can trigger automatic rejection if the employer has set a knockout rule (work permit, sponsorship, location, office days); others are only flagged for review. Answer them truthfully: they can decide more than the CV.');
      drawRows(ranked);
      return knockouts;
    }

    // Return the existing connection tooltip prefix without the extension build suffix.
    function connectionWords(connection, session) {
      return connection?.connected ? (connection.app ? (session ? t("panel.inSync", 'In sync with Jobadabra') : t("panel.connected", 'Connected to Jobadabra')) : t("panel.worker", 'Connected to your Worker')) : (connection?.whyKey ? t(connection.whyKey,connection.why,connection.whyValues) : connection?.why || t("panel.notConnectedHint", 'Not connected: the form still fills from your settings'));
    }

    // Draw the shared connection footer and its reload action in every open state.
    function renderFooter({connection, session, build}) {
      // The footer, one component for every state (owner, 16 Oct 2026): the connection on the left (a dot and its word; the build stays in the line, it is in every screenshot), Report on the right.
      const foot = $('.foot'), stateLine = $('.foot .state');
      foot.classList.toggle('on', !!connection?.connected);
      foot.classList.toggle('off', !!connection && !connection.connected);
      const word = connection?.connected ? t("panel.connectedShort", 'Connected') : connection ? t("panel.notConnected", 'Not connected') : t("panel.checking", 'Checking the connection…');   // the reason is in the tooltip
      const version = chrome.runtime.getManifest().version;
      stateLine.textContent = `${word} · v${version}${build?.label ? ` · ${build.label}` : ''}`;
      foot.title = t('panel.extensionVersion','{connection} · Jobadabra extension v{version}{build}',{connection:connectionWords(connection,session),version,build:build?.label ? ` (${build.label})` : ''});
      if (build && build.behind !== 0 && build.behind !== undefined) {
        const reload = Object.assign(document.createElement('button'), {className: 'reload', textContent: build.reloadLabel || t("panel.reload", 'Reload the extension to get the latest fixes')});
        reload.addEventListener('click', () => { reload.disabled = true; reload.textContent = t("panel.reloading", 'Reloading…'); send({type: 'panelReload'}).catch(() => {}); });
        stateLine.append(reload);
      }
    }

    // Draw the app action and pass the unchanged stuck-page facts to its existing offer.
    function renderActions({session, connection, claudeAsk, needsYou, handed, stopped, needs}) {
      // actions + connection
      $('.open-app').hidden = !session;
      window.__jobadabraClaude?.render({on: !!connection?.connected && !!connection.app && !!claudeAsk.help, stuck: !needsYou && handed && !stopped, always: !!claudeAsk.always, auto: !!claudeAsk.auto, consent: !!claudeAsk.consent, takeover: claudeAsk.takeover !== false, report: !!window.__jobadabraReportOn, needs});   // offered, never automatic unless "always" (panel-claude.js)
    }

    // Resolve app-owned evidence labels at draw time; bundled tip bodies resolve separately by stable ID.
    function renderTipLabel(evidence) {
      if (evidence === null) return;
      const labels = {research:['panel.tipFact','Fact'],recruiters:['panel.tipRecruiters','Recruiters say'],advice:['panel.tip','Tip'],'to-test':['panel.tipTry','Worth trying']};
      const [key,fallback] = labels[evidence] || labels.advice;
      $('.tip-chip').textContent = t(key,fallback);
    }

    return {renderTipLabel, drawPill, renderHeader, renderProgress, renderFill, renderRemaining, renderActions, renderFooter};
  };
})();
