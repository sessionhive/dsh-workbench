import { useEffect, useState } from 'react';
import type { ToastTone } from '../types';
import { Icon } from './icons';

interface TitleBarProps {
  mode: 'workbench' | 'board';
  onModeChange: (mode: 'workbench' | 'board') => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  onRefreshEngine: () => void;
  engineRefreshing?: boolean;
  notify: (message: string, tone?: ToastTone) => void;
}

export function TitleBar({
  mode,
  onModeChange,
  onOpenPalette,
  onOpenSettings,
  onRefreshEngine,
  engineRefreshing = false,
  notify,
}: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    desktop.isMaximized().then(setMaximized).catch(() => undefined);
    return desktop.onMaximizedChange(setMaximized);
  }, []);

  const windowFallback = () => notify('窗口控制仅在 Electron 桌面端可用', 'warn');

  const minimize = () => {
    if (window.desktop) window.desktop.minimize();
    else windowFallback();
  };

  const toggleMaximize = async () => {
    if (!window.desktop) {
      windowFallback();
      return;
    }
    setMaximized(await window.desktop.toggleMaximize());
  };

  const close = () => {
    if (window.desktop) window.desktop.close();
    else windowFallback();
  };

  return (
    <header className="titlebar">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <defs>
            <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6ff3f5" />
              <stop offset="100%" stopColor="#2a8bff" />
            </linearGradient>
          </defs>
          <path
            d="M16 2.2 28 9.1v13.8L16 29.8 4 22.9V9.1Z"
            fill="rgba(56,225,230,0.06)"
            stroke="url(#brandGrad)"
            strokeWidth="1.3"
          />
          <circle cx="16" cy="16" r="4.2" fill="url(#brandGrad)" />
          <circle
            cx="16"
            cy="16"
            r="8.6"
            fill="none"
            stroke="url(#brandGrad)"
            strokeOpacity="0.55"
            strokeDasharray="2.5 3.5"
          />
        </svg>
        <div className="brand-text">
          <div className="brand-name">
            DSH <span>中枢</span>
          </div>
          <div className="brand-sub">NEXUS · 集成工作台</div>
        </div>
      </div>

      <button type="button" className="command-trigger" onClick={onOpenPalette}>
        <Icon name="search" size={14} />
        <span>向中枢下达指令，或搜索会话…</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="titlebar-right">
        <div className="mode-switch" role="tablist" aria-label="工作台模式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'workbench'}
            className={mode === 'workbench' ? 'on' : ''}
            title="中枢台 · 会话、模块与调度"
            onClick={() => onModeChange('workbench')}
          >
            <Icon name="command" size={12} />
            中枢台
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'board'}
            className={mode === 'board' ? 'on' : ''}
            title="场景桌面 · 用盒子拼装当前场景"
            onClick={() => onModeChange('board')}
          >
            <Icon name="panel" size={12} />
            场景桌面
          </button>
        </div>
        <div className="win-controls">
          <button
            type="button"
            className={`win-settings win-refresh${engineRefreshing ? ' spinning' : ''}`}
            aria-label="刷新引擎数据"
            title="重新扫描引擎数据"
            onClick={onRefreshEngine}
            disabled={engineRefreshing}
          >
            <Icon name="refresh" size={13} />
          </button>
          <button
            type="button"
            className="win-settings"
            aria-label="设置"
            title="工作台设置"
            onClick={onOpenSettings}
          >
            <Icon name="sliders" size={13} />
          </button>
          <button type="button" aria-label="最小化" onClick={minimize}>
            <Icon name="minus" size={14} />
          </button>
          <button type="button" aria-label={maximized ? '还原' : '最大化'} onClick={toggleMaximize}>
            <Icon name={maximized ? 'restore' : 'square'} size={12} />
          </button>
          <button type="button" className="win-close" aria-label="关闭" onClick={close}>
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
