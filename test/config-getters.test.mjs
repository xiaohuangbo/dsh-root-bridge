/**
 * 回归测试: 配置 getter 必须读取 this.config, 绝不能自递归。
 *
 * 历史 bug: `get cfgMode() { return cfgValue(this.cfgMode); }` 会无限递归,
 * 插件激活/安装 bundle 时直接 "Maximum call stack size exceeded"。
 */
import assert from "node:assert/strict";
import { DshRootBridgeService } from "../svc16.js";

/** 绕过构造函数, 只测 getter。 */
function serviceWith(config) {
  const service = Object.create(DshRootBridgeService.prototype);
  service.config = config;
  return service;
}

// 普通值
{
  const s = serviceWith({
    mode: "full",
    escalation: "run0",
    requireReason: false,
    subagentPolicy: "inherit",
    promptTimeoutMs: 1234,
  });
  assert.equal(s.cfgMode, "full");
  assert.equal(s.cfgEscalation, "run0");
  assert.equal(s.cfgRequireReason, false);
  assert.equal(s.cfgSubagentPolicy, "inherit");
  assert.equal(s.cfgPromptTimeoutMs, 1234);
}

// volatile 字段被 cordis 解析为 { get() } 包装
{
  const s = serviceWith({
    mode: { get: () => "fakeroot" },
    escalation: { get: () => "sudo" },
    requireReason: { get: () => true },
    subagentPolicy: { get: () => "request" },
    promptTimeoutMs: { get: () => 0 },
  });
  assert.equal(s.cfgMode, "fakeroot");
  assert.equal(s.cfgEscalation, "sudo");
  assert.equal(s.cfgRequireReason, true);
  assert.equal(s.cfgSubagentPolicy, "request");
  assert.equal(s.cfgPromptTimeoutMs, 15 * 60 * 1000, "非法超时应回落到默认值");
}

// 空配置: 全部回落到默认值, 且不得递归
{
  const s = serviceWith({});
  assert.equal(s.cfgMode, "ask");
  assert.equal(s.cfgEscalation, "sudo");
  assert.equal(s.cfgRequireReason, true);
  assert.equal(s.cfgSubagentPolicy, "request");
  assert.equal(s.cfgPromptTimeoutMs, 15 * 60 * 1000);
}

console.log("PASS: config getters read this.config without self-recursion");
