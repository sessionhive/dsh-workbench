import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Icon } from '../../components/icons';
import type { Session, ToastTone } from '../../types';
import type { TerminalShellOption } from '../../terminal/types';
import {
  clearTerminalEntries,
  disposeTerminalRuntime,
  ensureTerminal,
  getTerminalRuntime,
  restartTerminal,
  runTerminalCommand,
  type TerminalStatus,
} from '../../terminal/runtime';
import { useModuleState } from '../state';
import type { ModuleDefinition } from '../types';

interface HistoryEntry {
  id: string;
  cmd: string;
  at: string;
}

/** 同一个终端盒子里的一个页签，各自持有独立的 shell。 */
interface TerminalTab {
  id: string;
  title: string;
}

interface TerminalState {
  /** 场景里自己补充的常用指令。 */
  custom: string[];
  /** 执行过的指令，去重后保留 40 条。 */
  history: HistoryEntry[];
  /** 左栏宽度占整个终端工作区的比例。 */
  splitX: number;
  /** 左栏上下分界占左栏高度的比例。 */
  splitY: number;
  /** 当前盒子里的终端页签。 */
  tabs: TerminalTab[];
  activeTabId: string;
}

const DEFAULT_TAB: TerminalTab = { id: 't1', title: '终端 1' };

const DEFAULT_STATE: TerminalState = {
  custom: [],
  history: [],
  splitX: 0.34,
  splitY: 0.52,
  tabs: [DEFAULT_TAB],
  activeTabId: DEFAULT_TAB.id,
};

const MIN_SPLIT_X = 0.16;
const MAX_SPLIT_X = 0.56;
const MIN_SPLIT_Y = 0.18;
const MAX_SPLIT_Y = 0.82;

const SCENE_PRESETS: Array<{ match: RegExp; commands: string[] }> = [
  {
    match: /(开发|编码|代码|dev|coder|frontend|backend|gui)/i,
    commands: [
      'npm run dev',
      'npm run build',
      'npx tsc --noEmit',
      'git status',
      'git diff --stat',
      'git log --oneline -10',
    ],
  },
  {
    match: /(运维|系统|诊断|ops|keeper|server)/i,
    commands: ['node -v', 'npm -v', 'npm ls --depth=0', 'netstat -ano | findstr :3083', 'git status'],
  },
  {
    match: /(调研|检索|信息|search|scout)/i,
    commands: ['rg --files | head -50', 'git log --oneline -20', 'pwd', 'ls'],
  },
  {
    match: /(写作|文档|内容|scribe|book)/i,
    commands: ['rg --files', 'git diff --stat', 'git log --oneline -10', 'pwd'],
  },
  {
    match: /(知识|记忆|整理|memory|curator)/i,
    commands: ['rg --files | head -80', 'git status', 'git log --oneline -10', 'pwd'],
  },
];

const FALLBACK_COMMANDS = ['pwd', 'ls', 'git status', 'node -v'];

type RunStatus = TerminalStatus;

const STATUS_LABEL: Record<RunStatus, string> = {
  starting: '启动中',
  running: '运行中',
  exited: '已退出',
  failed: '启动失败',
  offline: '不可用',
};

const STATUS_TONE: Record<RunStatus, string> = {
  starting: 'waiting',
  running: 'running',
  exited: 'idle',
  failed: 'offline',
  offline: 'offline',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function timeLabel() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function sceneCommands(session: Session) {
  const text = `${session.name} ${session.scene} ${session.role}`;
  const matched = SCENE_PRESETS.find((preset) => preset.match.test(text));
  return matched ? matched.commands : FALLBACK_COMMANDS;
}

function shortPath(value: string) {
  if (!value) return '';
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 3) return normalized;
  return `…/${parts.slice(-2).join('/')}`;
}

