import { useEffect } from 'react';
import { categoryOf, listModules, MODULE_CATEGORIES } from '../modules';
import type { SlotId } from '../modules';
import type { Session } from '../types';
import { Icon } from './icons';

interface ModuleDrawerProps {
  session: Session;
  onToggle: (moduleId: string, enabled: boolean) => void;
  onReset: () => void;
  onClose: () => void;
}

const SLOT_LABEL: Record<SlotId, string> = {
  'center.view': '中心',
  'detail.block': '详情',
  'command.action': '指令',
  'rail.widget': '侧栏',
  'status.item': '状态',
};

const KIND_LABEL: Record<string, string> = {
  view: '视图',
  panel: '面板',
  tool: '工具',
  context: '上下文',
};

export function ModuleDrawer({
  session,
  onToggle,
  onReset,
  onClose,
}: ModuleDrawerProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const registered = listModules();
  const rows = registered
    .map((definition) => ({
      definition,
      instance: session.modules.find(
        (item) => item.moduleId === definition.manifest.id,
      ),
    }))
    .sort((left, right) => (left.instance?.order ?? 99) - (right.instance?.order ?? 99));

  const enabledCount = rows.filter((row) => row.instance?.enabled).length;

  const groups = MODULE_CATEGORIES.map((category) => ({
    category,
    rows: rows.filter(({ definition }) => categoryOf(definition.manifest).id === category.id),
  })).filter((group) => group.rows.length > 0);

  return (
    <div
      className="drawer-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="模块装配">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">MODULE BAY</div>
            <h3>模块装配</h3>
            <p>{session.name} · 已启用 {enabledCount} / {rows.length}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭模块抽屉" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="drawer-scroll">
          <div className="drawer-hint">
            模块按会话独立启停，切换会话不影响其他会话的装配。启停会即刻反映到中心视图和详情栏。
          </div>

          {groups.map(({ category, rows: groupRows }) => (
            <div className="drawer-group" key={category.id}>
              <div className="drawer-group-head">
                <span>{category.label}</span>
                <small>{category.hint}</small>
                <em>
                  {groupRows.filter((row) => row.instance?.enabled).length}/{groupRows.length}
                </em>
              </div>
              {groupRows.map(({ definition, instance }) => {
                const enabled = Boolean(instance?.enabled);
                return (
                  <div
                    className={`drawer-row${enabled ? ' enabled' : ''}`}
                    key={definition.manifest.id}
                  >
                    <span
                      className="drawer-icon"
                      style={{ color: enabled ? 'var(--accent)' : 'var(--muted)' }}
                    >
                      <Icon name={definition.manifest.icon} size={16} />
                    </span>
                    <div className="drawer-main">
                      <div className="drawer-title">
                        <strong>{definition.manifest.name}</strong>
                        <span className="drawer-version">v{definition.manifest.version}</span>
                      </div>
                      <p>{definition.manifest.description}</p>
                      <div className="drawer-tags">
                        {definition.manifest.slots.map((slot) => (
                          <span key={slot}>{SLOT_LABEL[slot]}</span>
                        ))}
                        {definition.manifest.kind.slice(0, 2).map((kind) => (
                          <span key={kind} className="kind">
                            {KIND_LABEL[kind] ?? kind}
                          </span>
                        ))}
                        {definition.manifest.persistState && (
                          <span className="persist">写入存档</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`switch${enabled ? ' on' : ''}`}
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${enabled ? '停用' : '启用'} ${definition.manifest.name}`}
                      onClick={() => onToggle(definition.manifest.id, !enabled)}
                    >
                      <i />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}

          {rows.length === 0 && <div className="drawer-empty">模块注册表为空。</div>}
        </div>

        <div className="drawer-foot">
          <button type="button" className="ghost-btn" onClick={onReset}>
            <Icon name="refresh" size={13} />
            恢复默认装配
          </button>
        </div>
      </aside>
    </div>
  );
}
