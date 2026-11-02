// The one HTML escaper every page and mail uses. Guarded by jobadabra-web test/admin/stats.test.js, which feeds shared/html.js.
export const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
