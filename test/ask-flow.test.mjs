/**
 * 审批闭环测试: askUser() → status().pending(客户端轮询) → decide()/submitPassword() → 结算。
 *
 * 历史 bug: 早期实现走 ctx.waterfall + typertGateway.registerRemoteEvents 把审批事件推给浏览器。
 * 但 DSH 网关的远程事件源是**单源**的, 已被 @deepseek-ai/dsh-api-remotes 启动时占用,
 * 我们的注册永远抛 "already registered", 监听器不存在 → waterfall 直接返回 fallback(普通对象),
 * 于是工具报 "this.ctx.waterfall(...).then is not a function"。
 * 现在改为 status() 挂 pending + 客户端轮询, 本测试锁住这条链路。
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Context } = await import(pathToFileURL(require.resolve("@deepseek-ai/cordis")).href);
const { DshRootBridgeService } = await import("../svc16.js");

const root = new Context();
root.plugin({
  apply(ctx) {
    ctx.provide("systemPrompt", { section: () => () => {}, getSectionOrder: () => 500 });
    ctx.provide("typertGateway", { hasLiveClient: () => true });
    ctx.provide("settings", { configure: () => () => {} });
    ctx.provide("tools", { register: () => () => {} });
    ctx.provide("shell", { execute: async () => ({ result: async () => ({}) }) });
    ctx.provide("agents", { roots: () => [], isOwnedBy: () => false });
    ctx.provide("configEditor", { edit: async () => {} });
  },
});

const fiber = root.plugin(DshRootBridgeService);
await Promise.race([
  fiber,
  new Promise((_, reject) => setTimeout(() => reject(new Error("mount timeout")), 5000)),
]);
const svc = root.get("dsh-root-bridge");
assert.ok(svc !== undefined, "service must be mounted");

// 1) 审批请求: 挂进 status().pending
const approvalPromise = svc.askUser({ id: "root-1" }, {
  requestId: "req-1",
  kind: "approval",
  toolName: "request_root",
  command: "id && whoami",
  reason: "测试申请制审批",
  escalation: "sudo",
});
const status = svc.status();
assert.equal(status.pending.length, 1, "pending approval must surface in status()");
assert.deepEqual(
  {
    requestId: status.pending[0].requestId,
    kind: status.pending[0].kind,
    command: status.pending[0].command,
    reason: status.pending[0].reason,
    escalation: status.pending[0].escalation,
  },
  {
    requestId: "req-1",
    kind: "approval",
    command: "id && whoami",
    reason: "测试申请制审批",
    escalation: "sudo",
  },
);

// 2) 用户批准 → 结算
const handled = await svc.decide("req-1", "allow");
assert.equal(handled.handled, true, "decide must settle the pending request");
const approvalOutcome = await approvalPromise;
assert.equal(approvalOutcome.decision, "allow");
assert.equal(svc.status().pending.length, 0, "pending list must drain after a decision");

// 3) 密码请求(全 root / 子代理 input 策略走这条)
const passwordPromise = svc.askUser({ id: "root-1" }, {
  requestId: "req-2",
  kind: "password",
  escalation: "run0",
});
const status2 = svc.status();
assert.equal(status2.pending.length, 1);
assert.equal(status2.pending[0].kind, "password");
assert.equal(status2.pending[0].requestId, "req-2");
const submitted = await svc.submitPassword("req-2", "hunter2");
assert.equal(submitted.handled, true);
const passwordOutcome = await passwordPromise;
assert.equal(passwordOutcome.decision, "submit");
assert.equal(passwordOutcome.password, "hunter2");

// 4) 拒绝路径
const denyPromise = svc.askUser({ id: "root-1" }, {
  requestId: "req-3",
  kind: "approval",
  toolName: "request_root",
  command: "rm -rf /tmp/x",
  reason: "拒绝测试",
  escalation: "sudo",
});
await svc.decide("req-3", "deny");
const denyOutcome = await denyPromise;
assert.equal(denyOutcome.decision, "deny");
assert.equal(svc.status().pending.length, 0);

console.log("PASS: ask → status().pending → decide/submitPassword settles the approval loop");
