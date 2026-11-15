import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { buildBoardSnapshot } from '../../agent-display/board';
import type { AgentDisplayStatus } from '../../agent-display/types';
import { useEngineActivity } from '../../engineActivity';
import type { CostSnapshot, DispatchFeedResult, EngineSnapshot } from '../../engine/types';
import type { WorkbenchSettings } from '../../settings';
import type { Session } from '../../types';
import { Icon } from '../../components/icons';
import { useModuleState } from '../state';
import type { ModuleDefinition } from '../types';

type DisplayView = HTMLElement & {
  reload: () => void;
  executeJavaScript: (code: string) => Promise<unknown>;
  getWebContentsId: () => number;
};

type LoadFailEvent = Event & {
  errorDescription?: string;
  isMainFrame?: boolean;
  url?: string;
};

type NavigateEvent = Event & { url?: string; isMainFrame?: boolean };

/** 只保留 NEURAL 神经星环，其余主题与切换入口全部收起。 */
const THEMES: Array<{ id: string; no: number; label: string; hint: string }> = [
  { id: 'neural', no: 3, label: 'NEURAL 神经星环', hint: '13 个神经团 · 突触脉冲派单' },
];

const THEME_IDS = new Set(THEMES.map((theme) => theme.id));
const THEME_KEY = 'neural';

interface DisplayState {
  theme: string;
}

const INITIAL_STATE: DisplayState = { theme: THEME_KEY };

type Phase = 'preparing' | 'ready' | 'error';

/**
 * 只维护 NEURAL 一款：藏掉主题选择器与主题按钮、拦住 T 键轮换，
 * 并把页面 hash 锁回 NEURAL（页面内部的视角切换仍然可用）。
 */
function guardScript(id: string) {
  return `(() => {
    const kept = ${JSON.stringify([...THEME_IDS])};
    const fallback = ${JSON.stringify(id)};
    const initial = location.hash.slice(1);
    window.__wbTheme = kept.includes(initial) ? initial : window.__wbTheme || fallback;
    if (!document.getElementById('__wbKeep')) {
      const style = document.createElement('style');
      style.id = '__wbKeep';
      style.textContent = '.tcard,#picker,[data-series-pick]{display:none!important}';
      document.head.appendChild(style);
    }
    if (!window.__wbGuard) {
      window.__wbGuard = true;
      // 主题按钮在各主题的 shadow root 里，外部样式穿不进去，逐根注入一次。
      const hidePick = () => {
        document.querySelectorAll('.th-host').forEach((host) => {
          const root = host.shadowRoot;
          if (!root || root.getElementById('__wbHidePick')) return;
          const style = document.createElement('style');
          style.id = '__wbHidePick';
          style.textContent = '[data-series-pick]{display:none!important}';
          root.appendChild(style);
        });
      };
      hidePick();
      window.addEventListener('keydown', (event) => {
        if ((event.key === 't' || event.key === 'T') && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.stopImmediatePropagation();
        }
      }, true);
      window.setInterval(() => {
        hidePick();
        const hash = location.hash.slice(1);
        if (kept.includes(hash)) { window.__wbTheme = hash; return; }
        location.hash = window.__wbTheme || kept[0];
      }, 500);
    }
    const hash = location.hash.slice(1);
    if (!kept.includes(hash)) location.hash = window.__wbTheme;
    return { hash: location.hash.slice(1) };
  })()`;
}

/** 页面按屏幕刷新率跑（本机 120Hz），限到 60 帧省一半 GPU；只包装 rAF，不改页面文件。 */
const FPS_CAP = 60;

function bootstrapScript(id: string) {
  return `(() => {
    if (!window.__tacCap) {
      const LIMIT = 1000 / ${FPS_CAP} - 1.5;
      const native = window.requestAnimationFrame.bind(window);
      const pending = new Map();
      let seq = 0;
      let lastRun = -1e9;
      let nativeId = 0;
      const drain = (ts) => {
        nativeId = 0;
        if (ts - lastRun < LIMIT) { nativeId = native(drain); return; }
        lastRun = ts;
        const batch = Array.from(pending.values());
        pending.clear();
        for (const callback of batch) {
          try { callback(ts); } catch (error) { setTimeout(() => { throw error; }); }
        }
      };
      window.requestAnimationFrame = (callback) => {
        pending.set(++seq, callback);
        if (!nativeId) nativeId = native(drain);
        return seq;
      };
      window.cancelAnimationFrame = (id) => { pending.delete(id); };
      window.__tacCap = true;
    }
    const id = ${JSON.stringify(id)};
    if (!${JSON.stringify([...THEME_IDS])}.includes(location.hash.slice(1))) location.hash = id;
    return { hash: location.hash.slice(1), cap: true };
  })()`;
}

