// docs/desktop-ai-mcp.md names every tool the desktop AI gets (lib/desktop-ai-tools.js TOOLS), so a new tool cannot ship undocumented, and the page keeps saying the helper is not installed automatically.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {TOOLS} from '../lib/desktop-ai-tools.js';

const page = fs.readFileSync(new URL('../../docs/desktop-ai-mcp.md', import.meta.url), 'utf8');

test('every tool is documented, and the page says it is not installed automatically', () => {
  for (const tool of TOOLS) assert.ok(page.includes(`\`${tool.name}\``), `docs/desktop-ai-mcp.md does not name ${tool.name}`);
  assert.match(page, /not installed automatically/);
});
