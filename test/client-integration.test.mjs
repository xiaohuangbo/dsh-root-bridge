/**
 * Real-module integration test for the dsh-root-bridge client half.
 *
 * Loads the ACTUAL shipped client bundles into a real Cordis context:
 *   - @deepseek-ai/dsh-typert-registry  (client registry: provides `typert`)
 *   - @deepseek-ai/dsh-api-gateway      (client face: provides `remote`)
 * and then activates this plugin's client.js with stub `connection`, `locale`
 * and `slots` services. This exercises the exact boot path that failed with
 * "web boot: 1 entry did not activate" (ctx.remote.$mount -> typert RemoteStore
 * validation -> namespace service creation) plus a live method invocation.
 *
 * Run: node test/client-integration.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const bundleDir = join(here, '..');
const requireFromBundle = createRequire(join(bundleDir, 'package.json'));
const installed = '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';

/* ---------------- load real cordis + zod ---------------- */
const cordisUrl = pathToFileURL(requireFromBundle.resolve('@deepseek-ai/cordis')).href;
const cordisNamespace = await import(cordisUrl);
const { Context } = cordisNamespace;
const zodUrl = pathToFileURL(requireFromBundle.resolve('zod')).href;
const zodModule = await import(zodUrl);
const zod = zodModule.z !== undefined ? zodModule : zodModule.default;

/* ---------------- fake module table capturing client bundles ---------------- */
const specs = new Map();
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      specs.set(spec.id, spec);
    },
  },
};
globalThis.document = undefined;

function loadBundle(sourcePath) {
  vm.runInThisContext(readFileSync(sourcePath, 'utf8'), { filename: sourcePath });
}

loadBundle(join(installed, 'dsh-typert-registry/lib/client.browser.js'));
loadBundle(join(installed, 'dsh-api-gateway/lib/client.browser.js'));
loadBundle(join(bundleDir, 'client.js'));

const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
};

function factoryFor(id) {
  const spec = specs.get(id);
  assert.ok(spec, `client bundle ${id} must register with the module loader`);
  const require = (name) => {
    if (name === '@deepseek-ai/cordis') return cordisNamespace;
    if (name === 'zod') return zod;
    if (name === 'react') return ReactStub;
    if (name === 'react-dom') return { createPortal: (node) => node };
    if (name === 'react/jsx-runtime') return {};
    throw new Error(`unexpected import ${name}`);
  };
  return spec.factory(require);
}

/* ---------------- real context with stub services ---------------- */
const root = new Context();

const rpcCalls = [];
const connectionStub = {
  interactions: 'answer',
  isLoopback: true,
  rpc: {
    open: () => {
      throw new Error('streams are not exercised by this test');
    },
    call: async (_path, endpoint, payload) => {
      rpcCalls.push({ endpoint, payload });
      return { ok: true, value: { handled: true } };
    },
  },
  openWebSocket: () => {
    throw new Error('not exercised');
  },
  start: () => ({ stop() {} }),
  registerGenerationSource: () => () => {},
  generation: {
    getSnapshot: () => ({ host: { home: '/tmp' } }),
    subscribe: () => () => {},
  },
};

const localeStub = {
  register: () => () => {},
  bind: () => (key) => key,
  getLocale: () => ({ id: 'zh', fallback: 'en' }),
  subscribe: () => () => {},
};

const registeredSlots = [];
const slotsStub = {
  inject: (_key, callback) => callback(),
  register: (options, component) => {
    registeredSlots.push({ options, component });
    return () => {};
  },
};

const grantProvider = {
  apply(ctx) {
    ctx.provide('connection', connectionStub);
    ctx.provide('locale', localeStub);
    ctx.provide('slots', slotsStub);
  },
};
await root.plugin(grantProvider);

/* ---------------- activate the real core client plugins ---------------- */
const registryModule = factoryFor('@deepseek-ai/dsh-typert-registry');
await root.plugin({ inject: registryModule.inject, apply: registryModule.apply });

const gatewayModule = factoryFor('@deepseek-ai/dsh-api-gateway');
await root.plugin({ inject: gatewayModule.inject, apply: gatewayModule.apply });

assert.ok(root.get('typert') !== undefined, 'typert registry service must be provided');
assert.ok(root.get('remote') !== undefined, 'remote client service must be provided');
assert.equal(typeof root.get('remote').$mount, 'function', 'remote service must expose $mount');
assert.equal(typeof root.get('remote').$on, 'function', 'remote service must expose $on');

/* ---------------- activate this plugin's client half ---------------- */
const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args);
  originalError(...args);
};
const bridgeModule = factoryFor('@xiaohuangbo/dsh-root-bridge');
try {
  await root.plugin({ inject: bridgeModule.inject, apply: bridgeModule.apply });
} finally {
  console.error = originalError;
}

assert.deepEqual(errors, [], 'plugin activation must not log guard failures');

/* ---------------- the mounted namespace must be live ---------------- */
const namespace = root.get('remote.dsh-root-bridge');
assert.ok(namespace !== undefined, 'remote.dsh-root-bridge namespace service must exist after $mount');
for (const method of ['decide', 'submitPassword', 'status', 'setMode', 'getConfig', 'update']) {
  assert.equal(typeof namespace[method], 'function', `namespace must expose ${method}()`);
}

/* ---------------- a live invocation must reach the carrier ---------------- */
const result = await namespace.decide('req-1', 'allow');
assert.equal(result.ok, true, 'decide() invocation must succeed');
// 客户端可能因 status 轮询产生额外调用，按端点评判而非总数
const callsOf = (endpoint) => rpcCalls.filter((call) => call.endpoint === endpoint);
const decideCalls = callsOf('dsh-root-bridge/decide');
assert.equal(decideCalls.length, 1, 'exactly one decide carrier call expected');
assert.deepEqual({ ...decideCalls[0].payload.args }, { requestId: 'req-1', decision: 'allow' });

const read = await namespace.getConfig();
assert.equal(read.ok, true, 'config() invocation must succeed');
const configCalls = callsOf('dsh-root-bridge/getConfig');
assert.ok(configCalls.length >= 1, 'config carrier call expected');

const switched = await namespace.setMode('full');
assert.equal(switched.ok, true, 'setMode() invocation must succeed');
const setModeCalls = callsOf('dsh-root-bridge/setMode');
assert.equal(setModeCalls.length, 1, 'setMode carrier call expected');
assert.deepEqual({ ...setModeCalls[0].payload.args }, { mode: 'full' });

const updated = await namespace.update({ escalation: 'run0' });
assert.equal(updated.ok, true, 'update() invocation must succeed');
const updateCalls = callsOf('dsh-root-bridge/update');
assert.equal(updateCalls.length, 1, 'update carrier call expected');
assert.deepEqual({ ...updateCalls[0].payload.args }, { patch: { escalation: 'run0' } });

assert.equal(registeredSlots.length, 3, 'overlay + composer-dock chip + settings section must be registered');
assert.deepEqual(
  registeredSlots.map((entry) => `${entry.options.name}/${entry.options.id}`).sort(),
  ['conversation.input.left/dsh-root-bridge.mode', 'settings.section/root-bridge', 'shell.overlay/dsh-root-bridge-modal'],
);

console.log('PASS: client half activates in a real Cordis context with the shipped typert registry and gateway client');
console.log('  namespace:', 'remote.dsh-root-bridge (decide/submitPassword/status)');
console.log('  carrier calls:', rpcCalls.map((call) => call.endpoint).join(', '));
