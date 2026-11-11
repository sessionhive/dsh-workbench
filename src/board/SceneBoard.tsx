import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { TileShell } from './TileShell';
import type { BoardTile, TileDensity } from './types';

const COLUMNS = 12;
const ROW_HEIGHT = 64;
const GAP = 12;
/** 画布底部留几行空网格：拖拽时滚轮向下、贴边自动滚动都有余量。 */
const BOTTOM_ROOM_ROWS = 4;

interface SceneBoardProps {
  tiles: BoardTile[];
  setTiles: Dispatch<SetStateAction<BoardTile[]>>;
  renderTile: (tile: BoardTile, density: TileDensity) => ReactNode;
  onCloseTile?: (id: string) => void;
  className?: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function densityFor(width: number, height: number): TileDensity {
  if (width < 360 || height < 220) return 'compact';
  if (width < 640) return 'regular';
  return 'wide';
}

function overlaps(left: BoardTile, right: BoardTile) {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}

/** 拖动或缩放后，把被压住的盒子向下推，保持网格不重叠。 */
export function resolveCollisions(tiles: BoardTile[], activeId: string) {
  const active = tiles.find((tile) => tile.id === activeId);
  if (!active) return tiles;

  const settled: BoardTile[] = [{ ...active }];
  const moved = new Map<string, BoardTile>();
  const others = tiles
    .filter((tile) => tile.id !== activeId)
    .sort((left, right) => left.y - right.y || left.x - right.x);

  for (const tile of others) {
    let next = { ...tile };
    let guard = 0;
    while (guard < 64) {
      const blockers = settled.filter((settledTile) => overlaps(settledTile, next));
      if (blockers.length === 0) break;
      next = {
        ...next,
        y: Math.max(...blockers.map((blocker) => blocker.y + blocker.h)),
      };
      guard += 1;
    }
    settled.push(next);
    moved.set(next.id, next);
  }

  return tiles.map((tile) =>
    tile.id === activeId ? active : moved.get(tile.id) ?? tile,
  );
}

/**
 * 修复已存档的重叠布局：按上→下、左→右的顺序安置，后来的盒子整体下移让位。
 * 隐藏的盒子不参与，保留原坐标。
 */
export function resolveBoardOverlaps(
  tiles: BoardTile[],
  isVisible: (tile: BoardTile) => boolean,
) {
  const ordered = tiles
    .filter(isVisible)
    .slice()
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const placed: BoardTile[] = [];
  const byId = new Map<string, BoardTile>();

  for (const tile of ordered) {
    let next = { ...tile };
    let guard = 0;
    while (guard < 64) {
      const blockers = placed.filter((settledTile) => overlaps(settledTile, next));
      if (blockers.length === 0) break;
      next = { ...next, y: Math.max(...blockers.map((blocker) => blocker.y + blocker.h)) };
      guard += 1;
    }
    placed.push(next);
    byId.set(next.id, next);
  }

  return tiles.map((tile) => byId.get(tile.id) ?? tile);
}

/**
 * 场景桌面网格：12 列、固定行高，拖动吸附、右下角缩放、碰撞向下的推。
 * 不使用绝对像素坐标，窗口变化时只重新换算列宽。
 */
export function SceneBoard({ tiles, setTiles, renderTile, onCloseTile, className }: SceneBoardProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const gestureRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  /** 悬停右下角手柄时滚轮可逐格微调：滚轮调宽度，Shift+滚轮调高度。 */
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (focusedId) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.board-tile-resize')) return;
      const tileElement = target.closest('[data-tile-id]') as HTMLElement | null;
      const id = tileElement?.dataset.tileId;
      const tile = tilesRef.current.find((item) => item.id === id);
      if (!tile) return;

      event.preventDefault();
      const step = event.deltaY < 0 ? 1 : -1;
      const nextW = event.shiftKey
        ? tile.w
        : Math.min(Math.max(tile.w + step, tile.minW), COLUMNS - tile.x);
      const nextH = event.shiftKey ? Math.max(tile.h + step, tile.minH) : tile.h;
      if (nextW === tile.w && nextH === tile.h) return;
      setTiles((current) =>
        resolveCollisions(
          current.map((item) =>
            item.id === tile.id ? { ...item, w: nextW, h: nextH } : item,
          ),
          tile.id,
        ),
      );
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [focusedId, setTiles]);

