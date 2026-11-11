/**
 * dsh-root-bridge — 会话级 root 权限桥
 * 作者: xiaohuangbo
 *
 * 三种权限管理模式 (config.mode):
 *  - "ask":      申请root权限执行 — 模型通过 request_root 工具申请，
 *                网页弹窗展示命令与申请原因，由用户批准/拒绝后执行。
 *  - "full":     完全root模式 — 整个会话以 root 权限运行，bash 工具的
 *                所有命令都被提权；首次使用时用户通过网页弹窗输入密码
 *                (polkit 认证)，授予会话级 root 权限。
 *  - "fakeroot": Fakeroot模式 — 无需密码，所有 bash 命令包裹在 fakeroot
 *                中运行，伪装模拟 root 身份 (uid 0)，不具真实特权。
 *
 * 提权方式 (config.escalation): "sudo" | "run0" (run0 --empower, polkit)
 * 子代理策略 (config.subagentPolicy): "request" | "input" | "inherit"
 *
 * 安全警告:
 *  1. 尊重他人的隐私。
 *  2. 输入命令前请三思。
 *  3. 能力越大，责任越大。
 */
import z from "@deepseek-ai/schemastery";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

/** typert Remote 方法标记键 (与 @deepseek-ai/dsh-typert-protocol 内部一致)。 */
const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";
/** 审批/密码弹窗默认超时。 */
const DEFAULT_PROMPT_TIMEOUT_MS = 15 * 60 * 1000;
/** 单次系统探测超时。 */
const DEFAULT_COMMAND_TIMEOUT_MS = 120000;
const PROBE_TIMEOUT_MS = 15000;

/** 安全警告文案 (弹窗 + 系统提示)。 */
const SECURITY_WARNINGS_ZH = [
  "尊重他人的隐私。",
  "输入命令前请三思。",
  "能力越大，责任越大。",
];
const SECURITY_WARNINGS_EN = [
  "Respect other people's privacy.",
  "Think twice before entering a command.",
  "With great power comes great responsibility.",
];

/** Volatile 配置字段在 cordis 里解析为 { get() } 包装；普通字段原样返回。 */
function cfgValue(value) {
  return value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
}

