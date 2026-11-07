// The sidebar's update button: one short line from the version ("Update to 0.5.1 beta"); the release's full title, which names the
// channel ("🧪 BETA (release candidate) · 0.5.1 · 4 Oct"), goes in the tooltip. The title in the button wrapped to three lines (4 Oct 2026).
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
/** Describe the offered update or rollback version; keep its original version and beta flag. */
export const updateLabel = update => (update.rollback ? t('helpers.backVersion', {version: update.version}) : t('helpers.updateVersion', {version: update.version, beta: update.beta ? ' beta' : ''}));
/** Format the update tooltip from its original name/version and download URL. */
export const updateTooltip = update => t('helpers.updateTooltip', {name: update.name || update.version, url: update.url});
