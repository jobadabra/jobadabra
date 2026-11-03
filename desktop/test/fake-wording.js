// The AI's reply to the queue's question writer (lib/open-wording.js) for tests: every "id: label — hint" line becomes "What is your <label>?", a label that is already a question keeps its words (no spend). A test's fake AI
// answers a request with wordingReply(request) first; null = not a wording request.
export function wordingReply(request) {
  if (!/is "id: label"/.test(String(request.system || ''))) return null;
  const lines = String(request.messages[0].content).split('\n').filter(line => /^f\d+: /.test(line));
  return {content: [{type: 'text', text: JSON.stringify({asks: lines.map(line => {
    const [, field, label] = line.match(/^(f\d+): ([^—]*?)\s*(?:—.*)?$/) || [];
    return {field, question: /[?？]$/.test(label) ? label : `What is your ${label.toLowerCase()}?`, hint: ''};
  })})}]};
}
