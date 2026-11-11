import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { Icon } from '../components/icons';
import type { BoardTile, TileDensity } from './types';

const densityLabel: Record<TileDensity, string> = {
  compact: '紧凑',
  regular: '标准',
  wide: '宽屏',
};

interface TileShellProps {
  tile: BoardTile;
  density: TileDensity;
  children: ReactNode;
  style?: CSSProperties;
  active?: boolean;
  focused?: boolean;
  showResize?: boolean;
  onDragStart?: (event: PointerEvent<HTMLElement>) => void;
  onResizeStart?: (event: PointerEvent<HTMLElement>) => void;
  onFocus?: () => void;
  onClose?: () => void;
}

/** 统一盒子外壳：标题栏负责拖拽，内容区负责容器查询，尺寸手柄负责缩放。 */
export function TileShell({
  tile,
  density,
  children,
  style,
  active = false,
  focused = false,
  showResize = true,
  onDragStart,
  onResizeStart,
  onFocus,
  onClose,
}: TileShellProps) {
  const handleHeadPointerDown = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    onDragStart?.(event);
  };

  return (
    <section
      className={`board-tile kind-${tile.kind}${active ? ' dragging' : ''}${
        focused ? ' focused' : ''
      }${onDragStart ? ' draggable' : ''}`}
      style={style}
      data-density={density}
      data-tile-id={tile.id}
      data-tile-kind={tile.kind}
      data-module-id={tile.moduleId}
    >
      <header
        className="board-tile-head"
        onPointerDown={handleHeadPointerDown}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          onFocus?.();
        }}
        title="拖动标题栏换位，双击进入专注模式"
      >
        <span className="board-tile-grip" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <span
          className="board-tile-icon"
          style={tile.accent ? { color: tile.accent } : undefined}
        >
          <Icon name={tile.icon} size={13} />
        </span>
        <div className="board-tile-title">
          <strong>{tile.title}</strong>
          {tile.subtitle && <small>{tile.subtitle}</small>}
        </div>
        <span className="board-tile-density">{densityLabel[density]}</span>
        <div className="board-tile-actions">
          {onFocus && (
            <button
              type="button"
              className="board-tile-action"
              aria-label={focused ? '退出专注' : '专注'}
              title={focused ? '退出专注' : '专注模式'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onFocus}
            >
              <Icon name={focused ? 'restore' : 'arrowUpRight'} size={12} />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="board-tile-action"
              aria-label={focused ? '退出专注' : '关闭盒子'}
              title={focused ? '退出专注' : '关闭盒子'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onClose}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </header>
      <div className="board-tile-body" data-density={density}>
        {children}
      </div>
      {showResize && onResizeStart && (
        <button
          type="button"
          className="board-tile-resize"
          aria-label="调整盒子尺寸"
          title="拖动调整尺寸 · 滚轮调宽度 · Shift+滚轮调高度"
          onPointerDown={(event) => {
            event.stopPropagation();
            onResizeStart(event);
          }}
        />
      )}
    </section>
  );
}
