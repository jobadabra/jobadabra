// Translate explicitly marked app-owned leaves and attributes; never inspect or rewrite arbitrary user content.
import {t} from '../i18n/index.js';

const bindings = {'data-i18n': null, 'data-i18n-title': 'title', 'data-i18n-placeholder': 'placeholder', 'data-i18n-aria-label': 'aria-label', 'data-i18n-alt': 'alt'};

/** Apply bundled messages to explicit leaf slots and attributes under root, including root itself. */
export function translate(root) {
  for (const [binding, attribute] of Object.entries(bindings)) {
    const nodes = [...(root.querySelectorAll?.(`[${binding}]`) || [])];
    if (root.getAttribute?.(binding)) nodes.unshift(root);
    for (const node of nodes) {
      const value = t(node.getAttribute(binding));
      if (attribute) node.setAttribute(attribute, value);
      else node.textContent = value;
    }
  }
}
