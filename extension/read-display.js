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
