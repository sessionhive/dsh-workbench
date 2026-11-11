import { useEffect, useRef, useState } from 'react';
import type { EngineProcessInfo } from '../engine/types';
import {
  BOOT_SPEED_FACTOR,
  bootLines,
  defaultBootConfig,
  type BootConfig,
} from '../bootConfig';

interface EngineBootProps {
  status: EngineProcessInfo['status'];
  port?: string;
  /** 叠在已存在的官方页面之上（引擎重启 / 页面加载），而不是独占内容区。 */
  overlay?: boolean;
  /** 覆盖加载阶段的文案，例如“正在加载官方页面”。 */
  detail?: string;
  onRestart?: () => void;
  /** 主题设置里的启动动画配置。 */
  boot?: BootConfig;
}

const STATUS_LABEL: Record<EngineProcessInfo['status'], string> = {
  idle: '待启动',
  starting: '启动中',
  ready: '已连接',
  error: '未连接',
};

interface LogLine {
  tone: 'cmd' | 'ok' | 'warn' | 'dim';
  glyph: string;
  text: string;
}

/** 解析日志前缀：$ 命令、✓ 完成、! 警告、· 普通步骤。 */
function parseLine(raw: string): LogLine {
  const value = raw.trim();
  if (value.startsWith('$')) return { tone: 'cmd', glyph: '$', text: value.slice(1).trim() };
  if (value.startsWith('✓')) return { tone: 'ok', glyph: '✓', text: value.slice(1).trim() };
  if (value.startsWith('!')) return { tone: 'warn', glyph: '!', text: value.slice(1).trim() };
  if (value.startsWith('·') || value.startsWith('›')) {
    return { tone: 'dim', glyph: '·', text: value.slice(1).trim() };
  }
  return { tone: 'dim', glyph: '·', text: value };
}

/** 启动阶段文案：按耗时推进，和实际拉起顺序一致。 */
function stageText(status: EngineProcessInfo['status'], elapsed: number, detail?: string): string {
  if (detail) return detail;
  if (status === 'idle') return '等待工作台拉起引擎';
  if (status === 'error') return '引擎启动失败';
  if (elapsed < 2.4) return '正在拉起本地引擎进程';
  if (elapsed < 6) return '正在准备 dsh web 服务';
  return '正在等待引擎端口就绪';
}

/**
 * 引擎启动层：贴近 DSH 日志的终端样式。
 * 支持主题设置里的开关、风格（日志流 / 极简）、速度与自定义日志行；
 * 关闭开关后保留静态状态页，避免引擎区变成空白。
 */
export function EngineBoot({
  status,
  port,
  overlay,
  detail,
  onRestart,
  boot = defaultBootConfig,
}: EngineBootProps) {
  const startedRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed((Date.now() - startedRef.current) / 1000);
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  const idle = status === 'idle' && !detail;
  const stage = stageText(status, elapsed, detail);
  const factor = BOOT_SPEED_FACTOR[boot.speed];
  const step = 0.62 * factor;
  const ceiling = detail ? 96 : idle ? 8 : 90;
  const percent = Math.max(
    3,
    Math.min(ceiling, 3 + (ceiling - 3) * (1 - Math.exp(-elapsed / factor / (detail ? 1.5 : 3.2)))),
  );
  const showRestart = Boolean(onRestart) && (idle || (status === 'starting' && elapsed > 6.5));
  const rootClass = `engine-boot${overlay ? ' overlay' : ''}${idle ? ' idle' : ''}`;

  if (!boot.enabled) {
    return (
      <div className={`${rootClass} engine-boot--static`} role="status" aria-label="DSH 引擎启动">
        <div className="boot-static">
          <span className="boot-static-brand">DSH</span>
          <span className="boot-static-stage">{stage}</span>
          {port && <span className="boot-static-port">127.0.0.1:{port}</span>}
          {showRestart && (
            <button type="button" className="boot-action" onClick={onRestart}>
              {idle ? '启动引擎' : '重新启动'}
            </button>
          )}
        </div>
      </div>
    );
  }

  const lines = bootLines(boot, port);
  const revealed = detail
    ? lines.length
    : Math.min(lines.length, Math.max(0, Math.floor((elapsed - 0.15) / step) + 1));

  if (boot.style === 'minimal') {
    return (
      <div className={`${rootClass} engine-boot--minimal`} role="status" aria-label="DSH 引擎启动">
        <div className="boot-mini">
          <div className="boot-mini-brand">
            <b>DSH</b>
            <span>引擎</span>
          </div>
          <div className="boot-mini-stage">
            {stage}
            <i className="boot-caret" aria-hidden="true" />
          </div>
          <div
            className="boot-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <div className="boot-mini-meta">
            <span>{port ? `127.0.0.1:${port}` : '本地引擎'}</span>
            <i />
            <span>{elapsed.toFixed(1)}s</span>
            {showRestart && (
              <button type="button" className="boot-action" onClick={onRestart}>
                {idle ? '启动引擎' : '重新启动'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${rootClass} engine-boot--log`} role="status" aria-label="DSH 引擎启动">
      <div className="boot-window">
        <header className="boot-head">
          <span className="boot-brand">DSH</span>
          <span className="boot-head-title">ENGINE · 本地引擎</span>
          <span className={`boot-badge ${status}`}>{STATUS_LABEL[status]}</span>
        </header>

        <div className="boot-log" aria-live="polite">
        {lines.slice(0, revealed).map((line, index) => {
          const meta = parseLine(line);
          return (
            <div className="boot-line" data-tone={meta.tone} key={`${index}-${meta.text}`}>
              <span className="boot-time">+{(0.15 + index * step).toFixed(1)}s</span>
              <span className="boot-glyph">{meta.glyph}</span>
              <span className="boot-text">{meta.text}</span>
            </div>
          );
        })}
        <div className="boot-line current" data-tone={status === 'error' ? 'warn' : 'live'}>
          <span className="boot-time">+{elapsed.toFixed(1)}s</span>
          <span className="boot-glyph">›</span>
          <span className="boot-text">
            {stage}
            <i className="boot-caret" aria-hidden="true" />
          </span>
        </div>
      </div>

      <footer className="boot-foot">
        <div
          className="boot-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="boot-meta">
          <span>{port ? `127.0.0.1:${port}` : '本地引擎'}</span>
          <i />
          <span>{Math.round(percent)}%</span>
          <i />
          <span>{elapsed.toFixed(1)}s</span>
          {showRestart && (
            <button type="button" className="boot-action" onClick={onRestart}>
              {idle ? '启动引擎' : '重新启动'}
            </button>
          )}
        </div>
        </footer>
      </div>
    </div>
  );
}
