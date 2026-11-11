import type { TerminalStartResult } from './types';

export type TerminalStatus = 'starting' | 'running' | 'exited' | 'failed' | 'offline';

export interface TerminalEntry {
  id: number;
  kind: 'cmd' | 'out' | 'note';
  text: string;
}

export interface TerminalConfig {
  shell: string;
  workspace: string;
}

export interface TerminalSnapshot {
  status: TerminalStatus;
  entries: TerminalEntry[];
  shellName: string;
  shellPath: string;
  cwd: string;
  /** 当前 shell 对应的设置指纹；设置变化时据此重启。 */
  configKey: string;
}

export interface TerminalRuntime {
  key: string;
  termId: string;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => TerminalSnapshot;
}

interface TerminalRuntimeInternal extends TerminalRuntime {
  snapshot: TerminalSnapshot;
  listeners: Set<() => void>;
  startPromise: Promise<boolean> | null;
  seq: number;
}

const EMPTY: TerminalSnapshot = {
  status: 'starting',
  entries: [],
  shellName: '',
  shellPath: '',
  cwd: '',
  configKey: '',
};

/** 运行时实例按盒子存在，切换中枢台/场景桌面或折叠盒子都不会销毁 shell。 */
const runtimes = new Map<string, TerminalRuntimeInternal>();
let ipcBound = false;

/** 去掉 ANSI 颜色和交互序列，管道环境的输出里偶尔会混进来。 */
export function cleanTerminalChunk(raw: string) {
  return raw
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r(?!\n)/g, '');
}

export function configKeyOf(config: TerminalConfig) {
  return `${config.shell}|${config.workspace}`;
}

function asInternal(runtime: TerminalRuntime) {
  return runtime as TerminalRuntimeInternal;
}

function refresh(runtime: TerminalRuntimeInternal, patch: Partial<TerminalSnapshot>) {
  runtime.snapshot = { ...runtime.snapshot, ...patch };
  for (const listener of runtime.listeners) listener();
}

function pushEntry(
  runtime: TerminalRuntimeInternal,
  kind: TerminalEntry['kind'],
  text: string,
) {
  if (!text) return;
  const entries = runtime.snapshot.entries;
  let next: TerminalEntry[];
  const tail = entries[entries.length - 1];
  if (kind === 'out' && tail && tail.kind === 'out') {
    next = [...entries.slice(0, -1), { ...tail, text: (tail.text + text).slice(-30000) }];
  } else {
    runtime.seq += 1;
    next = [
      ...entries,
      { id: runtime.seq, kind, text: kind === 'out' ? text.slice(-30000) : text },
    ];
  }
  if (next.length > 500) next = next.slice(next.length - 500);
  refresh(runtime, { entries: next });
}

function bindIpc() {
  if (ipcBound) return;
  const api = window.desktop;
  if (!api?.terminalStart) return;
  ipcBound = true;
  api.onTerminalData((payload) => {
    const runtime = runtimes.get(payload.id);
    if (runtime) pushEntry(runtime, 'out', cleanTerminalChunk(payload.data));
  });
  api.onTerminalCwd((payload) => {
    const runtime = runtimes.get(payload.id);
    if (runtime) refresh(runtime, { cwd: payload.cwd });
  });
  api.onTerminalExit((payload) => {
    const runtime = runtimes.get(payload.id);
    if (!runtime) return;
    refresh(runtime, { status: 'exited' });
    pushEntry(
      runtime,
      'note',
      `进程已退出${
        typeof payload.code === 'number' ? `（退出码 ${payload.code}）` : ''
      }，输入命令或点重启会重新启动。`,
    );
  });
}

/** 取得某个盒子对应的终端运行时；不存在时创建但不自动启动。 */
export function getTerminalRuntime(key: string): TerminalRuntime {
  const termId = `term:${key}`;
  const existing = runtimes.get(termId);
  if (existing) {
    bindIpc();
    return existing;
  }
  const runtime: TerminalRuntimeInternal = {
    key,
    termId,
    snapshot: { ...EMPTY },
    listeners: new Set(),
    startPromise: null,
    seq: 0,
    subscribe(listener) {
      runtime.listeners.add(listener);
      return () => {
        runtime.listeners.delete(listener);
      };
    },
    getSnapshot() {
      return runtime.snapshot;
    },
  };
  runtimes.set(termId, runtime);
  bindIpc();
  return runtime;
}

