import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { SceneDesktop } from './components/SceneDesktop';
import type { BoardTile } from './board/types';
import { CommandPalette } from './components/CommandPalette';
import { EngineSurface } from './components/EngineSurface';
import { ModuleDrawer } from './components/ModuleDrawer';
import { NewSessionWizard } from './components/NewSessionWizard';
import { SessionEditor } from './components/SessionEditor';
import { SessionPanel } from './components/SessionPanel';
import { SessionRail } from './components/SessionRail';
import { SettingsPanel } from './components/SettingsPanel';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { Icon } from './components/icons';
import { initialSessions, roleIcon, statusLabel } from './data';
import { useCostMeter } from './hooks/useCostMeter';
import { useEngineData } from './hooks/useEngineData';
import { useEngineProcess } from './hooks/useEngineProcess';
import { useLongPressSort } from './hooks/useLongPressSort';
import { useSystemStats } from './hooks/useSystemStats';
import { normalizeModuleState, normalizeModules, resetModules } from './moduleDefaults';
import {
  emitWorkbenchEvent,
  getModuleDefinition,
  resolveModules,
  SlotHost,
  type ModuleActions,
  type ModuleStateChangeHandler,
} from './modules';
import {
  defaultSettings,
  mergeSettings,
  resolveTheme,
  themeBackground,
  themeVariables,
  type SettingsInput,
  type WorkbenchSettings,
} from './settings';
import {
  buildTemplates,
  createSessionFromTemplate,
  templateFromConfig,
  type SessionConfig,
  type SessionTemplate,
} from './templates';
import type { PaletteAction, RoleId, Session, ToastItem, ToastTone } from './types';
import { disposeSessionTerminals } from './terminal/runtime';

/** 盒子里的模块状态键形如 board:tile-xxx，需要先映射回模块再判断是否允许持久化。 */
function shouldPersistModuleState(session: Session, key: string) {
  const moduleId = key.startsWith('board:')
    ? session.board?.tiles?.find((tile) => tile.id === key.slice('board:'.length))?.moduleId
    : key;
  return Boolean(moduleId && getModuleDefinition(moduleId)?.manifest.persistState);
}