function Terminal({
  session,
  settings,
  instanceKey,
  notify,
}: {
  session: Session;
  settings: { shell: string; workspace: string };
  instanceKey: string;
  notify: (message: string, tone?: ToastTone) => void;
}) {
  const [state, setState] = useModuleState<TerminalState>(DEFAULT_STATE);
  const [commandDraft, setCommandDraft] = useState('');
  const [customDraft, setCustomDraft] = useState('');
  const [historyCursor, setHistoryCursor] = useState(-1);
  const [shellOptions, setShellOptions] = useState<TerminalShellOption[]>([]);
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);

  const config = useMemo(
    () => ({ shell: settings.shell || 'auto', workspace: settings.workspace || '' }),
    [settings.shell, settings.workspace],
  );

  const liveRef = useRef<{ x: number; y: number } | null>(null);
  const workRef = useRef<HTMLDivElement | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const shellSetting = config.shell;
  const workspace = config.workspace;

  const custom = Array.isArray(state?.custom) ? state.custom : [];
  const history = Array.isArray(state?.history) ? state.history : [];
  const splitX = clamp(
    live?.x ?? Number(state?.splitX ?? DEFAULT_STATE.splitX),
    MIN_SPLIT_X,
    MAX_SPLIT_X,
  );
  const splitY = clamp(
    live?.y ?? Number(state?.splitY ?? DEFAULT_STATE.splitY),
    MIN_SPLIT_Y,
    MAX_SPLIT_Y,
  );

  const baseState = useCallback(
    (previous: TerminalState | undefined): TerminalState => {
      const rawTabs = Array.isArray(previous?.tabs) ? previous.tabs : [];
      const tabs = rawTabs
        .filter(
          (tab): tab is TerminalTab =>
            Boolean(tab) && typeof tab.id === 'string' && tab.id.length > 0,
        )
        .map((tab, index) => ({
          id: tab.id,
          title:
            typeof tab.title === 'string' && tab.title.trim()
              ? tab.title.trim()
              : `终端 ${index + 1}`,
        }));
      const safeTabs = tabs.length > 0 ? tabs : [{ ...DEFAULT_TAB }];
      const activeTabId =
        typeof previous?.activeTabId === 'string' &&
        safeTabs.some((tab) => tab.id === previous.activeTabId)
          ? previous.activeTabId
          : safeTabs[0].id;
      return {
        custom: Array.isArray(previous?.custom) ? previous.custom : [],
        history: Array.isArray(previous?.history) ? previous.history : [],
        splitX:
          typeof previous?.splitX === 'number' && Number.isFinite(previous.splitX)
            ? previous.splitX
            : DEFAULT_STATE.splitX,
        splitY:
          typeof previous?.splitY === 'number' && Number.isFinite(previous.splitY)
            ? previous.splitY
            : DEFAULT_STATE.splitY,
        tabs: safeTabs,
        activeTabId,
      };
    },
    [],
  );

  const tabs = useMemo(() => baseState(state).tabs, [baseState, state]);
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === state?.activeTabId) ?? tabs[0],
    [state?.activeTabId, tabs],
  );

  // 每个页签各自挂一个运行时：切换页签不会打断另一个 shell，输出也各自保留。
  const runtime = useMemo(
    () => getTerminalRuntime(`${instanceKey}#${activeTab.id}`),
    [activeTab.id, instanceKey],
  );
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const { status, entries, shellName, shellPath, cwd } = snapshot;

  // 终端运行时挂在盒子上而不是组件上：切走再回来继续沿用同一个 shell 和输出。
  useEffect(() => {
    void ensureTerminal(runtime, config);
  }, [config, runtime]);

  useEffect(() => {
    const node = outputRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries]);

  useEffect(() => {
    if (!window.desktop?.terminalShells) return;
    let alive = true;
    void window.desktop.terminalShells().then((list) => {
      if (alive) setShellOptions(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const remember = useCallback(
    (command: string) => {
      setState((previous) => {
        const base = baseState(previous);
        const next: HistoryEntry = {
          id: `cmd-${Date.now().toString(36)}`,
          cmd: command,
          at: timeLabel(),
        };
        return {
          ...base,
          history: [next, ...base.history.filter((entry) => entry.cmd !== command)].slice(0, 40),
        };
      });
    },
    [baseState, setState],
  );

  const selectTab = (id: string) => {
    if (id === activeTab.id) return;
    setState((previous) => ({ ...baseState(previous), activeTabId: id }));
  };

  const addTab = () => {
    setState((previous) => {
      const base = baseState(previous);
      const used = new Set(base.tabs.map((tab) => tab.id));
      let index = base.tabs.length + 1;
      let id = `t${index}`;
      while (used.has(id)) {
        index += 1;
        id = `t${index}`;
      }
      return {
        ...base,
        tabs: [...base.tabs, { id, title: `终端 ${index}` }],
        activeTabId: id,
      };
    });
    notify('已新开终端页签', 'success');
  };

  const closeTab = (id: string) => {
    const base = baseState(state);
    if (base.tabs.length <= 1) {
      notify('至少保留一个终端页签', 'info');
      return;
    }
    const tabsNext = base.tabs.filter((tab) => tab.id !== id);
    const nextActive = base.activeTabId === id ? tabsNext[0].id : base.activeTabId;
    disposeTerminalRuntime(`${instanceKey}#${id}`);
    setState({ ...base, tabs: tabsNext, activeTabId: nextActive });
    notify('已关闭终端页签', 'info');
  };

  const runCommand = useCallback(
    async (raw: string) => {
      const command = raw.trim();
      if (!command) return;
      setCommandDraft('');
      setHistoryCursor(-1);

      if (!window.desktop?.terminalExec) {
        try {
          await navigator.clipboard.writeText(command);
          notify('已复制指令，可粘贴到 DSH 会话里执行', 'info');
        } catch {
          notify('当前环境无法执行或复制这条指令', 'warn');
        }
        return;
      }

      const ok = await runTerminalCommand(runtime, config, command);
      if (ok) remember(command);
    },
    [config, notify, remember, runtime],
  );

  const restart = async () => {
    await restartTerminal(runtime, config);
  };

  const copyCommand = async (command: string) => {
    try {
      const result = window.desktop
        ? await window.desktop.copyText(command)
        : { ok: false, error: '浏览器环境不支持复制' };
      if (!result.ok) {
        notify(result.error ?? '复制失败', 'warn');
        return;
      }
      notify('已复制指令', 'success');
    } catch {
      notify('复制失败', 'warn');
    }
  };

  const copyOutput = async () => {
    const text = entries
      .map((entry) =>
        entry.kind === 'cmd'
          ? `$ ${entry.text}`
          : entry.kind === 'note'
            ? `# ${entry.text}`
            : entry.text.replace(/\n$/, ''),
      )
      .join('\n');
    if (!text.trim()) {
      notify('终端还没有输出', 'info');
      return;
    }
    try {
      const result = window.desktop
        ? await window.desktop.copyText(text)
        : { ok: false, error: '浏览器环境不支持复制' };
      if (!result.ok) {
        notify(result.error ?? '复制失败', 'warn');
        return;
      }
      notify('已复制终端输出', 'success');
    } catch {
      notify('复制失败', 'warn');
    }
  };

  const common = useMemo(() => {
    const presets = sceneCommands(session);
    return [...presets, ...custom.filter((command) => !presets.includes(command))];
  }, [custom, session]);

  const addCustom = (event: FormEvent) => {
    event.preventDefault();
    const value = customDraft.trim();
    if (!value) return;
    if (common.includes(value)) {
      notify('这条指令已经在常用列表里了', 'info');
      return;
    }
    setState((previous) => {
      const base = baseState(previous);
      return { ...base, custom: [...base.custom, value] };
    });
    setCustomDraft('');
    notify('已加入场景常用指令', 'success');
  };

  const removeCustom = (cmd: string) => {
    setState((previous) => {
      const base = baseState(previous);
      return { ...base, custom: base.custom.filter((item) => item !== cmd) };
    });
  };

  const clearHistory = () => {
    setState((previous) => ({ ...baseState(previous), history: [] }));
    notify('已清空历史指令', 'info');
  };

  const commitSplit = useCallback(
    (next: { x: number; y: number }) => {
      setState((previous) => ({
        ...baseState(previous),
        splitX: next.x,
        splitY: next.y,
      }));
    },
    [baseState, setState],
  );

  const startSplit = (axis: 'x' | 'y') => (event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = workRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const start = { x: splitX, y: splitY };
    const apply = (next: { x: number; y: number }) => {
      liveRef.current = next;
      setLive(next);
    };
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (axis === 'x') {
        apply({
          x: clamp((moveEvent.clientX - rect.left) / rect.width, MIN_SPLIT_X, MAX_SPLIT_X),
          y: start.y,
        });
      } else {
        apply({
          x: start.x,
          y: clamp((moveEvent.clientY - rect.top) / rect.height, MIN_SPLIT_Y, MAX_SPLIT_Y),
        });
      }
    };
    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('terminal-splitting');
      document.body.style.cursor = '';
      const settled = liveRef.current;
      liveRef.current = null;
      setLive(null);
      if (settled) commitSplit(settled);
    };
    document.body.classList.add('terminal-splitting');
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const commands = history.map((entry) => entry.cmd);
    if (event.key === 'ArrowUp') {
      if (commands.length === 0) return;
      event.preventDefault();
      const next = Math.min(historyCursor + 1, commands.length - 1);
      setHistoryCursor(next);
      setCommandDraft(commands[next]);
    } else if (event.key === 'ArrowDown') {
      if (historyCursor < 0) return;
      event.preventDefault();
      const next = historyCursor - 1;
      setHistoryCursor(next);
      setCommandDraft(next < 0 ? '' : commands[next]);
    }
  };

  const shellHint = useMemo(() => {
    const chosen = shellOptions.find((option) => option.id === shellSetting);
    if (shellSetting === 'auto') {
      const fallback = shellOptions.find((option) => option.id === 'git-bash' && option.available);
      return fallback ? `自动 · 优先 ${fallback.label}` : '自动 · 按可用性选择';
    }
    return chosen?.label ?? shellSetting;
  }, [shellOptions, shellSetting]);

  const resolvedShell = shellName || shellHint;

  return (
    <div className="terminal-view">
      <div className="terminal-head">
        <span className="terminal-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div className="terminal-title">
          <strong>{session.scene || '通用'}终端</strong>
          <small title={shellPath || undefined}>
            {resolvedShell} · {shortPath(cwd) || workspace || '工作区目录'}
          </small>
        </div>
        <span className={`terminal-chip status-${status}`}>
          <i className={`status-dot ${STATUS_TONE[status]}`} />
          {STATUS_LABEL[status]}
        </span>
        <div className="terminal-head-actions">
          <button
            type="button"
            className="terminal-head-btn"
            title="复制全部输出"
            aria-label="复制全部输出"
            onClick={() => void copyOutput()}
          >
            <Icon name="copy" size={11} />
          </button>
          <button
            type="button"
            className="terminal-head-btn"
            title="清空输出"
            aria-label="清空输出"
            onClick={() => clearTerminalEntries(runtime)}
          >
            <Icon name="trash" size={11} />
          </button>
          <button
            type="button"
            className="terminal-head-btn"
            title="重启终端（结束当前进程）"
            aria-label="重启终端"
            onClick={() => void restart()}
          >
            <Icon name="refresh" size={11} />
          </button>
        </div>
      </div>

      <div className="terminal-tabs" role="tablist" aria-label="终端页签">
        {tabs.map((tab) => {
          const active = tab.id === activeTab.id;
          return (
            <div key={tab.id} className={`terminal-tab${active ? ' on' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="terminal-tab-main"
                onClick={() => selectTab(tab.id)}
                title={active ? `${tab.title} · 当前终端` : `切换到 ${tab.title}`}
              >
                <Icon name="terminal" size={11} />
                <span>{tab.title}</span>
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="terminal-tab-close"
                  aria-label={`关闭 ${tab.title}`}
                  title="关闭这个终端页签"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <Icon name="x" size={9} />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="terminal-tab-add"
          title="在当前盒子里新开一个终端"
          onClick={addTab}
        >
          <Icon name="plus" size={11} />
          新终端
        </button>
      </div>

      <div
        className="terminal-work"
        ref={workRef}
        style={{
          gridTemplateColumns: `minmax(132px, ${splitX * 100}%) 7px minmax(0, 1fr)`,
          gridTemplateRows: `minmax(78px, ${splitY * 100}%) 7px minmax(0, 1fr)`,
        }}
      >
        <section className="terminal-panel terminal-pane-presets">
          <header>
            <span>常用指令</span>
            <em>{common.length} 条</em>
          </header>
          <div className="terminal-list">
            {common.map((command) => {
              const isCustom = custom.includes(command);
              return (
                <div className="terminal-cmd" key={command}>
                  <button
                    type="button"
                    className="terminal-run-row"
                    title={`执行 ${command}`}
                    onClick={() => void runCommand(command)}
                  >
                    <span className="terminal-prompt">$</span>
                    <code>{command}</code>
                  </button>
                  {isCustom && (
                    <button
                      type="button"
                      className="terminal-remove"
                      title="移出常用"
                      aria-label={`移出 ${command}`}
                      onClick={() => removeCustom(command)}
                    >
                      <Icon name="x" size={10} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="terminal-copy"
                    title="复制这条指令"
                    aria-label={`复制 ${command}`}
                    onClick={() => void copyCommand(command)}
                  >
                    <Icon name="copy" size={11} />
                  </button>
                </div>
              );
            })}
          </div>

          <form className="terminal-add" onSubmit={addCustom}>
            <span className="terminal-prompt">+</span>
            <input
              value={customDraft}
              onChange={(event) => setCustomDraft(event.target.value)}
              placeholder="把这条指令收进常用…"
              spellCheck={false}
            />
            <button type="submit" disabled={!customDraft.trim()} title="加入常用指令">
              <Icon name="plus" size={11} />
              加入
            </button>
          </form>
        </section>

        <div
          className="terminal-split terminal-split-row"
          role="separator"
          aria-orientation="horizontal"
          title="上下拖动调整常用指令与历史的比例"
          onPointerDown={startSplit('y')}
        >
          <i />
        </div>

        <section className="terminal-panel terminal-pane-history">
          <header>
            <span>历史指令</span>
            <div className="terminal-panel-tools">
              <em>{history.length} 条</em>
              <button
                type="button"
                className="terminal-clear"
                onClick={clearHistory}
                disabled={history.length === 0}
              >
                清空
              </button>
            </div>
          </header>
          {history.length === 0 ? (
            <div className="terminal-empty">
              <Icon name="terminal" size={18} />
              <p>执行过的指令按时间留在这里，点一下就能再跑。</p>
            </div>
          ) : (
            <div className="terminal-list">
              {history.map((entry) => (
                <button
                  type="button"
                  className="terminal-history"
                  key={entry.id}
                  title={`执行 ${entry.cmd}`}
                  onClick={() => void runCommand(entry.cmd)}
                >
                  <span className="terminal-prompt">›</span>
                  <code>{entry.cmd}</code>
                  <small>{entry.at}</small>
                </button>
              ))}
            </div>
          )}
        </section>

        <div
          className="terminal-split terminal-split-col"
          role="separator"
          aria-orientation="vertical"
          title="左右拖动调整侧栏与终端的比例"
          onPointerDown={startSplit('x')}
        >
          <i />
        </div>

        <section className="terminal-screen">
          <div className="terminal-output" ref={outputRef}>
            {entries.length === 0 && (
              <p className="terminal-output-hint">
                正在连接 {resolvedShell}… 命令会直接在这个工作目录里执行。
              </p>
            )}
            {entries.map((entry) =>
              entry.kind === 'cmd' ? (
                <div className="terminal-line cmd" key={entry.id}>
                  <span>❯</span>
                  {entry.text}
                </div>
              ) : entry.kind === 'note' ? (
                <div className="terminal-line note" key={entry.id}>
                  {entry.text}
                </div>
              ) : (
                <div className="terminal-line out" key={entry.id}>
                  {entry.text}
                </div>
              ),
            )}
          </div>
          <form
            className="terminal-run"
            onSubmit={(event) => {
              event.preventDefault();
              void runCommand(commandDraft);
            }}
          >
            <span className="terminal-run-prompt">❯</span>
            <input
              value={commandDraft}
              onChange={(event) => {
                setCommandDraft(event.target.value);
                setHistoryCursor(-1);
              }}
              onKeyDown={onInputKeyDown}
              placeholder={
                status === 'running' ? '输入命令，Enter 执行；↑↓ 翻历史' : '按 Enter 重启终端并执行'
              }
              spellCheck={false}
              autoComplete="off"
            />
            <button type="submit" disabled={!commandDraft.trim()} title="执行命令">
              执行
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

/** 真实终端：左上常用指令、左下历史指令、右侧执行区，分栏比例随盒子保存。 */
export const terminalModule: ModuleDefinition = {
  manifest: {
    id: 'terminal.console',
    name: '终端',
    version: '0.2.0',
    description: '三区终端：常用指令、历史指令与真实 shell，分栏比例随盒子保存。',
    icon: 'terminal',
    kind: ['view', 'tool'],
    slots: ['center.view', 'detail.block'],
    category: 'workspace',
    permissions: ['notify'],
    persistState: true,
  },
  center: {
    tabLabel: '终端',
    title: '终端',
    subtitle: ({ sessionCount }) => `常用指令 · 历史复用 · ${sessionCount} 个场景共享`,
  },
  View: ({ session, actions, slot, settings, instanceKey }) => (
    <div className={`terminal-slot ${slot}`}>
      <Terminal
        session={session}
        instanceKey={instanceKey ?? `${session.id}:terminal.console`}
        settings={{ shell: settings.terminal.shell, workspace: settings.engine.workspacePath }}
        notify={actions.notify}
      />
    </div>
  ),
};
