import { useEffect, useRef } from 'react';
import type { EngineSnapshot } from '../engine/types';
import type { ModuleActions, ModuleStateChangeHandler } from '../modules';
import type { WorkbenchSettings } from '../settings';
import type { Session } from '../types';
import { SessionPanel } from './SessionPanel';
import { Icon } from './icons';

interface DetailDrawerProps {
  session: Session;
  sessions: Session[];
  actions: ModuleActions;
  settings: WorkbenchSettings;
  engine: EngineSnapshot | null;
  engineLoading: boolean;
  refreshEngine: () => void;
  onModuleStateChange: ModuleStateChangeHandler;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 会话详情：贴右边沿的抽屉，收起后只留一个竖向把手。 */
export function DetailDrawer({
  session,
  sessions,
  actions,
  settings,
  engine,
  engineLoading,
  refreshEngine,
  onModuleStateChange,
  open,
  onOpenChange,
}: DetailDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const tabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // 用 click 而不是 pointerdown：透明点击层要留到整个点击结束，
    // 否则收起得太早，底下的会话或按钮会顺带吃到一个 click。
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || tabRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <>
      {!open && (
        <button
          ref={tabRef}
          type="button"
          className="detail-rail-tab"
          aria-expanded={false}
          aria-controls="session-detail-popover"
          title="展开会话详情"
          onClick={() => onOpenChange(true)}
        >
          <Icon name="panel" size={13} />
          <span>会话详情</span>
        </button>
      )}

      {open && (
        <>
          {/* 透明点击层：连内嵌 webview 上的点击也能落回主页面，点任意位置收起抽屉。 */}
          <div
            className="detail-scrim"
            aria-hidden="true"
            onClick={() => onOpenChange(false)}
          />
          <div className="detail-rail" ref={panelRef}>
            <SessionPanel
              id="session-detail-popover"
              session={session}
              sessions={sessions}
              actions={actions}
              settings={settings}
              engine={engine}
              engineLoading={engineLoading}
              refreshEngine={refreshEngine}
              onModuleStateChange={onModuleStateChange}
              onClose={() => onOpenChange(false)}
            />
          </div>
        </>
      )}
    </>
  );
}
