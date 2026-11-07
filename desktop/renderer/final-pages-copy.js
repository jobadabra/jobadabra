// Display-only keyed readers for known primary-page metadata; unknown values retain their original content.
import {finalText} from '../i18n/final-pages.js';
export {finalText};
const partKeys = new Set(['summary','strengths','education','roles','gaps','surveys']);
/** Name a known Profile section for display; user headings and stored document headings remain original. */
export const partTitle = (key, fallback) => partKeys.has(key) ? finalText(`part_${key}`) : fallback;
const fieldKeys = new Set(['countries','home','cities','mode','relocation','permit','nationality','languages','roles','employment','workload','seniority','target','minimum']);
/** Clone only authored display properties of a known preference field; matching and stored option values remain canonical. */
export function preferenceField(field) {
  if (!fieldKeys.has(field.key)) return field;
  return {...field, label: finalText(`field_${field.key}`),
    ...(field.add ? {add: finalText(`add_${field.key}`)} : {}),
    ...(field.placeholder ? {placeholder: finalText(`placeholder_${field.key}`)} : {})};
}
/** Project a known side's headings and add action without changing the source configuration. */
export const preferenceSide = (key, value) => ['must','rank'].includes(key)
  ? {...value, ...Object.fromEntries(['title','lead','add'].map(field => [field, finalText(`side_${key}_${field}`)]))} : value;
const options = {'On-site':'onsite',Hybrid:'hybrid',Remote:'remote',Yes:'yes',No:'no','Within my country':'country',
  'Permanent only':'permanent','Permanent or contract':'both','Contract only':'contract',Junior:'junior','Mid-level':'mid',Senior:'senior','Staff or higher':'staff'};
/** Translate only the app's fixed option labels; option values and custom user choices are untouched. */
export const preferenceOption = value => Object.hasOwn(options,value) ? finalText(`option_${options[value]}`) : value;
const headings = {"Review": "heading_0", "Strengths": "heading_1", "Weak spots": "heading_2", "Signals from them": "heading_3", "Could count against you": "heading_4", "Practise before the next round": "heading_5", "Priorities from recurring evidence": "heading_6", "Numbers": "heading_7", "Daily insights this week": "heading_8", "Strong": "heading_9", "Weak answers": "heading_10", "Practise": "heading_11", "Changes": "heading_12"};
/** Display a recognized authored report section while preserving unknown headings and canonical parser output. */
export const reportHeading = title => Object.hasOwn(headings,title) ? finalText(headings[title]) : title;
/** Display known interview section labels and their structured count suffix, leaving all other AI/user headings raw. */
export function reviewHeading(title) {
  const count = /^Weak answers \((\d+) of (\d+)\)$/.exec(title);
  return count ? finalText('weakCount', {label: reportHeading('Weak answers'), weak: count[1], total: count[2]}) : reportHeading(title);
}

const paletteGroups = new Set(["Settings", "Go to", "Sessions", "Actions", "Profile", "Strategy", "Reports", "Focus", "Jobs", "Interviews", "Employers", "Calendar", "Notion"]); // about Notion: this fixed group names the Notion service itself
/** Name only fixed palette groups for display; canonical group identity and unknown labels stay unchanged. */
export const paletteGroup = group => paletteGroups.has(group) ? finalText(`group_${group.replaceAll(' ','_')}`) : group;
