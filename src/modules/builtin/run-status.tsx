import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/icons';
import type { EngineProcessInfo, HealthReport, HealthStatus } from '../../engine/types';
import { useSystemStats } from '../../hooks/useSystemStats';
import type { ModuleDefinition } from '../types';

const PROCESS_LABEL: Record<string, string> = {
  idle: '未启动',
  starting: '启动中',
  ready: '已就绪',
  error: '启动失败',
};

const PROCESS_TONE: Record<string, string> = {
  idle: 'idle',
  starting: 'waiting',
  ready: 'online',
  error: 'offline',
};

const HEALTH_LABEL: Record<HealthStatus, string> = {
  ok: '通过',
  warn: '注意',
  fail: '失败',
};

function uptimeText(startedAt: number, now: number): string {
  if (!startedAt) return '—';
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

function clockText(value: number): string {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
}

function scanClock(value: string | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '—';
  return new Date(parsed).toLocaleTimeString('zh-CN', { hour12: false });
}

function meterTone(value: number): string {
  if (value >= 85) return 'high';
  if (value >= 60) return 'mid';
  return 'low';
}

function healthCount(report: HealthReport | null, status: HealthStatus): number {
  return report?.checks.filter((check) => check.status === status).length ?? 0;
}

function ProcessCard({ info }: { info: EngineProcessInfo | null | undefined }) {
  const status = info?.status ?? 'idle';
  const [now, setNow] = useState(() => Date.now());
  const tone = PROCESS_TONE[status] ?? 'idle';

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="run-card">
      <header className="run-card-head">
        <span className="run-card-title">
          <Icon name="server" size={12} />
          DSH 引擎
        </span>
        <span className={`run-chip ${tone}`}>
          <i className={`status-dot ${tone}`} />
          {PROCESS_LABEL[status] ?? status}
        </span>
      </header>

      <div className="run-kv">
        <span>端口</span>
        <b>{info?.port || '3083'}</b>
      </div>
      <div className="run-kv">
        <span>运行时长</span>
        <b>{status === 'ready' ? uptimeText(info?.startedAt ?? 0, now) : '—'}</b>
      </div>
      <div className="run-kv">
        <span>启动时间</span>
        <b>{info?.startedAt ? clockText(info.startedAt) : '—'}</b>
      </div>
      {info?.engineDir && (
        <div className="run-path" title={info.engineDir}>
          {info.engineDir}
        </div>
      )}
      {info?.error && <p className="run-message fail">{info.error}</p>}
    </section>
  );
}

function SystemCard() {
  const stats = useSystemStats();
  const now = Date.now();
  return (
    <section className="run-card">
      <header className="run-card-head">
        <span className="run-card-title">
          <Icon name="cpu" size={12} />
          本机资源
        </span>
        <span className="run-muted">2 秒刷新</span>
      </header>

      <div className="run-meter">
        <div className="run-meter-head">
          <span>CPU</span>
          <b>{stats.cpu}%</b>
        </div>
        <div className="run-meter-track">
          <i className={`run-meter-fill ${meterTone(stats.cpu)}`} style={{ width: `${stats.cpu}%` }} />
        </div>
      </div>

      <div className="run-meter">
        <div className="run-meter-head">
          <span>内存</span>
          <b>{stats.mem}%</b>
        </div>
        <div className="run-meter-track">
          <i className={`run-meter-fill ${meterTone(stats.mem)}`} style={{ width: `${stats.mem}%` }} />
        </div>
      </div>

      <div className="run-note">采样时间 {clockText(now)}</div>
    </section>
  );
}

function ScanCard({
  scenes,
  skills,
  errors,
  scannedAt,
  loading,
  onRefresh,
}: {
  scenes: number;
  skills: number;
  errors: number;
  scannedAt: string | undefined;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="run-card">
      <header className="run-card-head">
        <span className="run-card-title">
          <Icon name="database" size={12} />
          引擎数据
        </span>
        <button
          type="button"
          className="icon-btn"
          title="重新扫描引擎数据"
          onClick={onRefresh}
        >
          <Icon name="refresh" size={12} />
        </button>
      </header>

      <div className="run-kv">
        <span>会话场景</span>
        <b>{loading ? '…' : scenes}</b>
      </div>
      <div className="run-kv">
        <span>技能目录</span>
        <b>{loading ? '…' : skills}</b>
      </div>
      <div className="run-kv">
        <span>扫描错误</span>
        <b className={errors > 0 ? 'run-bad' : ''}>{loading ? '…' : errors}</b>
      </div>
      <div className="run-note">最近扫描 {scanClock(scannedAt)}</div>
    </section>
  );
}