  useEffect(() => {
    if (!focusedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusedId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusedId]);

  const colWidth = width > 0 ? (width - GAP * (COLUMNS - 1)) / COLUMNS : 0;
  const rowStep = ROW_HEIGHT + GAP;
  const maxRows = tiles.reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
  // 余量只在拖拽时临时出现，松手后收起，避免空桌面底部多出几排格子。
  const canvasHeight =
    Math.max(maxRows * rowStep - GAP, 320) +
    (draggingId ? rowStep * BOTTOM_ROOM_ROWS : 0);
  const focusedTile = tiles.find((tile) => tile.id === focusedId) ?? null;

  /**
   * 拖动和缩放共用一套指针手势：指针捕获 + rAF 合并 + 失焦/隐藏/取消收尾。
   * 捕获能避免指针移出窗口后丢失 pointerup，失焦和 visibilitychange 则切断
   * Alt+Tab 切走再回来时的残留信号。
   */
  const startGesture = (
    tile: BoardTile,
    event: ReactPointerEvent<HTMLElement>,
    mode: 'move' | 'resize',
  ) => {
    if (colWidth <= 0 || focusedId || gestureRef.current !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const surface = canvasRef.current ?? event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const columnStep = colWidth + GAP;
    const origin = { x: tile.x, y: tile.y, w: tile.w, h: tile.h };
    const scroller = canvasRef.current?.parentElement ?? null;
    const startScrollTop = scroller?.scrollTop ?? 0;
    let autoScrollFrame: number | null = null;
    let lastX = tile.x;
    let lastY = tile.y;
    let lastW = tile.w;
    let lastH = tile.h;
    let started = false;
    let done = false;

    gestureRef.current = pointerId;

    const apply = (clientX: number, clientY: number) => {
      const dx = clientX - startX;
      const scrollDelta = scroller ? scroller.scrollTop - startScrollTop : 0;
      const dy = clientY - startY + scrollDelta;
      if (!started) {
        if (Math.hypot(dx, dy) < 4) return;
        started = true;
        // 只有真的开始拖动才让画布长高留出滚动余量；单击不应让棋盘跳一下。
        setDraggingId(tile.id);
      }

      if (mode === 'move') {
        const nextX = clamp(origin.x + Math.round(dx / columnStep), 0, COLUMNS - tile.w);
        const nextY = Math.max(0, origin.y + Math.round(dy / rowStep));
        if (nextX === lastX && nextY === lastY) return;
        lastX = nextX;
        lastY = nextY;
        setTiles((current) =>
          current.map((item) =>
            item.id === tile.id ? { ...item, x: nextX, y: nextY } : item,
          ),
        );
        return;
      }

      const nextW = clamp(origin.w + Math.round(dx / columnStep), tile.minW, COLUMNS - origin.x);
      const nextH = Math.max(tile.minH, origin.h + Math.round(dy / rowStep));
      if (nextW === lastW && nextH === lastH) return;
      lastW = nextW;
      lastH = nextH;
      setTiles((current) =>
        current.map((item) =>
          item.id === tile.id ? { ...item, w: nextW, h: nextH } : item,
        ),
      );
    };

    const flush = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };

    const applyPointer = () => {
      const point = pointerRef.current;
      if (point) apply(point.x, point.y);
    };

    // 指针贴近面板上下边缘时持续滚动，盒子可以一路拖到可视区之外。
    const tickAutoScroll = () => {
      autoScrollFrame = null;
      if (done || !scroller || !pointerRef.current) return;
      const rect = scroller.getBoundingClientRect();
      const { y } = pointerRef.current;
      const edge = 56;
      let step = 0;
      if (y < rect.top + edge) step = -Math.ceil((rect.top + edge - y) / 5);
      else if (y > rect.bottom - edge) step = Math.ceil((y - (rect.bottom - edge)) / 5);
      if (!step) return;
      const before = scroller.scrollTop;
      scroller.scrollTop = before + step;
      if (scroller.scrollTop === before) return;
      applyPointer();
      autoScrollFrame = requestAnimationFrame(tickAutoScroll);
    };

    const kickAutoScroll = () => {
      if (autoScrollFrame === null) autoScrollFrame = requestAnimationFrame(tickAutoScroll);
    };

    const onPointerMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      if (move.pointerType === 'mouse' && move.buttons === 0) {
        finish();
        return;
      }
      pointerRef.current = { x: move.clientX, y: move.clientY };
      kickAutoScroll();
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        applyPointer();
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') finish();
    };
    const onKeyDown = (key: KeyboardEvent) => {
      if (key.key === 'Escape') finish();
    };

    function finish() {
      if (done) return;
      done = true;
      flush();
      if (autoScrollFrame !== null) {
        cancelAnimationFrame(autoScrollFrame);
        autoScrollFrame = null;
      }
      pointerRef.current = null;
      gestureRef.current = null;
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibility);
      if (surface.hasPointerCapture?.(pointerId)) surface.releasePointerCapture(pointerId);
      cleanupRef.current = null;
      if (started) {
        setDraggingId(null);
        setTiles((current) => resolveCollisions(current, tile.id));
      }
    }

