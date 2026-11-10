window.__ModuleLoader__.load({
  id: '@xiaohuangbo/dsh-root-bridge',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const { useEffect, useRef, useState } = React;
    const h = React.createElement;

    const EVENT = 'dsh-root-bridge/approval-request';
    const NS = 'dsh-root-bridge';
    const NAMESPACE = 'dsh-root-bridge';

    /* ---------------- 弹窗队列 store ---------------- */
    const store = {
      current: null, // { request, resolve }
      queue: [],
      version: 0,
      listeners: new Set(),
      bump() {
        this.version += 1;
        for (const listener of this.listeners) listener();
      },
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      snapshot() {
        return this.current;
      },
    };

    function settleCurrent(payload) {
      const item = store.current;
      store.current = null;
      if (item) item.resolve(payload);
      if (store.queue.length > 0) store.current = store.queue.shift();
      store.bump();
    }

    function promptUser(request) {
      return new Promise((resolve) => {
        const item = { request, resolve };
        if (store.current === null) store.current = item;
        else store.queue.push(item);
        store.bump();
      });
    }

    /* ---------------- 语言包 ---------------- */
    const zh = {
      'approval.title': 'root 权限执行申请',
      'approval.subject': '工具 {toolName} 请求以 root 权限执行一条命令',
      'approval.command': '要执行的命令',
      'approval.reason': '申请原因',
      'approval.noReason': '（未说明原因）',
      'approval.method': '提权方式：{escalation}',
      'approval.allow': '允许执行',
      'approval.deny': '拒绝',
      'password.title': '身份验证（polkit）',
      'password.subject': '授予本会话 root 权限需要验证身份',
      'password.method': '提权方式：{escalation}',
      'password.label': '密码',
      'password.note': '密码仅保存在本机内存中用于本会话提权，不会写入会话日志或配置。',
      'password.submit': '验证并授权',
      'password.cancel': '取消',
      'warnings.title': '安全警告',
      'warnings.1': '尊重他人的隐私。',
      'warnings.2': '输入命令前请三思。',
      'warnings.3': '能力越大，责任越大。',
      'busy': '等待处理…',
      'chip.label': 'Root',
      'chip.ask': '申请制',
      'chip.full': '完全root',
      'chip.fakeroot': 'Fakeroot',
      'chip.ask.desc': '每次申请，弹窗批准后才执行',
      'chip.full.desc': '整个会话以 root 运行',
      'chip.fakeroot.desc': '伪装 root，没有真实特权',
      'chip.tip': '当前 root 权限模式，点击展开选项',
      'chip.menu': '选择 root 权限模式',
      'chip.failed': '切换失败',
      'settings.nav': 'Root 权限',
      'settings.title': 'Root 权限桥',
      'settings.intro': '为整个会话选择 root 权限模式；切换即时生效，无需重启 DSH。',
      'settings.mode': '权限模式',
      'settings.mode.ask': '申请制',
      'settings.mode.ask.desc': '模型通过 request_root 申请，网页弹窗展示命令与原因，逐次由你批准。',
      'settings.mode.full': '完全 root',
      'settings.mode.full.desc': '整个会话以 root 运行，bash 命令自动提权；首次需要时弹窗输入密码（polkit 认证）。',
      'settings.mode.fakeroot': 'Fakeroot',
      'settings.mode.fakeroot.desc': '无需密码，命令在 fakeroot 中运行，伪装 root 身份但没有真实特权。',
      'settings.escalation': '提权方式',
      'settings.escalation.sudo': 'sudo',
      'settings.escalation.sudo.desc': '密码经 SUDO_ASKPASS 注入，不进入命令或会话日志；免密 sudo 时无需输入。',
      'settings.escalation.run0': 'run0 --empower',
      'settings.escalation.run0.desc': 'polkit 认证（systemd 258+），授权缓存过期时自动重新弹窗验证并重试。',
      'settings.reason': '强制申请原因',
      'settings.reason.desc': '开启后，模型申请 root 权限时必须说明原因（requireReason）。',
      'settings.subagent': '子代理 sudo 策略',
      'settings.subagent.request': '逐次审批',
      'settings.subagent.request.desc': '子代理每次 root 操作都弹窗由你批准。',
      'settings.subagent.input': '允许输入密码',
      'settings.subagent.input.desc': '子代理可触发 GUI 密码输入，建立会话级授权。',
      'settings.subagent.inherit': '继承会话授权',
      'settings.subagent.inherit.desc': '子代理自动继承主会话已有的 root 授权。',
      'settings.timeout': '弹窗超时（分钟）',
      'settings.state': '已授予 root 授权的会话数：{count}',
      'settings.warnings': '安全警告',
      'settings.saved': '已保存，即时生效',
      'settings.failed': '保存失败：{error}',
      'settings.loadFailed': '读取配置失败，请刷新页面重试',
      'settings.language': '界面语言',
      'settings.language.auto': '自动判断',
      'settings.language.auto.desc': '跟随 DSH 当前语言自动切换。',
      'settings.language.zh': '中文',
      'settings.language.zh.desc': '始终使用简体中文。',
      'settings.language.en': 'English',
      'settings.language.en.desc': 'Always use English.',
    };
    const en = {
      'approval.title': 'Root execution request',
      'approval.subject': 'Tool {toolName} requests to run a command as root',
      'approval.command': 'Command',
      'approval.reason': 'Reason',
      'approval.noReason': '(no reason given)',
      'approval.method': 'Escalation: {escalation}',
      'approval.allow': 'Allow',
      'approval.deny': 'Deny',
      'password.title': 'Authentication (polkit)',
      'password.subject': 'Verification is required to grant this session root access',
      'password.method': 'Escalation: {escalation}',
      'password.label': 'Password',
      'password.note': 'The password is kept in host memory only for this session and is never written to the session log or configuration.',
      'password.submit': 'Verify & grant',
      'password.cancel': 'Cancel',
      'warnings.title': 'Security warnings',
      'warnings.1': 'Respect other people\u2019s privacy.',
      'warnings.2': 'Think twice before entering a command.',
      'warnings.3': 'With great power comes great responsibility.',
      'busy': 'Working…',
      'chip.label': 'Root',
      'chip.ask': 'Ask',
      'chip.full': 'Full root',
      'chip.fakeroot': 'Fakeroot',
      'chip.ask.desc': 'Approve each request in a popup',
      'chip.full.desc': 'The whole session runs as root',
      'chip.fakeroot.desc': 'Looks like root, no real privileges',
      'chip.tip': 'Current root mode. Click to open options',
      'chip.menu': 'Choose a root permission mode',
      'chip.failed': 'Switch failed',
      'settings.nav': 'Root bridge',
      'settings.title': 'Root permission bridge',
      'settings.intro': 'Choose the root permission mode for this session. Changes apply immediately; no restart needed.',
      'settings.mode': 'Permission mode',
      'settings.mode.ask': 'Request',
      'settings.mode.ask.desc': 'The model asks through request_root; a web popup shows the command and reason for your approval.',
      'settings.mode.full': 'Full root',
      'settings.mode.full.desc': 'The whole session runs as root; bash calls are elevated. The first use asks for your password (polkit).',
      'settings.mode.fakeroot': 'Fakeroot',
      'settings.mode.fakeroot.desc': 'No password; commands run under fakeroot and only appear to be root.',
      'settings.escalation': 'Escalation',
      'settings.escalation.sudo': 'sudo',
      'settings.escalation.sudo.desc': 'The password is injected through SUDO_ASKPASS and never appears in commands or the session log.',
      'settings.escalation.run0': 'run0 --empower',
      'settings.escalation.run0.desc': 'polkit authentication (systemd 258+); an expired grant re-prompts and retries once.',
      'settings.reason': 'Require a reason',
      'settings.reason.desc': 'The model must explain why it needs root when requesting.',
      'settings.subagent': 'Subagent sudo policy',
      'settings.subagent.request': 'Ask each time',
      'settings.subagent.request.desc': 'Every subagent root action needs your approval.',
      'settings.subagent.input': 'Allow password entry',
      'settings.subagent.input.desc': 'A subagent may trigger the password prompt to establish the session grant.',
      'settings.subagent.inherit': 'Inherit grant',
      'settings.subagent.inherit.desc': 'Subagents inherit the session root grant silently.',
      'settings.timeout': 'Popup timeout (minutes)',
      'settings.state': 'Sessions with a root grant: {count}',
      'settings.warnings': 'Security warnings',
      'settings.saved': 'Saved — applied immediately',
      'settings.failed': 'Save failed: {error}',
      'settings.loadFailed': 'Failed to read configuration; refresh the page and retry',
      'settings.language': 'Language',
      'settings.language.auto': 'Auto',
      'settings.language.auto.desc': 'Follow the current DSH language.',
      'settings.language.zh': '中文',
      'settings.language.zh.desc': 'Always use Simplified Chinese.',
      'settings.language.en': 'English',
      'settings.language.en.desc': 'Always use English.',
    };

    /* ---------------- 界面语言 (中文 / English / 自动跟随 DSH) ---------------- */
    /**
     * forced: 插件设置里的选择 ('auto' | 'zh' | 'en')
     * dshActive: DSH 当前语言（来自 locale 服务快照的 active）
     * 自动模式下语言跟随 dshActive，其余情况强制使用所选语言。
     */
    const i18n = {
      forced: 'auto',
      dshActive: 'zh',
      listeners: new Set(),
      bump() { for (const listener of this.listeners) listener(); },
      setForced(value) {
        const next = value === 'zh' || value === 'en' ? value : 'auto';
        if (next === this.forced) return;
        this.forced = next;
        this.bump();
      },
      setDshActive(value) {
        const next = typeof value === 'string' && value !== '' ? value : this.dshActive;
        if (next === this.dshActive) return;
        this.dshActive = next;
        this.bump();
      },
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      get lang() {
        if (this.forced === 'zh' || this.forced === 'en') return this.forced;
        return String(this.dshActive).toLowerCase().startsWith('zh') ? 'zh' : 'en';
      },
    };

    /** 按当前有效语言取词并插值。 */
    function tr(key, vars) {
      const dict = i18n.lang === 'en' ? en : zh;
      const template = dict[key] ?? (typeof key === 'string' ? key : '');
      if (vars === undefined || template === '') return template;
      return String(template).replace(/{(\w+)}/g, (match, name) => (name in vars ? String(vars[name]) : match));
    }

    /** 组件内使用：语言变化时自动重渲染。 */
    function useTr() {
      const [, force] = useState(0);
      useEffect(() => i18n.subscribe(() => force((n) => n + 1)), []);
      return tr;
    }

    /* ---------------- 样式 (宿主主题 token) ---------------- */
    const styles = {
      layer: {
        position: 'fixed', inset: 0, zIndex: 2147483000, pointerEvents: 'none',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '72px 16px 16px',
      },
      card: {
        pointerEvents: 'auto', width: '100%', maxWidth: 640,
        border: '1px solid var(--dsw-alias-state-warn-secondary)',
        borderRadius: 'var(--dsw-radius-xl)', background: 'var(--dsw-specific-input-major)',
        boxShadow: 'var(--dsw-shadow-lv2)', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      },
      strip: {
        background: 'var(--dsw-alias-state-warn-tertiary)', color: 'var(--dsw-alias-state-warn-primary)',
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', fontSize: 13, lineHeight: '18px',
      },
      dot: {
        width: 8, height: 8, borderRadius: '50%', background: 'var(--dsw-alias-state-warn-primary)', flexShrink: 0,
      },
      body: {
        display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px',
        maxHeight: '46vh', overflowY: 'auto', textAlign: 'left',
      },
      label: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, margin: 0 },
      headline: { color: 'var(--dsw-alias-label-primary)', fontSize: 15, fontWeight: 500, margin: 0 },
      mono: {
        color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'var(--ds-font-family-code)',
        fontSize: 13, lineHeight: '20px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        background: 'var(--dsw-alias-interactive-bg-secondary)', border: '1px solid var(--dsw-alias-interactive-border-secondary)',
        borderRadius: 'var(--dsw-radius-md)', padding: '8px 10px', margin: 0, maxHeight: 160, overflowY: 'auto',
      },
      reason: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: '20px', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      warnings: {
        border: '1px solid var(--dsw-alias-state-warn-secondary)', borderRadius: 'var(--dsw-radius-md)',
        background: 'var(--dsw-alias-state-warn-tertiary)', padding: '8px 12px', margin: 0,
      },
      warningsTitle: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: 12, fontWeight: 600, margin: '0 0 4px' },
      warningsItem: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: 12, lineHeight: '18px', margin: 0 },
      input: {
        width: '100%', boxSizing: 'border-box', color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-specific-input-minor)', border: '1px solid var(--dsw-alias-interactive-border-primary)',
        borderRadius: 'var(--dsw-radius-md)', padding: '8px 10px', fontSize: 14, outline: 'none',
      },
      actions: {
        display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 16px', flexWrap: 'wrap',
      },
      button: {
        border: '1px solid var(--dsw-alias-interactive-border-primary)', borderRadius: 'var(--dsw-radius-md)',
        background: 'var(--dsw-alias-interactive-bg-primary)', color: 'var(--dsw-alias-label-primary)',
        padding: '7px 16px', fontSize: 13, cursor: 'pointer', lineHeight: '18px',
      },
      buttonPrimary: {
        border: '1px solid transparent', borderRadius: 'var(--dsw-radius-md)',
        background: 'var(--dsw-alias-interactive-bg-brand)', color: 'var(--dsw-alias-label-inverse-primary)',
        padding: '7px 16px', fontSize: 13, cursor: 'pointer', lineHeight: '18px',
      },
      buttonDanger: {
        border: '1px solid transparent', borderRadius: 'var(--dsw-radius-md)',
        background: 'var(--dsw-alias-interactive-bg-danger)', color: 'var(--dsw-alias-state-error-primary)',
        padding: '7px 16px', fontSize: 13, cursor: 'pointer', lineHeight: '18px',
      },
    };

    /* ---------------- 弹窗组件 ---------------- */
    function useCurrentRequest() {
      const [current, setCurrent] = useState(() => store.snapshot());
      useEffect(() => store.subscribe(() => setCurrent(store.snapshot())), []);
      return current;
    }

    function RootBridgeModal(props) {
      const t = useTr();
      const item = useCurrentRequest();
      const [password, setPassword] = useState('');
      const [showPassword, setShowPassword] = useState(false);
      const [busy, setBusy] = useState(false);
      const inputRef = useRef(null);

      useEffect(() => {
        // 每次新请求都要重置 busy/密码: 之前只在密码请求里重置,
        // 导致回答过一次之后, 下一个审批弹窗的按钮一直是 disabled(点了没反应), 必须刷新页面才恢复。
        setBusy(false);
        setPassword('');
        setShowPassword(false);
        if (item !== null && item.request.kind === 'password') {
          const timer = setTimeout(() => inputRef.current?.focus(), 30);
          return () => clearTimeout(timer);
        }
        return undefined;
      }, [item]);

      useEffect(() => {
        if (item === null) return undefined;
        const request = item.request;
        const onAbort = () => settleCurrent({ decision: 'deny', reason: 'cancelled' });
        request.signal?.addEventListener('abort', onAbort, { once: true });
        return () => request.signal?.removeEventListener('abort', onAbort);
      }, [item]);

      if (item === null) return null;
      const { request } = item;
      const key = (k, vars) => t(k, vars);
      const fmt = (text) => (typeof text === 'string' ? text : text ?? '');

      const answer = (payload) => {
        if (busy) return;
        setBusy(true);
        settleCurrent(payload);
      };

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (request.kind === 'password') answer({ decision: 'cancel' });
          else answer({ decision: 'deny', reason: 'cancelled' });
        }
      };

      if (request.kind === 'password') {
        const submit = () => {
          if (password === '') return;
          answer({ decision: 'submit', password });
        };
        return h('div', {
          style: styles.layer, role: 'dialog', 'aria-modal': true, 'aria-label': t('password.title'), onKeyDown,
        }, h('div', { style: styles.card }, [
          h('div', { style: styles.strip }, [h('span', { style: styles.dot }), key('password.title')]),
          h('div', { style: styles.body }, [
            h('p', { style: styles.headline }, key('password.subject')),
            h('p', { style: styles.label }, key('password.method', { escalation: fmt(request.escalation) })),
            h('label', { style: { ...styles.label, marginTop: 4 } }, key('password.label')),
            h('input', {
              ref: inputRef, type: showPassword ? 'text' : 'password', style: styles.input, value: password,
              // 关闭浏览器自动填充: 自动填入的旧密码会让 sudo 校验失败且难以察觉
              autoComplete: 'off', name: 'dsh-root-bridge-sudo-password', spellCheck: false,
              placeholder: '\u2022\u2022\u2022\u2022\u2022\u2022',
              onChange: (e) => setPassword(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') submit(); },
            }),
            h('button', {
              type: 'button',
              style: { ...styles.label, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textAlign: 'left' },
              onClick: () => setShowPassword((v) => !v),
            }, showPassword ? '隐藏密码' : '显示密码'),
            h('p', { style: { ...styles.label, color: 'var(--dsw-alias-label-tertiary)' } }, key('password.note')),
          ]),
          h('div', { style: styles.actions }, [
            h('button', { style: styles.button, disabled: busy, onClick: () => answer({ decision: 'cancel' }) }, key('password.cancel')),
            h('button', { style: styles.buttonPrimary, disabled: busy || password === '', onClick: submit }, key('password.submit')),
          ]),
        ]));
      }

      const allow = () => answer({ decision: 'allow' });
      const deny = () => answer({ decision: 'deny', reason: 'rejected' });
      return h('div', {
        style: styles.layer, role: 'dialog', 'aria-modal': true, 'aria-label': t('approval.title'), onKeyDown,
      }, h('div', { style: styles.card }, [
        h('div', { style: styles.strip }, [h('span', { style: styles.dot }), key('approval.title')]),
        h('div', { style: styles.body }, [
          h('p', { style: styles.headline }, key('approval.subject', { toolName: fmt(request.toolName) })),
          h('p', { style: styles.label }, key('approval.command')),
          h('pre', { style: styles.mono }, fmt(request.command)),
          h('p', { style: styles.label }, key('approval.reason')),
          h('p', { style: styles.reason }, fmt(request.reason) !== '' ? fmt(request.reason) : key('approval.noReason')),
          h('p', { style: styles.label }, key('approval.method', { escalation: fmt(request.escalation) })),
          h('div', { style: styles.warnings }, [
            h('p', { style: styles.warningsTitle }, key('warnings.title')),
            h('p', { style: styles.warningsItem }, '1. ' + t('warnings.1')),
            h('p', { style: styles.warningsItem }, '2. ' + t('warnings.2')),
            h('p', { style: styles.warningsItem }, '3. ' + t('warnings.3')),
          ]),
        ]),
        h('div', { style: styles.actions }, [
          h('button', { style: styles.buttonDanger, disabled: busy, onClick: deny }, key('approval.deny')),
          h('button', { style: styles.buttonPrimary, disabled: busy, onClick: allow }, key('approval.allow')),
        ]),
      ]));
    }

    /* ---------------- 底栏折叠模式选项 ---------------- */
    const MODES = ['ask', 'full', 'fakeroot'];
    /**
     * 悬停动画走 CSS 伪类 + transition（与 dsh-ide-git 同一套做法），
     * 避免用 React state 切换内联样式导致的整块重渲染和闪烁。
     */
    // 与内置底栏芯片（权限芯片 / 模型选择器）保持完全一致:
    // 透明无边框 + 悬停换成同一个 --dsw-alias-interactive-bg-hover，不加过渡。
    const CHIP_CSS = `
.dsh-root-bridge-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-root-bridge-opt:hover:not(:disabled):not(.is-active){background:var(--dsw-alias-interactive-bg-hover)}
`;
    const chipStyles = {
      root: {
        display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, position: 'relative',
      },
      // 与 .iWlSmW_trigger / ._7KE1Ra_trigger 同尺寸: 透明、无边框、radius-sm、高 28
      trigger: {
        display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 8px',
        borderRadius: 'var(--dsw-radius-sm)', background: '0 0', border: 'none', outline: 'none',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 13, fontWeight: 500, lineHeight: '20px', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
      },
      triggerOpen: {
        display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 8px',
        borderRadius: 'var(--dsw-radius-sm)', border: 'none', outline: 'none',
        background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)',
        fontSize: 13, fontWeight: 500, lineHeight: '20px', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
      },
      label: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 },
      value: { color: 'var(--dsw-alias-label-primary)', fontWeight: 500 },
      caret: { fontSize: 9, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 11, whiteSpace: 'nowrap' },
      menu: {
        position: 'fixed', zIndex: 1000, width: 248, boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', gap: 4, padding: 6,
        borderRadius: 'var(--dsw-radius-lg)', border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-specific-input-major)', boxShadow: 'var(--dsw-shadow-lv2)',
        pointerEvents: 'auto',
      },
      option: {
        display: 'flex', flexDirection: 'column', gap: 2, width: '100%', textAlign: 'left',
        border: '1px solid transparent', borderRadius: 'var(--dsw-radius-sm)',
        background: 'transparent', color: 'var(--dsw-alias-label-primary)',
        padding: '7px 8px', cursor: 'pointer',
      },
      optionActive: {
        display: 'flex', flexDirection: 'column', gap: 2, width: '100%', textAlign: 'left',
        border: '1px solid var(--dsw-alias-state-business-primary)',
        borderRadius: 'var(--dsw-radius-sm)', background: 'var(--dsw-alias-state-business-tertiary)',
        color: 'var(--dsw-alias-label-primary)', padding: '7px 8px', cursor: 'pointer',
      },
      optionTitle: { fontSize: 13, fontWeight: 600, lineHeight: '18px' },
      optionDesc: { fontSize: 12, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' },
    };

    function placeModeMenu(trigger) {
      const rect = trigger.getBoundingClientRect();
      const width = 248;
      return {
        left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)),
        bottom: Math.max(8, window.innerHeight - rect.top + 6),
      };
    }

    function InputBarModeSwitch(props) {
      const t = useTr();
      const [mode, setMode] = useState(null);
      const [open, setOpen] = useState(false);
      const [menuPos, setMenuPos] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const triggerRef = useRef(null);
      const menuRef = useRef(null);
      const api = props.rootBridge;

      useEffect(() => {
        let alive = true;
        if (api === undefined) return undefined;
        Promise.resolve()
          .then(() => api.status())
          .then((result) => {
            if (!alive) return;
            if (result !== null && typeof result === 'object' && result.ok === true) {
              const value = result.value;
              if (value !== null && typeof value === 'object' && MODES.includes(value.mode)) setMode(value.mode);
              if (value !== null && typeof value === 'object' && value.language !== undefined) i18n.setForced(value.language);
            }
          })
          .catch(() => {});
        return () => { alive = false; };
      }, []);

      useEffect(() => {
        if (!open) return undefined;
        const trigger = triggerRef.current;
        if (trigger) setMenuPos(placeModeMenu(trigger));
        const closeIfOutside = (event) => {
          const target = event.target;
          if (triggerRef.current !== null && triggerRef.current.contains(target)) return;
          if (menuRef.current !== null && menuRef.current.contains(target)) return;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        const reposition = () => {
          if (triggerRef.current) setMenuPos(placeModeMenu(triggerRef.current));
        };
        document.addEventListener('mousedown', closeIfOutside, true);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        return () => {
          document.removeEventListener('mousedown', closeIfOutside, true);
          document.removeEventListener('keydown', onKey);
          window.removeEventListener('resize', reposition);
          window.removeEventListener('scroll', reposition, true);
        };
      }, [open]);

      const switchTo = (next) => {
        setOpen(false);
        if (busy || api === undefined) return;
        if (mode === next) return;
        const previous = mode;
        setBusy(true);
        setError(null);
        setMode(next); // 先本地切换，失败再回滚
        Promise.resolve()
          .then(() => api.setMode(next))
          .then((result) => {
            if (result !== null && typeof result === 'object' && result.ok === true) {
              const value = result.value;
              if (value !== null && typeof value === 'object' && MODES.includes(value.mode)) setMode(value.mode);
              if (value !== null && typeof value === 'object' && value.language !== undefined) i18n.setForced(value.language);
            } else {
              const message = result !== null && typeof result === 'object' && result.error !== undefined
                ? (typeof result.error === 'string' ? result.error : (result.error.message ?? JSON.stringify(result.error)))
                : 'unknown error';
              setMode(previous);
              setError(message);
            }
          })
          .catch((cause) => {
            setMode(previous);
            setError(cause instanceof Error ? cause.message : String(cause));
          })
          .finally(() => setBusy(false));
      };

      if (mode === null) return null;
      const menu = open && menuPos !== null && typeof document !== 'undefined'
        ? ReactDOM.createPortal(h('div', {
          ref: menuRef,
          role: 'listbox',
          'aria-label': t('chip.menu'),
          style: { ...chipStyles.menu, left: menuPos.left, bottom: menuPos.bottom },
        }, MODES.map((id) => h('button', {
          key: id,
          type: 'button',
          role: 'option',
          'aria-selected': id === mode,
          disabled: busy,
          className: id === mode ? 'dsh-root-bridge-opt is-active' : 'dsh-root-bridge-opt',
          style: id === mode ? chipStyles.optionActive : chipStyles.option,
          onMouseDown: (event) => {
            event.preventDefault();
            event.stopPropagation();
            switchTo(id);
          },
        }, [
          h('span', { style: chipStyles.optionTitle }, t(`chip.${id}`)),
          h('span', { style: chipStyles.optionDesc }, t(`chip.${id}.desc`)),
        ]))), document.body)
        : null;
      return h('div', { style: chipStyles.root }, [
        h('button', {
          ref: triggerRef,
          type: 'button',
          disabled: busy,
          className: 'dsh-root-bridge-trigger',
          title: error !== null ? `${t('chip.failed')}: ${error}` : t('chip.tip'),
          'aria-haspopup': 'listbox',
          'aria-expanded': open,
          'aria-label': `${t('chip.label')} ${t(`chip.${mode}`)}`,
          style: open ? chipStyles.triggerOpen : chipStyles.trigger,
          onClick: () => setOpen((current) => !current),
        }, [
          h('span', { style: chipStyles.label }, t('chip.label')),
          h('span', { style: chipStyles.value }, t(`chip.${mode}`)),
          h('span', { style: chipStyles.caret, 'aria-hidden': true }, open ? '▴' : '▾'),
        ]),
        error !== null ? h('span', { style: chipStyles.error, title: error }, t('chip.failed')) : null,
        menu,
      ]);
    }

    /* ---------------- 设置页：Root 权限 ---------------- */
    const sectionStyles = {
      root: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760, color: 'var(--dsw-alias-label-primary)' },
      title: { margin: 0, fontSize: 18, fontWeight: 600 },
      intro: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: '20px' },
      group: { display: 'flex', flexDirection: 'column', gap: 6 },
      label: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', margin: 0 },
      hint: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', margin: 0, lineHeight: '18px' },
      row: { display: 'flex', gap: 8, flexWrap: 'wrap' },
      option: {
        flex: '1 1 180px', minWidth: 160, textAlign: 'left', cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-lg)',
        background: 'var(--dsw-specific-input-minor)', padding: '10px 12px', color: 'var(--dsw-alias-label-primary)',
        display: 'flex', flexDirection: 'column', gap: 4,
      },
      optionActive: {
        flex: '1 1 180px', minWidth: 160, textAlign: 'left', cursor: 'pointer',
        border: '1px solid var(--dsw-alias-state-business-primary)', borderRadius: 'var(--dsw-radius-lg)',
        background: 'var(--dsw-alias-state-business-tertiary)', padding: '10px 12px', color: 'var(--dsw-alias-label-primary)',
        display: 'flex', flexDirection: 'column', gap: 4,
      },
      optionTitle: { fontSize: 13, fontWeight: 600 },
      optionDesc: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', margin: 0 },
      warn: {
        border: '1px solid var(--dsw-alias-state-warn-secondary)', borderRadius: 'var(--dsw-radius-md)',
        background: 'var(--dsw-alias-state-warn-tertiary)', padding: '8px 12px',
      },
      warnTitle: { margin: '0 0 4px', fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-state-warn-primary)' },
      warnItem: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-warn-primary)' },
      status: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', margin: 0 },
      saved: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)', margin: 0 },
      failed: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', margin: 0 },
      timeoutInput: {
        width: 120, color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-specific-input-minor)',
        border: '1px solid var(--dsw-alias-interactive-border-primary)', borderRadius: 'var(--dsw-radius-md)',
        padding: '5px 8px', fontSize: 13,
      },
    };

    const MODE_INFO = [
      { key: 'ask', titleKey: 'settings.mode.ask', descKey: 'settings.mode.ask.desc' },
      { key: 'full', titleKey: 'settings.mode.full', descKey: 'settings.mode.full.desc' },
      { key: 'fakeroot', titleKey: 'settings.mode.fakeroot', descKey: 'settings.mode.fakeroot.desc' },
    ];
    const ESCALATION_INFO = [
      { key: 'sudo', titleKey: 'settings.escalation.sudo', descKey: 'settings.escalation.sudo.desc' },
      { key: 'run0', titleKey: 'settings.escalation.run0', descKey: 'settings.escalation.run0.desc' },
    ];
    const LANG_INFO = [
      { key: 'auto', titleKey: 'settings.language.auto', descKey: 'settings.language.auto.desc' },
      { key: 'zh', titleKey: 'settings.language.zh', descKey: 'settings.language.zh.desc' },
      { key: 'en', titleKey: 'settings.language.en', descKey: 'settings.language.en.desc' },
    ];
    const SUBAGENT_INFO = [
      { key: 'request', titleKey: 'settings.subagent.request', descKey: 'settings.subagent.request.desc' },
      { key: 'input', titleKey: 'settings.subagent.input', descKey: 'settings.subagent.input.desc' },
      { key: 'inherit', titleKey: 'settings.subagent.inherit', descKey: 'settings.subagent.inherit.desc' },
    ];

    function OptionCards({ t, options, value, disabled, onPick }) {
      return h('div', { style: sectionStyles.row }, options.map((option) => h('button', {
        key: option.key, type: 'button', disabled,
        style: option.key === value ? sectionStyles.optionActive : sectionStyles.option,
        onClick: () => onPick(option.key),
      }, [
        h('span', { style: sectionStyles.optionTitle }, t(option.titleKey)),
        h('span', { style: sectionStyles.optionDesc }, t(option.descKey)),
      ])));
    }

    function RootBridgeSettings(props) {
      const t = useTr();
      const api = props.rootBridge;
      const [config, setConfig] = useState(null);
      const [grants, setGrants] = useState(0);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [saved, setSaved] = useState(false);
      const [timeoutDraft, setTimeoutDraft] = useState('');

      useEffect(() => {
        let alive = true;
        if (api === undefined) return undefined;
        Promise.resolve().then(() => api.config()).then((result) => {
          if (!alive) return;
          if (result !== null && typeof result === 'object' && result.ok === true) {
            setConfig(result.value);
            i18n.setForced(result.value?.language);
            setTimeoutDraft(String(Math.round((result.value.promptTimeoutMs ?? 900000) / 60000)));
          } else {
            setError(t('settings.loadFailed'));
          }
        }).catch(() => { if (alive) setError(t('settings.loadFailed')); });
        Promise.resolve().then(() => api.status()).then((result) => {
          if (!alive) return;
          if (result !== null && typeof result === 'object' && result.ok === true) {
            const value = result.value ?? {};
            setGrants(Array.isArray(value.grants) ? value.grants.length : 0);
          }
        }).catch(() => {});
        return () => { alive = false; };
      }, []);

      const apply = (patch) => {
        if (busy || api === undefined) return;
        setBusy(true);
        setError(null);
        setSaved(false);
        Promise.resolve()
          .then(() => api.update(patch))
          .then((result) => {
            if (result !== null && typeof result === 'object' && result.ok === true) {
              setConfig(result.value);
              i18n.setForced(result.value?.language);
              setSaved(true);
              const timer = setTimeout(() => setSaved(false), 2500);
              void timer;
            } else {
              const message = result !== null && typeof result === 'object' && result.error !== undefined ? (result.error.message ?? String(result.error)) : 'unknown error';
              setError(t('settings.failed', { error: message }));
            }
          })
          .catch((cause) => setError(t('settings.failed', { error: cause instanceof Error ? cause.message : String(cause) })))
          .finally(() => setBusy(false));
      };

      const commitTimeout = () => {
        const minutes = Number(timeoutDraft);
        if (!Number.isFinite(minutes) || minutes <= 0) {
          setError(t('settings.failed', { error: 'timeout must be a positive number of minutes' }));
          return;
        }
        apply({ promptTimeoutMs: Math.round(minutes * 60000) });
      };

      if (config === null) {
        return h('div', { style: sectionStyles.root }, [
          h('h2', { style: sectionStyles.title }, t('settings.title')),
          h('p', { style: sectionStyles.hint }, error ?? t('settings.loadFailed')),
        ]);
      }

      return h('div', { style: sectionStyles.root }, [
        h('h2', { style: sectionStyles.title }, t('settings.title')),
        h('p', { style: sectionStyles.intro }, t('settings.intro')),
        h('div', { style: sectionStyles.group }, [
          h('p', { style: sectionStyles.label }, t('settings.language')),
          h(OptionCards, { t, options: LANG_INFO, value: config.language ?? 'auto', disabled: busy, onPick: (language) => apply({ language }) }),
        ]),
        h('div', { style: sectionStyles.group }, [
          h('p', { style: sectionStyles.label }, t('settings.mode')),
          h(OptionCards, { t, options: MODE_INFO, value: config.mode, disabled: busy, onPick: (mode) => apply({ mode }) }),
        ]),
        h('div', { style: sectionStyles.group }, [
          h('p', { style: sectionStyles.label }, t('settings.escalation')),
          h(OptionCards, { t, options: ESCALATION_INFO, value: config.escalation, disabled: busy, onPick: (escalation) => apply({ escalation }) }),
        ]),
        h('div', { style: sectionStyles.group }, [
          h('p', { style: sectionStyles.label }, t('settings.reason')),
          h('p', { style: sectionStyles.hint }, t('settings.reason.desc')),
          h('div', { style: sectionStyles.row }, [
            h('button', {
              type: 'button', disabled: busy,
              style: config.requireReason ? sectionStyles.optionActive : sectionStyles.option,
              onClick: () => apply({ requireReason: !config.requireReason }),
            }, [h('span', { style: sectionStyles.optionTitle }, config.requireReason ? '开 / On' : '关 / Off')]),
          ]),
        ]),
        h('div', { style: sectionStyles.group }, [
          h('p', { style: sectionStyles.label }, t('settings.subagent')),
          h(OptionCards, { t, options: SUBAGENT_INFO, value: config.subagentPolicy, disabled: busy, onPick: (subagentPolicy) => apply({ subagentPolicy }) }),
        ]),
        h('div', { style: sectionStyles.group }, [
          h('p', { style: sectionStyles.label }, t('settings.timeout')),
          h('div', { style: { display: 'flex', gap: 8 } }, [
            h('input', {
              type: 'number', min: 1, step: 1, value: timeoutDraft, disabled: busy,
              style: sectionStyles.timeoutInput,
              onChange: (event) => setTimeoutDraft(event.target.value),
              onBlur: commitTimeout,
              onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); commitTimeout(); } },
            }),
          ]),
        ]),
        h('p', { style: sectionStyles.status }, t('settings.state', { count: grants })),
        error === null ? null : h('p', { style: sectionStyles.failed }, error),
        saved ? h('p', { style: sectionStyles.saved }, t('settings.saved')) : null,
        h('div', { style: sectionStyles.warn }, [
          h('p', { style: sectionStyles.warnTitle }, t('settings.warnings')),
          h('p', { style: sectionStyles.warnItem }, '1. ' + t('warnings.1')),
          h('p', { style: sectionStyles.warnItem }, '2. ' + t('warnings.2')),
          h('p', { style: sectionStyles.warnItem }, '3. ' + t('warnings.3')),
        ]),
      ]);
    }

    /* ---------------- Client 插件入口 ---------------- */
    const inject = ['remote', 'slots', 'locale'];

    /** 每一步独立保护：客户端半部分的任何一步失败都只降级该步骤，绝不让整个插件条目激活失败而拖垮页面启动。 */
    function guard(label, fn) {
      try {
        return fn();
      } catch (error) {
        console.error(`[dsh-root-bridge] ${label} failed:`, error);
        return undefined;
      }
    }

    async function guardAsync(label, fn) {
      try {
        return await fn();
      } catch (error) {
        console.error(`[dsh-root-bridge] ${label} failed:`, error);
        return undefined;
      }
    }

    async function apply(ctx) {
      // 0) 底栏组件的 CSS 悬停过渡（与 dsh-ide-git 同样的注入口径）
      guard('chip styles', () => ctx.effect(() => {
        if (typeof document === 'undefined' || document.head === null) return () => {};
        const style = document.createElement('style');
        style.setAttribute('data-dsh-root-bridge', '');
        style.textContent = CHIP_CSS;
        document.head.appendChild(style);
        return () => { style.remove(); };
      }, 'dsh-root-bridge: chip styles'));

      // 1) 语言包（非致命）
      guard('locale dictionaries', () => ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-root-bridge: locale'));

      // 2) 挂载 remote 命名空间（非致命：水位返回值通道仍可独立完成审批应答）
      await guardAsync('remote namespace mount', async () => {
        const zodModule = require('zod');
        const z = zodModule.z ?? zodModule;
        const mkCodec = (typeSymbol, schema, jsonSchema) => ({
          mode: 'strict',
          typeSymbol,
          create: () => schema,
          ...(jsonSchema === undefined ? {} : { jsonSchema }),
        });
        const codecString = (typeSymbol) => mkCodec(typeSymbol, z.string(), { type: 'string' });
        const codecAnyResult = (typeSymbol) => mkCodec(typeSymbol, z.any(), { type: 'object' });
        const contribution = {
          package: '@xiaohuangbo/dsh-root-bridge',
          descriptors: [
            {
              id: 'dsh-root-bridge#decide',
              service: NAMESPACE,
              namespace: NAMESPACE,
              method: 'decide',
              invocation: { kind: 'direct' },
              parameters: [
                { name: 'requestId', wire: 'requestId', source: 'json', codec: codecString('dsh-root-bridge#decide:requestId') },
                { name: 'decision', wire: 'decision', source: 'json', codec: codecString('dsh-root-bridge#decide:decision') },
              ],
              result: codecAnyResult('dsh-root-bridge#decide:result'),
            },
            {
              id: 'dsh-root-bridge#submitPassword',
              service: NAMESPACE,
              namespace: NAMESPACE,
              method: 'submitPassword',
              invocation: { kind: 'direct' },
              parameters: [
                { name: 'requestId', wire: 'requestId', source: 'json', codec: codecString('dsh-root-bridge#submitPassword:requestId') },
                { name: 'password', wire: 'password', source: 'json', codec: codecString('dsh-root-bridge#submitPassword:password') },
              ],
              result: codecAnyResult('dsh-root-bridge#submitPassword:result'),
            },
            {
              id: 'dsh-root-bridge#status',
              service: NAMESPACE,
              namespace: NAMESPACE,
              method: 'status',
              invocation: { kind: 'direct' },
              parameters: [],
              result: codecAnyResult('dsh-root-bridge#status:result'),
            },
            {
              id: 'dsh-root-bridge#setMode',
              service: NAMESPACE,
              namespace: NAMESPACE,
              method: 'setMode',
              invocation: { kind: 'direct' },
              parameters: [
                { name: 'mode', wire: 'mode', source: 'json', codec: codecString('dsh-root-bridge#setMode:mode') },
              ],
              result: codecAnyResult('dsh-root-bridge#setMode:result'),
            },
            {
              id: 'dsh-root-bridge#getConfig',
              service: NAMESPACE,
              namespace: NAMESPACE,
              method: 'getConfig',
              invocation: { kind: 'direct' },
              parameters: [],
              result: codecAnyResult('dsh-root-bridge#getConfig:result'),
            },
            {
              id: 'dsh-root-bridge#update',
              service: NAMESPACE,
              namespace: NAMESPACE,
              method: 'update',
              invocation: { kind: 'direct' },
              parameters: [
                { name: 'patch', wire: 'patch', source: 'json', codec: codecAnyResult('dsh-root-bridge#update:patch') },
              ],
              result: codecAnyResult('dsh-root-bridge#update:result'),
            },
          ],
        };
        const disposeMount = await ctx.remote.$mount(contribution);
        ctx.effect(() => () => { Promise.resolve(disposeMount()).catch(() => {}); }, 'dsh-root-bridge: remote mount');
      });

      // 2.5) 界面语言：自动模式跟随 DSH 语言；插件设置覆盖时用设置值
      guard('language sync', () => ctx.effect(() => {
        const locale = ctx.locale;
        const readDsh = () => {
          try {
            const snapshot = typeof locale?.getLocale === 'function' ? locale.getLocale() : undefined;
            if (snapshot !== undefined && snapshot !== null) i18n.setDshActive(snapshot.active);
          } catch { /* 语言服务不可用时保持现状 */ }
        };
        readDsh();
        const off = typeof locale?.subscribe === 'function' ? locale.subscribe(() => readDsh()) : undefined;

        const bridge = ctx.get(`remote.${NAMESPACE}`);
        if (bridge !== undefined) {
          Promise.resolve()
            .then(() => bridge.getConfig())
            .then((result) => {
              if (result !== null && typeof result === 'object' && result.ok === true) i18n.setForced(result.value?.language);
            })
            .catch(() => {});
        }
        return () => { if (typeof off === 'function') off(); };
      }, 'dsh-root-bridge: language sync'));

      // 3) 轮询 status() 里的待回答请求 → 弹窗；决定走 decide/submitPassword
      //    (网关的单源远程事件已被 api-remotes 占用，故不用 Host→Client 事件)
      guard('approval poller', () => ctx.effect(() => {
        let stopped = false;
        let inFlight = false;
        // 已答过的 requestId: 宿主结算有延迟，轮询可能把同一条请求再弹一次，
        // 第二次点击「允许」时宿主已 handled:false —— 表现为"点了没反应"。
        const answered = new Set();

        const remember = (id) => {
          answered.add(id);
          if (answered.size > 200) {
            const oldest = answered.values().next().value;
            if (oldest !== undefined) answered.delete(oldest);
          }
        };

        const tick = () => {
          if (stopped || inFlight) return;
          if (store.current !== null) return; // 已有弹窗在显示
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          const bridge = ctx.get(`remote.${NAMESPACE}`);
          if (bridge === undefined) return;
          inFlight = true;
          Promise.resolve()
            .then(() => bridge.status())
            .then((result) => {
              if (stopped || store.current !== null) return;
              if (result === null || typeof result !== 'object' || result.ok !== true) return;
              const pending = result.value?.pending;
              if (!Array.isArray(pending) || pending.length === 0) return;
              const request = pending.find((candidate) => candidate !== null
                && typeof candidate === 'object'
                && typeof candidate.requestId === 'string'
                && !answered.has(candidate.requestId));
              if (request === undefined) return;
              remember(request.requestId);
              promptUser(request).then((decision) => {
                const api = ctx.get(`remote.${NAMESPACE}`);
                if (api === undefined) return;
                if (request.kind === 'approval') {
                  Promise.resolve(api.decide(request.requestId, decision?.decision ?? 'deny')).catch(() => {});
                } else if (request.kind === 'password') {
                  Promise.resolve(api.submitPassword(request.requestId, decision?.password ?? '')).catch(() => {});
                }
              }).catch(() => {});
            })
            .catch(() => {})
            .finally(() => { inFlight = false; });
        };

        const timer = setInterval(tick, 600);
        // Node 侧（测试/无浏览器）避免定时器吊住事件循环；浏览器里无 unref。
        if (timer !== null && typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
        tick();
        return () => {
          stopped = true;
          clearInterval(timer);
        };
      }, 'dsh-root-bridge: approval poller'));

      // 4) 全局弹窗层
      guard('overlay slot', () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'dsh-root-bridge-modal', order: 900, locale: NS,
      }, RootBridgeModal)));

      // 5) 底栏模式切换（composer 工具行左侧，与 dsh-ide-git 状态胶囊同一槽位）
      guard('input-bar mode switch', () => {
        const api = () => ctx.get(`remote.${NAMESPACE}`);
        const boundT = ctx.locale.bind(NS);
        return ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left', id: 'dsh-root-bridge.mode', order: 30, locale: NS,
        }, (pillProps) => h(InputBarModeSwitch, Object.assign({}, pillProps, {
          t: boundT,
          rootBridge: {
            status: () => api()?.status(),
            setMode: (mode) => api()?.setMode(mode),
          },
        }))));
      });

      // 6) 设置面板里的独立「Root 权限」设置页（与 memory-eternal 等插件同一机制）
      guard('settings section', () => {
        const api = () => ctx.get(`remote.${NAMESPACE}`);
        return ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'root-bridge', order: 30, label: () => ctx.locale.bind(NS)('settings.nav'), locale: NS,
          inject: () => ({ rootBridge: {
            config: () => api()?.getConfig(),
            update: (patch) => api()?.update(patch),
            status: () => api()?.status(),
          } }),
        }, RootBridgeSettings));
      });
    }

    return { inject, apply };
  },
});
