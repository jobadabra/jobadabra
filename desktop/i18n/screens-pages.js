// Register dynamic page catalogs before importing renderer page modules.
import {registerMessages} from './index.js';
import {messages as details} from './catalogs/pages/details.js';
import {messages as status} from './catalogs/pages/status.js';
import {messages as counts} from './catalogs/pages/counts.js';
import {messages as profile} from './catalogs/pages/profile.js';
import {messages as downloads} from './catalogs/pages/downloads.js';
import {messages as session} from './catalogs/pages/session.js';
import {messages as jobs} from './catalogs/pages/jobs.js';
import {messages as setup} from './catalogs/pages/setup.js';
import {messages as common} from './catalogs/pages/common.js';

for (const [locale, messages] of Object.entries(common)) registerMessages(locale, 'pagesCommon', messages);
for (const [locale, messages] of Object.entries(details)) registerMessages(locale, 'pagesDetails', messages);
for (const [locale, messages] of Object.entries(status)) registerMessages(locale, 'pagesStatus', messages);
for (const [locale, messages] of Object.entries(counts)) registerMessages(locale, 'pagesCounts', messages);
for (const [locale, messages] of Object.entries(profile)) registerMessages(locale, 'pagesProfile', messages);
for (const [locale, messages] of Object.entries(downloads)) registerMessages(locale, 'pagesDownloads', messages);
for (const [locale, messages] of Object.entries(session)) registerMessages(locale, 'pagesSession', messages);
for (const [locale, messages] of Object.entries(jobs)) registerMessages(locale, 'pagesJobs', messages);
for (const [locale, messages] of Object.entries(setup)) registerMessages(locale, 'pagesSetup', messages);
