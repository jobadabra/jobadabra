// Draws one readiness state of the person's own AI plan (renderer/ai-plan-guide.js says it): an alert box with the title, one line of text, the numbered install steps with the official line
// (and Copy), and the buttons (one primary, the rest links). onAction(id) is the page's; copy(text) puts the install line on the clipboard.
// Why (2 Nov 2026, owner): "We should never show a raw error": this box is the only thing drawn for a missing, broken or signed-out CLI.
import {el} from './components.js';
import {icon} from './icons.js';

const ICON = {good: 'check-circle', info: 'info', warn: 'info'};

/** Draw one readiness guide (renderer/ai-plan-guide.js `guide`) as a card: title, text, numbered steps, command with Copy, buttons that call onAction(id); returns the element. */
export function planCard(g, {onAction = () => {}, copy = text => navigator.clipboard?.writeText(text), busy = ''} = {}) {
  const box = el('div', `alert tone-${g.tone} engine-guide`);
  box.dataset.state = g.state;
  const body = el('div');
  body.append(el('b', '', g.title));
  if (g.text) body.append(el('p', '', g.text));
  if (g.steps.length) {
    const list = el('ol', 'engine-steps');
    g.steps.forEach(step => list.append(el('li', '', step)));
    body.append(list);
  }
  if (g.command) {
    const line = el('div', 'engine-command');
    const copyButton = Object.assign(el('button', 'secondary', 'Copy'), {type: 'button'});
    copyButton.addEventListener('click', () => { copy(g.command); copyButton.textContent = 'Copied'; });
    line.append(el('code', '', g.command), copyButton);
    body.append(line);
  }
  const actions = el('div', 'engine-actions');
  for (const action of g.actions) {
    const button = Object.assign(el('button', action.primary ? 'primary' : 'secondary', busy === action.id ? `${action.label}…` : action.label), {type: 'button', disabled: !!busy});
    button.dataset.action = action.id;
    button.addEventListener('click', () => onAction(action.id));
    actions.append(button);
  }
  if (g.actions.length) body.append(actions);
  box.append(icon(ICON[g.tone] || 'info'), body);
  return box;
}
