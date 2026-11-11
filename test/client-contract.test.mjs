/**
 * Client-contract regression test for dsh-root-bridge.
 *
 * Reproduces the exact validation the Web client enforces when a plugin calls
 * `ctx.remote.$mount(contribution)`:
 *  - dsh-api-gateway ClientRemoteService.validateContribution (requireStrictInputs,
 *    scopedProjection, endpointOf, RemoteNamespaceService.assertMethodAvailable)
 *  - dsh-typert-registry RemoteStore.register -> DescriptorStore.validate
 *    -> validateInvocation / validateCodec / validateSegment / validateWireName
 *
 * The first version of the plugin shipped descriptors without id/service and
 * without strict codecs carrying typeSymbol + create(), which threw at boot and
 * left the entry FAILED ("web boot: 1 entry did not activate"). This test fails
 * loudly if that contract regresses.
 *
 * Run: node test/client-contract.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const bundleDir = join(here, '..');
const clientSource = readFileSync(join(bundleDir, 'client.js'), 'utf8');

/* ---------------- 1. Capture the client module factory ---------------- */
const captured = [];
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      captured.push(spec);
    },
  },
};
globalThis.document = undefined;

const moduleUrl =
  'data:text/javascript;base64,' + Buffer.from(clientSource, 'utf8').toString('base64');
await import(moduleUrl);

assert.equal(captured.length, 1, 'client.js must register exactly one module');
const spec = captured[0];
assert.equal(spec.id, '@xiaohuangbo/dsh-root-bridge', 'module id must equal the package name');

/* ---------------- 2. Fake module table: react + zod ---------------- */
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
};
const zod = {
  z: {
    string: () => ({ kind: 'string' }),
    any: () => ({ kind: 'any' }),
  },
};
const require = (id) => {
  if (id === 'react') return React;
  if (id === 'react-dom') return { createPortal: (node) => node };
  if (id === 'zod') return zod;
  throw new Error(`unexpected client module import: ${id}`);
};

const mod = spec.factory(require);
assert.equal(typeof mod.apply, 'function', 'factory must return apply()');
assert.ok(Array.isArray(mod.inject), 'factory must return inject[]');

/* ---------------- 3. Real validators (copied from the installed bundles) ---------------- */
function validateWireName(subject, value) {
  if (value === '.' || value === '..' || !/^[A-Za-z0-9_$.-]+$/.test(value)) {
    throw new Error(`typert: invalid ${subject} "${value}" — must contain only RPC endpoint segment characters`);
  }
}
function validateSegment(subject, value) {
  if (value.length === 0 || value.includes('#')) {
    throw new Error(`typert: invalid ${subject} "${value}" — must be nonempty and must not contain "#"`);
  }
}
function validateNonempty(subject, value) {
  if (value.length === 0) throw new Error(`typert: invalid ${subject} — must be nonempty`);
}
function validateCodec(codec, subject) {
  if (codec.mode === 'src-json') return;
  validateNonempty(`${subject} type symbol`, codec.typeSymbol);
  if (typeof codec.create !== 'function') {
    throw new Error(`typert: ${subject} strict codec has no create() factory`);
  }
}
function validateInvocation(descriptor) {
  validateNonempty('invocation id', descriptor.id);
  validateSegment('invocation service key', descriptor.service);
  validateWireName('invocation namespace', descriptor.namespace);
  validateWireName('invocation method', descriptor.method);
  validateCodec(descriptor.result, `${descriptor.id} result`);
  const wires = new Set();
  for (const parameter of descriptor.parameters) {
    validateWireName('parameter name', parameter.name);
    validateWireName('parameter wire field', parameter.wire);
    if (wires.has(parameter.wire)) throw new Error(`typert: invocation "${descriptor.id}" repeats wire field "${parameter.wire}"`);
    wires.add(parameter.wire);
    if (parameter.source === 'lookup') {
      if (parameter.lookup === undefined) throw new Error(`typert: invocation "${descriptor.id}" lookup parameter "${parameter.name}" has no lookup key`);
      validateSegment('lookup key', parameter.lookup);
    } else if (parameter.lookup !== undefined) {
      throw new Error(`typert: invocation "${descriptor.id}" JSON parameter "${parameter.name}" declares a lookup key`);
    }
    validateCodec(parameter.codec, `${descriptor.id} parameter ${parameter.name}`);
  }
  if (descriptor.cancellation !== undefined && descriptor.cancellation.parameter !== 'signal') {
    throw new Error(`typert: invocation "${descriptor.id}" cancellation parameter must be "signal"`);
  }
  if (descriptor.mode !== undefined && descriptor.mode !== 'stream') {
    throw new Error(`typert: invocation "${descriptor.id}" mode must be "stream"`);
  }
  if (descriptor.uplink !== undefined) validateCodec(descriptor.uplink.codec, `${descriptor.id} uplink`);
  if (descriptor.scope !== undefined) throw new Error(`unexpected scope on ${descriptor.id}`);
  if (descriptor.invocation.kind === 'context') {
    validateSegment('Context key', descriptor.invocation.context);
    validateWireName('Context wire field', descriptor.invocation.wire);
    validateCodec(descriptor.invocation.codec, `${descriptor.id} Context`);
  }
}
function requireStrictCodec(codec, endpoint, field) {
  if (codec.mode !== 'strict') throw new Error(`client api: generated Remote ${endpoint} field ${JSON.stringify(field)} has no strict codec`);
}
function requireStrictInputs(descriptor) {
  const endpoint = `${descriptor.namespace}/${descriptor.method}`;
  for (const parameter of descriptor.parameters) requireStrictCodec(parameter.codec, endpoint, parameter.wire);
  if (descriptor.uplink !== undefined) requireStrictCodec(descriptor.uplink.codec, endpoint, 'uplink');
  if (descriptor.invocation.kind === 'context') requireStrictCodec(descriptor.invocation.codec, endpoint, descriptor.invocation.wire);
}
const RESERVED_METHODS = new Set(['invokeRemote', 'methods', 'namespace', 'empty', 'has', 'install', 'installDirect', 'installScoped', 'remove', 'assertMethodAvailable', 'constructor', '$on', '$mount', '$stream', '$host']);

