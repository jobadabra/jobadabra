// The words of a kit chip on a Jobs row, by which inputs the kit was drafted from (a pure move out of jobs-render.js, 2 Nov 2026: that file neared the 500-line limit; it has no imports, so it adds no import cycle).
const INPUT_NAMES = {cv: 'CV', profile: 'Profile', answers: 'standard answers'};
/** A kit's chip on a Jobs row: `state` is the kit's freshness ('current', 'earlier: <inputs>', else none) -> {label, title}; an unknown state returns the plain kit chip. Pure; the words only. */
export function kitLabel(state = '') {
  if (state === 'current') return {label: '📝 Kit', title: 'Current: drafted from your current CV, Profile and standard answers.'};
  if (state.startsWith('earlier')) {
    const changed = state.split(':')[1]?.split(',').map(name => INPUT_NAMES[name] || name).join(', ') || 'inputs';
    return {label: '📝 Kit · earlier inputs', title: `Drafted with earlier inputs: your ${changed} changed since. Redraft it from the ⋯ menu if you still want it.`};
  }
  return {label: '📝 Kit', title: 'Inputs unknown: drafted before Jobadabra recorded which CV, Profile and answers a kit came from.'};
}