interface PersistedState {
  version?: number;
  sessions?: Session[];
  settings?: SettingsInput;
  customTemplates?: SessionTemplate[];
  railCollapsed?: boolean;
  selectedId?: string;
  /** 场景桌面里手动收进「收纳」的场景，和侧边会话栏无关。 */
  sceneShelf?: string[];
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const [selectedId, setSelectedId] = useState<RoleId>('coder');
  const [activeViewId, setActiveViewId] = useState('session.chat');
  const [panelOpen, setPanelOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [railQuery, setRailQuery] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [settings, setSettings] = useState<WorkbenchSettings>(defaultSettings);
  const [customTemplates, setCustomTemplates] = useState<SessionTemplate[]>([]);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [sceneShelf, setSceneShelf] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(!window.desktop);
  const [statePath, setStatePath] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const stats = useSystemStats();
  const {
    engine,
    loading: engineLoading,
    refresh: refreshEngine,
    error: engineError,
  } = useEngineData(settings.engine.dataPath);
  const { info: engineProcess, restart: restartEngine } = useEngineProcess();
  const cost = useCostMeter(settings.engine.dataPath);
  const templates = useMemo(
    () => buildTemplates(engine, customTemplates),
    [customTemplates, engine],
  );
  const theme = useMemo(() => resolveTheme(settings), [settings]);
  const themeStyle = useMemo(
    () =>
      ({
        ...themeVariables(theme),
        background: themeBackground(theme),
      }) as CSSProperties,
    [theme],
  );

  /** 挂到根节点：用 portal 渲染到 body 的浮层（如场景收纳）也能拿到主题变量。 */
  useEffect(() => {
    const root = document.documentElement;
    const variables = themeVariables(theme);
    Object.entries(variables).forEach(([key, value]) => root.style.setProperty(key, value));
    root.dataset.tone = theme.tone;
  }, [theme]);

  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0];
  const runningCount = sessions.filter((session) => session.status === 'running').length;
  const unreadCount = sessions.reduce((total, session) => total + session.unread, 0);
  const detailAnchorRef = useRef<HTMLDivElement | null>(null);
  const [detailMaxHeight, setDetailMaxHeight] = useState(0);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    let alive = true;
    desktop
      .loadState()
      .then(async (result) => {
        if (!alive) return;
        const stored = result.state as PersistedState | null;
        if (stored && Array.isArray(stored.sessions) && stored.sessions.length > 0) {
          const restored = stored.sessions.map((session) => ({
            ...session,
            icon: session.icon ?? roleIcon[session.id] ?? 'spark',
            modules: normalizeModules(Array.isArray(session.modules) ? session.modules : []),
            moduleState:
              session.moduleState && typeof session.moduleState === 'object'
                ? normalizeModuleState(session.moduleState)
                : {},
          }));
          setSessions(restored);
          if (stored.selectedId && restored.some((session) => session.id === stored.selectedId)) {
            setSelectedId(stored.selectedId);
          }
        }
        // 源码不绑定绝对路径：旧存档缺失的新路径字段由主进程按程序位置补齐。
        const defaults = await desktop.defaultPaths?.();
        const rawEngine = stored?.settings?.engine ?? {};
        const engineInput =
          defaults && Object.keys(defaults).length > 0
            ? {
                engineDir: typeof rawEngine.engineDir === 'string' ? rawEngine.engineDir : defaults.engineDir,
                dataPath: typeof rawEngine.dataPath === 'string' ? rawEngine.dataPath : defaults.dataPath,
                workspacePath:
                  typeof rawEngine.workspacePath === 'string'
                    ? rawEngine.workspacePath
                    : defaults.workspacePath,
                filesRoot:
                  typeof rawEngine.filesRoot === 'string' ? rawEngine.filesRoot : defaults.filesRoot,
                skillsPath:
                  typeof rawEngine.skillsPath === 'string' ? rawEngine.skillsPath : defaults.skillsPath,
                toolsPath:
                  typeof rawEngine.toolsPath === 'string' ? rawEngine.toolsPath : defaults.toolsPath,
              }
            : rawEngine;
        if (stored?.settings) {
          setSettings(mergeSettings({ ...stored.settings, engine: engineInput }));
        } else if (defaults) {
          setSettings(mergeSettings({ engine: engineInput }));
        }
        if (Array.isArray(stored?.customTemplates)) setCustomTemplates(stored.customTemplates);
        if (typeof stored?.railCollapsed === 'boolean') setRailCollapsed(stored.railCollapsed);
        if (Array.isArray(stored?.sceneShelf)) {
          setSceneShelf(stored.sceneShelf.filter((id): id is string => typeof id === 'string'));
        }
        setStatePath(result.path);
        setHydrated(true);
      })
      .catch(() => {
        if (alive) setHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const desktop = window.desktop;
    if (!hydrated || !desktop) return;
    const timer = window.setTimeout(() => {
      const persistedSessions = sessions.map((session) => ({
        ...session,
        moduleState: Object.fromEntries(
          Object.entries(session.moduleState).filter(([key]) =>
            shouldPersistModuleState(session, key),
          ),
        ),
      }));
      void desktop.saveState({
        version: 3,
        savedAt: new Date().toISOString(),
        sessions: persistedSessions,
        settings,
        customTemplates,
        railCollapsed,
        selectedId,
        sceneShelf,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [customTemplates, hydrated, railCollapsed, sceneShelf, selectedId, sessions, settings]);

  // 关闭行为以设置为准；等水合完成再同步，避免默认值把存档里的选择短暂覆盖。
  useEffect(() => {
    if (!hydrated) return;
    const desktop = window.desktop;
    if (!desktop?.setCloseToTray) return;
    void desktop.setCloseToTray(settings.workbench.closeToTray);
  }, [hydrated, settings.workbench.closeToTray]);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop?.onCloseToTrayChange) return;
    return desktop.onCloseToTrayChange((enabled) => {
      setSettings((prev) =>
        prev.workbench.closeToTray === enabled
          ? prev
          : { ...prev, workbench: { ...prev.workbench, closeToTray: enabled } },
      );
    });
  }, []);

  const centerModules = useMemo(() => resolveModules(selected, 'center.view'), [selected]);

  const reorderSessions = useCallback((ids: RoleId[]) => {
    setSessions((current) => {
      const byId = new Map(current.map((session) => [session.id, session]));
      const ordered = ids
        .map((id) => byId.get(id))
        .filter((session): session is Session => Boolean(session));
      const rest = current.filter((session) => !ids.includes(session.id));
      return [...ordered, ...rest];
    });
  }, []);

  const reorderCenterModules = useCallback(
    (ids: string[]) => {
      const positions = new Map(ids.map((id, index) => [id, index]));
      setSessions((current) =>
        current.map((session) => {
          if (session.id !== selectedId) return session;
          return {
            ...session,
            modules: session.modules.map((instance) => {
              const position = positions.get(instance.moduleId);
              if (position === undefined) return instance;
              return {
                ...instance,
                slotOrders: { ...instance.slotOrders, 'center.view': position },
              };
            }),
          };
        }),
      );
    },
    [selectedId],
  );

  const centerIds = useMemo(
    () => centerModules.map((instance) => instance.moduleId),
    [centerModules],
  );
  const centerSort = useLongPressSort({
    ids: centerIds,
    disabled: centerIds.length < 2,
    onReorder: reorderCenterModules,
  });
  const orderedCenterModules = useMemo(
    () =>
      centerSort.order
        .map((id) => centerModules.find((instance) => instance.moduleId === id))
        .filter((instance): instance is (typeof centerModules)[number] => Boolean(instance)),
    [centerModules, centerSort.order],
  );

  const activeModule =
    centerModules.find((instance) => instance.moduleId === activeViewId) ?? centerModules[0];
  const activeCenter = activeModule
    ? getModuleDefinition(activeModule.moduleId)?.center
    : undefined;
  const engineActive = activeModule?.moduleId === 'session.chat';
  const engineTarget = boardOpen ? 'board' : engineActive ? 'workbench' : null;

  // 中心视图默认落在 DSH 引擎；当前会话没有对话模块时退回第一个可用视图。
  useEffect(() => {
    if (!hydrated) return;
    if (!centerModules.some((instance) => instance.moduleId === activeViewId)) {
      const preferred = centerModules.find((instance) => instance.moduleId === 'session.chat');
      setActiveViewId(preferred?.moduleId ?? centerModules[0]?.moduleId ?? '');
    }
  }, [activeViewId, centerModules, hydrated]);

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3000);
  }, []);

  // 详情下拉的高度按按钮实际位置计算，保证始终停在底栏上方。
  useEffect(() => {
    if (!panelOpen) return;
    const update = () => {
      const anchor = detailAnchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setDetailMaxHeight(Math.max(220, window.innerHeight - rect.bottom - 48));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [panelOpen, railCollapsed, selectedId]);

  useEffect(() => {
    if (!panelOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!detailAnchorRef.current?.contains(event.target as Node)) setPanelOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanelOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [panelOpen]);

  const selectSession = useCallback((id: RoleId) => {
    setSelectedId(id);
    setSessions((current) =>
      current.map((session) => (session.id === id ? { ...session, unread: 0 } : session)),
    );
    emitWorkbenchEvent({ type: 'session.select', sessionId: id });
  }, []);

  const dispatchTask = useCallback(
    (id: RoleId, text: string) => {
      const target = sessions.find((session) => session.id === id);
      if (!target) return;

      setSessions((current) =>
        current.map((session) =>
          session.id === id
            ? {
                ...session,
                status: 'running',
                lastActive: '刚刚',
                events: [
                  {
                    id: `task-${Date.now()}`,
                    time: '刚刚',
                    ago: 0,
                    kind: 'task' as const,
                    text,
                  },
                  ...session.events,
                ].slice(0, 8),
              }
            : session,
        ),
      );
      emitWorkbenchEvent({ type: 'session.dispatch', sessionId: id, text });
      notify(`任务已派发至 ${target.name}`, 'success');

      window.setTimeout(() => {
        setSessions((current) =>
          current.map((session) =>
            session.id === id && session.status === 'running'
              ? { ...session, status: 'waiting' }
              : session,
          ),
        );
      }, settings.workbench.dispatchHoldMs);
    },
    [notify, sessions, settings.workbench.dispatchHoldMs],
  );

  const openSessionAndDispatch = useCallback(
    (id: RoleId) => {
      selectSession(id);
    },
    [selectSession],
  );

  const updateModuleState = useCallback<ModuleStateChangeHandler>(
    (sessionId, moduleId, update) => {
      setSessions((current) =>
        current.map((session) => {
          if (session.id !== sessionId) return session;
          const previous = session.moduleState[moduleId];
          const next =
            typeof update === 'function'
              ? (update as (prev: unknown) => unknown)(previous)
              : update;
          return {
            ...session,
            moduleState: { ...session.moduleState, [moduleId]: next },
          };
        }),
      );
    },
    [],
  );

  const toggleModule = useCallback(
    (sessionId: RoleId, moduleId: string, enabled: boolean) => {
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                modules: session.modules.map((instance) =>
                  instance.moduleId === moduleId ? { ...instance, enabled } : instance,
                ),
              }
            : session,
        ),
      );
      emitWorkbenchEvent({ type: 'module.toggle', sessionId, moduleId, enabled });
      const definition = getModuleDefinition(moduleId);
      notify(
        `${definition?.manifest.name ?? moduleId} 已${enabled ? '启用' : '停用'}`,
        enabled ? 'success' : 'info',
      );
    },
    [notify],
  );

  const resetSessionModules = useCallback(() => {
    setSessions((current) =>
      current.map((session) =>
        session.id === selected.id ? { ...session, modules: resetModules() } : session,
      ),
    );
    notify('已恢复默认模块装配', 'success');
  }, [notify, selected.id]);

  const createSession = useCallback(
    (template: SessionTemplate, config: SessionConfig) => {
      const session = createSessionFromTemplate(template, config, sessions);
      setSessions((current) => [...current, session]);
      setWizardOpen(false);
      selectSession(session.id);
      setActiveViewId(resolveModules(session, 'center.view')[0]?.moduleId ?? '');
      notify(`已创建会话「${session.name}」`, 'success');
      emitWorkbenchEvent({ type: 'session.create', sessionId: session.id });
    },
    [notify, selectSession, sessions],
  );

  const saveCustomTemplate = useCallback(
    (config: SessionConfig, existingId: string | null) => {
      const existing = existingId
        ? customTemplates.find((template) => template.id === existingId) ?? null
        : null;
      const template = templateFromConfig(config, existing, existingId ?? undefined);
      setCustomTemplates((current) =>
        existingId
          ? current.map((item) => (item.id === existingId ? template : item))
          : [...current, template],
      );
      notify(existingId ? `模板「${template.name}」已更新` : `已保存模板「${template.name}」`, 'success');
      return template.id;
    },
    [customTemplates, notify],
  );

  const deleteCustomTemplate = useCallback(
    (id: string) => {
      const target = customTemplates.find((template) => template.id === id);
      setCustomTemplates((current) => current.filter((template) => template.id !== id));
      notify(`已删除模板${target ? `「${target.name}」` : ''}`, 'info');
    },
    [customTemplates, notify],
  );

  const saveBoardLayout = useCallback(
    (id: RoleId, tiles: BoardTile[]) => {
      setSessions((current) =>
        current.map((session) =>
          session.id === id
            ? { ...session, board: { tiles, savedAt: new Date().toISOString() } }
            : session,
        ),
      );
      notify('场景布局已保存', 'success');
    },
    [notify],
  );

  const updateSession = useCallback(
    (id: RoleId, patch: Partial<Session>) => {
      setSessions((current) =>
        current.map((session) => (session.id === id ? { ...session, ...patch } : session)),
      );
      setEditorOpen(false);
      notify('会话设置已更新', 'success');
    },
    [notify],
  );

  const deleteSession = useCallback(
    (id: RoleId) => {
      if (id === 'hub') return;
      const target = sessions.find((session) => session.id === id);
      disposeSessionTerminals(id);
      setSessions((current) => current.filter((session) => session.id !== id));
      setSceneShelf((current) => current.filter((sceneId) => sceneId !== id));
      setEditorOpen(false);
      setSelectedId('hub');
      setPanelOpen(false);
      notify(`已删除会话${target ? `「${target.name}」` : ''}`, 'info');
    },
    [notify, sessions],
  );

  const moduleActions = useMemo<ModuleActions>(
    () => ({
      selectSession,
      openSession: openSessionAndDispatch,
      dispatchTask,
      notify,
      openSettings: () => setSettingsOpen(true),
      openNewSession: () => setWizardOpen(true),
      openModuleDrawer: () => setDrawerOpen(true),
    }),
    [dispatchTask, notify, openSessionAndDispatch, selectSession],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const paletteActions = useMemo<PaletteAction[]>(() => {
    const sessionActions: PaletteAction[] = sessions.map((session) => ({
      id: `session-${session.id}`,
      group: '切换会话',
      title: `${session.name} · ${session.role}`,
      hint: statusLabel[session.status],
      icon: session.icon,
      color: session.color,
      run: () => selectSession(session.id),
    }));

    const viewActions: PaletteAction[] = centerModules.map((instance) => {
      const definition = getModuleDefinition(instance.moduleId);
      return {
        id: `view-${instance.moduleId}`,
        group: '视图',
        title: `打开${definition?.center?.tabLabel ?? definition?.manifest.name ?? instance.moduleId}`,
        hint: instance.moduleId === activeModule?.moduleId ? '当前' : undefined,
        icon: definition?.manifest.icon ?? 'layers',
        run: () => setActiveViewId(instance.moduleId),
      };
    });

    const toggleActions: PaletteAction[] = selected.modules.flatMap((instance) => {
      const definition = getModuleDefinition(instance.moduleId);
      if (!definition) return [];
      return [
        {
          id: `toggle-${instance.moduleId}`,
          group: '模块 · 当前会话',
          title: `${instance.enabled ? '停用' : '启用'} ${definition.manifest.name}`,
          hint: instance.enabled ? '已启用' : '已停用',
          icon: instance.enabled ? 'pause' : 'check',
          run: () => toggleModule(selected.id, instance.moduleId, !instance.enabled),
        },
      ];
    });

    return [
      ...sessionActions,
      ...viewActions,
      ...toggleActions,
      {
        id: 'edit-session',
        group: '操作',
        title: '编辑会话身份',
        hint: selected.name,
        icon: 'pen',
        run: () => setEditorOpen(true),
      },
      {
        id: 'toggle-rail',
        group: '操作',
        title: railCollapsed ? '展开会话栏' : '折叠会话栏',
        icon: railCollapsed ? 'chevronRight' : 'chevronLeft',
        run: () => setRailCollapsed((value) => !value),
      },
      {
        id: 'toggle-panel',
        group: '操作',
        title: panelOpen ? '收起会话详情' : '展开会话详情',
        icon: 'panel',
        run: () => setPanelOpen((open) => !open),
      },
      {
        id: 'scene-desktop',
        group: '操作',
        title: boardOpen ? '返回中枢台' : '切换到场景桌面',
        hint: boardOpen ? '离开盒子拼装' : '盒子拼装 · 场景标签',
        icon: 'panel',
        run: () => setBoardOpen((open) => !open),
      },
      {
        id: 'module-drawer',
        group: '操作',
        title: '模块装配',
        hint: selected.name,
        icon: 'layers',
        run: () => setDrawerOpen(true),
      },
      {
        id: 'new-session',
        group: '操作',
        title: '新建会话',
        hint: '模板向导',
        icon: 'plus',
        run: () => setWizardOpen(true),
      },
      {
        id: 'settings',
        group: '操作',
        title: '工作台设置',
        icon: 'sliders',
        run: () => setSettingsOpen(true),
      },
      {
        id: 'rescan-engine',
        group: '操作',
        title: '重新扫描引擎数据',
        hint: engine?.ok ? `${engine.scenes.length} 场景` : '未连接',
        icon: 'refresh',
        run: refreshEngine,
      },
    ];
  }, [
    activeModule?.moduleId,
    boardOpen,
    centerModules,
    engine,
    notify,
    panelOpen,
    railCollapsed,
    refreshEngine,
    selectSession,
    selected,
    sessions,
    toggleModule,
  ]);

  return (
    <div
      className={`app${settings.appearance.density === 'compact' ? ' density-compact' : ''}${
        settings.appearance.motion ? '' : ' motion-off'
      }`}
      data-tone={theme.tone}
      style={themeStyle}
    >
      <TitleBar
        mode={boardOpen ? 'board' : 'workbench'}
        onModeChange={(mode) => setBoardOpen(mode === 'board')}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onRefreshEngine={() => {
          refreshEngine();
          notify(
            engine?.ok
              ? `已重新扫描引擎数据 · ${engine.scenes.length} 个场景`
              : '正在尝试连接引擎数据目录',
            engine?.ok ? 'success' : 'warn',
          );
        }}
        engineRefreshing={engineLoading}
        notify={notify}
      />

      <div className={`workspace no-detail${railCollapsed ? ' rail-collapsed' : ''}`}>
        <SessionRail
          sessions={sessions}
          selectedId={selectedId}
          query={railQuery}
          collapsed={railCollapsed}
          engine={engine}
          onQueryChange={setRailQuery}
          onSelect={selectSession}
          onNew={() => setWizardOpen(true)}
          onEdit={() => setEditorOpen(true)}
          onModules={() => setDrawerOpen(true)}
          onToggleCollapsed={() => setRailCollapsed((value) => !value)}
          onReorderSessions={reorderSessions}
        />

        <main className="center">
          <div className="center-head">
            <div className="head-titles">
              <div className="eyebrow">ORCHESTRATION</div>
              <h2>{activeCenter?.title ?? '工作台'}</h2>
              <p>
                {activeCenter?.subtitle({
                  sessionCount: sessions.length,
                  runningCount,
                  unreadCount,
                }) ?? '当前会话未启用中心视图模块'}
              </p>
            </div>

            {centerModules.length > 0 && (
              <div className="segmented">
                {orderedCenterModules.map((instance) => {
                  const definition = getModuleDefinition(instance.moduleId);
                  const dragging = centerSort.draggingId === instance.moduleId;
                  return (
                    <button
                      key={instance.moduleId}
                      type="button"
                      className={`${activeModule?.moduleId === instance.moduleId ? 'on' : ''}${
                        dragging ? ' dragging' : ''
                      }`}
                      title="长按拖拽排序"
                      onClick={() => {
                        if (centerSort.wasDragging()) return;
                        setActiveViewId(instance.moduleId);
                      }}
                      {...centerSort.getItemProps(instance.moduleId)}
                    >
                      {definition?.center?.tabLabel ??
                        definition?.manifest.name ??
                        instance.moduleId}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="head-actions">
              <div
                className="detail-anchor"
                ref={detailAnchorRef}
                style={
                  {
                    '--detail-max': detailMaxHeight ? `${detailMaxHeight}px` : undefined,
                  } as CSSProperties
                }
              >
                <button
                  type="button"
                  className={`ghost-btn detail-toggle${panelOpen ? ' on' : ''}`}
                  aria-expanded={panelOpen}
                  aria-controls="session-detail-popover"
                  title={panelOpen ? '收起会话详情' : '展开会话详情'}
                  onClick={() => setPanelOpen((open) => !open)}
                >
                  <Icon name="panel" size={13} />
                  会话详情
                  <Icon
                    name="chevronDown"
                    size={12}
                    className={`detail-chevron${panelOpen ? ' open' : ''}`}
                  />
                </button>

                {panelOpen && (
                  <SessionPanel
                    session={selected}
                    sessions={sessions}
                    actions={moduleActions}
                    settings={settings}
                    engine={engine}
                    engineLoading={engineLoading}
                    refreshEngine={refreshEngine}
                    onModuleStateChange={updateModuleState}
                    onClose={() => setPanelOpen(false)}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="center-body">
            {activeModule ? (
              <SlotHost
                slot="center.view"
                session={selected}
                sessions={sessions}
                actions={moduleActions}
                settings={settings}
                engine={engine}
                engineLoading={engineLoading}
                refreshEngine={refreshEngine}
                onModuleStateChange={updateModuleState}
                onlyModuleId={activeModule.moduleId}
              />
            ) : (
              <div className="center-empty">
                当前会话未启用中心视图模块，按 Ctrl K 打开模块面板。
              </div>
            )}
          </div>
        </main>
      </div>

      <StatusBar
        sessions={sessions}
        stats={stats}
        engine={engine}
        engineLoading={engineLoading}
        engineProcess={engineProcess}
        cost={cost}
      />

      {paletteOpen && (
        <CommandPalette actions={paletteActions} onClose={() => setPaletteOpen(false)} />
      )}

      {drawerOpen && (
        <ModuleDrawer
          session={selected}
          onToggle={(moduleId, enabled) => toggleModule(selected.id, moduleId, enabled)}
          onReset={resetSessionModules}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          engine={engine}
          engineLoading={engineLoading}
          engineError={engineError}
          statePath={statePath}
          onChange={setSettings}
          onRefreshEngine={refreshEngine}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {wizardOpen && (
        <NewSessionWizard
          templates={templates}
          engine={engine}
          engineLoading={engineLoading}
          onCreate={createSession}
          onSaveTemplate={saveCustomTemplate}
          onDeleteTemplate={deleteCustomTemplate}
          onClose={() => setWizardOpen(false)}
        />
      )}

      {editorOpen && (
        <SessionEditor
          session={selected}
          engine={engine}
          onSave={(patch) => updateSession(selected.id, patch)}
          onDelete={selected.id === 'hub' ? undefined : () => deleteSession(selected.id)}
          onClose={() => setEditorOpen(false)}
        />
      )}

      {boardOpen && (
        <SceneDesktop
          session={selected}
          sessions={sessions}
          actions={moduleActions}
          settings={settings}
          engine={engine}
          engineLoading={engineLoading}
          refreshEngine={refreshEngine}
          onSelectSession={selectSession}
          onReorderSessions={reorderSessions}
          onSaveLayout={saveBoardLayout}
          sceneShelf={sceneShelf}
          onSceneShelfChange={setSceneShelf}
          onToggleModule={(moduleId, enabled) => toggleModule(selected.id, moduleId, enabled)}
          onModuleStateChange={(moduleId, update) =>
            updateModuleState(selected.id, moduleId, update)
          }
        />
      )}

      <EngineSurface
        target={engineTarget}
        info={engineProcess}
        harness={engineTarget ? selected.harness ?? null : null}
        boot={settings.appearance.boot}
        onRestart={() => {
          void restartEngine();
        }}
      />

      <Toasts items={toasts} />
    </div>
  );
}
