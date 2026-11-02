// Grey lane lifecycle, shared by the page and weekly summary (owner, 30 Oct 2026: page + weekly + expiry).
// Only observed suite results count as nights; absent suite jobs never imply green. No D1 reads here.
// Guards: test/admin/e2e-{intel,page,weekly}.test.js.
const DAY = 86400000;
const dayOf = value => new Date(value).toISOString().slice(0, 10);
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && dayOf(value) === value;
const text = (value, max = 500) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
const suiteName = value => typeof value === 'string' && /^[\w.+-]{1,80}$/.test(value);
const nightly = row => ['nightly', 'scheduled'].includes(row.kind);
const rate = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const percent = value => `${Math.round(value * 100)}%`;
/** Public main's registry -> bounded lane data, or null for an unreadable registry; an empty suites object is a valid read. */
export function cleanLanes(value) {
  if (!value?.suites || typeof value.suites !== 'object' || Array.isArray(value.suites)) return null;
  return {suites: Object.fromEntries(Object.entries(value.suites).slice(0, 300).filter(([name, row]) => suiteName(name) && row && ['tolerant', 'suspended', 'retired'].includes(row.lane)).map(([name, row]) => [name, {
    lane: row.lane, input: text(row.input, 80), since: isDay(row.since) ? row.since : '', why: text(row.why), ...(row.returns ? {returns: text(row.returns)} : {})
  }]))};
}

const cleanBands = bands => Object.fromEntries(Object.entries(bands || {}).filter(([suite, metrics]) => suiteName(suite) && metrics && typeof metrics === 'object').map(([suite, metrics]) => [suite,
  Object.fromEntries(Object.entries(metrics).filter(([name, band]) => suiteName(name) && rate(band?.lower) && rate(band?.upper) && band.lower <= band.upper).map(([name, band]) => [name, {lower: band.lower, upper: band.upper}]))]));

/** Merge bounded observations into the existing snapshot, not another table. Failed/omitted registry reads retain the last successful read. */
export function greyData(previous = {}, data = {}, now = new Date()) {
  const from = dayOf(now.getTime() - 29 * DAY), to = dayOf(now), observations = new Map();
  for (const row of [...(previous.suiteNights || []), ...(Array.isArray(data.suiteNights) ? data.suiteNights.slice(0, 10000) : [])]) {
    if (!isDay(row?.day) || row.day < from || row.day > to || !nightly(row) || !suiteName(row.suite) || !['mac', 'windows'].includes(row.platform)
      || !Number.isInteger(row.runId) || row.runId <= 0 || typeof row.green !== 'boolean') continue;
    observations.set(`${row.runId}:${row.suite}:${row.platform}`, {runId: row.runId, day: row.day, kind: row.kind, suite: row.suite, platform: row.platform, green: row.green,
      ...(row.rates && typeof row.rates === 'object' ? {rates: Object.fromEntries(Object.entries(row.rates).filter(([name, value]) => suiteName(name) && rate(value)))} : {})});
  }
  const lanes = cleanLanes(data.lanes) || cleanLanes(previous.lanes);
  return {...(lanes ? {lanes} : {}),
    suiteNights: [...observations.values()].sort((a, b) => b.day.localeCompare(a.day) || b.runId - a.runId).slice(0, 10000),
    ...((data.mainBands || previous.mainBands) ? {mainBands: cleanBands(data.mainBands || previous.mainBands)} : {})};
}

function nightsOf(snapshot, suite, now) {
  const byDay = new Map(), to = dayOf(now), from = dayOf(now.getTime() - 29 * DAY);
  const add = row => {
    if (!isDay(row.day) || row.day < from || row.day > to) return;
    const night = byDay.get(row.day) || {day: row.day, green: null, rates: {}};
    if (row.green === false) night.green = false;
    else if (row.green === true && night.green === null) night.green = true;
    // Multiple platforms/runs on one night: show the lowest measured rate, rather than hiding a regression with another green.
    for (const [name, value] of Object.entries(row.rates || {})) if (rate(value)) night.rates[name] = Math.min(night.rates[name] ?? 1, value);
    byDay.set(row.day, night);
  };
  for (const row of snapshot.suiteNights || []) if (row.suite.replace(/-\d+of\d+$/, '') === suite && nightly(row)) add(row);
  // Old snapshots prove reds only; quality counts prove this suite ran even before suite outcomes were collected.
  for (const row of snapshot.fails || []) if (row.suite.replace(/-\d+of\d+$/, '') === suite && nightly(row)) add({...row, green: false});
  if (suite === 'quality') for (const row of snapshot.quality || []) if (row.pairs > 0) add({...row, green: null, rates: {agree: row.within8 / row.pairs}});
  const bands = snapshot.mainBands?.[suite] || {};
  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 7).map(night => ({...night,
    comparisons: Object.entries(night.rates).filter(([name]) => rate(bands[name]?.lower) && rate(bands[name]?.upper)).map(([metric, value]) => ({metric, rate: value, ...bands[metric], below: value < bands[metric].lower}))}));
}

/** One shared count for HTML and weekly text: UTC calendar age, seven observed nights and optional PR reasons/main bands. */
export function greySummary(snapshot, now = new Date()) {
  const lanes = cleanLanes(snapshot?.lanes), today = dayOf(now);
  const rows = Object.entries(lanes?.suites || {}).filter(([, row]) => ['tolerant', 'suspended'].includes(row.lane)).sort(([a], [b]) => a.localeCompare(b)).map(([suite, row]) => {
    const age = row.since ? Math.max(0, Math.round((Date.parse(today) - Date.parse(row.since)) / DAY)) : null;
    const nights = nightsOf(snapshot, suite, now), three = nights.slice(0, 3);
    const consecutive = three.length === 3 && three.every((night, i) => !i || Date.parse(three[i - 1].day) - Date.parse(night.day) === DAY);
    const below = consecutive && three[0].comparisons.some(({metric}) => three.every(night => night.comparisons.some(c => c.metric === metric && c.below)));
    return {suite, ...row, age, ageText: age === null ? 'age unknown' : `${age} day${age === 1 ? '' : 's'}`, returns: row.returns || 'no exit condition yet', nights, expired: age > 14, below};
  });
  return {read: Boolean(lanes), rows};
}

/** Shared wording for one observed night; rates appear only beside an available measured main band. */
export function greyNightText(night) {
  return `${night.day} ${night.green === null ? 'result not stored' : night.green ? 'green' : 'red'}${night.comparisons.map(c => `; ${c.metric} ${percent(c.rate)} vs main ${percent(c.lower)}–${percent(c.upper)}`).join('')}`;
}

// Why (31 Oct 2026, owner: "A: retire it, one-line note"; a suite past its budget is our bug, red): the 7-day suite x reason table lost its only writer, so the card says what grey means now.
export const GREY_NOTE = 'Since 31 Oct 2026 a suite is red or green: its one try is the verdict. Grey now means only a problem outside our code (runner, install, AI credit) and shows on the PR that met it.';

/** Weekly issue and Telegram use the page's computed rows and night wording, without another count. */
export function greyLines(grey) {
  return ['Grey', ...(!grey.read ? ['lane registry not read yet'] : !grey.rows.length ? ['No tolerant or suspended suites.'] : grey.rows.map(row =>
    `${row.suite} · ${row.lane} · ${row.input || 'input not named'} · ${row.why || 'reason not named'} · since ${row.since || 'unknown'} (${row.ageText}) · ${row.returns}\n${row.nights.map(greyNightText).join(' | ') || 'No suite nights stored yet.'}`))];
}
