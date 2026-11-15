import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import { SceneBoard, resolveBoardOverlaps, resolveCollisions } from '../board/SceneBoard';
import type { BoardTile, TileDensity } from '../board/types';
import { isSessionWorking, useEngineActivity } from '../engineActivity';
import type { EngineProcessInfo, EngineSnapshot } from '../engine/types';
import { useLongPressSort } from '../hooks/useLongPressSort';
import {
  getModuleDefinition,
  resolveModules,
  type ModuleActions,
  type ModuleInstance,
  type ModuleStateUpdater,
  type SlotId,
} from '../modules';
import { ModuleBoundary } from '../modules/ModuleHost';
import { ModuleStateProvider } from '../modules/state';
import { isRemovedModule } from '../moduleDefaults';
import type { WorkbenchSettings } from '../settings';
import {
  disposeTerminalInstance,
  terminalInstanceKey,
} from '../terminal/runtime';
import type { Session } from '../types';
import { BoxSettingsPanel } from './BoxSettingsPanel';
import { Icon } from './icons';

interface SceneDesktopProps {
  session: Session;
  sessions: Session[];
  actions: ModuleActions;
  settings: WorkbenchSettings;
  engine: EngineSnapshot | null;
  engineLoading: boolean;
  engineProcess?: EngineProcessInfo | null;
  refreshEngine: () => void;
  onSelectSession: (id: Session['id']) => void;
  onReorderSessions: (ids: Session['id'][]) => void;
  onSaveLayout: (id: Session['id'], tiles: BoardTile[]) => void;
  /** 会话桌面自己的标签收纳；不影响左侧会话栏。 */
  sceneShelf: string[];
  onSceneShelfChange: (ids: string[]) => void;
  onToggleModule: (moduleId: string, enabled: boolean) => void;
  onModuleStateChange: (moduleId: string, update: unknown | ModuleStateUpdater) => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  core: '核心',
  workspace: '工作区',
  knowledge: '知识',
  session: '会话',
};

/** 会话标签按实际可用宽度铺开，放不下的才自动进入「收纳」。 */
const SCENE_TAB_GAP = 4;

function moduleTile(
  moduleId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  minW: number,
  minH: number,
): BoardTile {
  const definition = getModuleDefinition(moduleId);
  const category = definition?.manifest.category ?? 'session';
  return {
    id: `tile-${moduleId}`,
    kind: 'module',
    moduleId,
    title: definition?.manifest.name ?? moduleId,
    subtitle: CATEGORY_LABEL[category] ?? '模块',
    icon: definition?.manifest.icon ?? 'layers',
    x,
    y,
    w,
    h,
    minW,
    minH,
  };
}

interface TileGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  minH: number;
}