/** 单引号安全引用，用于把原始命令嵌入外层 bash -c。 */
function shellQuote(text) {
  return `'${String(text).replaceAll("'", `'\\''`)}'`;
}

/** run0 polkit 授权失效/需要认证的输出特征。 */
const AUTH_NEEDED_RE =
  /(interactive authentication required|authentication is required|authorization is required|polkit authentication failed)/i;

/** 读取 result.content 中的纯文本。 */
function contentText(content) {
  const block = Array.isArray(content) ? content.find((b) => b && b.type === "text") : content;
  return block && typeof block.text === "string" ? block.text : "";
}

const Config = z.object({
  mode: z
    .union(["ask", "full", "fakeroot"])
    .default("ask")
    .volatile()
    .description("权限管理模式。ask=申请root权限执行(每次需网页审批)；full=完全root模式(整个会话以root运行, GUI输入密码polkit认证)；fakeroot=fakeroot模拟root(无需密码, 无真实特权)。"),
  escalation: z
    .union(["sudo", "run0"])
    .default("sudo")
    .volatile()
    .description("提权方式。sudo=通过 sudo 提权；run0=通过 run0 --empower 提权(polkit 认证)。"),
  requireReason: z
    .boolean()
    .default(true)
    .volatile()
    .description("申请root权限时是否强制要求说明原因 (reason)。默认开启。"),
  subagentPolicy: z
    .union(["request", "input", "inherit"])
    .default("request")
    .volatile()
    .description("委托子代理的sudo访问策略。request=子代理每次root申请都需网页审批；input=子代理可触发GUI密码输入建立会话级授权；inherit=子代理自动继承主会话已有的root授权。"),
  promptTimeoutMs: z
    .number()
    .default(DEFAULT_PROMPT_TIMEOUT_MS)
    .volatile()
    .description("审批/密码弹窗超时时间(毫秒)，超时视为拒绝。默认15分钟。"),
  language: z
    .union(["auto", "zh", "en"])
    .default("auto")
    .volatile()
    .description("插件界面语言。auto=自动跟随 DSH 当前语言；zh=简体中文；en=English。"),
});

function modeText(service) {
  const warnings = SECURITY_WARNINGS_ZH.map((line, i) => `${i + 1}. ${line}`).join("\n");
  const mode = service.cfgMode;
  const escalation = service.cfgEscalation;
  const subagentPolicy = service.cfgSubagentPolicy;
  if (mode === "ask") {
    return (
      `[Root 权限模式: 申请制 (request_root)]\n` +
      `当前会话以「申请root权限执行」模式运行：需要 root/特权权限时，调用工具 request_root 申请。` +
      `申请会在网页弹出审批窗口，展示要执行的命令与申请原因，由用户决定批准或拒绝；被拒绝的命令不会执行。` +
      (service.cfgRequireReason ? ` 申请时必须提供原因 (reason)。` : "") +
      ` 提权方式: ${escalation}。` +
      `子代理策略: ${subagentPolicy} (request=逐次审批; input=可触发GUI密码输入; inherit=继承主会话授权)。` +
      `普通命令请直接用 bash 工具，不要滥用 request_root。\n` +
      `安全警告:\n${warnings}`
    );
  }
  if (mode === "full") {
    return (
      `[Root 权限模式: 完全 root]\n` +
      `整个会话以 root 权限运行：bash 工具的所有命令都通过 ${escalation} 提权执行。` +
      `首次需要时，用户会在网页弹窗中输入密码 (polkit 认证)，授予会话级 root 权限；` +
      `密码只保存在本机内存中，不写入会话日志。` +
      `子代理策略: ${subagentPolicy} (request=子代理命令需逐次审批; input=子代理触发GUI密码输入; inherit=继承会话授权)。\n` +
      `安全警告:\n${warnings}`
    );
  }
  return (
    `[Root 权限模式: fakeroot 模拟]\n` +
    `本会话的 bash 命令都在 fakeroot 环境中运行：进程看到模拟的 root 身份 (uid 0) 与文件属主，` +
    `但这只是用户态伪装，并不具备真实特权，也不影响真实的权限检查。需要真实 root 的操作请改用申请模式或完全root模式。\n` +
    `安全警告:\n${warnings}`
  );
}

/** 只接受已知字段并做取值校验；非法值抛错，未知字段忽略。 */
function sanitizePatch(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("patch must be an object");
  const next = {};
  if (value.mode !== undefined) {
    if (value.mode !== "ask" && value.mode !== "full" && value.mode !== "fakeroot") throw new Error(`invalid mode: ${JSON.stringify(value.mode)}`);
    next.mode = value.mode;
  }
  if (value.escalation !== undefined) {
    if (value.escalation !== "sudo" && value.escalation !== "run0") throw new Error(`invalid escalation: ${JSON.stringify(value.escalation)}`);
    next.escalation = value.escalation;
  }
  if (value.requireReason !== undefined) {
    if (typeof value.requireReason !== "boolean") throw new Error("requireReason must be a boolean");
    next.requireReason = value.requireReason;
  }
  if (value.subagentPolicy !== undefined) {
    if (value.subagentPolicy !== "request" && value.subagentPolicy !== "input" && value.subagentPolicy !== "inherit") throw new Error(`invalid subagentPolicy: ${JSON.stringify(value.subagentPolicy)}`);
    next.subagentPolicy = value.subagentPolicy;
  }
  if (value.language !== undefined) {
    if (value.language !== "auto" && value.language !== "zh" && value.language !== "en") throw new Error(`invalid language: ${JSON.stringify(value.language)}`);
    next.language = value.language;
  }
  if (value.promptTimeoutMs !== undefined) {
    const ms = value.promptTimeoutMs;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 1000 || ms > 3600000) throw new Error("promptTimeoutMs must be a number between 1000 and 3600000");
    next.promptTimeoutMs = Math.round(ms);
  }
  return next;
}

export class DshRootBridgeService extends TypertRemoteService {
  static Config = Config;

  pending = new Map(); // requestId -> { kind, resolve, timer }
  grants = new Map(); // rootSessionId -> { method, dir?, pwFile?, askpass?, passwordless? }

  constructor(ctx, config) {
    super(ctx, "dsh-root-bridge");
    this.config = config;

    // 系统提示 (会话内模式说明 + 安全警告)
    ctx.inject(["systemPrompt"], (scope) =>
      scope.systemPrompt.section({
        name: "tool:root-bridge",
        order: (scope.systemPrompt.getSectionOrder("PLAN_POLICY") ?? 500) + 50,
        // 每次组装提示时读取实时配置，切换模式后端侧说明立即更新。
        text: () => modeText(this),
      }),
    );

    // 审批/密码弹窗：网关的远程事件源已被 api-remotes 独占(单源约束)，
    // 因此改为把待审批请求挂进 status()，由客户端轮询弹出弹窗，决定走 decide/submitPassword。

    // 设置页自动表单 (Config schema)
    ctx.inject(["settings"], (scope) => scope.settings.configure({ auto: true }, this.ctx.fiber));

    // 工具执行管线: pre-execute 门禁 (full 模式建立/继承会话授权), execute 包裹命令, post-execute 修复 run0 授权过期
    ctx.on("tools/pre-execute", (exec, next) => this.preExecute(exec, next));
    ctx.on("tools/execute", (exec, next) => this.onExecute(exec, next));
    ctx.on("tools/post-execute", (exec, result, next) => this.postExecute(exec, result, next));

    // 始终注册 request_root：模式可在设置页/模式条实时切换，工具内部按当前模式分支。
    ctx.inject(["tools"], (scope) => scope.tools.register(this.requestRootTool()));

    // 卸载清理: 结束未决弹窗、删除密码临时文件
    ctx.effect(() => () => {
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.resolve({ decision: "deny", reason: "plugin-disposed" });
        this.pending.delete(id);
      }
      for (const [id, grant] of this.grants) {
        if (grant.dir) rmSync(grant.dir, { recursive: true, force: true });
        this.grants.delete(id);
      }
    }, "dsh-root-bridge: dispose");
  }

  /* ============================ 实时配置 ============================ */

  get cfgMode() { return cfgValue(this.config?.mode) ?? "ask"; }
  get cfgEscalation() { return cfgValue(this.config?.escalation) ?? "sudo"; }
  get cfgRequireReason() {
    const value = cfgValue(this.config?.requireReason);
    return value === undefined ? true : Boolean(value);
  }
  get cfgSubagentPolicy() { return cfgValue(this.config?.subagentPolicy) ?? "request"; }
  get cfgLanguage() {
    const value = cfgValue(this.config?.language);
    return value === "zh" || value === "en" ? value : "auto";
  }
  get cfgPromptTimeoutMs() {
    const value = cfgValue(this.config?.promptTimeoutMs);
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_PROMPT_TIMEOUT_MS;
  }

  /* ============================ Remote 方法 (Client → Host) ============================ */

  /** 读取当前配置（客户端设置页用）。名字避开 this.config 实例属性。 */
  getConfig() {
    return {
      mode: this.cfgMode,
      escalation: this.cfgEscalation,
      requireReason: this.cfgRequireReason,
      subagentPolicy: this.cfgSubagentPolicy,
      promptTimeoutMs: this.cfgPromptTimeoutMs,
      language: this.cfgLanguage,
    };
  }

  /** 校验并更新配置（经 configEditor 写回 profile patch；volatile 字段即时生效，无需重启）。 */
  async update(patch) {
    const next = sanitizePatch(patch);
    if (Object.keys(next).length === 0) throw new Error("no known configuration fields in patch");
    const editor = this.ctx.get("configEditor");
    if (editor === undefined) throw new Error("configuration cannot be saved in this profile");
    // 注意: 绝不能用 this.ctx.fiber.entry —— 实测它指向 typert-gateway 的条目,
    // 会把模式写进网关配置(历史 bug)。必须按模块名从 configEditor 的条目表里找自己。
    const entry = this.resolveEntry(editor);
    if (entry === undefined) throw new Error("configuration entry for dsh-root-bridge was not found");
    try {
      await editor.edit(entry, (current) => ({ ...current, ...next }));
    } catch (error) {
      this.logUpdateFailure(next, entry, error);
      throw error;
    }
    this.logUpdateFailure(next, entry, undefined);
    // volatile 传播可能晚于 edit() 返回，直接把刚写入的字段覆盖上去，确保客户端立即看到新值。
    return { ...this.getConfig(), ...next };
  }

  /** 在 profile 的可寻址条目里找到本插件自己的那一行。 */
  resolveEntry(editor) {
    let entries = [];
    try {
      entries = typeof editor.entries === "function" ? editor.entries() : [];
    } catch {
      return undefined;
    }
    return entries.find((candidate) => {
      const id = String(candidate?.options?.id ?? "");
      const name = String(candidate?.options?.name ?? "");
      return id === "dsh-root-bridge" || name.includes("@xiaohuangbo/dsh-root-bridge");
    });
  }

  /** 把配置写入的失败详情落到工作区日志，便于诊断（客户端弹窗里只显示一行）。 */
  logUpdateFailure(next, entry, error) {
    try {
      const line = [
        new Date().toISOString(),
        error === undefined ? "OK" : "FAIL",
        `patch=${JSON.stringify(next)}`,
        `entryId=${String(entry?.options?.id)}`,
        `entryName=${String(entry?.options?.name)}`,
        `fiberState=${String(entry?.fiber?.state)}`,
        error === undefined ? "" : `error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      ].join(" | ");
      appendFileSync(new URL("./update-error.log", import.meta.url), `${line}\n`);
    } catch { /* 日志失败不影响主流程 */ }
  }

  /** 切换权限模式（等价于 update({ mode })）。 */
  async setMode(mode) {
    return this.update({ mode });
  }

  async decide(requestId, decision) {
    const entry = this.pending.get(requestId);
    if (entry === undefined || entry.kind !== "approval") return { handled: false };
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve({ decision: String(decision) });
    return { handled: true };
  }

  async submitPassword(requestId, password) {
    const entry = this.pending.get(requestId);
    if (entry === undefined || entry.kind !== "password") return { handled: false };
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve({ decision: "submit", password: String(password ?? "") });
    return { handled: true };
  }

  status() {
    return {
      mode: this.cfgMode,
      escalation: this.cfgEscalation,
      requireReason: this.cfgRequireReason,
      subagentPolicy: this.cfgSubagentPolicy,
      language: this.cfgLanguage,
      grants: [...this.grants.keys()].map((id) => String(id)),
      // 待回答的审批/密码请求：客户端轮询到这里后弹出弹窗
      pending: [...this.pending.values()]
        .map((entry) => entry.payload)
        .filter((payload) => payload !== undefined),
    };
  }

  /* ============================ 工具管线 ============================ */

  async preExecute(exec, next) {
    if (this.cfgMode !== "full" || exec.name !== "bash") return next();
    const agent = exec.agent;
    if (agent === undefined) {
      return { kind: "deny", reason: "[dsh-root-bridge] 完全root模式缺少agent上下文，拒绝执行" };
    }
    const root = this.rootOf(agent);
    const delegated = root !== agent;
    const hasGrant = this.grantUsable(this.grants.get(root.id));

    if (delegated) {
      if (this.cfgSubagentPolicy === "inherit") {
        if (hasGrant) return { kind: "allow" };
        const ok = await this.establishGrant(root, exec.signal);
        return ok ? { kind: "allow" } : { kind: "deny", reason: denyText("grant-failed") };
      }
      if (this.cfgSubagentPolicy === "input") {
        const ok = await this.establishGrant(root, exec.signal);
        return ok ? { kind: "allow" } : { kind: "deny", reason: denyText("grant-failed") };
      }
      // request: 子代理每条 root 命令都需要审批
      const approval = await this.askUser(
        root,
        {
          requestId: randomUUID(),
          kind: "approval",
          toolName: "bash",
          command: exec.arguments.command,
          reason: exec.arguments.description ?? "",
          escalation: this.cfgEscalation,
          warnings: SECURITY_WARNINGS_ZH,
        },
        exec.signal,
      );
      if (approval.decision !== "allow") return { kind: "deny", reason: denyText("rejected") };
      const ok = await this.establishGrant(root, exec.signal);
      return ok ? { kind: "allow" } : { kind: "deny", reason: denyText("grant-failed") };
    }

    // 主代理: 整个会话 root —— 只保证会话授权存在 (必要时弹密码窗)
    if (hasGrant) return { kind: "allow" };
    const ok = await this.establishGrant(root, exec.signal);
    return ok ? { kind: "allow" } : { kind: "deny", reason: denyText("grant-failed") };
  }

  onExecute(exec, next) {
    if (exec.name !== "bash" || this.cfgMode === "ask") return next();
    const agent = exec.agent;
    if (agent === undefined) return next();
    const root = this.rootOf(agent);
    const grant = this.grants.get(root.id);
    const original = exec.arguments.command;
    let wrapped;
    if (this.cfgMode === "fakeroot") {
      wrapped = `fakeroot -- bash -c ${shellQuote(original)}`;
    } else if (grant !== undefined && grant.method === "sudo") {
      wrapped = grant.passwordless
        ? `sudo -n -- bash -c ${shellQuote(original)}`
        : `SUDO_ASKPASS=${shellQuote(grant.askpass)} DSH_ROOT_PW_FILE=${shellQuote(grant.pwFile)} sudo -A -- bash -c ${shellQuote(original)}`;
    } else if (grant !== undefined && grant.method === "run0") {
      wrapped = `run0 --empower -- bash -c ${shellQuote(original)}`;
    } else {
      // 无授权: 不包裹，命令以普通权限运行 (fail closed)
      return next();
    }
    exec.dshRootOriginalCommand = original;
    exec.arguments = { ...exec.arguments, command: wrapped };
    return next();
  }

  async postExecute(exec, result, next) {
    if (this.cfgMode !== "full" || this.cfgEscalation !== "run0" || exec.name !== "bash") return next();
    const text = contentText(result.content);
    if (!AUTH_NEEDED_RE.test(text)) return next();
    const agent = exec.agent;
    if (agent === undefined) return next();
    const root = this.rootOf(agent);
    this.grants.delete(root.id);
    const ok = await this.establishGrant(root, exec.signal);
    if (!ok) {
      return {
        kind: "accept",
        content: [
          { type: "text", text: `${text}\n[dsh-root-bridge] 需要重新验证(polkit授权已过期)，但用户取消了验证：命令未以特权方式重新执行。` },
        ],
      };
    }
    const original = exec.dshRootOriginalCommand ?? exec.arguments.command;
    const wrapped = `run0 --empower -- bash -c ${shellQuote(original)}`;
    try {
      const run = await this.runCommand({
        command: wrapped,
        workdir: exec.arguments.workdir,
        timeoutMs: exec.arguments.timeout_ms,
        signal: exec.signal,
      });
      return { kind: "accept", content: [{ type: "text", text: this.renderRunResult(run) }] };
    } catch (error) {
      return {
        kind: "accept",
        content: [{ type: "text", text: `${text}\n[dsh-root-bridge] 重新验证后重试失败: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }

  /* ============================ 会话授权 ============================ */

  /** 释放一条会话授权并清理其临时凭证文件。 */
  dropGrant(rootId) {
    const grant = this.grants.get(rootId);
    if (grant === undefined) return;
    if (grant.dir) rmSync(grant.dir, { recursive: true, force: true });
    this.grants.delete(rootId);
  }

  grantUsable(grant) {
    if (grant === undefined) return false;
    // 提权方式被切换后（sudo <-> run0）旧授权必须失效，否则切换会静默不生效：
    // 授权仍按旧方式复用，用户以为换了方式，实际执行的还是老的。
    if (grant.method !== this.cfgEscalation) return false;
    if (grant.method === "sudo" && grant.pwFile !== undefined) {
      return existsSync(grant.pwFile) && existsSync(grant.askpass);
    }
    return true;
  }

  /** 探测是否已可用免密提权 (免密 sudo 或 run0 polkit 已授权)。 */
  probePasswordless(method) {
    if (method === "sudo") {
      const r = spawnSync("sudo", ["-n", "-v"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
      return r.status === 0;
    }
    // 注意: 不能用 --no-ask-password —— 它会禁止 run0 启用交互代理, polkit 随即拒绝;
    // 用普通 --empower 探测: 已授权/被规则允许时立即成功, 否则快速失败。
    const r = spawnSync("run0", ["--empower", "true"], {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return r.status === 0;
  }

  /**
   * 本机 pam_faillock 里该用户的 sudo 失败记录数。
   * sudo 一次密码校验内部会重试 3 次, 错误密码会瞬间打满 deny 阈值并锁定账号 10 分钟,
   * 所以**在已有失败记录时绝不能再自动尝试**, 否则用户输对密码也会被拒。
   */
  faillockFailures() {
    const username = userInfo().username;
    const r = spawnSync("faillock", ["--user", username], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
    if (r.status !== 0 || typeof r.stdout !== "string") return 0;
    return r.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\d{4}-\d{2}-\d{2}/.test(line) && /\bsudo\b/.test(line)).length;
  }

  /**
   * 用 GUI 输入的密码校验 sudo (askpass 方式, 密码不进命令行/日志)。
   * 注意: 这里**不能**带 -n。-n 表示"绝不提示", 连 SUDO_ASKPASS 都不调用,
   * 与 -A 互斥; 带上它时只要账号需要密码就必然返回非 0 (历史 bug: 密码校验永远失败)。
   * -k 先清掉缓存时间戳, -v 触发一次真实校验。
   */
  verifySudoPassword(askpass, pwFile) {
    const r = spawnSync("sudo", ["-A", "-k", "-v"], {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
      env: { ...process.env, SUDO_ASKPASS: askpass, DSH_ROOT_PW_FILE: pwFile },
    });
    return r.status === 0;
  }

  /** 用 GUI 输入的密码通过伪终端完成 run0 的 polkit 认证 (缓存授权)。 */
  primeRun0(password) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      let child;
      try {
        child = spawn("script", ["-q", "-e", "-c", "run0 --empower true", "/dev/null"], {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        return finish(false);
      }
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish(false);
      }, 25000);
      child.stdin.write(`${password}\n`, (err) => {
        if (err) {
          clearTimeout(timer);
          try {
            child.kill("SIGKILL");
          } catch {}
          finish(false);
          return;
        }
        child.stdin.end();
      });
      child.on("error", () => {
        clearTimeout(timer);
        finish(false);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        finish(code === 0);
      });
    });
  }

  /** 建立 (或复用) 会话级 root 授权; 返回是否成功。 */
  async establishGrant(root, signal) {
    const method = this.cfgEscalation;
    const existing = this.grants.get(root.id);
    if (existing !== undefined && existing.method !== method) {
      // 用户切换了提权方式(sudo <-> run0): 旧授权必须作废, 否则新方式永远不会被执行。
      this.dropGrant(root.id);
    } else if (this.grantUsable(existing)) {
      return true;
    }
    this.grantFailure = undefined;

    if (this.probePasswordless(method)) {
      this.grants.set(root.id, { method, passwordless: true });
      return true;
    }

    // 已有 sudo 失败记录时先别弹密码框: 再校验一次就可能把账号锁死 10 分钟。
    if (method === "sudo" && this.faillockFailures() > 0) {
      this.grantFailure = "faillock";
      return false;
    }

    const answer = await this.askUser(
      root,
      { requestId: randomUUID(), kind: "password", escalation: method },
      signal,
    );
    if (answer.decision !== "submit" || typeof answer.password !== "string" || answer.password === "") {
      this.grantFailure = answer.reason === "timeout" ? "timeout" : "cancelled";
      return false;
    }

    if (method === "sudo") {
      const dir = mkdtempSync(join(tmpdir(), "dsh-root-bridge-"));
      const pwFile = join(dir, "pw");
      const askpass = join(dir, "askpass.sh");
      try {
        writeFileSync(pwFile, answer.password, { mode: 0o600 });
        writeFileSync(askpass, '#!/bin/sh\ncat -- "$DSH_ROOT_PW_FILE"\n', { mode: 0o700 });
      } catch {
        rmSync(dir, { recursive: true, force: true });
        this.grantFailure = "io-error";
        return false;
      }
      if (!this.verifySudoPassword(askpass, pwFile)) {
        rmSync(dir, { recursive: true, force: true });
        this.grantFailure = "bad-password";
        return false;
      }
      this.grants.set(root.id, { method: "sudo", dir, pwFile, askpass });
      return true;
    }

    // run0: polkit 认证后授权会被缓存, 密码不落盘
    if (!(await this.primeRun0(answer.password))) {
      this.grantFailure = "polkit-failed";
      return false;
    }
    // 认证后立刻用免密探测复核: polkit 授权确实缓存了才算建立成功
    if (!this.probePasswordless("run0")) {
      this.grantFailure = "polkit-failed";
      return false;
    }
    this.grants.set(root.id, { method: "run0" });
    return true;
  }

  /* ============================ 弹窗问答 (Host → Client → Host) ============================ */

  /** 登记一条待回答的请求; 客户端轮询 status() 后弹窗, 用 decide/submitPassword 结算。 */
  askUser(agent, payload, signal) {
    const requestId = payload.requestId;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ decision: "deny", reason: "timeout" });
      }, this.cfgPromptTimeoutMs);
      this.pending.set(requestId, {
        kind: payload.kind,
        payload: {
          requestId,
          kind: payload.kind,
          toolName: payload.toolName,
          command: payload.command,
          reason: payload.reason,
          escalation: payload.escalation,
        },
        resolve,
        timer: timeout,
        agentId: agent === undefined ? undefined : String(agent.id),
      });

      const gateway = this.ctx.get("typertGateway");
      const live = gateway === undefined || gateway.hasLiveClient();
      if (!live) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        resolve({ decision: "deny", reason: "no-ui" });
        return;
      }

      if (signal !== undefined) {
        const onAbort = () => {
          const entry = this.pending.get(requestId);
          if (entry === undefined) return;
          clearTimeout(entry.timer);
          this.pending.delete(requestId);
          resolve({ decision: "deny", reason: "aborted" });
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  /* ============================ ask 模式工具 ============================ */

  requestRootTool() {
    return {
      name: "request_root",
      description:
        `申请以 root 权限执行一条 bash 命令 (会话级 root 授权，通过 sudo 或 run0 --empower 提权)。` +
        `调用后会在网页弹出审批窗口，展示要执行的命令与申请原因，由用户决定批准或拒绝；批准后命令才执行，结果返回本工具。` +
        `仅当确实需要 root/特权权限时使用；普通命令请直接使用 bash 工具。` +
        `参数 reason 说明申请原因（插件设置 requireReason=true 时必填）。`,
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的 bash 命令（原样，无需自行加 sudo）" },
          reason: { type: "string", description: "申请原因：为什么要用 root 权限执行这条命令" },
          workdir: { type: "string", description: "可选工作目录；缺省为会话工作目录" },
          timeout_ms: { type: "number", description: "可选超时时间（毫秒）" },
        },
        required: ["command"],
      },
      output: {
        schema: { type: "string" },
        // 工具结果渲染必须返回内容块数组(与 dsh-tool-bash 一致)，返回裸字符串会让下游 content.some 崩溃。
        render: (_args, value) => [{ type: "text", text: String(value) }],
      },
      execute: async (args, exec) => {
        const mode = this.cfgMode;
        if (mode === "full") {
          return "[dsh-root-bridge] 当前为「完全root」模式：bash 工具的命令已自动以 root 权限运行，无需 request_root。直接使用 bash 工具即可。";
        }
        if (mode === "fakeroot") {
          return "[dsh-root-bridge] 当前为「fakeroot 模拟root」模式：仅伪装 root 身份，没有真实特权。如需真实 root，请让用户在插件设置页或输入框上方的模式条切换到「申请制」或「完全root」。";
        }
        const escalation = this.cfgEscalation;
        const agent = exec.agent;
        const root = agent === undefined ? undefined : this.rootOf(agent);
        const delegated = agent !== undefined && root !== agent;
        const grant = root === undefined ? undefined : this.grants.get(root.id);
        const hasGrant = this.grantUsable(grant);

        // 子代理策略: inherit 只有在已有会话授权时才能直接使用
        if (delegated && this.cfgSubagentPolicy === "inherit" && !hasGrant) {
          return (
            "[dsh-root-bridge] 拒绝：子代理策略为「继承」，但当前会话尚无已授予的 root 授权（用户尚未输入密码）。" +
            "请把需要 root 的操作写进你的最终结果，由主会话处理或申请。"
          );
        }
        if (this.cfgRequireReason && String(args.reason ?? "").trim() === "") {
          throw new Error("[dsh-root-bridge] 申请 root 权限必须说明原因（reason）。若需关闭此要求，请在插件设置页把 requireReason 设为 false。");
        }
        const command = String(args.command ?? "").trim();
        if (command === "") throw new Error("[dsh-root-bridge] 命令不能为空");

        // 审批 (子代理策略为 input 时，以 GUI 密码输入作为授权门槛，不再逐次审批)
        if (!(delegated && this.cfgSubagentPolicy === "input")) {
          const approval = await this.askUser(
            root ?? agent,
            {
              requestId: randomUUID(),
              kind: "approval",
              toolName: "request_root",
              command,
              reason: String(args.reason ?? ""),
              escalation,
              warnings: SECURITY_WARNINGS_ZH,
            },
            exec.signal,
          );
          if (approval.decision !== "allow") {
            return `[dsh-root-bridge] 申请未获批准（${approval.reason ?? approval.decision ?? "拒绝"}），命令未执行。`;
          }
        }

        // 建立会话授权 (已存在则复用)
        if (!hasGrant) {
          const ok = await this.establishGrant(root ?? agent, exec.signal);
          if (!ok) {
            const reasons = {
              cancelled: "你在密码框中点了取消",
              timeout: "等待密码输入超时",
              "bad-password": "sudo 密码校验失败。注意：本机 sudo 连续 3 次失败会锁定账号 10 分钟，请核对无误后再试",
              faillock: "本机账号已有 sudo 失败记录，再做校验会直接触发 10 分钟锁定，已暂停尝试。请在终端执行 faillock --reset 清除计数后再试",
              "polkit-failed": "polkit 认证失败",
              "io-error": "临时凭证文件创建失败",
            };
            const why = reasons[this.grantFailure] ?? "未知原因";
            return `[dsh-root-bridge] 未能建立会话级 root 授权（${why}），命令未执行。`;
          }
        }
        const current = this.grants.get((root ?? agent).id);
        if (current === undefined) return "[dsh-root-bridge] 内部错误：授权状态丢失，命令未执行。";

        // 构造并执行
        const workdir = typeof args.workdir === "string" && args.workdir.trim() !== "" ? args.workdir : undefined;
        const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : undefined;
        try {
          let wrapped;
          let stdin;
          if (current.method === "sudo") {
            if (current.passwordless) {
              wrapped = `sudo -n -- bash -c ${shellQuote(command)}`;
            } else {
              wrapped = `sudo -S -p '' -- bash -c ${shellQuote(command)}`;
              stdin = `${readFileSync(current.pwFile, "utf8")}\n`;
            }
          } else {
            wrapped = `run0 --empower -- bash -c ${shellQuote(command)}`;
          }
          const result = await this.runCommand({
            command: wrapped,
            workdir,
            timeoutMs,
            ...(stdin === undefined ? {} : { stdin }),
            signal: exec.signal,
          });
          return this.renderRunResult(result);
        } catch (error) {
          return `[dsh-root-bridge] root 执行失败: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    };
  }

  /**
   * 直接 spawn 执行命令。
   * 不经过 ctx.shell.execute: 该服务在本组合里要求请求携带 sandboxPolicy(仅 bash 工具能拿到),
   * 而提权命令本身已由 sudo/run0 隔离, 不需要再套一层文件沙箱。
   */
  runCommand({ command, workdir, timeoutMs, signal, stdin }) {
    const timeout = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_COMMAND_TIMEOUT_MS;
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let child;
      const finish = (code, sig) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal !== undefined) signal.removeEventListener("abort", onAbort);
        resolve({
          exitCode: typeof code === "number" ? code : null,
          signal: sig === undefined ? null : sig,
          timedOut,
          timeoutMs: timeout,
          stdout: { text: stdout, truncated: false },
          stderr: { text: stderr, truncated: false },
        });
      };
      const kill = () => {
        try { child?.kill("SIGKILL"); } catch { /* ignore */ }
      };
      const onAbort = () => kill();
      const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
      if (signal !== undefined) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        child = spawn("bash", ["-c", command], {
          cwd: typeof workdir === "string" && workdir !== "" && existsSync(workdir) ? workdir : process.cwd(),
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        stderr += `spawn failed: ${error instanceof Error ? error.message : String(error)}`;
        finish(null, null);
        return;
      }
      child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", (error) => {
        stderr += `spawn failed: ${error instanceof Error ? error.message : String(error)}`;
        finish(null, null);
      });
      child.on("close", (code, sig) => finish(code, sig));
      try {
        if (stdin === undefined) child.stdin?.end();
        else child.stdin?.end(stdin);
      } catch { /* stdin may already be closed */ }
    });
  }

  renderRunResult(result) {
    const out = result.stdout?.truncated
      ? `${result.stdout.text}\n[output truncated; full output: ${result.stdout.spillPath ?? "(unavailable)"}]`
      : (result.stdout?.text ?? "");
    const err = result.stderr?.text ?? "";
    let body = out;
    if (err.length > 0) {
      if (body.length > 0 && !body.endsWith("\n")) body += "\n";
      body += `[stderr]\n${err}`;
    }
    if (body.length === 0) body = "(no output)";
    const markers = [];
    if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`);
    if (result.signal !== null && result.signal !== undefined) markers.push(`[killed by signal: ${result.signal}]`);
    else if (result.exitCode !== 0) markers.push(`[exit code: ${result.exitCode}]`);
    if (markers.length === 0) return body;
    if (!body.endsWith("\n")) body += "\n";
    return body + markers.join("\n");
  }

  /* ============================ 辅助 ============================ */

  rootOf(agent) {
    const agents = this.ctx.get("agents");
    if (agents === undefined) return agent;
    const roots = agents.roots();
    if (roots.includes(agent)) return agent;
    for (const root of roots) {
      if (agents.isOwnedBy(agent.id, root)) return root;
    }
    return agent;
  }
}

function denyText(kind) {
  if (kind === "rejected") return "[dsh-root-bridge] 用户拒绝了该次 root 权限申请，命令未执行。";
  return "[dsh-root-bridge] 无法建立会话级 root 授权（用户取消或校验失败），命令未执行。";
}

// 声明 Client 可调用的 Remote 方法 (网关 SRC 发现依赖该标记)。
Object.defineProperty(DshRootBridgeService.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([
      Object.freeze({ method: "decide", invocation: Object.freeze({ kind: "direct" }) }),
      Object.freeze({ method: "submitPassword", invocation: Object.freeze({ kind: "direct" }) }),
      Object.freeze({ method: "status", invocation: Object.freeze({ kind: "direct" }) }),
      Object.freeze({ method: "setMode", invocation: Object.freeze({ kind: "direct" }) }),
      Object.freeze({ method: "getConfig", invocation: Object.freeze({ kind: "direct" }) }),
      Object.freeze({ method: "update", invocation: Object.freeze({ kind: "direct" }) }),
    ]),
  }),
});

export default DshRootBridgeService;
