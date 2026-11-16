import { useEffect, useState } from 'react';
import { useEngineActivity } from '../engineActivity';
import {
  formatBalance,
  formatClock,
  formatCountdown,
  formatPeakWindows,
  peakStateAt,
} from '../engine/peak';
import type { CostSnapshot, EngineProcessInfo, EngineSnapshot } from '../engine/types';
import type { SystemStats } from '../hooks/useSystemStats';
import type { Session } from '../types';
import { Icon } from './icons';
import {
  clearVoiceError,
  speakLatestReply,
  stopVoice,
  toggleVoicePause,
  useVoiceState,
} from '../voice';

interface StatusBarProps {
  sessions: Session[];
  stats: SystemStats;
  engine?: EngineSnapshot | null;
  engineLoading?: boolean;
  engineProcess?: EngineProcessInfo | null;
  cost?: CostSnapshot | null;
}

const HARNESS_LABEL: Record<EngineProcessInfo['status'], string> = {
  idle: 'DSH 引擎待启动',
  starting: 'DSH 引擎启动中',
  ready: 'DSH 引擎已连接',
  error: 'DSH 引擎未连接',
};

export function StatusBar({
  sessions,
  stats,
  engine,
  engineLoading,
  engineProcess,
  cost,
}: StatusBarProps) {
  const [now, setNow] = useState(() => new Date());
  const activity = useEngineActivity();
  const voice = useVoiceState();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 运行数来自引擎页面的真实 running，而不是本地会话的旧状态字段。
  const running = activity.working.length;
  const unread = sessions.reduce((total, session) => total + session.unread, 0);
  const time = now.toLocaleTimeString('zh-CN', { hour12: false });

  const liveCost = cost?.ok ? cost : null;
  const peak = liveCost ? peakStateAt(liveCost.peak, now.getTime()) : null;
  const balanceText = liveCost
    ? formatBalance(liveCost.balance?.total, liveCost.decimals, liveCost.symbol)
    : '';
  const todayCost = liveCost
    ? formatBalance(liveCost.today?.costCny, liveCost.decimals, liveCost.symbol)
    : '';
  const balanceTitle = liveCost
    ? [
        `账户余额 ${balanceText}`,
        liveCost.balance?.updatedAt
          ? `账本更新 ${new Date(liveCost.balance.updatedAt).toLocaleString('zh-CN', {
              hour12: false,
            })}`
          : '',
        `今日已花 ${todayCost} · ${liveCost.today?.calls ?? 0} 次调用`,
      ]
        .filter(Boolean)
        .join('\n')
    : undefined;
  const peakWindows = liveCost ? formatPeakWindows(liveCost.peak) : '';
  const peakTitle = peak
    ? [
        peakWindows ? `高峰时段 ${peakWindows}（北京时间）` : '',
        '周末与节假日全天谷价',
        peak.nextAtMs
          ? `下次切换 ${formatClock(peak.nextAtMs)} · ${peak.nextIntoPeak ? '进入高峰' : '转为谷价'}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : undefined;
  const peakLabel = peak
    ? peak.holiday
      ? '假日 · 全天谷价'
      : peak.weekend
        ? '周末 · 全天谷价'
        : `${peak.inPeak ? '峰价' : '谷价'} · ${formatCountdown(peak.nextAtMs - now.getTime())}后${
            peak.nextIntoPeak ? '入峰' : '转谷'
          }`
    : '';
  const harnessTitle =
    engineProcess?.status === 'ready' && engineProcess.port
      ? `DSH 引擎 · 端口 ${engineProcess.port}`
      : engineProcess?.error || HARNESS_LABEL[engineProcess?.status ?? 'idle'];

  return (
    <footer className="statusbar">
      <div className="group">
        <span className={`engine-state${engine?.ok ? ' on' : ''}`}>
          <i />
          {engineLoading
            ? '引擎读取中'
            : engine?.ok
              ? `引擎 ${engine.scenes.length} 个会话 · 只读`
              : '引擎未连接'}
        </span>
        <span className="sep" />
        <span>
          会话 <b className="mono">{sessions.length}</b>
        </span>
        <span>
          运行 <b className="mono">{running}</b>
        </span>
        <span>
          未读 <b className="mono">{unread}</b>
        </span>
        {voice.phase === 'idle' && voice.lastReply && (
          <>
            <span className="sep" />
            <button
              type="button"
              className="status-voice idle"
              title="朗读当前会话最新一轮回复"
              onClick={speakLatestReply}
            >
              <Icon name="volume" size={12} />
              朗读回复
            </button>
          </>
        )}
        {voice.phase === 'idle' && voice.error && (
          <button
            type="button"
            className="status-voice error"
            title={voice.error}
            onClick={clearVoiceError}
          >
            <Icon name="alert" size={11} />
            语音不可用
          </button>
        )}
        {voice.phase !== 'idle' && (
          <span className={`status-voice live ${voice.phase}`}>
            <button
              type="button"
              title={voice.phase === 'paused' ? '继续朗读' : '暂停朗读'}
              onClick={toggleVoicePause}
            >
              <Icon name={voice.phase === 'paused' ? 'play' : 'pause'} size={11} />
            </button>
            <span className="status-voice-label">
              {voice.phase === 'loading'
                ? voice.local
                  ? voice.index
                    ? `本地合成 ${voice.index}/${voice.total}`
                    : '本地合成中'
                  : '准备语音'
                : voice.phase === 'paused'
                  ? '已暂停'
                  : `朗读中 ${voice.index}/${voice.total}`}
            </span>
            <button type="button" title="停止朗读" onClick={stopVoice}>
              <Icon name="stop" size={10} />
            </button>
          </span>
        )}
      </div>
      <div className="spacer" />
      <div className="group status-right">
        <span
          className={`harness-link ${engineProcess?.status ?? 'idle'}`}
          title={harnessTitle}
          aria-label={harnessTitle}
        >
          <i />
          {HARNESS_LABEL[engineProcess?.status ?? 'idle']}
        </span>
        {liveCost?.balance && (
          <span className="cost-balance" title={balanceTitle}>
            余额 <b className="mono">{balanceText}</b>
          </span>
        )}
        {peak && (
          <span className={`cost-peak${peak.inPeak ? ' peak' : ' off'}`} title={peakTitle}>
            <i />
            {peakLabel}
          </span>
        )}
        <span className="sep" />
        <span className="resource-item">
          CPU <b className="mono">{stats.cpu}%</b>
        </span>
        <span className="resource-item">
          MEM <b className="mono">{stats.mem}%</b>
        </span>
        <span className="sep" />
        <span className="mono">{time}</span>
      </div>
    </footer>
  );
}
