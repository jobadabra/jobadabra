// Localized survey presentation stays separate from canonical saved questions and choices.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';

const KEYS = {
  Yes: 'helperMore.answerYes', No: 'helperMore.answerNo',
  'Age bracket': 'helperRest.age',
  'Gender identity': 'helperRest.gender',
  'Identifies as transgender': 'helperRest.transgender',
  'Sexual orientation': 'helperRest.orientation',
  'Disability status': 'helperRest.disability',
  'Race / ethnicity': 'helperRest.ethnicity',
  'Hispanic or Latino': 'helperRest.hispanic',
  'Veteran status': 'helperRest.veteran',
  'Under 20': 'helperRest.under20',
  '60 or over': 'helperRest.sixtyOver',
  'Man': 'helperRest.man',
  'Woman': 'helperRest.woman',
  'Non-binary': 'helperRest.nonbinary',
  'Heterosexual / straight': 'helperRest.straight',
  'Gay or lesbian': 'helperRest.gay',
  'Bisexual': 'helperRest.bisexual',
  'Another orientation': 'helperRest.anotherOrientation',
  'White': 'helperRest.white',
  'Black or African American': 'helperRest.black',
  'Asian': 'helperRest.asian',
  'Middle Eastern or North African': 'helperRest.middleEast',
  'Native or Indigenous': 'helperRest.native',
  'Mixed or multiple': 'helperRest.mixed',
  'Another group': 'helperRest.anotherGroup',
  'Decline to self-identify': 'helperRest.decline',
};

/** Translate only known survey labels and choices; unknown answers stay exactly as written. */
export const surveyText = value => KEYS[value] ? t(KEYS[value]) : value;
