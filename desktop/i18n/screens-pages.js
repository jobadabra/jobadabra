// Register dynamic page catalogs before importing renderer page modules.
import {registerMessages} from './index.js';
import {messages as common} from './catalogs/pages/common.js';

for (const [locale, messages] of Object.entries(common)) registerMessages(locale, 'pagesCommon', messages);
