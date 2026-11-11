// The steps the app starts as engine processes in one Find jobs run: the words of their "Time is up" lines and whether their time-up makes the search Partial.
// Mirror of the rows of src/press/stages.py that carry an `app` key (tests/unit/press/test_stages.py pins the keys); the app's own seconds stay in search-steps.js.
export const APP_STEPS = {
  search: {what: 'the search', counts: true},
  scout: {what: 'searching wider', counts: false},   // the employer finder is an add-on: its own stop does not make the search Partial
};
