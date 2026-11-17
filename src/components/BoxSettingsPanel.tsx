import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { BoardTile } from '../board/types';
import { getModuleDefinition } from '../modules/runtime';
import type { Session } from '../types';
import { Icon } from './icons';

/**
 * 存档里的盒子只有在模块仍注册时才展示。
 * 本机扩展留下的盒子会留在存档里，但公开构建不注册对应模块，
 * 因此不能出现在「桌面盒子 / 可用盒子」列表里。
 */
function isKnownTile(tile: BoardTile) {
  return tile.kind !== 'module' || Boolean(getModuleDefinition(tile.moduleId));
}

interface BoxSettingsPanelProps {
  session: Session;
  tiles: BoardTile[];
  enabledModuleIds: Set<string>;
  isTileVisible: (tile: BoardTile) => boolean;
  libraryTiles: BoardTile[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: (tile: BoardTile) => void;
  onRemove: (id: string) => void;
  onResize: (id: string, w: number, h: number) => void;
  onResetSize: (tile: BoardTile) => void;
  onMove: (id: string, x: number, y: number) => void;
  onAddAll: () => void;
  onRemoveAll: () => void;
  onEnableModule: (tile: BoardTile) => void;
}

function kindLabel(tile: BoardTile) {
  return `模块 · ${tile.moduleId}`;
}

/** 一块屏幕的格子数：宽 12 列、高 9 行；超出的部分在预览里画线标出。 */
const SCREEN_COLUMNS = 12;
const SCREEN_ROWS = 9;

/**
 * 盒子设置：左边列桌面盒子与可添加盒子，右边只预览桌面上的盒子。
 * 长按盒子可换位，拖右下角把手调宽高，松手立即写回布局。
 */
export function BoxSettingsPanel({
  session,
  tiles,
  enabledModuleIds,
  isTileVisible,
  libraryTiles,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  onResize,
  onResetSize,
  onMove,
  onAddAll,
  onRemoveAll,
  onEnableModule,
}: BoxSettingsPanelProps) {
  const boardTiles = tiles.filter((tile) => isKnownTile(tile) && isTileVisible(tile));
  const selected = boardTiles.find((tile) => tile.id === selectedId) ?? boardTiles[0] ?? null;

  const previewRows = Math.max(
    SCREEN_ROWS,
    ...boardTiles.map((tile) => tile.y + tile.h),
    selected ? selected.y + selected.h : 0,
  );

  const removedTiles = tiles.filter((tile) => isKnownTile(tile) && !isTileVisible(tile));
  const availableRows = [
    ...removedTiles.map((tile) => ({
      tile,
      disabled: tile.kind === 'module' && !enabledModuleIds.has(tile.moduleId),
    })),
    ...libraryTiles.map((tile) => ({ tile, disabled: false })),
  ];
  const canAddAll =
    removedTiles.some((tile) => tile.kind !== 'module' || enabledModuleIds.has(tile.moduleId)) ||
    libraryTiles.length > 0;

  // 选中盒子后按 Backspace / Delete 直接移除；输入框和弹层里不抢按键。
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (document.querySelector('.modal-overlay')) return;
      event.preventDefault();
      onRemove(selected.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onRemove, selected]);

  const selectOnKey = (event: KeyboardEvent<HTMLDivElement>, id: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect(id);
  };

  const gridRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const [resize, setResize] = useState<{ id: string; w: number; h: number } | null>(null);
  const pressRef = useRef<{
    id: string;
    timer: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    active: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const rowHeight = Math.max(18, Math.min(30, Math.round(280 / previewRows)));

  const sizeOf = (tile: BoardTile) =>
    resize && resize.id === tile.id ? resize : { w: tile.w, h: tile.h };

  const clearPress = () => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };

  const beginPress = (event: PointerEvent<HTMLButtonElement>, tile: BoardTile) => {
    if (!isTileVisible(tile) || event.button !== 0) return;
    const grid = gridRef.current;
    if (!grid) return;
    // 上一次按压可能没收到 pointerup，先清掉它的计时器再开新的。
    clearPress();
    const tileRect = event.currentTarget.getBoundingClientRect();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 合成事件或指针已经抬起时捕获会失败，拖动逻辑仍然可用。
    }
    pressRef.current = {
      id: tile.id,
      timer: window.setTimeout(() => {
        const press = pressRef.current;
        // 计时期间已经换到别的盒子或结束按压时，不再进入拖拽。
        if (!press || press.id !== tile.id || press.active) return;
        press.active = true;
        setDrag({ id: tile.id, x: tile.x, y: tile.y });
        onSelect(tile.id);
      }, 380),
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - tileRect.left,
      offsetY: event.clientY - tileRect.top,
      active: false,
    };
  };

  const movePress = (event: PointerEvent<HTMLButtonElement>, tile: BoardTile) => {
    const press = pressRef.current;
    if (!press || press.id !== tile.id) return;
    if (!press.active) {
      if (
        Math.abs(event.clientX - press.startX) > 6 ||
        Math.abs(event.clientY - press.startY) > 6
      ) {
        clearPress();
      }
      return;
    }
    const grid = gridRef.current;
    if (!grid) return;
    event.preventDefault();
    const rect = grid.getBoundingClientRect();
    const columnWidth = rect.width / SCREEN_COLUMNS;
    const nextX = Math.max(
      0,
      Math.min(
        SCREEN_COLUMNS - tile.w,
        Math.floor((event.clientX - press.offsetX - rect.left) / columnWidth),
      ),
    );
    const nextY = Math.max(
      0,
      Math.floor((event.clientY - press.offsetY - rect.top) / rowHeight),
    );
    setDrag((current) =>
      current && current.x === nextX && current.y === nextY
        ? current
        : { id: tile.id, x: nextX, y: nextY },
    );
  };

  const endPress = (event: PointerEvent<HTMLButtonElement>, tile: BoardTile) => {
    const press = pressRef.current;
    if (!press || press.id !== tile.id) return;
    const active = press.active;
    clearPress();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (active) {
      const target = dragRef.current;
      setDrag(null);
      if (target && (target.x !== tile.x || target.y !== tile.y)) {
        suppressClickRef.current = true;
        // 拖动结束时浏览器可能不派发 click；留一个短兜底，避免吞掉下一次点击。
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 120);
        onMove(tile.id, target.x, target.y);
      }
    }
  };

  const startResize = (event: PointerEvent<HTMLSpanElement>, tile: BoardTile) => {
    event.preventDefault();
    event.stopPropagation();
    const grid = gridRef.current;
    if (!grid || !isTileVisible(tile) || event.button !== 0) return;
    clearPress();
    onSelect(tile.id);
    const rect = grid.getBoundingClientRect();
    const columnWidth = rect.width / SCREEN_COLUMNS;
    const maxW = Math.max(tile.minW, SCREEN_COLUMNS - tile.x);
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = tile.w;
    const startH = tile.h;
    let settled = { w: startW, h: startH };

    const onMovePointer = (moveEvent: globalThis.PointerEvent) => {
      const nextW = Math.max(
        tile.minW,
        Math.min(maxW, startW + Math.round((moveEvent.clientX - startX) / columnWidth)),
      );
      const nextH = Math.max(
        tile.minH,
        startH + Math.round((moveEvent.clientY - startY) / rowHeight),
      );
      settled = { w: nextW, h: nextH };
      setResize((current) =>
        current && current.w === nextW && current.h === nextH
          ? current
          : { id: tile.id, w: nextW, h: nextH },
      );
    };

    const finish = () => {
      window.removeEventListener('pointermove', onMovePointer);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      document.body.classList.remove('box-preview-resizing');
      setResize(null);
      if (settled.w !== startW || settled.h !== startH) {
        onResize(tile.id, settled.w, settled.h);
      }
    };

    document.body.classList.add('box-preview-resizing');
    window.addEventListener('pointermove', onMovePointer);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    setResize({ id: tile.id, w: startW, h: startH });
  };

  return (
    <div className="board-settings">
      <div className="board-settings-head">
        <div>
          <span className="board-section-label">BOX CONTROL</span>
          <h3>盒子设置</h3>
          <p>
            右侧只预览桌面上的盒子：长按拖动换位，拖右下角把手调宽高，松手立即保存。
            选中盒子后按 Backspace / Delete 也能直接移除，移除的盒子会回到「可用盒子」。
          </p>
        </div>
        <div className="board-settings-tools">
          <span className="box-settings-count">
            <b>{boardTiles.length}</b> 个在桌面
          </span>
          <button
            type="button"
            className="ghost-btn"
            onClick={onAddAll}
            disabled={!canAddAll}
            title="把所有可用盒子添加到桌面"
          >
            <Icon name="plus" size={13} />
            全部添加
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={onRemoveAll}
            disabled={boardTiles.length === 0}
            title="把桌面上的盒子全部移除到「可用盒子」"
          >
            <Icon name="trash" size={13} />
            全部移除
          </button>
        </div>
      </div>

      <div className="box-settings-layout">
        <aside className="box-settings-side">
          <section className="box-settings-card">
            <header>
              <span>桌面盒子</span>
              <em>{session.name}</em>
            </header>
            <div className="box-settings-list" role="listbox" aria-label="桌面盒子">
              {boardTiles.map((tile) => {
                const active = selected?.id === tile.id;
                return (
                  <div
                    role="option"
                    aria-selected={active}
                    tabIndex={0}
                    className={`box-setting-row selectable${active ? ' selected' : ''}`}
                    key={tile.id}
                    onClick={() => onSelect(tile.id)}
                    onKeyDown={(event) => selectOnKey(event, tile.id)}
                  >
                    <span
                      className="box-setting-icon"
                      style={
                        tile.accent
                          ? { color: tile.accent, borderColor: `${tile.accent}44` }
                          : undefined
                      }
                    >
                      <Icon name={tile.icon} size={13} />
                    </span>
                    <div className="box-setting-name">
                      <strong>{tile.title}</strong>
                      <small>{kindLabel(tile)}</small>
                    </div>
                    <span className="box-setting-dims">
                      {tile.w}×{tile.h}
                    </span>
                    <button
                      type="button"
                      className="box-setting-remove"
                      title="从桌面移除"
                      aria-label={`从桌面移除 ${tile.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemove(tile.id);
                      }}
                    >
                      <Icon name="trash" size={11} />
                    </button>
                  </div>
                );
              })}
              {boardTiles.length === 0 && (
                <p className="box-settings-note">桌面还是空的，从下面「可用盒子」里添加。</p>
              )}
            </div>
          </section>

          <section className="box-settings-card">
            <header>
              <span>可用盒子</span>
              <em>{availableRows.length} 个未添加</em>
            </header>
            {availableRows.length === 0 ? (
              <p className="box-settings-note">这个会话的盒子都已经放到桌面上了。</p>
            ) : (
              <div className="box-settings-list">
                {availableRows.map(({ tile, disabled }) => (
                  <div className="box-setting-row" key={tile.id}>
                    <span
                      className="box-setting-icon"
                      style={
                        tile.accent
                          ? { color: tile.accent, borderColor: `${tile.accent}44` }
                          : undefined
                      }
                    >
                      <Icon name={tile.icon} size={13} />
                    </span>
                    <div className="box-setting-name">
                      <strong>{tile.title}</strong>
                      <small>
                        {disabled ? `会话已停用 · ${tile.moduleId}` : kindLabel(tile)}
                        {!disabled && tile.hidden ? ' · 已移除' : ''}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="box-setting-add"
                      title={disabled ? '在会话中启用并添加到桌面' : '添加到桌面'}
                      onClick={() => {
                        if (disabled) onEnableModule(tile);
                        onAdd(tile);
                        onSelect(tile.id);
                      }}
                    >
                      <Icon name={disabled ? 'check' : 'plus'} size={11} />
                      {disabled ? '启用' : '添加'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>

        <section className="box-settings-card box-settings-detail" aria-live="polite">
          <header>
            <span>盒子预览</span>
            <em>{selected ? `选中 ${sizeOf(selected).w} × ${sizeOf(selected).h}` : '未选择盒子'}</em>
          </header>

          {!selected ? (
            <p className="box-settings-note">桌面上还没有盒子，先添加一个再调整尺寸。</p>
          ) : (
            <div className="box-detail-body">
              <div className="box-preview-stage">
                <div
                  className="box-preview-grid"
                  ref={gridRef}
                  style={{
                    height: `${previewRows * rowHeight}px`,
                    backgroundSize: `calc(100% / ${SCREEN_COLUMNS}) 100%, 100% ${rowHeight}px`,
                  }}
                >
                  {previewRows > SCREEN_ROWS && (
                    <span
                      className="box-preview-screen-line"
                      style={{ top: `${SCREEN_ROWS * rowHeight}px` }}
                      aria-hidden="true"
                    >
                      <em>
                        一屏 · {SCREEN_COLUMNS} × {SCREEN_ROWS}
                      </em>
                    </span>
                  )}
                  {boardTiles.map((tile) => {
                    const active = selected.id === tile.id;
                    const dragging = drag?.id === tile.id;
                    const sizing = resize?.id === tile.id;
                    const size = sizeOf(tile);
                    return (
                      <button
                        type="button"
                        key={tile.id}
                        className={`box-preview-tile${active ? ' on' : ''}${
                          dragging ? ' dragging' : ''
                        }${sizing ? ' resizing' : ''}`}
                        style={{
                          left: `calc(${(tile.x / SCREEN_COLUMNS) * 100}% + 2px)`,
                          width: `calc(${(size.w / SCREEN_COLUMNS) * 100}% - 4px)`,
                          top: `${tile.y * rowHeight + 2}px`,
                          height: `${size.h * rowHeight - 4}px`,
                        }}
                        title={`${tile.title} · ${size.w}×${size.h} · 长按拖动 · 拖右下角改尺寸`}
                        onClick={() => {
                          if (suppressClickRef.current) {
                            suppressClickRef.current = false;
                            return;
                          }
                          onSelect(tile.id);
                        }}
                        onPointerDown={(event) => beginPress(event, tile)}
                        onPointerMove={(event) => movePress(event, tile)}
                        onPointerUp={(event) => endPress(event, tile)}
                        onPointerCancel={(event) => endPress(event, tile)}
                      >
                        <Icon name={tile.icon} size={11} />
                        <span>{tile.title}</span>
                        <em>
                          {size.w}×{size.h}
                        </em>
                        {active && (
                          <span
                            className="box-preview-handle"
                            role="presentation"
                            title="拖动调整宽高"
                            onPointerDown={(event) => startResize(event, tile)}
                          />
                        )}
                      </button>
                    );
                  })}
                  {drag && !resize && (
                    <span
                      className="box-preview-ghost"
                      style={{
                        left: `calc(${(drag.x / SCREEN_COLUMNS) * 100}% + 2px)`,
                        width: `calc(${
                          (boardTiles.find((tile) => tile.id === drag.id)?.w ?? 4) /
                          SCREEN_COLUMNS
                        } * 100% - 4px)`,
                        top: `${drag.y * rowHeight + 2}px`,
                        height: `${
                          (boardTiles.find((tile) => tile.id === drag.id)?.h ?? 3) *
                            rowHeight -
                          4
                        }px`,
                      }}
                    />
                  )}
                  {boardTiles.length === 0 && (
                    <p className="box-preview-empty">
                      桌面上还没有盒子，从左侧「可用盒子」里添加后就会出现在这里。
                    </p>
                  )}
                </div>
                <span className="box-preview-caption">
                  <b>{selected.title}</b>
                  <em>
                    第 {selected.x + 1} 列 · 第 {selected.y + 1} 行
                  </em>
                  <small>长按拖动换位 · 拖右下角改尺寸 · Backspace 移除</small>
                </span>
              </div>

              <div className="box-detail-facts">
                <span>
                  <i>盒子尺寸</i>
                  <b>
                    {sizeOf(selected).w} 列 × {sizeOf(selected).h} 行
                  </b>
                </span>
                <span>
                  <i>最小尺寸</i>
                  <b>
                    {selected.minW} × {selected.minH}
                  </b>
                </span>
                <span>
                  <i>状态</i>
                  <b>桌面显示</b>
                </span>
              </div>

              <div className="box-size-hint">
                <Icon name="square" size={12} />
                <span>
                  拖动选中盒子右下角的把手调整宽高，每次吸附一格；选中后按 Backspace 或 Delete
                  可直接移除。
                </span>
              </div>

              <div className="box-detail-actions">
                <button
                  type="button"
                  className="ghost-btn files-action"
                  onClick={() => onResetSize(selected)}
                  disabled={
                    selected.w === Math.min(selected.minW, SCREEN_COLUMNS) &&
                    selected.h === selected.minH
                  }
                >
                  <Icon name="restore" size={12} />
                  恢复默认尺寸
                </button>
                <button
                  type="button"
                  className="ghost-btn files-action"
                  onClick={() => onRemove(selected.id)}
                >
                  <Icon name="trash" size={12} />
                  从桌面移除
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