async function startSession(
  runtime: TerminalRuntimeInternal,
  config: TerminalConfig,
): Promise<boolean> {
  const api = window.desktop;
  const key = configKeyOf(config);
  if (!api?.terminalStart) {
    refresh(runtime, { status: 'offline', configKey: key });
    pushEntry(runtime, 'note', '当前环境不支持系统终端，常用指令仍可复制到 DSH 会话执行。');
    return false;
  }

  refresh(runtime, { status: 'starting', configKey: key });
  let result: TerminalStartResult;
  try {
    result = await api.terminalStart({
      id: runtime.termId,
      shell: config.shell,
      cwd: config.workspace,
    });
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : '终端启动失败' };
  }

  // 启动期间盒子被移除或工作台退出，收掉刚拉起的进程。
  if (runtimes.get(runtime.termId) !== runtime) {
    void api.terminalKill?.(runtime.termId);
    return false;
  }

  if (!result.ok) {
    refresh(runtime, { status: 'failed' });
    pushEntry(runtime, 'note', result.error ?? '终端启动失败，可点右上角重启再试');
    return false;
  }

  refresh(runtime, {
    status: 'running',
    shellName: result.shellLabel ?? '',
    shellPath: result.shellPath ?? '',
    cwd: result.cwd ?? '',
  });
  pushEntry(runtime, 'note', `${result.shellLabel ?? 'shell'} · ${result.cwd ?? ''}`);
  return true;
}

function startTerminal(runtime: TerminalRuntimeInternal, config: TerminalConfig) {
  if (runtime.startPromise) return runtime.startPromise;
  const run = startSession(runtime, config);
  runtime.startPromise = run.finally(() => {
    runtime.startPromise = null;
  });
  return runtime.startPromise;
}

/**
 * 只在需要时启动：已有同配置的 shell 直接复用，
 * shell 或启动目录变化时换一条新进程，旧输出留在滚动区里。
 */
export function ensureTerminal(runtime: TerminalRuntime, config: TerminalConfig) {
  const internal = asInternal(runtime);
  if (internal.startPromise) return internal.startPromise;
  const key = configKeyOf(config);
  if (internal.snapshot.configKey !== key) return startTerminal(internal, config);
  if (internal.snapshot.status === 'starting' || internal.snapshot.status === 'running') {
    return Promise.resolve(true);
  }
  return Promise.resolve(false);
}

/** 执行一条命令；必要时先拉起 shell，命令会写进同一个滚动区。 */
export async function runTerminalCommand(
  runtime: TerminalRuntime,
  config: TerminalConfig,
  command: string,
) {
  const internal = asInternal(runtime);
  const ready = await ensureTerminal(runtime, config);
  if (!ready) return false;
  pushEntry(internal, 'cmd', command);
  const result = await window.desktop?.terminalExec?.(internal.termId, command);
  if (!result) return false;
  if (!result.ok) pushEntry(internal, 'note', result.error ?? '命令没有写进终端');
  return result.ok;
}

export function clearTerminalEntries(runtime: TerminalRuntime) {
  refresh(asInternal(runtime), { entries: [] });
}

export async function restartTerminal(runtime: TerminalRuntime, config: TerminalConfig) {
  const internal = asInternal(runtime);
  if (internal.startPromise) {
    await internal.startPromise.catch(() => false);
    internal.startPromise = null;
  }
  await window.desktop?.terminalKill?.(internal.termId);
  pushEntry(internal, 'note', '终端已重启');
  return startTerminal(internal, config);
}

/** 盒子被彻底移除时销毁运行时并结束对应 shell。 */
export function disposeTerminalRuntime(key: string) {
  const termId = `term:${key}`;
  const runtime = runtimes.get(termId);
  if (!runtime) return;
  runtimes.delete(termId);
  const kill = () => {
    void window.desktop?.terminalKill?.(termId);
  };
  const pending = runtime.startPromise;
  if (pending) void pending.catch(() => false).then(kill);
  else kill();
}

/** 删除场景时收掉它名下所有终端 shell，避免进程留在后台。 */
export function disposeSessionTerminals(sessionId: string) {
  for (const runtime of [...runtimes.values()]) {
    if (runtime.key.startsWith(`${sessionId}:`)) disposeTerminalRuntime(runtime.key);
  }
}

/** 盒子被移除时收掉它名下的所有页签 shell。 */
export function disposeTerminalInstance(instanceKey: string) {
  for (const runtime of [...runtimes.values()]) {
    if (runtime.key === instanceKey || runtime.key.startsWith(`${instanceKey}#`)) {
      disposeTerminalRuntime(runtime.key);
    }
  }
}

/**
 * 盒子里的终端实例键。主终端盒子与中枢台的终端页签共用同一个 shell，
 * 多开出来的终端各自独立。
 */
export function terminalInstanceKey(sessionId: string, tileId?: string) {
  return !tileId || tileId === 'tile-terminal.console'
    ? `${sessionId}:terminal.console`
    : `${sessionId}:${tileId}`;
}
