import { Fragment, useEffect, useMemo, useState } from 'react';
import type { PaletteAction } from '../types';
import { Icon } from './icons';

interface CommandPaletteProps {
  actions: PaletteAction[];
  onClose: () => void;
}

export function CommandPalette({ actions, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return actions;
    return actions.filter((action) =>
      `${action.title}${action.hint ?? ''}${action.group}`.toLowerCase().includes(keyword),
    );
  }, [actions, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((index) => Math.min(filtered.length - 1, index + 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const action = filtered[active];
        if (action) {
          action.run();
          onClose();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, filtered, onClose]);

  return (
    <div
      className="palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="命令面板">
        <div className="palette-search">
          <Icon name="search" size={15} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索会话或指令…"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="palette-list">
          {filtered.length === 0 && <div className="palette-empty">没有匹配项</div>}
          {filtered.map((action, index) => {
            const showGroup = index === 0 || filtered[index - 1].group !== action.group;
            return (
              <Fragment key={action.id}>
                {showGroup && <div className="palette-group">{action.group}</div>}
                <button
                  type="button"
                  className={`palette-item${index === active ? ' active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    action.run();
                    onClose();
                  }}
                >
                  <span
                    className="p-icon"
                    style={
                      action.color
                        ? { color: action.color, background: `${action.color}16` }
                        : undefined
                    }
                  >
                    <Icon name={action.icon} size={14} />
                  </span>
                  <span className="p-title">{action.title}</span>
                  {action.hint && <span className="p-hint">{action.hint}</span>}
                </button>
              </Fragment>
            );
          })}
        </div>

        <div className="palette-foot">
          <span>↑↓ 选择</span>
          <span>Enter 执行</span>
          <span>Esc 关闭</span>
          <span className="spacer" />
          <span>DSH NEXUS</span>
        </div>
      </div>
    </div>
  );
}
