// Register app-authored native desktop messages in the same locale runtime used by the renderer.
import {registerMessages} from './index.js';
import menu from './catalogs/native/menu.js';
import quit from './catalogs/native/quit.js';
import pickers from './catalogs/native/pickers.js';
import system from './catalogs/native/system.js';
import channels from './catalogs/native/channels.js';
for (const catalog of [menu, quit, pickers, system, channels]) for (const [locale, messages] of Object.entries(catalog)) registerMessages(locale, 'native', messages);
export {t} from './index.js';
