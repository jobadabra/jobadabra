// Register helper catalogs before importing renderer modules with module-level display strings.
import {registerMessages} from './index.js';
import {messages as en} from './catalogs/helpers/en.js';
import {messages as de} from './catalogs/helpers/de.js';
import {messages as fr} from './catalogs/helpers/fr.js';
import {messages as it} from './catalogs/helpers/it.js';
import {messages as es} from './catalogs/helpers/es.js';
import {messages as ro} from './catalogs/helpers/ro.js';
import {messages as ru} from './catalogs/helpers/ru.js';

for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'helpers', messages);

// State catalogs stay separate to keep each bundled catalog below 500 lines.
import {messages as enState} from './catalogs/helpers/en-state.js';
import {messages as deState} from './catalogs/helpers/de-state.js';
import {messages as frState} from './catalogs/helpers/fr-state.js';
import {messages as itState} from './catalogs/helpers/it-state.js';
import {messages as esState} from './catalogs/helpers/es-state.js';
import {messages as roState} from './catalogs/helpers/ro-state.js';
import {messages as ruState} from './catalogs/helpers/ru-state.js';
for (const [locale, messages] of Object.entries({en: enState, de: deState, fr: frState, it: itState, es: esState, ro: roState, ru: ruState})) registerMessages(locale, 'helperState', messages);

// Other helper copy is registered separately from state and plural messages.
import {messages as enMore} from './catalogs/helpers/en-more.js';
import {messages as deMore} from './catalogs/helpers/de-more.js';
import {messages as frMore} from './catalogs/helpers/fr-more.js';
import {messages as itMore} from './catalogs/helpers/it-more.js';
import {messages as esMore} from './catalogs/helpers/es-more.js';
import {messages as roMore} from './catalogs/helpers/ro-more.js';
import {messages as ruMore} from './catalogs/helpers/ru-more.js';
for (const [locale, messages] of Object.entries({en: enMore, de: deMore, fr: frMore, it: itMore, es: esMore, ro: roMore, ru: ruMore})) registerMessages(locale, 'helperMore', messages);

// Flow and connection helper presentations keep canonical data values separate.
import {messages as enFlow} from './catalogs/helpers/en-flow.js';
import {messages as deFlow} from './catalogs/helpers/de-flow.js';
import {messages as frFlow} from './catalogs/helpers/fr-flow.js';
import {messages as itFlow} from './catalogs/helpers/it-flow.js';
import {messages as esFlow} from './catalogs/helpers/es-flow.js';
import {messages as roFlow} from './catalogs/helpers/ro-flow.js';
import {messages as ruFlow} from './catalogs/helpers/ru-flow.js';
for (const [locale, messages] of Object.entries({en: enFlow, de: deFlow, fr: frFlow, it: itFlow, es: esFlow, ro: roFlow, ru: ruFlow})) registerMessages(locale, 'helperFlow', messages);

// Profile review helpers have their own bounded display catalogs.
import {messages as enProfile} from './catalogs/helpers/en-profile.js';
import {messages as deProfile} from './catalogs/helpers/de-profile.js';
import {messages as frProfile} from './catalogs/helpers/fr-profile.js';
import {messages as itProfile} from './catalogs/helpers/it-profile.js';
import {messages as esProfile} from './catalogs/helpers/es-profile.js';
import {messages as roProfile} from './catalogs/helpers/ro-profile.js';
import {messages as ruProfile} from './catalogs/helpers/ru-profile.js';
for (const [locale, messages] of Object.entries({en: enProfile, de: deProfile, fr: frProfile, it: itProfile, es: esProfile, ro: roProfile, ru: ruProfile})) registerMessages(locale, 'helperProfile', messages);

// Remaining helper copy uses bounded catalogs.
import {messages as enRest} from './catalogs/helpers/en-rest.js';
import {messages as deRest} from './catalogs/helpers/de-rest.js';
import {messages as frRest} from './catalogs/helpers/fr-rest.js';
import {messages as itRest} from './catalogs/helpers/it-rest.js';
import {messages as esRest} from './catalogs/helpers/es-rest.js';
import {messages as roRest} from './catalogs/helpers/ro-rest.js';
import {messages as ruRest} from './catalogs/helpers/ru-rest.js';
for (const [locale, messages] of Object.entries({en: enRest, de: deRest, fr: frRest, it: itRest, es: esRest, ro: roRest, ru: ruRest})) registerMessages(locale, 'helperRest', messages);

// Confirmation and guidance catalogs.
import {messages as enGuide} from './catalogs/helpers/en-guide.js';
import {messages as deGuide} from './catalogs/helpers/de-guide.js';
import {messages as frGuide} from './catalogs/helpers/fr-guide.js';
import {messages as itGuide} from './catalogs/helpers/it-guide.js';
import {messages as esGuide} from './catalogs/helpers/es-guide.js';
import {messages as roGuide} from './catalogs/helpers/ro-guide.js';
import {messages as ruGuide} from './catalogs/helpers/ru-guide.js';
for (const [locale, messages] of Object.entries({en: enGuide, de: deGuide, fr: frGuide, it: itGuide, es: esGuide, ro: roGuide, ru: ruGuide})) registerMessages(locale, 'helperGuide', messages);

// Desktop-only tips catalogs.
import {messages as enTips} from './catalogs/helpers/en-tips.js';
import {messages as deTips} from './catalogs/helpers/de-tips.js';
import {messages as frTips} from './catalogs/helpers/fr-tips.js';
import {messages as itTips} from './catalogs/helpers/it-tips.js';
import {messages as esTips} from './catalogs/helpers/es-tips.js';
import {messages as roTips} from './catalogs/helpers/ro-tips.js';
import {messages as ruTips} from './catalogs/helpers/ru-tips.js';
for (const [locale, messages] of Object.entries({en: enTips, de: deTips, fr: frTips, it: itTips, es: esTips, ro: roTips, ru: ruTips})) registerMessages(locale, 'helperTips', messages);
