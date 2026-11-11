import { useMemo } from 'react';
import { isSessionWorking, sessionLight, useEngineActivity } from '../engineActivity';
import { resolveSessionScene } from '../engine/scene';
import type { EngineSnapshot } from '../engine/types';
import {
  SlotHost,
  type ModuleActions,
  type ModuleStateChangeHandler,
} from '../modules';
import type { WorkbenchSettings } from '../settings';
import type { Session } from '../types';
import { SessionDocs } from './SessionDocs';
import { Icon } from './icons';

interface SessionPanelProps {
  session: Session;
  sessions: Session[];
  actions: ModuleActions;
  settings: WorkbenchSettings;
  engine: EngineSnapshot | null;
  engineLoading: boolean;
  refreshEngine: () => void;
  onModuleStateChange: ModuleStateChangeHandler;
  onClose: () => void;
}

export function SessionPanel({
  session,
  sessions,
  actions,
  settings,
  engine,
  engineLoading,
  refreshEngine,
  onModuleStateChange,
  onClose,
}: SessionPanelProps) {
  const activity = useEngineActivity();
  const scene = useMemo(() => resolveSessionScene(session, engine), [engine, session]);
  const isHub = session.id === 'hub';
  const boundTitle = session.harness?.title ?? '';
  const working = isSessionWorking(activity, session);
  const light = sessionLight(activity, session);
  const statusText = working
    ? '工作中'
    : light === 'online'
      ? 'DSH 在线'
      : boundTitle
        ? '引擎未连接'
        : '未绑定 DSH';
  const statusTitle = working
    ? '该 DSH 会话正在执行任务'
    : light === 'online'
      ? 'DSH 已连接，当前空闲'
      : boundTitle
        ? 'DSH 引擎尚未就绪'
        : '尚未绑定 DSH 会话';

  return (
    <aside className="detail panel" id="session-detail-popover">
      <div className="detail-head">
        <div>
          <div className="eyebrow">SESSION DETAILS</div>
          <h3>会话详情</h3>
        </div>
        <div className="detail-head-actions">
          <button type="button" className="icon-btn" aria-label="收起详情" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>

      <div className="detail-scroll">
        <div className="detail-identity">
          <span
            className="identity-icon detail-avatar"
            style={{
              color: session.color,
              background: `${session.color}14`,
              borderColor: `${session.color}3d`,
            }}
          >
            <Icon name={session.icon} size={22} />
          </span>
          <div className="detail-identity-main">
            <div className="detail-identity-title">
              <h4>{session.name}</h4>
              {isHub && (
                <span className="data-source-chip" title="中枢调度读取全部引擎场景">
                  <Icon name="database" size={10} />
                  数据源 {engine?.ok ? engine.scenes.length : '—'} 场景
                </span>
              )}
            </div>
            <p>{session.role}</p>
            <div className="detail-identity-chips">
              <span className={`status-chip ${light}`} title={statusTitle}>
                <i className={`status-dot ${light}`} />
                {statusText}
              </span>
              <span
                className={`binding-chip${boundTitle ? ' on' : ''}`}
                title={boundTitle ? `绑定 DSH 会话：${boundTitle}` : '尚未绑定 DSH 会话'}
              >
                <Icon name="panel" size={10} />
                {boundTitle ? `DSH · ${boundTitle}` : '未绑定 DSH'}
              </span>
              <span className="scene-chip">{scene?.name ?? session.scene}</span>
            </div>
          </div>
        </div>

        <SessionDocs
          session={session}
          engine={engine}
          root={settings.engine.dataPath}
          notify={actions.notify}
        />

        <SlotHost
          slot="detail.block"
          session={session}
          sessions={sessions}
          actions={actions}
          settings={settings}
          engine={engine}
          engineLoading={engineLoading}
          refreshEngine={refreshEngine}
          onModuleStateChange={onModuleStateChange}
        />
      </div>
    </aside>
  );
}
