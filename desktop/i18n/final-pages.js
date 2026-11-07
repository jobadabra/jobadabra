// Register remaining primary-page display keys and explicit aliases to existing catalog messages.
import './screens.js';
import './screens-pages.js';
import './screens-helpers.js';
import {number} from './format.js';
import {registerMessages, t} from './index.js';
import en from './catalogs/final-pages/en.js';
import de from './catalogs/final-pages/de.js';
import fr from './catalogs/final-pages/fr.js';
import it from './catalogs/final-pages/it.js';
import es from './catalogs/final-pages/es.js';
import ro from './catalogs/final-pages/ro.js';
import ru from './catalogs/final-pages/ru.js';
export const catalogs = {en, de, fr, it, es, ro, ru};
for (const [locale, messages] of Object.entries(catalogs)) registerMessages(locale, 'finalPages', messages);
const aliases = {"nav1": "screenStaticMain.text79", "nav3": "helperTail.cancelAll", "nav10": "pagesCommon.importLinkedin", "nav14": "screenStaticDialogsOne.text707", "nav16": "pagesFieldsStatus.analyzeSearch", "nav18": "screenStaticMain.text60", "nav24": "screenStaticAttributes.text27", "nav34": "pagesPlans.havePro", "nav36": "pagesPlans.redeemPromo", "nav38": "pagesPlans.joinWaitlist", "nav40": "pagesProfileMore.fillDetails", "nav42": "helperRest.checkLearned", "nav44": "pagesCommon.jobPreferences", "nav46": "pagesCommon.mainGoals", "nav48": "screenStaticProfile.text207", "nav50": "pagesStrategy.locations", "nav54": "screenStaticProfile.text203", "nav56": "pagesJobs.reviewPreferences"};
/** Format one trusted page template at display time; supplied user content is interpolated once. */
export const finalText = (key, variables = {}) => t(aliases[key] || `finalPages.${key}`,
  Number.isFinite(Number(variables.count)) ? {...variables, shown: number(Number(variables.count))} : variables);