    cleanupRef.current = finish;
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibility);
    try {
      surface.setPointerCapture(pointerId);
    } catch {
      /* 捕获不可用时仍由 document 监听收尾 */
    }
  };

  return (
    <div
      className={`board-canvas${draggingId ? ' gesturing' : ''}${className ? ` ${className}` : ''}`}
      ref={canvasRef}
      style={
        width > 0
          ? ({
              '--board-col-step': `${colWidth + GAP}px`,
              '--board-row-step': `${rowStep}px`,
            } as CSSProperties)
          : undefined
      }
    >
      {!focusedTile &&
        width > 0 &&
        tiles.map((tile) => {
          const pixelWidth = tile.w * colWidth + (tile.w - 1) * GAP;
          const pixelHeight = tile.h * ROW_HEIGHT + (tile.h - 1) * GAP;
          const density = densityFor(pixelWidth, pixelHeight);
          const style: CSSProperties = {
            left: tile.x * (colWidth + GAP),
            top: tile.y * rowStep,
            width: pixelWidth,
            height: pixelHeight,
          };

          return (
            <TileShell
              key={tile.id}
              tile={tile}
              density={density}
              style={style}
              active={draggingId === tile.id}
              onDragStart={(event) => startGesture(tile, event, 'move')}
              onResizeStart={(event) => startGesture(tile, event, 'resize')}
              onFocus={() => setFocusedId(tile.id)}
              onClose={() => onCloseTile?.(tile.id)}
            >
              {renderTile(tile, density)}
            </TileShell>
          );
        })}

      {focusedTile && (
        <div className="board-focus-layer" role="dialog" aria-label={`${focusedTile.title} 专注模式`}>
          <TileShell
            tile={focusedTile}
            density="wide"
            focused
            showResize={false}
            style={{ position: 'relative', width: '100%', height: '100%' }}
            onFocus={() => setFocusedId(null)}
            onClose={() => setFocusedId(null)}
          >
            {renderTile(focusedTile, 'wide')}
          </TileShell>
        </div>
      )}

      <div className="board-canvas-spacer" style={{ height: canvasHeight }} aria-hidden="true" />
    </div>
  );
}
