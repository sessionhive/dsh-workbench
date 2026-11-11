import { useMemo } from 'react';
import {
  isSessionWorking,
  sessionLight,
  useEngineActivity,
  type EngineActivity,
} from '../engineActivity';
import type { EngineSnapshot } from '../engine/types';
import { useLongPressSort } from '../hooks/useLongPressSort';
import type { RoleId, Session } from '../types';
import { Icon } from './icons';

interface SessionRailProps {
  sessions: Session[];
  selectedId: RoleId;
  query: string;
  collapsed: boolean;
  engine: EngineSnapshot | null;
  onQueryChange: (value: string) => void;
  onSelect: (id: RoleId) => void;
  onNew: () => void;
  onEdit: () => void;
  onModules: () => void;
  onToggleCollapsed: () => void;
  onReorderSessions: (ids: RoleId[]) => void;
}

interface SessionRowProps {
  session: Session;
  active: boolean;
  activity: EngineActivity;
  dataSourceCount?: number;
  dragging: boolean;
  sortProps?: ReturnType<ReturnType<typeof useLongPressSort>['getItemProps']>;
  onSelect: () => void;
}

function SessionRow({
  session,
  active,
  activity,
  dataSourceCount,
  dragging,
  sortProps,
  onSelect,
}: SessionRowProps) {
  const working = isSessionWorking(activity, session);
  const light = sessionLight(activity, session);
  const bound = Boolean(session.harness?.title);
  const dotTitle = working
    ? 'DSH 正在工作'
    : bound
      ? activity.ready
        ? 'DSH 空闲'
        : 'DSH 未连接'
      : '未绑定 DSH 会话';
  const isHub = session.id === 'hub';

  return (
    <button
      type="button"
      className={`session-item${active ? ' active' : ''}${dragging ? ' dragging' : ''}`}
      onClick={onSelect}
      title={`${session.name} · ${session.role}${working ? ' · DSH 正在工作' : dotTitle}`}
      {...(sortProps ?? {})}
    >
      <span
        className={`session-icon${working ? ' working' : ''}`}
        style={{
          color: session.color,
          background: `${session.color}14`,
          borderColor: `${session.color}3d`,
        }}
      >
        <Icon name={session.icon} size={15} />
      </span>
      <span className="session-indicators">
        <span className={`status-dot ${light}`} title={dotTitle} />
        {bound && (
          <span className="session-binding" title={`绑定 DSH 会话：${session.harness?.title}`}>
            DSH
          </span>
        )}
      </span>
      <span className="session-main">
        <span className="session-name">
          {session.name}
          {session.unread > 0 && <i className="unread">{session.unread}</i>}
        </span>
        <span className="session-role">
          {isHub && typeof dataSourceCount === 'number'
            ? `数据源 ${dataSourceCount} 个场景`
            : `${session.scene} · ${session.role.split(' · ')[0]}`}
        </span>
      </span>
    </button>
  );
}

export function SessionRail({
  sessions,
  selectedId,
  query,
  collapsed,
  engine,
  onQueryChange,
  onSelect,
  onNew,
  onEdit,
  onModules,
  onToggleCollapsed,
  onReorderSessions,
}: SessionRailProps) {
  const activity = useEngineActivity();
  const hub = sessions.find((session) => session.id === 'hub');
  const roles = useMemo(() => sessions.filter((session) => session.id !== 'hub'), [sessions]);
  const sort = useLongPressSort({
    ids: roles.map((session) => session.id),
    disabled: Boolean(query.trim()),
    onReorder: (ids) => {
      const current = new Set(sessions.map((session) => session.id));
      const ordered = ids.filter((id) => id !== hub?.id && current.has(id));
      const next = [hub?.id, ...ordered].filter((id): id is RoleId => Boolean(id));
      const rest = sessions.map((session) => session.id).filter((id) => !next.includes(id));
      onReorderSessions([...next, ...rest]);
    },
  });
  const orderedRoles = sort.order
    .map((id) => roles.find((session) => session.id === id))
    .filter((session): session is Session => Boolean(session));

  const keyword = query.trim().toLowerCase();
  const visible = keyword
    ? orderedRoles.filter((session) =>
        `${session.name}${session.role}${session.scene}`.toLowerCase().includes(keyword),
      )
    : orderedRoles;

  const rowProps = (session: Session) => ({
    session,
    activity,
    dragging: sort.draggingId === session.id,
    sortProps: sort.getItemProps(session.id),
    onSelect: () => {
      if (sort.wasDragging()) return;
      onSelect(session.id);
    },
  });

  return (
    <aside className={`rail panel${collapsed ? ' collapsed' : ''}`}>
      <div className="rail-head">
        {!collapsed && (
          <div>
            <div className="eyebrow">SESSIONS</div>
            <h1>会话中枢</h1>
          </div>
        )}
        <div className="rail-head-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={collapsed ? '展开会话栏' : '折叠会话栏'}
            title={collapsed ? '展开会话栏' : '折叠会话栏'}
            onClick={onToggleCollapsed}
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={15} />
          </button>
          {!collapsed && (
            <>
              <button type="button" className="icon-btn" aria-label="模块装配" title="模块装配" onClick={onModules}>
                <Icon name="layers" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="编辑会话"
                title={`编辑或删除「${sessions.find((session) => session.id === selectedId)?.name ?? '当前会话'}」`}
                onClick={onEdit}
              >
                <Icon name="pen" size={14} />
              </button>
              <button type="button" className="icon-btn" aria-label="新建会话" title="新建会话" onClick={onNew}>
                <Icon name="plus" size={15} />
              </button>
            </>
          )}
        </div>
      </div>

      {!collapsed && (
        <label className="search">
          <Icon name="search" size={13} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="筛选会话 / 场景"
            spellCheck={false}
          />
          {query && (
            <button type="button" aria-label="清空筛选" onClick={() => onQueryChange('')}>
              <Icon name="x" size={12} />
            </button>
          )}
        </label>
      )}

      <div className="rail-scroll">
        {hub && (
          <div className="rail-group">
            {!collapsed && (
              <div className="rail-group-title">
                调度核心 <span>01</span>
              </div>
            )}
            <SessionRow
              {...rowProps(hub)}
              dataSourceCount={engine?.ok ? engine.scenes.length : 0}
              active={selectedId === hub.id}
              sortProps={undefined}
            />
          </div>
        )}

        <div className="rail-group">
          {!collapsed && (
            <div className="rail-group-title">
              会话角色 <span>{String(visible.length).padStart(2, '0')}</span>
            </div>
          )}
          {visible.map((session) => (
            <SessionRow {...rowProps(session)} key={session.id} active={selectedId === session.id} />
          ))}
          {visible.length === 0 && !collapsed && <div className="rail-empty">没有匹配的会话</div>}
        </div>
      </div>
    </aside>
  );
}
