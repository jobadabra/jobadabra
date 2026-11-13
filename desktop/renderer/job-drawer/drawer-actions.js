// Actions the drawer's parts call but whose owners are pages (Account / Credentials' "Open Credentials" opens Settings → Credentials), and the part a page asks the drawer to open on. A leaf module: settings.js fills it in, the drawer reads it,
// so the drawer never imports a page (arch-check no-circular: an import of pages/settings.js from the drawer closed 4 import cycles).
export const drawerActions = {openCredentials: () => {}};
/** Job url → the Application part the drawer opens on next (the ⋯ menu's "Fix what's missing" asks for 'readiness'); tab-application.js takes it once. */
export const nextPart = new Map();
