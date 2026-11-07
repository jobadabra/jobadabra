// Typed read-display values keep canonical protocol/reason strings separate from localized authored frames.
/** Attach a trusted display identifier without changing the canonical words. */
export function readWords(raw,key,values={}) { return {raw,key,values}; }
/** Render only typed authored frames; unknown/external strings remain untouched. */
export function renderRead(message,t) {
  if (!message || typeof message !== 'object' || !message.key) return String(message ?? '');
  const values=Object.fromEntries(Object.entries(message.values || {}).map(([key,value])=>[key,value && typeof value==='object' && value.key ? renderRead(value,t) : value]));
  return t(message.key,values);
}
/** Record canonical stop reasons for existing decisions alongside optional display metadata. */
export function setReadReason(state,raw,key,values={}) { state.stopped=raw; state.stoppedDisplay=key ? readWords(raw,key,values) : null; }
/** Read a typed reason only while it still describes the unchanged canonical state. */
export function readStateReason(state,t) { return renderRead(state.stoppedDisplay?.raw===state.stopped ? state.stoppedDisplay : state.stopped,t); }

/** Render authored filter suffixes while leaving site labels/values and older raw snapshots unchanged. */
export function readFilters(state,t) { return state.filterDisplay?.length===state.filters?.length ? state.filterDisplay.map(item=>renderRead(item,t)).join(', ') : (state.filters || []).join(', '); }

/** Keep extension-only display metadata out of the existing desktop protocol payload. */
export function readProtocolState(state) { return Object.fromEntries(Object.entries(state).filter(([key])=>!['stoppedDisplay','filterDisplay','noteDisplay'].includes(key))); }

/** Build the existing login/check reasons without placing display branches in the reading controller. */
export function readBlockedReason(login) { return readWords(login ? 'the site asks you to sign in: do it, then click again' : 'the site shows a check: answer it yourself, then click again',login ? 'read.login' : 'read.check'); }
/** Build the authored AI wrapper while retaining its unknown reason as raw text. */
export function readAIWay(why) { return readWords(`AI: ${String(why || 'trying a way to the jobs').slice(0,120)}`,'read.ai',{reason:why ? String(why).slice(0,120) : readWords('trying a way to the jobs','read.tryJobs')}); }
/** Build the filter summary with canonical diagnostic wording and separate localized suffixes. */
export function readFilterSummary(state,t) {
  if(state.filters.length) return readWords(`filters set: ${state.filters.join(', ').slice(0,100)}`,'read.filtersSet',{filters:readFilters(state,t).slice(0,100)});
  return readWords(`no filters set${state.note ? ` (${state.note})` : ''}: reading the page as it is`,'read.noFilters',{note:state.note ? ` (${renderRead(state.noteDisplay || state.note,t)})` : ''});
}
/** Build a no-cards explanation without translating the cookie button or changing its diagnostic text. */
export function readNoCards({knownList,seen,asked,banner,aiDiagnostic}) {
  if(knownList) return readWords('its job list shows no jobs here (filtered to your places, it may have none)','read.knownEmpty');
  const count=seen.cards?.length || 0;
  const raw=`no job cards on this page (${count} repeated items seen${asked ? aiDiagnostic : ''}${banner ? `; a cookie banner was still open, closed with "${banner.slice(0,30)}"` : ''})`;
  return readWords(raw,'read.noCards',{count,ai:asked ? readWords('','read.noCardsAI') : '',cookie:banner ? readWords('','read.noCardsCookie',{button:banner.slice(0,30)}) : ''});
}
/** Resolve the existing empty-list reason while keeping its canonical filter matching unchanged. */
export function readEmptyReason(state,knownList,t) {
  if(knownList) return readWords('its job list has no jobs here today (filtered to your places)','read.empty');
  if(state.filters.some(filter=>!/not filtered/.test(filter))) return readWords(`no jobs on this list with your place filter (${state.filters.join(', ').slice(0,80)})`,'read.filteredEmpty',{filters:readFilters(state,t).slice(0,80)});
  return readWords('no job list found on this page: try Read with Claude, or Open it myself','read.noList');
}
/** Keep the existing permission reason mapping and preserve arbitrary failures as raw values. */
export function readFailureReason(error) {
  if(/Cannot access|permission/i.test(error.message)) return readWords('the next page is on another site, or access was not given','read.access');
  return readWords(error.message || 'stopped',error.displayKey || (!error.message ? 'read.stoppedShort' : null),error.displayValues);
}
/** Apply a built display reason through the canonical-state preserving setter. */
export function applyReadReason(state,message) { setReadReason(state,message.raw,message.key,message.values); }
