const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'webmcp.js'), 'utf8');

async function registeredTools() {
  const tools = [];
  const calls = [];
  const status = { hidden: true };
  const bridge = {
    findNearby: async (input, signal) => { calls.push(['find', input, signal]); return { result_count: 1 }; },
    inspectCondition: async (input, signal) => { calls.push(['inspect', input, signal]); return { condition_id: input.condition_id }; },
    planCivicAudit: async (input, signal) => { calls.push(['audit', input, signal]); return { objective: input.objective }; },
    readCurrent: async () => { calls.push(['read']); return { selected_condition: null }; },
    prepareAction: async (input, signal) => { calls.push(['prepare', input, signal]); return { prepared: input.action }; },
  };
  const context = {
    AbortController,
    console,
    document: {
      documentElement: { dataset: {} },
      getElementById: id => id === 'webmcp-status' ? status : null,
      modelContext: { registerTool: async (tool, options) => { tools.push({ ...tool, registrationOptions: options }); } },
    },
    window: { UnignorableWebMCPBridge: bridge, addEventListener() {} },
  };
  vm.runInNewContext(source, context, { filename: 'webmcp.js' });
  await new Promise(resolve => setImmediate(resolve));
  return { tools, calls, status, document: context.document };
}

test('registers a bounded, discoverable WebMCP civic caseworker surface', async () => {
  const { tools, status, document } = await registeredTools();
  assert.deepEqual(tools.map(tool => tool.name), [
    'unignorable_find_nearby',
    'unignorable_inspect_condition',
    'unignorable_plan_civic_field_audit',
    'unignorable_read_current_condition',
    'unignorable_prepare_condition_action',
  ]);
  assert.equal(tools.filter(tool => tool.annotations.readOnlyHint).length, 2);
  assert.ok(tools.every(tool => tool.annotations.untrustedContentHint));
  assert.ok(tools.every(tool => tool.inputSchema.additionalProperties === false));
  assert.ok(tools.every(tool => tool.registrationOptions.signal instanceof AbortSignal));
  assert.equal(status.hidden, false);
  assert.equal(document.documentElement.dataset.webmcpTools, '5');
});

test('delegates execution through the same page bridge and preserves cancellation', async () => {
  const { tools, calls } = await registeredTools();
  const signal = new AbortController().signal;
  const find = tools.find(tool => tool.name === 'unignorable_find_nearby');
  const inspect = tools.find(tool => tool.name === 'unignorable_inspect_condition');
  const audit = tools.find(tool => tool.name === 'unignorable_plan_civic_field_audit');
  const prepare = tools.find(tool => tool.name === 'unignorable_prepare_condition_action');
  assert.deepEqual(await find.execute({ place: 'Penn Station' }, { signal }), { result_count: 1 });
  assert.deepEqual(await inspect.execute({ condition_id: '311-encampment-1' }, { signal }), { condition_id: '311-encampment-1' });
  assert.deepEqual(await audit.execute({ place: 'Penn Station', objective: 'challenge_closure_loop' }, { signal }), { objective: 'challenge_closure_loop' });
  assert.deepEqual(await prepare.execute({ condition_id: '311-encampment-1', action: 'share_receipt' }, { signal }), { prepared: 'share_receipt' });
  assert.equal(calls[0][2], signal);
  assert.equal(calls[1][2], signal);
  assert.equal(calls[2][2], signal);
  assert.equal(calls[3][2], signal);
});

test('never exposes direct submission, payment, messaging, or social-post execution', () => {
  assert.doesNotMatch(source, /api\/condition-observations|api\/checkout|api\/action\/prepare|intent\/tweet|navigator\.share|clipboard\.writeText/);
  assert.match(source, /Preparation only: never requests geolocation/);
});