function validateContribution(contribution) {
  assert.equal(typeof contribution.package, 'string');
  validateSegment('Remote package name', contribution.package);
  // RemoteStore.register -> DescriptorStore.validate
  const endpoints = new Set();
  const ids = new Set();
  for (const descriptor of contribution.descriptors) {
    validateInvocation(descriptor);
    const endpoint = `${descriptor.namespace}/${descriptor.method}`;
    if (endpoints.has(endpoint)) throw new Error(`typert: remote endpoint "${endpoint}" is already registered`);
    if (ids.has(descriptor.id)) throw new Error(`typert: remote invocation id "${descriptor.id}" is already registered`);
    endpoints.add(endpoint);
    ids.add(descriptor.id);
  }
  // ClientRemoteService.validateContribution
  for (const descriptor of contribution.descriptors) {
    requireStrictInputs(descriptor);
    assert.equal(descriptor.invocation.kind, 'direct', 'this plugin only mounts direct methods');
    const endpoint = `${descriptor.namespace}/${descriptor.method}`;
    if (RESERVED_METHODS.has(descriptor.method)) throw new Error(`client api: method ${endpoint} conflicts with its namespace service`);
    assert.ok(!descriptor.method.includes('#'), `method ${endpoint} must be a wire name`);
  }
}

/* ---------------- 4. Run apply() with a contract-checking ctx ---------------- */
const effectLog = [];
const registeredSlots = [];
const mountedContributions = [];
const onEvents = [];

const ctx = {
  effect(fn, label) {
    effectLog.push(label);
    const cleanup = fn();
    return typeof cleanup === 'function' ? cleanup : () => {};
  },
  get(key) {
    return key === `remote.${'dsh-root-bridge'}` ? {} : undefined;
  },
  remote: {
    async $mount(contribution) {
      validateContribution(contribution);
      mountedContributions.push(contribution);
      return async () => {};
    },
    $on(event, listener) {
      assert.equal(typeof event, 'string');
      assert.equal(typeof listener, 'function');
      onEvents.push(event);
      return () => {};
    },
  },
  locale: {
    register(ns, dicts) {
      assert.equal(ns, 'dsh-root-bridge');
      assert.ok(dicts.zh && dicts.en, 'locale needs zh + en dictionaries');
      return () => {};
    },
    bind: () => (key) => key,
  },
  slots: {
    inject(key, callback) {
      assert.ok(key === 'shell.overlay' || key === 'conversation.input.left' || key === 'settings.section', `unexpected slot inject: ${key}`);
      const dispose = callback();
      assert.equal(typeof dispose, 'function');
      return dispose;
    },
    register(options) {
      registeredSlots.push(options);
      return () => {};
    },
  },
};

