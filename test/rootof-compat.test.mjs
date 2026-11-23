/**
 * 回归测试: rootOf() 的 API 兼容降级。
 *
 * 历史 bug: rootOf() 无条件调用 agents.roots()/isOwnedBy()，但部分 DSH 构建
 * （如 @deepseek-ai/dsh-agent@0.2.2-rc.5 的 AgentRegistry）只有 get()/list()，
 * 于是 request_root 在弹审批窗之前就抛 "agents.roots is not a function"。
 * 本测试锁住特性检测降级链路：无 roots() 时沿 parent 链上溯，找不到返回自身；
 * 有 roots() 时行为与原实现一致。
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Context } = await import(pathToFileURL(require.resolve("@deepseek-ai/cordis")).href);
const { DshRootBridgeService } = await import("../svc16.js");

async function mount(agentsMock) {
  const root = new Context();
  root.plugin({
    apply(ctx) {
      ctx.provide("systemPrompt", { section: () => () => {}, getSectionOrder: () => 500 });
      ctx.provide("typertGateway", { hasLiveClient: () => true });
      ctx.provide("settings", { configure: () => () => {} });
      ctx.provide("tools", { register: () => () => {} });
      ctx.provide("shell", { execute: async () => ({ result: async () => ({}) }) });
      ctx.provide("agents", agentsMock);
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
  return svc;
}

// 1) 无 roots()/isOwnedBy()（rc.5 AgentRegistry 形状）：不抛错，返回自身
{
  const svc = await mount({ get: () => undefined, list: () => [] });
  const agent = { id: "solo" };
  assert.equal(svc.rootOf(agent), agent);
}

// 2) 无 roots() 但存在 parent 链：上溯到根代理
{
  const rootAgent = { id: "root" };
  const mid = { id: "mid", parent: rootAgent };
  const leaf = { id: "leaf", parent: mid };
  const byId = new Map([["root", rootAgent], ["mid", mid], ["leaf", leaf]]);
  const svc = await mount({ get: (id) => byId.get(id), list: () => [...byId.values()] });
  assert.equal(svc.rootOf(leaf), rootAgent);
  assert.equal(svc.rootOf(mid), rootAgent);
  assert.equal(svc.rootOf(rootAgent), rootAgent);
}

// 3) parent 链成环也不死循环
{
  const a = { id: "a" };
  const b = { id: "b", parent: a };
  a.parent = b;
  const byId = new Map([["a", a], ["b", b]]);
  const svc = await mount({ get: (id) => byId.get(id), list: () => [...byId.values()] });
  const result = svc.rootOf(a);
  assert.ok(result === a || result === b);
}

// 4) 原有 roots()/isOwnedBy() API 存在：行为与原实现一致
{
  const rootAgent = { id: "root" };
  const child = { id: "child" };
  const svc = await mount({
    roots: () => [rootAgent],
    isOwnedBy: (id, r) => id === "child" && r === rootAgent,
    get: () => undefined,
    list: () => [rootAgent, child],
  });
  assert.equal(svc.rootOf(child), rootAgent);
  assert.equal(svc.rootOf(rootAgent), rootAgent);
}

console.log("PASS: rootOf() degrades gracefully when agents.roots()/isOwnedBy() are absent");