/** 新建会话时的默认盒子排布；只登记适合当盒子的中心视图模块。 */
const MODULE_GEOMETRY: Record<string, TileGeometry> = {
  'neuron.view': { x: 7, y: 0, w: 5, h: 5, minW: 4, minH: 4 },
  'todo.list': { x: 4, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
  'files.browser': { x: 0, y: 7, w: 4, h: 4, minW: 3, minH: 3 },
  'memory.search': { x: 4, y: 7, w: 4, h: 3, minW: 3, minH: 2 },
  'web.search': { x: 8, y: 5, w: 4, h: 3, minW: 4, minH: 3 },
  'terminal.console': { x: 0, y: 11, w: 5, h: 4, minW: 3, minH: 3 },
  'dispatch.timeline': { x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
  'run.status': { x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
};

/** 会话桌面只同步会话的中心视图模块，侧栏小模块不强行变成盒子。 */
function boardModuleIds(session: Session): string[] {
  return resolveModules(session, 'center.view').map((instance) => instance.moduleId);
}

/** 会话里新启用的模块补一个盒子，已有盒子（包括已移除的）保留位置。 */
function ensureModuleTiles(tiles: BoardTile[], session: Session): BoardTile[] {
  const existing = new Set(
    tiles.filter((tile) => tile.kind === 'module').map((tile) => tile.moduleId),
  );
  const missing = boardModuleIds(session).filter((moduleId) => !existing.has(moduleId));
  if (missing.length === 0) return tiles;

  const bottom = tiles.reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
  const added = missing.map((moduleId, index) =>
    moduleTile(
      moduleId,
      (index % 2) * 5,
      bottom + Math.floor(index / 2) * 3,
      5,
      3,
      3,
      2,
    ),
  );
  return [...tiles, ...added];
}

/** 单个盒子的存档校验：坏数据或旧版演示盒子只丢自己，不拖累整块布局。 */
function readBoardTile(value: unknown): BoardTile | null {
  if (!value || typeof value !== 'object') return null;
  const tile = value as Partial<BoardTile>;
  if (tile.kind !== 'module' && tile.kind !== 'info') return null;
  if (typeof tile.id !== 'string' || typeof tile.moduleId !== 'string') return null;
  if (typeof tile.title !== 'string') return null;
  if (
    ![tile.x, tile.y, tile.w, tile.h, tile.minW, tile.minH].every(
      (number) => typeof number === 'number' && Number.isFinite(number),
    )
  ) {
    return null;
  }
  return tile as BoardTile;
}

function restoreTiles(session: Session): BoardTile[] | null {
  const stored = session.board?.tiles;
  if (!Array.isArray(stored) || stored.length === 0) return null;
  // 会话信息盒子已下线；已移除的模块也不再回到桌面。
  const kept = stored
    .map(readBoardTile)
    .filter((tile): tile is BoardTile => Boolean(tile))
    .filter((tile) => tile.kind === 'module' && !isRemovedModule(tile.moduleId));
  return kept.length > 0 ? kept : null;
}

/** 载入存档时的可见性判断：已移除的盒子与未启用模块都不参与碰撞。 */
function visiblePredicate(session: Session) {
  const enabled = new Set(boardModuleIds(session));
  return (tile: BoardTile) =>
    !tile.hidden && (tile.kind !== 'module' || enabled.has(tile.moduleId));
}

function initialTiles(session: Session): BoardTile[] {
  const restored = restoreTiles(session);
  // 会话桌面默认留空，盒子由用户在「盒子设置」里按需添加。
  const base = restored ? ensureModuleTiles(restored, session) : [];
  return resolveBoardOverlaps(base, visiblePredicate(session));
}

function initialDirty(session: Session): boolean {
  const restored = restoreTiles(session);
  if (!restored) return false;
  const next = initialTiles(session);
  if (next.length !== restored.length) return true;
  const stored = new Map(restored.map((tile) => [tile.id, tile]));
  // 载入时修复了重叠或补了新模块，也要提示重新存档。
  return next.some((tile) => {
    const saved = stored.get(tile.id);
    return (
      !saved ||
      saved.x !== tile.x ||
      saved.y !== tile.y ||
      saved.w !== tile.w ||
      saved.h !== tile.h ||
      Boolean(saved.hidden) !== Boolean(tile.hidden)
    );
  });
}

function slotFor(density: TileDensity): SlotId {
  return density === 'compact' ? 'detail.block' : 'center.view';
}

interface BoardModuleViewProps {
  moduleId: string;
  stateKey: string;
  instanceKey: string;
  state: unknown;
  onStateChange: (update: unknown | ModuleStateUpdater) => void;
  density: TileDensity;
  session: Session;
  sessions: Session[];
  actions: ModuleActions;
  settings: WorkbenchSettings;
  engine: EngineSnapshot | null;
  engineLoading: boolean;
  engineProcess?: EngineProcessInfo | null;
  refreshEngine: () => void;
}

function BoardModuleView({
  moduleId,
  stateKey,
  instanceKey,
  state,
  onStateChange,
  density,
  session,
  sessions,
  actions,
  settings,
  engine,
  engineLoading,
  engineProcess,
  refreshEngine,
}: BoardModuleViewProps) {
  const definition = getModuleDefinition(moduleId);
  if (!definition?.View) {
    return <div className="board-tile-empty">模块「{moduleId}」未注册</div>;
  }

  const ModuleView = definition.View;
  const instance: ModuleInstance = { moduleId, enabled: true, order: 0, config: {} };

  return (
    <ModuleStateProvider moduleId={stateKey} value={state} onChange={onStateChange}>
      <ModuleBoundary moduleId={moduleId} label={definition.manifest.name}>
        <ModuleView
          slot={slotFor(density)}
          session={session}
          sessions={sessions}
          module={instance}
          instanceKey={instanceKey}
          actions={actions}
          settings={settings}
          engine={engine}
          engineLoading={engineLoading}
          engineProcess={engineProcess}
          refreshEngine={refreshEngine}
        />
      </ModuleBoundary>
    </ModuleStateProvider>
  );
}

/** 会话桌面：每个会话一块盒子布局，布局可写入存档。 */
export function SceneDesktop({
  session,
  sessions,
  actions,
  settings,
  engine,
  engineLoading,
  engineProcess,
  refreshEngine,
  onSelectSession,
  onReorderSessions,
  onSaveLayout,
  sceneShelf,
  onSceneShelfChange,
  onToggleModule,
  onModuleStateChange,
}: SceneDesktopProps) {
  const activity = useEngineActivity();
  const sceneSort = useLongPressSort({
    ids: sessions.filter((item) => item.id !== 'hub').map((item) => item.id),
    onReorder: (ids) => {
      const current = new Set(sessions.map((item) => item.id));
      const ordered = ids.filter((id) => id !== 'hub' && current.has(id));
      const next = [current.has('hub') ? 'hub' : null, ...ordered].filter(
        (id): id is Session['id'] => Boolean(id),
      );
      const rest = sessions.map((item) => item.id).filter((id) => !next.includes(id));
      onReorderSessions([...next, ...rest]);
    },
  });
  const orderedScenes = useMemo(() => {
    const byId = new Map(sessions.map((item) => [item.id, item]));
    const ordered = sceneSort.order
      .map((id) => byId.get(id))
      .filter((item): item is Session => Boolean(item));
    const hub = sessions.find((item) => item.id === 'hub');
    const missing = sessions.filter(
      (item) => item.id !== 'hub' && !sceneSort.order.includes(item.id),
    );
    return [...(hub ? [hub] : []), ...ordered, ...missing];
  }, [sceneSort.order, sessions]);

  // 会话标签收纳只作用于这块会话标签栏：手动收纳的先进去，宽度放不下的自动进去。
  const [shelfOpen, setShelfOpen] = useState(false);
  const [shelfPos, setShelfPos] = useState<{ top: number; right: number } | null>(null);
  const shelfRef = useRef<HTMLDivElement | null>(null);
  const shelfPopRef = useRef<HTMLDivElement | null>(null);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const tabMeasureRef = useRef<HTMLDivElement | null>(null);
  const manualShelf = useMemo(() => new Set(sceneShelf), [sceneShelf]);
  const hubScene = orderedScenes.find((item) => item.id === 'hub') ?? null;
  const nonHubScenes = useMemo(
    () => orderedScenes.filter((item) => item.id !== 'hub'),
    [orderedScenes],
  );
  const availableScenes = useMemo(
    () => nonHubScenes.filter((item) => !manualShelf.has(item.id)),
    [manualShelf, nonHubScenes],
  );
  // 先按全部铺开渲染，量到真实宽度后再收起放不下的标签。
  const [fit, setFit] = useState<{ count: number; restorable: Set<string> }>(() => ({
    count: Number.POSITIVE_INFINITY,
    restorable: new Set<string>(),
  }));
  const sceneTabs = useMemo(
    () => availableScenes.slice(0, fit.count),
    [availableScenes, fit.count],
  );
  const visibleIds = useMemo(() => new Set(sceneTabs.map((item) => item.id)), [sceneTabs]);
  const shelfScenes = useMemo(
    () => nonHubScenes.filter((item) => !visibleIds.has(item.id)),
    [nonHubScenes, visibleIds],
  );
  const restorableIds = fit.restorable;

  const measureTabs = useCallback(() => {
    const strip = tabMeasureRef.current;
    const container = tabStripRef.current;
    if (!strip || !container) return;
    const widths = new Map<string, number>();
    for (const node of Array.from(strip.children) as HTMLElement[]) {
      const id = node.dataset.tabId;
      if (id) widths.set(id, node.getBoundingClientRect().width);
    }
    const limit = container.clientWidth;
    let used = hubScene ? widths.get(hubScene.id) ?? 0 : 0;
    let count = 0;
    for (const item of availableScenes) {
      const width = widths.get(item.id) ?? 0;
      const next = used > 0 ? used + SCENE_TAB_GAP + width : width;
      if (next > limit + 0.5) break;
      used = next;
      count += 1;
    }
    // 剩下的空位还放得下手动收纳的会话时，允许一键移出。
    const restorable = new Set<string>();
    for (const item of nonHubScenes) {
      if (!manualShelf.has(item.id)) continue;
      const width = widths.get(item.id) ?? 0;
      const need = used > 0 ? width + SCENE_TAB_GAP : width;
      if (used + need > limit + 0.5) continue;
      restorable.add(item.id);
      used += need;
    }
    setFit((previous) => {
      if (previous.count === count && previous.restorable.size === restorable.size) {
        let same = true;
        for (const id of restorable) {
          if (!previous.restorable.has(id)) {
            same = false;
            break;
          }
        }
        if (same) return previous;
      }
      return { count, restorable };
    });
  }, [availableScenes, hubScene, manualShelf, nonHubScenes]);

  useLayoutEffect(() => {
    measureTabs();
    const container = tabStripRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureTabs());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measureTabs]);

  useEffect(() => {
    if (!shelfOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (shelfRef.current?.contains(target) || shelfPopRef.current?.contains(target)) return;
      setShelfOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShelfOpen(false);
    };
    const onResize = () => setShelfOpen(false);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [shelfOpen]);

  const toggleShelf = () => {
    if (shelfOpen) {
      setShelfOpen(false);
      return;
    }
    const rect = shelfRef.current?.getBoundingClientRect();
    if (!rect) return;
    // 弹层挂到 body 上，避免被会话桌面里内嵌的引擎画面盖住。
    setShelfPos({ top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right) });
    setShelfOpen(true);
  };
  const [mode, setMode] = useState<'board' | 'settings'>('board');
  const [tiles, setTiles] = useState<BoardTile[]>(() => initialTiles(session));
  const [dirty, setDirty] = useState(() => initialDirty(session));
  const [hasSaved, setHasSaved] = useState(() => Boolean(restoreTiles(session)));
  const [selectedTileId, setSelectedTileId] = useState('');
  const [moduleState, setModuleState] = useState<Record<string, unknown>>(() => ({
    ...session.moduleState,
  }));

  const activeSessionRef = useRef(session.id);
  const draftRef = useRef<Record<string, BoardTile[]>>({});
  const dirtyRef = useRef<Record<string, boolean>>({});
  const savedRef = useRef<Record<string, boolean>>({ [session.id]: Boolean(restoreTiles(session)) });
  const moduleStateRef = useRef<Record<string, Record<string, unknown>>>({});
  /** 在盒子设置里点「启用」后，等模块真正回到可见集合再处理碰撞。 */
  const pendingRevealRef = useRef<Set<string>>(new Set());
  const latestRef = useRef({ tiles, dirty, hasSaved, moduleState });
  latestRef.current = { tiles, dirty, hasSaved, moduleState };

  const enabledModuleIds = useMemo(() => new Set(boardModuleIds(session)), [session]);
  const isTileVisible = useCallback(
    (tile: BoardTile) =>
      !tile.hidden && (tile.kind !== 'module' || enabledModuleIds.has(tile.moduleId)),
    [enabledModuleIds],
  );
  const visibleTiles = useMemo(() => tiles.filter(isTileVisible), [isTileVisible, tiles]);

  useEffect(() => {
    const latest = latestRef.current;
    const previous = activeSessionRef.current;

    if (previous !== session.id) {
      draftRef.current[previous] = latest.tiles;
      dirtyRef.current[previous] = latest.dirty;
      savedRef.current[previous] = latest.hasSaved;
      moduleStateRef.current[previous] = latest.moduleState;

      activeSessionRef.current = session.id;
      const draft = draftRef.current[session.id];
      // 有草稿就沿用草稿（空桌面也是有效草稿）；否则按存档恢复，没有存档就是空桌面。
      const next = draft
        ? draft.length > 0
          ? ensureModuleTiles(draft, session)
          : draft
        : initialTiles(session);
      const stored = restoreTiles(session);
      setTiles(next);
      setDirty(dirtyRef.current[session.id] ?? initialDirty(session));
      setHasSaved(savedRef.current[session.id] ?? Boolean(stored));
      setModuleState(moduleStateRef.current[session.id] ?? { ...session.moduleState });
      // 不同会话里有同名盒子：切换后清掉旧选中项和待归位队列，避免改到别的会话。
      setSelectedTileId('');
      pendingRevealRef.current.clear();
      if (draft) draftRef.current[session.id] = next;
      return;
    }

    // 空桌面不自动填充盒子；已有布局时只为新启用的模块补位。
    if (latest.tiles.length === 0) return;
    const next = ensureModuleTiles(latest.tiles, session);
    if (next === latest.tiles) return;
    setTiles(next);
    setDirty(true);
    draftRef.current[session.id] = next;
    dirtyRef.current[session.id] = true;
  }, [session]);

  const updateTiles = useCallback((action: SetStateAction<BoardTile[]>) => {
    setTiles(action);
    setDirty(true);
  }, []);

  /** 拖动/缩放只操作当前可见的盒子，已移除的盒子位置原样保留。 */
  const setVisibleTiles = useCallback<Dispatch<SetStateAction<BoardTile[]>>>(
    (action) => {
      updateTiles((current) => {
        const currentVisible = current.filter(isTileVisible);
        const nextVisible =
          typeof action === 'function'
            ? (action as (previous: BoardTile[]) => BoardTile[])(currentVisible)
            : action;
        const byId = new Map(nextVisible.map((tile) => [tile.id, tile]));
        return current.map((tile) => byId.get(tile.id) ?? tile);
      });
    },
    [isTileVisible, updateTiles],
  );

  /**
   * 重新添加的盒子统一落到最下方，按添加顺序重新生成，
   * 不抢占已经在桌面上的盒子。
   */
  const bottomOf = useCallback(
    (all: BoardTile[], excludeId: string) =>
      all.reduce(
        (max, tile) =>
          tile.id === excludeId || !isTileVisible(tile) ? max : Math.max(max, tile.y + tile.h),
        0,
      ),
    [isTileVisible],
  );

  const placeAtBottom = useCallback(
    (all: BoardTile[], id: string) => {
      const y = bottomOf(all, id);
      return all.map((tile) => (tile.id === id ? { ...tile, x: 0, y } : tile));
    },
    [bottomOf],
  );

  /** 拖动、缩放、添加与移除后立即落盘，不再等 Ctrl+S。 */
  const commitLayout = useCallback(
    (next: BoardTile[]) => {
      setTiles(next);
      setDirty(false);
      setHasSaved(true);
      savedRef.current[session.id] = true;
      dirtyRef.current[session.id] = false;
      draftRef.current[session.id] = next;
      onSaveLayout(session.id, next);
    },
    [onSaveLayout, session.id],
  );

  // 模块重新启用后，盒子落到桌面最下方，避免压住已经摆好的其他盒子。
  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (pending.size === 0) return;
    const ready = [...pending].filter((id) => {
      const tile = latestRef.current.tiles.find((item) => item.id === id);
      return tile !== undefined && isTileVisible(tile);
    });
    if (ready.length === 0) return;
    let next = latestRef.current.tiles;
    for (const id of ready) next = placeAtBottom(next, id);
    commitLayout(next);
    for (const id of ready) pending.delete(id);
  }, [commitLayout, enabledModuleIds, isTileVisible, placeAtBottom, session]);

  const saveLayout = () => {
    onSaveLayout(session.id, tiles);
    setDirty(false);
    setHasSaved(true);
    savedRef.current[session.id] = true;
    dirtyRef.current[session.id] = false;
    draftRef.current[session.id] = tiles;
  };

  /** Ctrl/Cmd+S 随时保存当前会话布局；输入框和弹层里的保存留给它们自己。 */
  const saveLayoutRef = useRef(saveLayout);
  saveLayoutRef.current = saveLayout;
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (document.querySelector('.modal-overlay')) return;
      event.preventDefault();
      saveLayoutRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const resetLayout = () => {
    for (const tile of latestRef.current.tiles) {
      // 主终端盒子与中枢台页签共用 shell，重置布局时保留，避免页签里的输出被掐断。
      if (
        tile.kind === 'module' &&
        tile.moduleId === 'terminal.console' &&
        tile.id !== 'tile-terminal.console'
      ) {
        disposeTerminalInstance(terminalInstanceKey(session.id, tile.id));
      }
    }
    updateTiles([]);
  };

  const addTile = useCallback(
    (tile: BoardTile) => {
      const current = latestRef.current.tiles;
      const existing = current.find((item) => item.id === tile.id);
      // 已移除的盒子还在存档里，重新添加时原地复用并落到底部。
      if (existing) {
        if (!existing.hidden) return;
        commitLayout(
          placeAtBottom(
            current.map((item) => (item.id === tile.id ? { ...item, hidden: false } : item)),
            tile.id,
          ),
        );
        return;
      }
      const bottom = current.reduce((max, item) => Math.max(max, item.y + item.h), 0);
      commitLayout([...current, { ...tile, x: 0, y: bottom }]);
    },
    [commitLayout, placeAtBottom],
  );

  const removeTile = useCallback(
    (id: string) => {
      const current = latestRef.current.tiles;
      const target = current.find((tile) => tile.id === id);
      if (!target || target.hidden) return;
      const next = current.map((tile) => (tile.id === id ? { ...tile, hidden: true } : tile));
      commitLayout(next);
      setSelectedTileId((active) =>
        active === id ? (next.find((tile) => isTileVisible(tile))?.id ?? '') : active,
      );
      actions.notify(`已从桌面移除「${target.title}」 · 可在盒子设置里重新添加`, 'info');
    },
    [actions, commitLayout, isTileVisible],
  );

  /** 全部添加：清掉所有「已移除」状态，并把会话里还没上桌的模块补到桌面底部。 */
  const addAllTiles = useCallback(() => {
    const current = latestRef.current.tiles;
    const restored = new Set<string>();
    let next = current.map((tile) => {
      if (tile.hidden && isTileVisible({ ...tile, hidden: false })) {
        restored.add(tile.id);
        return { ...tile, hidden: false };
      }
      return tile;
    });
    for (const id of restored) next = placeAtBottom(next, id);
    const existing = new Set(next.map((tile) => tile.moduleId));
    const missing = boardModuleIds(session).filter((moduleId) => !existing.has(moduleId));
    for (const moduleId of missing) {
      const geometry = MODULE_GEOMETRY[moduleId];
      const tile = geometry
        ? moduleTile(moduleId, 0, 0, geometry.w, geometry.h, geometry.minW, geometry.minH)
        : moduleTile(moduleId, 0, 0, 4, 3, 3, 2);
      next = placeAtBottom([...next, tile], tile.id);
    }
    if (restored.size === 0 && missing.length === 0) return;
    commitLayout(next);
    actions.notify('已把可用盒子全部添加到桌面', 'success');
  }, [actions, commitLayout, isTileVisible, placeAtBottom, session]);

  /** 全部移除：桌面上的盒子统一回到「可用盒子」，不丢尺寸和位置。 */
  const removeAllTiles = useCallback(() => {
    const current = latestRef.current.tiles;
    if (!current.some((tile) => !tile.hidden)) return;
    commitLayout(current.map((tile) => ({ ...tile, hidden: true })));
    setSelectedTileId('');
    actions.notify('已移除桌面上的全部盒子 · 可在盒子设置里重新添加', 'info');
  }, [actions, commitLayout]);

  const resizeTileTo = useCallback(
    (id: string, w: number, h: number) => {
      const latest = latestRef.current;
      const tile = latest.tiles.find((item) => item.id === id);
      if (!tile) return;
      const nextW = Math.max(tile.minW, Math.min(12 - tile.x, Math.round(w)));
      const nextH = Math.max(tile.minH, Math.round(h));
      if (nextW === tile.w && nextH === tile.h) return;
      const visible = latest.tiles.filter(isTileVisible);
      const resolved = resolveCollisions(
        visible.map((item) =>
          item.id === id ? { ...item, w: nextW, h: nextH } : item,
        ),
        id,
      );
      const byId = new Map(resolved.map((item) => [item.id, item]));
      commitLayout(latest.tiles.map((item) => byId.get(item.id) ?? item));
    },
    [commitLayout, isTileVisible],
  );

  const resetTileSize = useCallback(
    (tile: BoardTile) => {
      const geometry = MODULE_GEOMETRY[tile.moduleId];
      const target = tile.kind === 'module' && geometry ? geometry : { w: 3, h: 4 };
      resizeTileTo(
        tile.id,
        Math.min(Math.max(target.w, tile.minW), 12 - tile.x),
        Math.max(target.h, tile.minH),
      );
    },
    [resizeTileTo],
  );

  /** 盒子预览里拖动换位：只和解可见盒子，松手立刻落盘。 */
  const moveTile = useCallback(
    (id: string, x: number, y: number) => {
      const latest = latestRef.current;
      const tile = latest.tiles.find((item) => item.id === id);
      if (!tile) return;
      const nextX = Math.max(0, Math.min(12 - tile.w, x));
      const nextY = Math.max(0, y);
      if (nextX === tile.x && nextY === tile.y) return;
      const visible = latest.tiles.filter(isTileVisible);
      const resolved = resolveCollisions(
        visible.map((item) => (item.id === id ? { ...item, x: nextX, y: nextY } : item)),
        id,
      );
      const byId = new Map(resolved.map((item) => [item.id, item]));
      commitLayout(latest.tiles.map((item) => byId.get(item.id) ?? item));
    },
    [commitLayout, isTileVisible],
  );

  const updateModuleState = useCallback(
    (key: string, update: unknown | ModuleStateUpdater) => {
      setModuleState((current) => {
        const previous = current[key];
        const next =
          typeof update === 'function'
            ? (update as (prev: unknown) => unknown)(previous)
            : update;
        return { ...current, [key]: next };
      });
      // 盒子里的模块状态（浏览器标签、固定目录等）同步回会话，随存档持久化。
      onModuleStateChange(key, update);
    },
    [onModuleStateChange],
  );

  const boardActions = useMemo<ModuleActions>(() => {
    const block = (message: string) => actions.notify(message, 'info');
    return {
      selectSession: () => block('会话桌面：请用顶部会话标签切换'),
      openSession: () => block('会话桌面：会话切换已由会话标签接管'),
      dispatchTask: () => block('会话桌面：任务未派发'),
      notify: actions.notify,
      updateSettings: actions.updateSettings,
      openSettings: () => block('会话桌面：请使用标题栏设置'),
      openNewSession: () => block('会话桌面：新建会话请回到工作台'),
      openModuleDrawer: () => block('会话桌面：盒子库尚未接入'),
    };
  }, [actions]);

  const renderTile = (tile: BoardTile, density: TileDensity) => {
    if (tile.kind !== 'module') return null;

    // 主盒子与中枢台页签共用状态：终端共用常用指令/分栏，浏览器共用标签/站点/缩放。
    const sharedModule =
      tile.id === `tile-${tile.moduleId}` &&
      (tile.moduleId === 'terminal.console' || tile.moduleId === 'web.search');
    const stateKey = sharedModule ? tile.moduleId : `board:${tile.id}`;
    return (
      <BoardModuleView
        moduleId={tile.moduleId}
        stateKey={stateKey}
        instanceKey={
          tile.moduleId === 'terminal.console'
            ? terminalInstanceKey(session.id, tile.id)
            : `${session.id}:${tile.id}`
        }
        state={moduleState[stateKey]}
        onStateChange={(update) => updateModuleState(stateKey, update)}
        density={density}
        session={session}
        sessions={sessions}
        actions={boardActions}
        settings={settings}
        engine={engine}
        engineLoading={engineLoading}
        engineProcess={engineProcess}
        refreshEngine={refreshEngine}
      />
    );
  };

  const libraryTiles = useMemo(() => {
    const existing = new Set(tiles.map((tile) => tile.id));
    const next: BoardTile[] = [];
    for (const moduleId of boardModuleIds(session)) {
      const geometry = MODULE_GEOMETRY[moduleId];
      const tile = geometry
        ? moduleTile(moduleId, 0, 0, geometry.w, geometry.h, geometry.minW, geometry.minH)
        : moduleTile(moduleId, 0, 0, 4, 3, 3, 2);
      if (!existing.has(tile.id)) next.push(tile);
    }
    return next;
  }, [session, tiles]);

  const renderSettings = () => (
    <BoxSettingsPanel
      session={session}
      tiles={tiles}
      enabledModuleIds={enabledModuleIds}
      isTileVisible={isTileVisible}
      libraryTiles={libraryTiles}
      selectedId={selectedTileId}
      onSelect={setSelectedTileId}
      onAdd={addTile}
      onRemove={removeTile}
      onResize={resizeTileTo}
      onResetSize={resetTileSize}
      onMove={moveTile}
      onAddAll={addAllTiles}
      onRemoveAll={removeAllTiles}
      onEnableModule={(tile) => {
        pendingRevealRef.current.add(tile.id);
        onToggleModule(tile.moduleId, true);
      }}
    />
  );

  const shelfCandidates = orderedScenes.filter(
    (item) =>
      item.id !== 'hub' &&
      item.id !== session.id &&
      !shelfScenes.some((shelfItem) => shelfItem.id === item.id),
  );
  const activeInShelf = shelfScenes.some((item) => item.id === session.id);

  return (
    <div className="board-desktop" role="dialog" aria-label="会话桌面">
      <header className="board-bar">
        <div className="board-scene-tabs" role="tablist" aria-label="会话" ref={tabStripRef}>
          {[...(hubScene ? [hubScene] : []), ...sceneTabs].map((item) => {
            const active = item.id === session.id;
            const working = isSessionWorking(activity, item);
            const dragging = sceneSort.draggingId === item.id;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className={`board-scene-tab${active ? ' on' : ''}${working ? ' working' : ''}${
                  dragging ? ' dragging' : ''
                }`}
                key={item.id}
                title={`${item.name}${working ? ' · DSH 正在工作' : ' · 长按拖拽排序'}`}
                onClick={() => {
                  if (sceneSort.wasDragging()) return;
                  if (!active) onSelectSession(item.id);
                }}
                {...(item.id === 'hub' ? {} : sceneSort.getItemProps(item.id))}
              >
                <span
                  className={`board-scene-mark${working ? ' working' : ''}`}
                  style={{ color: item.color }}
                >
                  <Icon name={item.icon} size={11} />
                </span>
                <span>{item.name}</span>
                {item.unread > 0 && <em>{item.unread}</em>}
              </button>
            );
          })}
        </div>

        {/* 离屏量尺：按真实字体和徽标宽度测量每个会话标签，决定标签栏放得下几个。 */}
        <div className="board-scene-measure" aria-hidden="true" ref={tabMeasureRef}>
          {[...(hubScene ? [hubScene] : []), ...nonHubScenes].map((item) => (
            <button
              type="button"
              className="board-scene-tab"
              key={item.id}
              data-tab-id={item.id}
              tabIndex={-1}
            >
              <span className="board-scene-mark" style={{ color: item.color }}>
                <Icon name={item.icon} size={11} />
              </span>
              <span>{item.name}</span>
              {item.unread > 0 && <em>{item.unread}</em>}
            </button>
          ))}
        </div>

        <div className={`board-scene-shelf${shelfOpen ? ' open' : ''}`} ref={shelfRef}>
          <button
            type="button"
            className={`board-shelf-btn${shelfOpen ? ' on' : ''}${activeInShelf ? ' has-active' : ''}`}
            aria-expanded={shelfOpen}
            aria-haspopup="dialog"
            title={
              activeInShelf ? '当前会话在收纳里 · 只影响会话桌面' : '收纳会话标签 · 只影响会话桌面'
            }
            onClick={toggleShelf}
          >
            <Icon name="layers" size={12} />
            收纳
            {shelfScenes.length > 0 && <em>{shelfScenes.length}</em>}
          </button>
        </div>

        <div className="board-bar-tabs" role="tablist" aria-label="会话桌面视图">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'board'}
            className={mode === 'board' ? 'on' : ''}
            onClick={() => setMode('board')}
          >
            <Icon name="panel" size={13} />
            盒子拼装
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'settings'}
            className={mode === 'settings' ? 'on' : ''}
            onClick={() => setMode('settings')}
          >
            <Icon name="sliders" size={13} />
            盒子设置
          </button>
        </div>

        <div className="board-bar-actions">
          <button
            type="button"
            className="icon-btn"
            disabled={!dirty}
            aria-label="保存布局"
            title={dirty ? '保存当前会话的盒子布局 · Ctrl+S' : '布局没有改动 · Ctrl+S 保存'}
            onClick={saveLayout}
          >
            <Icon name="save" size={14} />
          </button>
          {mode === 'board' && (
            <button
              type="button"
              className="icon-btn"
              aria-label="重置布局"
              title="重置布局 · 恢复默认盒子"
              onClick={resetLayout}
            >
              <Icon name="reset" size={14} />
            </button>
          )}
        </div>
      </header>

      {shelfOpen &&
        shelfPos &&
        createPortal(
          <div
            className="board-shelf-pop"
            role="dialog"
            aria-label="会话收纳"
            ref={shelfPopRef}
            style={{ top: shelfPos.top, right: shelfPos.right }}
          >
            <header>
              <span>会话收纳</span>
              <em>{shelfScenes.length} 个会话</em>
            </header>
            {shelfScenes.length > 0 ? (
              <div className="board-shelf-list">
                {shelfScenes.map((item) => {
                  const manual = manualShelf.has(item.id);
                  const working = isSessionWorking(activity, item);
                  const active = item.id === session.id;
                  const canRestore = restorableIds.has(item.id);
                  return (
                    <div
                      className={`board-shelf-row${working ? ' working' : ''}${
                        active ? ' active' : ''
                      }`}
                      key={item.id}
                    >
                      <button
                        type="button"
                        className="board-shelf-scene"
                        title={`切换到 ${item.name}`}
                        onClick={() => {
                          onSelectSession(item.id);
                          setShelfOpen(false);
                        }}
                      >
                        <span className="board-shelf-mark" style={{ color: item.color }}>
                          <Icon name={item.icon} size={11} />
                        </span>
                        <span className="board-shelf-name">
                          <strong>{item.name}</strong>
                          <small>
                            {item.scene}
                            {working ? ' · 正在工作' : ''}
                            {active ? ' · 当前' : ''}
                          </small>
                        </span>
                      </button>
                      {manual && canRestore ? (
                        <button
                          type="button"
                          className="board-shelf-out"
                          title="移出收纳"
                          aria-label={`把 ${item.name} 移出收纳`}
                          onClick={() =>
                            onSceneShelfChange(sceneShelf.filter((id) => id !== item.id))
                          }
                        >
                          <Icon name="x" size={11} />
                        </button>
                      ) : (
                        <span
                          className="board-shelf-auto"
                          title={
                            manual
                              ? '标签栏放不下，先移出一个可见会话再试'
                              : '标签栏宽度放不下，自动收纳'
                          }
                        >
                          {manual ? '标签满' : '自动'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="board-shelf-empty">
                标签栏放得下全部会话时不会自动收纳，也可以在下面手动收进来。
              </p>
            )}
            <div className="board-shelf-manage">
              <span className="board-shelf-label">收进收纳</span>
              <div className="board-shelf-manage-list">
                {shelfCandidates.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="board-shelf-add"
                    title={`把「${item.name}」收进收纳`}
                    onClick={() =>
                      onSceneShelfChange([...sceneShelf.filter((id) => id !== item.id), item.id])
                    }
                  >
                    <Icon name={item.icon} size={10} />
                    {item.name}
                  </button>
                ))}
              </div>
              {shelfCandidates.length === 0 && (
                <span className="board-shelf-tip">其余会话都已经在收纳里。</span>
              )}
            </div>
          </div>,
          document.body,
        )}

      <div className="board-stage">
        {mode === 'board' ? (
          visibleTiles.length === 0 ? (
            <div className="board-empty">
              <span className="board-empty-glyph">
                <Icon name="layers" size={22} />
              </span>
              <h4>{tiles.length === 0 ? '桌面是空的' : '盒子都移除了'}</h4>
              <p>
                {tiles.length === 0
                  ? '从「盒子设置」里挑需要的盒子放到桌面，每个会话单独保存布局。'
                  : '到「盒子设置」里重新添加，或者挑新的盒子。'}
              </p>
              <button type="button" className="primary-btn" onClick={() => setMode('settings')}>
                <Icon name={tiles.length === 0 ? 'plus' : 'sliders'} size={13} />
                {tiles.length === 0 ? '添加盒子' : '管理盒子'}
              </button>
            </div>
          ) : (
            <SceneBoard
              key={session.id}
              tiles={visibleTiles}
              setTiles={setVisibleTiles}
              renderTile={renderTile}
              onCloseTile={removeTile}
            />
          )
        ) : (
          renderSettings()
        )}
      </div>

      <footer className="board-foot">
        <span>
          <b>{visibleTiles.length}</b> 个盒子 · 12 列网格
        </span>
        {tiles.length > visibleTiles.length && (
          <span>{tiles.length - visibleTiles.length} 个已移除</span>
        )}
        <span>会话：{session.name}</span>
        <span className="board-save-hint">Ctrl+S 保存</span>
        <span className={`board-save-state${dirty ? ' dirty' : ''}`}>
          {dirty
            ? '布局有改动 · 未保存'
            : hasSaved
              ? '布局已存档'
              : tiles.length === 0
                ? '空桌面 · 未保存'
                : '默认布局 · 未保存'}
        </span>
      </footer>
    </div>
  );
}