function HealthCard({
  report,
  loading,
  error,
  onRefresh,
}: {
  report: HealthReport | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const failed = report?.checks.filter((check) => check.status === 'fail') ?? [];
  const warned = report?.checks.filter((check) => check.status === 'warn') ?? [];
  const issues = [...failed, ...warned].slice(0, 3);

  return (
    <section className="run-card run-health">
      <header className="run-card-head">
        <span className="run-card-title">
          <Icon name="activity" size={12} />
          体检
        </span>
        <button type="button" className="icon-btn" title="重新体检" onClick={onRefresh}>
          <Icon name="refresh" size={12} />
        </button>
      </header>

      {loading && <div className="run-note">正在体检…</div>}
      {!loading && error && <p className="run-message fail">{error}</p>}
      {!loading && !error && !report && <div className="run-note">暂无体检结果。</div>}

      {!loading && report && (
        <>
          <div className="run-health-counts">
            <span className="ok">{healthCount(report, 'ok')} 通过</span>
            <span className="warn">{healthCount(report, 'warn')} 注意</span>
            <span className="fail">{healthCount(report, 'fail')} 失败</span>
          </div>
          {issues.length > 0 ? (
            <ul className="run-health-list">
              {issues.map((check) => (
                <li key={check.id} className={check.status}>
                  <span className={`run-health-tag ${check.status}`}>
                    {HEALTH_LABEL[check.status]}
                  </span>
                  <span className="run-health-label">{check.label}</span>
                  <span className="run-health-detail" title={check.hint || check.detail}>
                    {check.detail}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="run-message ok">全部检查通过。</p>
          )}
          <div className="run-note">
            体检于 {clockText(report.checkedAt)}
            {healthCount(report, 'ok') > 0 ? ` · ${healthCount(report, 'ok')} 项通过` : ''}
          </div>
        </>
      )}
    </section>
  );
}

/** 运行状态：DSH 进程、本机资源、引擎扫描与体检的总览面板。 */
export const runStatusModule: ModuleDefinition = {
  manifest: {
    id: 'run.status',
    name: '运行状态',
    version: '0.1.0',
    description:
      '汇总 DSH 进程状态与端口、CPU/内存占用、引擎扫描统计和最近一次体检结果，只读诊断面板。',
    icon: 'cpu',
    kind: ['view'],
    slots: ['center.view'],
    category: 'core',
    permissions: ['sessions:read', 'fs:read'],
  },
  center: {
    tabLabel: '运行',
    title: '运行状态',
    subtitle: ({ runningCount }) =>
      `DSH 进程 · 本机资源 · 引擎扫描与体检 · ${runningCount} 个任务运行中`,
  },
  View: ({ engine, engineLoading, engineProcess, settings, refreshEngine }) => {
    const [health, setHealth] = useState<{
      loading: boolean;
      report: HealthReport | null;
      error: string;
    }>({ loading: false, report: null, error: '' });

    const runHealth = useCallback(async () => {
      const desktop = window.desktop;
      if (!desktop?.healthCheck) {
        setHealth({ loading: false, report: null, error: '当前环境无法执行主进程体检' });
        return;
      }
      setHealth((previous) => ({ ...previous, loading: true, error: '' }));
      try {
        const report = await desktop.healthCheck(settings.engine);
        setHealth({
          loading: false,
          report: report.ok ? report : null,
          error: report.ok ? '' : '体检没有返回结果',
        });
      } catch (reason) {
        setHealth({
          loading: false,
          report: null,
          error: reason instanceof Error ? reason.message : String(reason),
        });
      }
    }, [settings.engine]);

    useEffect(() => {
      void runHealth();
    }, [runHealth]);

    return (
      <div className="run-status">
        <div className="run-head">
          <div className="run-head-main">
            <span className="run-title">
              <Icon name="cpu" size={12} />
              运行状态
            </span>
            <span className="run-meta">
              只读诊断 · {engine?.ok ? '引擎数据已连接' : '等待引擎数据'}
            </span>
          </div>
          <button
            type="button"
            className="run-refresh"
            title="重新扫描并体检"
            onClick={() => {
              refreshEngine();
              void runHealth();
            }}
          >
            <Icon name="refresh" size={12} />
            刷新
          </button>
        </div>

        <div className="run-grid">
          <ProcessCard info={engineProcess} />
          <SystemCard />
          <ScanCard
            scenes={engine?.scenes.length ?? 0}
            skills={engine?.skills.dirs.length ?? 0}
            errors={engine?.errors.length ?? 0}
            scannedAt={engine?.scannedAt}
            loading={engineLoading}
            onRefresh={refreshEngine}
          />
          <HealthCard
            report={health.report}
            loading={health.loading}
            error={health.error}
            onRefresh={() => void runHealth()}
          />
        </div>
      </div>
    );
  },
};
