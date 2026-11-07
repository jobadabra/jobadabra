// Register the shared navigation session counter before rendering its visible label or accessible tooltip.
import {registerMessages} from './index.js';
import catalog from './catalogs/session-counts.js';
for (const [locale, messages] of Object.entries(catalog)) registerMessages(locale, 'sessionCounts', messages);