await mod.apply(ctx);

/* ---------------- 5. Assertions ---------------- */
assert.equal(mountedContributions.length, 1, 'apply must mount the remote namespace contribution');
const contribution = mountedContributions[0];
assert.equal(contribution.package, '@xiaohuangbo/dsh-root-bridge');
assert.deepEqual(
  contribution.descriptors.map((d) => `${d.namespace}/${d.method}`).sort(),
  ['dsh-root-bridge/decide', 'dsh-root-bridge/getConfig', 'dsh-root-bridge/setMode', 'dsh-root-bridge/status', 'dsh-root-bridge/submitPassword', 'dsh-root-bridge/update'],
);
assert.ok(onEvents.length === 0, 'must not subscribe Host→Client events (gateway single-source is owned by api-remotes); approval rides status() polling instead');
assert.equal(registeredSlots.length, 3, 'must register the overlay, the input-bar switch and the settings section');
assert.deepEqual(
  registeredSlots.map((slot) => ({ slot: slot.name, id: slot.id })).sort((a, b) => a.slot.localeCompare(b.slot)),
  [
    { slot: 'conversation.input.left', id: 'dsh-root-bridge.mode' },
    { slot: 'settings.section', id: 'root-bridge' },
    { slot: 'shell.overlay', id: 'dsh-root-bridge-modal' },
  ],
);

/* ---------------- 6. Cross-check wires against the host service methods ---------------- */
const hostSource = readFileSync(join(bundleDir, 'svc16.js'), 'utf8');
for (const [method, wires] of [
  ['decide', ['requestId', 'decision']],
  ['submitPassword', ['requestId', 'password']],
  ['setMode', ['mode']],
  ['update', ['patch']],
]) {
  const descriptor = contribution.descriptors.find((d) => d.method === method);
  assert.deepEqual(descriptor.parameters.map((p) => p.wire), wires, `${method} wires must match the host method signature`);
  // Host SRC discovery derives parameters from the JS function parameter names.
  assert.ok(hostSource.includes(`async ${method}(`), `host service must declare ${method}()`);
}
assert.ok(hostSource.includes('status()'), 'host service must declare status()');
assert.ok(hostSource.includes('getConfig() {'), 'host service must declare getConfig()');
assert.ok(hostSource.includes('async update(patch)'), 'host service must declare update(patch)');

console.log('PASS: client contribution satisfies the real client-side contracts');
console.log('  mounted remote methods:', contribution.descriptors.map((d) => `${d.namespace}/${d.method}`).join(', '));
console.log('  slot registration:', registeredSlots[0].name, '/', registeredSlots[0].id);
console.log('  subscribed events:', onEvents.join(', '));

/* ---------------- 7. Negative check: the ORIGINAL broken shape must fail ---------------- */
const broken = {
  package: '@xiaohuangbo/dsh-root-bridge',
  descriptors: [
    {
      namespace: 'dsh-root-bridge',
      method: 'decide',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'requestId', wire: 'requestId', source: 'json', codec: { mode: 'strict' } },
      ],
      result: { mode: 'strict' },
    },
  ],
};
let rejected = false;
try {
  validateContribution(broken);
} catch {
  rejected = true;
}
assert.equal(rejected, true, 'the original descriptor shape (no id/service/typeSymbol/create) must be rejected — regression guard');
console.log('PASS: the previously shipped broken descriptor shape is rejected by the same validators');

/* ---------------- 8. Fail-soft: a throwing step must NOT fail activation ---------------- */
{
  const softSlots = [];
  const softEvents = [];
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args);
  const softCtx = {
    effect: (fn) => { fn(); return () => {}; },
    get: () => undefined,
    remote: {
      async $mount() {
        throw new Error('simulated typert registry rejection');
      },
      $on(event, listener) {
        softEvents.push(event);
        return () => {};
      },
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (_key, callback) => callback(),
      register: (options) => { softSlots.push(options); return () => {}; },
    },
  };
  try {
    await mod.apply(softCtx);
  } finally {
    console.error = originalError;
  }
  assert.equal(logged.length, 1, 'the failing step must be logged, not thrown');
  assert.ok(softEvents.length === 0, 'no forwarded-event subscription is expected');
  assert.equal(softSlots.length, 3, 'overlay + chip + settings registrations must survive a failed mount');
  console.log('PASS: a failing client step degrades that step only — plugin activation never fails');
}