interface AgentDisplayProps {
  notify: (message: string, tone?: 'info' | 'success' | 'warn') => void;
  sessions: Session[];
  engine: EngineSnapshot | null;
  settings: WorkbenchSettings;
}

function AgentDisplay({ notify, sessions, engine, settings }: AgentDisplayProps) {
  const [state, setState] = useModuleState(INITIAL_STATE);
  const theme = THEME_IDS.has(state.theme) ? state.theme : THEME_KEY;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const activity = useEngineActivity();

  const [status, setStatus] = useState<AgentDisplayStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('preparing');
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(false);
  const [frameError, setFrameError] = useState('');
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState<'' | 'import' | 'update'>('');
  const [feed, setFeed] = useState<DispatchFeedResult | null>(null);
  const [cost, setCost] = useState<CostSnapshot | null>(null);
  const viewRef = useRef<DisplayView | null>(null);
  const setStateRef = useRef(setState);
  setStateRef.current = setState;

  // 共享快照：五款主题读的是同一份会话 + 派单 + 账本数据。
  const snapshot = useMemo(
    () => buildBoardSnapshot({ sessions, engine, activity, feed, cost }),
    [sessions, engine, activity, feed, cost],
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // 派单与账本走低频轮询，避免跟会话状态的高频变化缠在一起。
  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge?.dispatchFeed) return;
    let alive = true;
    const day = (offset: number) => {
      const value = new Date();
      const date = new Date(value.getFullYear(), value.getMonth(), value.getDate() - offset);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate(),
      ).padStart(2, '0')}`;
    };
    const load = () => {
      void bridge
        .dispatchFeed([day(0)])
        .then((next) => {
          if (alive) setFeed(next);
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 60000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const bridge = window.desktop;
    const root = settings.engine.dataPath;
    if (!bridge?.costSnapshot || !root) return;
    let alive = true;
    const load = () => {
      void bridge
        .costSnapshot(root)
        .then((next) => {
          if (alive) setCost(next);
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 120000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [settings.engine.dataPath]);

  /** 把共享快照推进大屏页面；页面里的 window.__WB 由补丁注入。 */
  const pushSnapshot = useCallback((view: DisplayView) => {
    const payload = JSON.stringify(snapshotRef.current).replace(/</g, '\\u003c');
    void view.executeJavaScript(`window.__WB && window.__WB.push(${payload})`).catch(() => {});
  }, []);

  /** 安装 60 帧节流、锁主题并落一次主题；加载完成后再调一次也无副作用。 */
  const bootstrap = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    void view.executeJavaScript(bootstrapScript(themeRef.current)).catch(() => {});
    void view.executeJavaScript(guardScript(themeRef.current)).catch(() => {});
    pushSnapshot(view);
  }, [pushSnapshot]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const timer = window.setTimeout(() => pushSnapshot(view), 260);
    return () => window.clearTimeout(timer);
  }, [snapshot, src, pushSnapshot]);

  const adopt = useCallback((next: AgentDisplayStatus, reload = false) => {
    setStatus(next);
    if (next.canceled) return;
    if (next.ok && next.url) {
      setPhase('ready');
      setSrc((previous) => previous || `${next.url}#${themeRef.current}`);
      setFrameError('');
      if (reload) {
        const view = viewRef.current;
        if (view) {
          setLoading(true);
          view.reload();
        }
      }
      return;
    }
    if (!next.ok) setPhase('error');
  }, []);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) {
      setPhase('error');
      setStatus({ ok: false, error: '桌面版才能加载战术大屏' });
      return;
    }
    let alive = true;
    setPhase('preparing');
    void bridge
      .agentDisplayEnsure()
      .then((next) => {
        if (alive) adopt(next);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setPhase('error');
        setStatus({ ok: false, error: String((error as Error)?.message || error) });
      });
    return () => {
      alive = false;
    };
  }, [adopt]);

  // 加载态与主题同步：页面里按 T 或点自带的主题卡时，顶栏的主题芯片也跟着走。
  // 事件订阅只跟 src 走；会话状态通过 ref 读写，避免频繁重订阅漏掉 dom-ready。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const onStart = () => {
      setLoading(true);
      setFrameError('');
    };
    const onStop = () => {
      setLoading(false);
      bootstrap();
    };
    const onReady = () => {
      setLoading(false);
      bootstrap();
    };
    const onNavigate = (event: Event) => {
      const detail = event as NavigateEvent;
      if (detail.isMainFrame === false) return;
      const hash = (detail.url || '').split('#')[1] || '';
      if (!THEME_IDS.has(hash) || hash === themeRef.current) return;
      setStateRef.current((prev) => ({ ...prev, theme: hash }));
    };
    const onFail = (event: Event) => {
      const detail = event as LoadFailEvent;
      if (detail.isMainFrame === false) return;
      setLoading(false);
      setFrameError(detail.errorDescription || '大屏页面加载失败');
    };
    view.addEventListener('did-start-loading', onStart);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('did-finish-load', onStop);
    view.addEventListener('dom-ready', onReady);
    view.addEventListener('did-navigate-in-page', onNavigate);
    view.addEventListener('did-fail-load', onFail);
    return () => {
      view.removeEventListener('did-start-loading', onStart);
      view.removeEventListener('did-stop-loading', onStop);
      view.removeEventListener('did-finish-load', onStop);
      view.removeEventListener('dom-ready', onReady);
      view.removeEventListener('did-navigate-in-page', onNavigate);
      view.removeEventListener('did-fail-load', onFail);
    };
  }, [src, bootstrap]);

  // 页面里 replaceState 切主题不一定触发导航事件，低频对一次 hash；
  // 能读到 hash 就顺便把 ready 置回，避免错过加载事件后点击主题失效。
  useEffect(() => {
    if (!src) return;
    const timer = window.setInterval(() => {
      const view = viewRef.current;
      if (!view) return;
      void view
        .executeJavaScript('location.hash.slice(1)')
        .then((hash: unknown) => {
          if (typeof hash === 'string' && THEME_IDS.has(hash) && hash !== themeRef.current) {
            setStateRef.current((prev) => ({ ...prev, theme: hash }));
          }
        })
        .catch(() => {});
    }, 1500);
    return () => window.clearInterval(timer);
  }, [src]);

  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [full]);

  // 焦点在大屏页面里时 Esc 由主进程转回来，只认自己这个 webview。
  useEffect(() => {
    const off = window.desktop?.onWebviewEscape?.((payload) => {
      const view = viewRef.current;
      if (!view) return;
      try {
        if (view.getWebContentsId() !== payload.id) return;
      } catch {
        return;
      }
      setFull(false);
    });
    return () => off?.();
  }, []);

  const reload = () => {
    const view = viewRef.current;
    if (!view) return;
    setFrameError('');
    setLoading(true);
    view.reload();
  };

  const openExternal = async () => {
    const result = await window.desktop?.agentDisplayOpenExternal();
    if (result && !result.ok) notify(result.error || '无法在浏览器打开', 'warn');
  };

  const importFile = async () => {
    const bridge = window.desktop;
    if (!bridge || busy) return;
    setBusy('import');
    try {
      const next = await bridge.agentDisplayImport();
      if (next.canceled) return;
      if (next.ok) {
        adopt(next, true);
        notify('已导入本地大屏页面', 'success');
      } else {
        notify(next.error || '导入失败', 'warn');
      }
    } catch (error) {
      notify(String((error as Error)?.message || error), 'warn');
    } finally {
      setBusy('');
    }
  };

  const updateAsset = async () => {
    const bridge = window.desktop;
    if (!bridge || busy) return;
    setBusy('update');
    try {
      const next = await bridge.agentDisplayReinstall();
      adopt(next, true);
      if (next.ok) notify('大屏资源已更新到最新版本', 'success');
      else notify(next.error || '更新失败', 'warn');
    } catch (error) {
      notify(String((error as Error)?.message || error), 'warn');
    } finally {
      setBusy('');
    }
  };

  const retry = async () => {
    const bridge = window.desktop;
    if (!bridge) return;
    setPhase('preparing');
    setFrameError('');
    adopt(await bridge.agentDisplayEnsure());
  };

  const phaseText =
    phase === 'preparing' ? '正在准备资源' : phase === 'ready' ? '已就绪' : '资源未就绪';
  const themeLabel = THEMES.find((entry) => entry.id === theme)?.label || theme;

  return (
    <div className={`tac-view${full ? ' full' : ''}`}>
      <div className="tac-bar">
        <span className="tac-brand">
          <Icon name="monitor" size={14} />
          Agent 战术大屏
        </span>
        <span className={`tac-dot ${phase}`} aria-hidden="true" />
        <span className="tac-phase" title={status?.path || status?.error}>
          {phaseText}
        </span>
        <span
          className="tac-origin"
          title="第三方项目 cyberdaddyleo/agent-display · PolyForm Noncommercial 1.0.0 · 商用需向作者授权"
        >
          外部 · 非商用
        </span>
        <span className="tac-spacer" />
        <button
          type="button"
          className="tac-btn"
          onClick={reload}
          disabled={!src}
          title="重新载入大屏"
        >
          <Icon name="refresh" size={12} />
        </button>
        <button
          type="button"
          className="tac-btn"
          onClick={() => void openExternal()}
          disabled={!src}
          title="在系统浏览器打开当前大屏"
        >
          <Icon name="arrowUpRight" size={12} />
        </button>
        <button
          type="button"
          className="tac-btn"
          onClick={() => void importFile()}
          disabled={busy !== ''}
          title="导入本地 agent-display 的 index.html"
        >
          <Icon name="folder" size={12} />
          {busy === 'import' ? '导入中' : '导入'}
        </button>
        <button
          type="button"
          className="tac-btn"
          onClick={() => void updateAsset()}
          disabled={busy !== ''}
          title="从 GitHub 重新下载 index.html 与 LICENSE"
        >
          <Icon name="cloud" size={12} />
          {busy === 'update' ? '更新中' : '更新'}
        </button>
        <button
          type="button"
          className="tac-btn"
          onClick={() => setFull((value) => !value)}
          title={full ? '退出全屏（Esc）' : '在工作台内全屏'}
        >
          <Icon name={full ? 'restore' : 'square'} size={12} />
          {full ? '退出' : '全屏'}
        </button>
      </div>

      <div className="tac-stage">
        {src ? (
          <webview
            ref={viewRef as unknown as RefObject<HTMLElement>}
            className="tac-frame"
            src={src}
            partition="persist:workbench-display"
            title={`Agent 战术大屏 · ${themeLabel}`}
          />
        ) : null}
        {loading && <i className="tac-progress" aria-hidden="true" />}
        {!src && (
          <div className="tac-cover">
            <Icon name="monitor" size={30} />
            <h4>{phase === 'error' ? '大屏资源没有就绪' : '正在准备战术大屏'}</h4>
            <p>
              {phase === 'error'
                ? status?.error || '请重试，或直接导入本地的 index.html。'
                : '首次进入会从 GitHub 下载一个 index.html 存到本机用户数据目录，之后直接本地加载；画面内容来自工作台里的真实会话与派单事件。'}
            </p>
            {phase === 'error' && (
              <div className="tac-cover-actions">
                <button type="button" className="ghost-btn" onClick={() => void retry()}>
                  重新下载
                </button>
                <button type="button" className="ghost-btn" onClick={() => void importFile()}>
                  导入本地文件
                </button>
              </div>
            )}
          </div>
        )}
        {frameError && src && (
          <div className="tac-cover overlay">
            <h4>大屏页面加载失败</h4>
            <p>{frameError}</p>
            <button type="button" className="ghost-btn" onClick={reload}>
              重新载入
            </button>
          </div>
        )}
        {full && (
          <div className="tac-full-hint">
            <kbd>Esc</kbd> 退出全屏
          </div>
        )}
      </div>
    </div>
  );
}

/** 外部战术大屏：只保留 NEURAL 神经星环，资源托管在本机用户数据目录。 */
export const agentDisplayModule: ModuleDefinition = {
  manifest: {
    id: 'agent.display',
    name: 'Agent 战术大屏',
    version: '0.4.0',
    description:
      '内嵌「Agent 战术大屏」的 NEURAL 神经星环：13 个神经团的突触脉冲视角，展示真实会话、派单链路与事件流。页面来自外部项目 cyberdaddyleo/agent-display，按 PolyForm Noncommercial 许可使用；资源只落在用户数据目录，不并入仓库。其余主题与主题切换入口已收起。',
    icon: 'monitor',
    kind: ['view', 'tool'],
    slots: ['center.view'],
    category: 'workspace',
    origin: 'third-party',
    permissions: ['net:fetch'],
    persistState: true,
  },
  center: {
    tabLabel: '大屏',
    title: 'Agent 战术大屏',
    subtitle: () => '外部 · 赛博老爸 · NEURAL 神经星环 · 真实会话',
  },
  View: ({ actions, sessions, engine, settings }) => (
    <AgentDisplay notify={actions.notify} sessions={sessions} engine={engine} settings={settings} />
  ),
};
