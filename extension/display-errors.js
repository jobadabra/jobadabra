// Typed display metadata for extension-authored errors; external reasons remain verbatim values.
import {plainWhy} from './ai-reply.js';
import {catalogs} from './i18n.js';

/** Describe a failed job lookup without translating or reclassifying its external reason. */
export function panelJobFailure(error,app) {
  if (!error.status) return app ? {why:catalogs.en['error.noApp'],whyKey:'error.noApp'} : {why:plainWhy(error)};
  if (error.status === 404) return {why:''};
  const reason = plainWhy(error,'') || error.status;
  return {why:`Connected, but this job couldn't be loaded (${reason}): trying again`,whyKey:'error.jobLoad',whyValues:{reason}};
}
