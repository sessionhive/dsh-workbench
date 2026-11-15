import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DispatchEventEntry,
  DispatchFeedResult,
  DispatchOrder,
  DispatchThresholds,
  DispatchTiming,
  EngineScene,
} from '../../engine/types';
import type { Session } from '../../types';
import { Icon } from '../../components/icons';
import { Markdown } from '../../components/Markdown';
import type { ModuleDefinition } from '../types';

/** 常驻轮询只覆盖今天和昨天；更早的记录按需加载。 */
const RECENT_DAYS = 2;
/** 「更早」一次补拉的天数（与今天合计一周）。 */
const FEED_DAYS = 7;
/** 插件写事件很频繁，界面 5 秒跟一次；页面隐藏时降频。 */
const POLL_MS = 5000;
const HIDDEN_POLL_MS = 15000;
/** 超时角标每 30 秒刷新一次，避免一直等到下一次派单轮询。 */
const OVERDUE_TICK_MS = 30000;
/** 插件接口尚未下发 thresholds 时的兜底值，与流程规范保持一致。 */
const FALLBACK_THRESHOLDS: Required<DispatchThresholds> = {
  staleMinutes: 3,
  noticeMinutes: 5,
  heartbeatMinutes: 5,
};

const STAGE_LABEL: Record<string, string> = {
  created: '已建单',
  dispatched: '已派单',
  delivered: '已送达',
  acked: '已受理',
  started: '进行中',
  submitted: '已提交',
  verified: '已验收',
  rejected: '已打回',
  closed: '已关闭',
};

const EVENT_LABEL: Record<string, string> = {
  dispatch: '派单',
  wake: '唤醒',
  delivered: '送达',
  ack: '受理',
  takeover: '接管',
  progress: '进展',
  submit: '提交',
  handoff: '交接',
  verify: '验收',
  reject: '打回',
  close: '关单',
  cancel: '取消',
  stale: '超时',
  comment: '记录',
  heartbeat: '心跳',
  interrupted: '中断',
  blocked: '阻塞',
};

type Tone = 'live' | 'done' | 'fail' | 'muted';

interface ChainNode {
  raw: string;
  label: string;
  active: boolean;
}

interface ChainEvent {
  key: string;
  stamp: number;
  time: string;
  kind: string;
  label: string;
  tone: Tone;
  from: string;
  to: string;
  note: string;
  refs: string[];
  count: number;
  endTime?: string;
  heartbeat: boolean;
}

interface OverdueBadge {
  minutes: number;
  text: string;
}

interface DispatchChain {
  key: string;
  id: string;
  day: string;
  stage: string;
  statusText: string;
  tone: Tone;
  cancelled: boolean;
  latest: number;
  latestTime: string;
  lastActivity: number;
  task: string;
  order: DispatchOrder;
  nodes: ChainNode[];
  events: ChainEvent[];
  heartbeatCount: number;
  overdue: OverdueBadge | null;
  seeded: boolean;
}

function eventKind(event: DispatchEventEntry): string {
  return String(event.type || '').toLowerCase();
}

function eventStamp(event: DispatchEventEntry): number {
  const parsed = event.ts ? Date.parse(event.ts) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeParts(stamp: number): { date: string; clock: string } {
  if (!stamp) return { date: '—', clock: '—' };
  const value = new Date(stamp);
  const clock = value.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  return { date: `${value.getMonth() + 1}-${value.getDate()}`, clock };
}

function clockOf(stamp: number): string {
  if (!stamp) return '—';
  return new Date(stamp).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function clockSeconds(stamp: number): string {
  if (!stamp) return '—';
  return new Date(stamp).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** 本地日期 key，和插件的 day 字段一致。 */
function localDay(offset = 0): string {
  const value = new Date();
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate() - offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function recentDays(count: number): string[] {
  return Array.from({ length: count }, (_, index) => localDay(index));
}

/** 插件下发的阈值优先；旧接口缺字段时退回兜底值，避免文案跟着改死。 */
function thresholdsOf(feed: DispatchFeedResult | null): Required<DispatchThresholds> {
  const source = feed?.thresholds ?? {};
  const pick = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  return {
    staleMinutes: pick(source.staleMinutes, FALLBACK_THRESHOLDS.staleMinutes),
    noticeMinutes: pick(source.noticeMinutes, FALLBACK_THRESHOLDS.noticeMinutes),
    heartbeatMinutes: pick(source.heartbeatMinutes, FALLBACK_THRESHOLDS.heartbeatMinutes),
  };
}

/** 页面里的 day 分组标签：今天 / 昨天 / MM-DD。 */
function dayLabel(day: string): string {
  if (day === localDay(0)) return '今天';
  if (day === localDay(1)) return '昨天';
  return day.slice(5) || day;
}

function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return '';
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest ? `${minutes}m${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

function basename(value: string): string {
  return (
    String(value || '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() ?? ''
  );
}

/** 只有 submit（带 refs）推进完成候选，其余都是过程信息。 */
function deriveStage(order: DispatchOrder): string {
  const events = order.events ?? [];
  const has = (type: string) => events.some((event) => eventKind(event) === type);
  if (has('cancel')) return 'closed';
  if (has('close')) return 'closed';
  if (has('reject')) return 'rejected';
  if (has('verify')) return 'verified';
  if (has('submit')) return 'submitted';
  if (has('progress')) return 'started';
  if (has('ack') || has('takeover')) return 'acked';
  if (has('delivered')) return 'delivered';
  if (has('dispatch')) return 'dispatched';
  return 'created';
}

function isHeartbeat(event: DispatchEventEntry): boolean {
  if (eventKind(event) === 'heartbeat') return true;
  if (eventKind(event) !== 'comment') return false;
  return /heartbeat|心跳/i.test(`${event.note || ''} ${event.reason || ''}`);
}

function eventTone(kind: string): Tone {
  if (/reject|cancel|stale|interrupt|block/.test(kind)) return 'fail';
  if (/close|verify/.test(kind)) return 'done';
  if (/comment|heartbeat/.test(kind)) return 'muted';
  return 'live';
}

/** 心跳只保留一条汇总（×N + 时间范围）；其余相邻同秒重复合并成 ×N。 */
function toChainEvents(order: DispatchOrder): ChainEvent[] {
  const rows: ChainEvent[] = [];
  let heartbeat: ChainEvent | null = null;
  for (const event of order.events ?? []) {
    const kind = eventKind(event);
    const isBeat = isHeartbeat(event);
    const stamp = eventStamp(event);
    const previous = rows[rows.length - 1];
    const key = `${stamp}|${kind}|${event.from || ''}|${event.to || ''}|${event.note || ''}`;
    const row: ChainEvent = {
      key,
      stamp,
      time: clockSeconds(stamp),
      kind,
      label: isBeat ? '心跳' : EVENT_LABEL[kind] || kind || '事件',
      tone: eventTone(kind),
      from: String(event.from || ''),
      to: String(event.to || ''),
      note: String(event.note || event.reason || ''),
      refs: Array.isArray(event.refs) ? event.refs.filter((ref) => typeof ref === 'string') : [],
      count: 1,
      heartbeat: isBeat,
    };
    if (isBeat) {
      if (!heartbeat) {
        heartbeat = { ...row, endTime: row.time };
      } else {
        heartbeat.count += 1;
        heartbeat.endTime = row.time;
      }
      continue;
    }
    if (previous && previous.key === key) {
      previous.count += 1;
      continue;
    }
    rows.push(row);
  }
  if (heartbeat) {
    const index = rows.findIndex((row) => row.stamp > heartbeat!.stamp);
    rows.splice(index < 0 ? rows.length : index, 0, heartbeat);
  }
  return rows;
}

/** 事件里的 from/to 可能是角色 id、Harness 标题或引擎场景 id，尽量落到本地会话。 */
function resolveSession(
  raw: string | undefined,
  sessions: Session[],
  scenes: EngineScene[] | undefined,
): Session | null {
  const key = String(raw ?? '').trim();
  if (!key) return null;

  const direct = sessions.find(
    (session) =>
      session.id === key ||
      session.name === key ||
      session.harness?.title === key ||
      session.harness?.sessionId === key ||
      session.engine?.sceneId === key,
  );
  if (direct) return direct;

  const scene = scenes?.find(
    (item) =>
      item.id === key ||
      item.name === key ||
      item.primarySessionTitle === key ||
      item.sessions.some((session) => session.sessionId === key),
  );
  if (!scene) return null;

  return (
    sessions.find((session) => session.engine?.sceneId === scene.id) ??
    sessions.find(
      (session) =>
        session.harness?.sessionId === scene.primarySessionId ||
        session.harness?.title === scene.primarySessionTitle,
    ) ??
    null
  );
}

function buildChain(
  order: DispatchOrder,
  now: number,
  labelFor: (raw: string) => string,
  thresholds: Required<DispatchThresholds>,
): DispatchChain {
  const day = String(order.day || String(order.key || '').split('/')[0] || '');
  const id = String(order.id || String(order.key || '').split('/')[1] || '');
  const key = String(order.key || `${day}/${id}`);
  const events = toChainEvents(order);
  const latest = events.reduce((max, event) => Math.max(max, event.stamp), 0);
  const stage = String(order.stage || deriveStage(order)).toLowerCase();
  // 取消以取消事件为准；status 只是兜底，避免插件把“清理关单”也标成 cancelled 时误显示。
  const cancelEvent = events.some((event) => event.kind === 'cancel');
  const closeEvent = events.some((event) => event.kind === 'close');
  const cancelled = cancelEvent || (/cancel/i.test(String(order.status || '')) && !closeEvent);
  const blocked =
    events.some((event) => event.kind === 'blocked') || /block/i.test(String(order.status || ''));
  const closed = stage === 'closed' || Boolean(order.done);

  const tone: Tone =
    cancelled || blocked
      ? blocked
        ? 'fail'
        : 'muted'
      : stage === 'rejected'
        ? 'fail'
        : closed || stage === 'verified'
          ? 'done'
          : 'live';

  const statusText = cancelled
    ? '已取消'
    : blocked
      ? '已阻塞'
      : stage === 'closed'
        ? '已关闭'
        : STAGE_LABEL[stage] || stage || '已建单';

  // 真实活动时间：心跳、超时催办和插件的重复唤醒都不算“有人干活”。
  const lastActivity = events.reduce(
    (max, event) =>
      /comment|stale|heartbeat|wake/.test(event.kind) ? max : Math.max(max, event.stamp),
    0,
  );

  const flow = Array.isArray(order.flow)
    ? order.flow.filter((item) => typeof item === 'string')
    : [];
  const roles: string[] = [];
  const push = (raw: string) => {
    const value = String(raw || '').trim();
    if (!value) return;
    if (roles[roles.length - 1] === value) return;
    roles.push(value);
  };
  if (flow.length) {
    flow.forEach(push);
    // 单棒流程只返回接单方，补上派单方才能看出「命令 → 接单方」。
    const dispatcher = String(order.dispatcher || '').trim();
    if (
      dispatcher &&
      !flow.some((item) => String(item).trim().toLowerCase() === dispatcher.toLowerCase())
    ) {
      roles.unshift(dispatcher);
    }
  } else {
    push(String(order.dispatcher || ''));
    push(String(order.assignee || ''));
    push(String(order.current_owner || order.owner || ''));
  }
  const current = String(order.current_owner || order.owner || '').trim();
  const nodes = roles.map((raw) => ({
    raw,
    label: labelFor(raw),
    active: !closed && !cancelled && !blocked && raw === current,
  }));

  // 超时规则：已关闭不参与；待受理按 dispatched_at，处理中按最后一次真实活动。
  const dispatchedAt = order.dispatched_at ? Date.parse(order.dispatched_at) : 0;
  const overdue: OverdueBadge | null = (() => {
    if (closed || cancelled || blocked) return null;
    if (stage === 'dispatched' || stage === 'delivered') {
      if (!dispatchedAt) return null;
      const minutes = Math.floor((now - dispatchedAt) / 60000);
      if (minutes >= thresholds.staleMinutes) return { minutes, text: `${minutes} 分钟未受理` };
      return null;
    }
    if (stage === 'acked' || stage === 'started' || stage === 'submitted') {
      const since = lastActivity || dispatchedAt;
      if (!since) return null;
      const minutes = Math.floor((now - since) / 60000);
      if (minutes < thresholds.noticeMinutes) return null;
      return {
        minutes,
        text: stage === 'submitted' ? `${minutes} 分钟未验收` : `${minutes} 分钟未提交`,
      };
    }
    return null;
  })();

  // 卡片时间贴真实活动（心跳、超时催办不算），否则会跟超时角标自相矛盾。
  const latestParts = timeParts(lastActivity || dispatchedAt || latest);

  return {
    key,
    id,
    day,
    stage,
    statusText,
    tone,
    cancelled,
    latest: latest || dispatchedAt,
    latestTime: latest ? latestParts.clock : latestParts.date,
    lastActivity,
    task: String(order.task || ''),
    order,
    nodes,
    events,
    heartbeatCount: events
      .filter((event) => event.heartbeat)
      .reduce((sum, event) => sum + event.count, 0),
    overdue,
    seeded: (order.events ?? []).some((event) => Boolean(event.seeded)),
  };
}

/** 按日期分组，保持传入顺序（链路已按最新事件倒序）。 */
function groupByDay(chains: DispatchChain[]): [string, DispatchChain[]][] {
  const map = new Map<string, DispatchChain[]>();
  for (const chain of chains) {
    const list = map.get(chain.day) ?? [];
    list.push(chain);
    map.set(chain.day, list);
  }
  return [...map.entries()];
}

function timingOf(order: DispatchOrder): DispatchTiming {
  const timing = order.timing ?? {};
  return timing.durations ? { ...timing, ...timing.durations } : timing;
}

/** 派单记录：按天隔离、按 stage 分栏，flow 链路 + 超时角标 + 只读详情。 */
export const dispatchTimelineModule: ModuleDefinition = {
  manifest: {
    id: 'dispatch.timeline',
    name: '派单记录',
    version: '0.2.0',
    description:
      '按日期 + 单号展示插件派单：按 stage 分进行中 / 已完成，flow 链路高亮当前棒次，超时只催不替，详情含事件时间线、耗时与单据文件，只读。',
    icon: 'activity',
    kind: ['view'],
    slots: ['center.view'],
    category: 'core',
    permissions: ['sessions:read'],
  },
  center: {
    tabLabel: '派单',
    title: '派单记录',
    subtitle: ({ runningCount }) => `插件派单 · 按天隔离 · 只读 · ${runningCount} 个任务运行中`,
  },
  View: ({ sessions, engine, settings, actions, refreshEngine }) => {
    const [feed, setFeed] = useState<DispatchFeedResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [now, setNow] = useState(() => Date.now());
    const [reload, setReload] = useState(0);
    const [older, setOlder] = useState<{
      loading: boolean;
      orders: DispatchOrder[];
      error?: string;
    } | null>(null);
    const [historyReload, setHistoryReload] = useState(0);
    const [closedActiveDates, setClosedActiveDates] = useState<Set<string>>(() => new Set());
    const [openDates, setOpenDates] = useState<Set<string>>(() => new Set());
    const [detailKey, setDetailKey] = useState('');
    const [md, setMd] = useState<{
      key: string;
      path: string;
      loading: boolean;
      text: string;
      error?: string;
    } | null>(null);
    const mdSeqRef = useRef(0);

    // 只读派单接口：常驻轮询只拉今天/昨天，更早的记录点「加载更早」再补。
    useEffect(() => {
      const desktop = window.desktop;
      if (!desktop?.dispatchFeed) {
        setLoading(false);
        return;
      }
      let alive = true;
      let timer = 0;
      const run = async () => {
        try {
          const result = await desktop.dispatchFeed(recentDays(RECENT_DAYS));
          if (alive) {
            setFeed(result);
            setLoading(false);
          }
        } catch (error) {
          if (alive) {
            setFeed((previous) => ({
              ok: false,
              readAt: Date.now(),
              days: [],
              orders: previous?.orders ?? [],
              thresholds: previous?.thresholds ?? null,
              error: String((error as Error)?.message ?? error),
            }));
            setLoading(false);
          }
        }
        if (alive) timer = window.setTimeout(run, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
      };
      void run();
      const onVisibility = () => {
        if (!alive || document.hidden) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(run, 300);
      };
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
        alive = false;
        window.clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisibility);
      };
    }, [reload]);

    // 「更早」按需补拉一次；加载过之后手动刷新会跟着一起更新。
    useEffect(() => {
      if (!older) return;
      const desktop = window.desktop;
      if (!desktop?.dispatchFeed) return;
      let alive = true;
      setOlder((previous) => (previous ? { ...previous, loading: true, error: undefined } : previous));
      const days = recentDays(FEED_DAYS).slice(RECENT_DAYS);
      void desktop
        .dispatchFeed(days)
        .then((result) => {
          if (!alive) return;
          setOlder({
            loading: false,
            orders: Array.isArray(result.orders) ? result.orders : [],
            error: result.ok ? undefined : result.error || '读取更早记录失败',
          });
        })
        .catch((error: unknown) => {
          if (!alive) return;
          setOlder({
            loading: false,
            orders: [],
            error: String((error as Error)?.message ?? error),
          });
        });
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [historyReload]);

    useEffect(() => {
      const timer = window.setInterval(() => setNow(Date.now()), OVERDUE_TICK_MS);
      return () => window.clearInterval(timer);
    }, []);

    const labelFor = (raw: string) => {
      const trimmed = String(raw || '').trim();
      if (!trimmed) return '未知';
      if (trimmed.toLowerCase() === 'host') return '宿主';
      const scene = engine?.scenes.find(
        (item) =>
          item.id === trimmed || item.name === trimmed || item.primarySessionTitle === trimmed,
      );
      if (scene) return scene.name;
      const session = sessions.find(
        (item) =>
          item.id === trimmed ||
          item.name === trimmed ||
          item.harness?.title === trimmed ||
          item.engine?.sceneId === trimmed,
      );
      return session?.name || trimmed;
    };

    const thresholds = useMemo(() => thresholdsOf(feed), [feed]);

    const chains = useMemo(() => {
      const unique = new Map<string, DispatchOrder>();
      const all = [...(feed?.orders ?? []), ...(older?.orders ?? [])];
      for (const order of all) {
        if (!order || typeof order !== 'object') continue;
        const day = String(order.day || '');
        const id = String(order.id || '');
        const key = String(order.key || (day && id ? `${day}/${id}` : ''));
        if (!key) continue;
        const previous = unique.get(key);
        if (!previous || (order.events?.length ?? 0) > (previous.events?.length ?? 0)) {
          unique.set(key, order);
        }
      }
      return [...unique.values()]
        .map((order) => buildChain(order, now, labelFor, thresholds))
        .filter((chain) => Boolean(chain.id))
        .sort((left, right) => right.latest - left.latest);
    }, [feed, older, engine, now, sessions, thresholds]);

    const activeChains = useMemo(
      () =>
        chains.filter(
          (chain) => !chain.cancelled && chain.stage !== 'closed' && !chain.order.done,
        ),
      [chains],
    );
    const doneChains = useMemo(
      () => chains.filter((chain) => chain.cancelled || chain.stage === 'closed' || chain.order.done),
      [chains],
    );
    const activeGroups = useMemo(() => groupByDay(activeChains), [activeChains]);
    const doneGroups = useMemo(() => groupByDay(doneChains), [doneChains]);

    const toggleActiveDate = (day: string) =>
      setClosedActiveDates((previous) => {
        const next = new Set(previous);
        if (next.has(day)) next.delete(day);
        else next.add(day);
        return next;
      });

    const toggleDoneDate = (day: string) =>
      setOpenDates((previous) => {
        const next = new Set(previous);
        if (next.has(day)) next.delete(day);
        else next.add(day);
        return next;
      });

    const closeMd = () => {
      mdSeqRef.current += 1;
      setMd(null);
    };

    const openTarget = (raw: string) => {
      const target = resolveSession(raw, sessions, engine?.scenes);
      if (!target) {
        actions.notify('这条派单还没有对应的本地会话', 'info');
        return;
      }
      actions.openSession(target.id);
    };

    /** 只看 collab/<day>/<id>-<角色>.md；文件名由主进程目录列表决定。 */
    const toggleMd = (chain: DispatchChain) => {
      if (md?.key === chain.key) {
        closeMd();
        return;
      }
      const root = engine?.root || settings.engine.dataPath;
      const desktop = window.desktop;
      if (!root || !desktop) {
        actions.notify('当前环境无法读取引擎文件', 'info');
        return;
      }
      if (!chain.id || !chain.day) {
        actions.notify('这条记录缺少日期或单号，找不到派单文件', 'info');
        return;
      }
      const assignee = String(chain.order.assignee || chain.nodes[0]?.raw || '').trim();
      const agent = /^[A-Za-z0-9._-]+$/.test(assignee) ? assignee : '';
      const fallback = `collab/${chain.day}/${chain.id}-${agent || '*'}.md`;
      const seq = ++mdSeqRef.current;
      setMd({ key: chain.key, path: fallback, loading: true, text: '' });
      void desktop
        .readEngineOrder(root, chain.day, chain.id, agent)
        .then((result) => {
          if (seq !== mdSeqRef.current) return;
          setMd({
            key: chain.key,
            path: result.relative || fallback,
            loading: false,
            text: stripFrontMatter(result.text ?? ''),
            error: result.ok ? undefined : result.error || '无法读取该文件',
          });
        })
        .catch((error: unknown) => {
          if (seq !== mdSeqRef.current) return;
          setMd({
            key: chain.key,
            path: fallback,
            loading: false,
            text: '',
            error: String((error as Error)?.message ?? error),
          });
        });
    };

    const renderEvents = (chain: DispatchChain) => (
      <div className="dispatch-events">
        {chain.events.length === 0 && <span className="dispatch-md-note">还没有事件记录。</span>}
        {chain.events.map((event) => (
          <div
            key={`${chain.key}-${event.key}`}
            className={`dispatch-event${event.tone === 'muted' ? ' muted' : ''}`}
          >
            <span
              className="dispatch-event-time"
              title={
                event.stamp
                  ? new Date(event.stamp).toLocaleString('zh-CN', { hour12: false })
                  : undefined
              }
            >
              {event.time}
            </span>
            <span className={`dispatch-event-kind ${event.tone}`}>
              {event.label}
              {event.count > 1 && <i>×{event.count}</i>}
            </span>
            <span className="dispatch-event-body">
              {(event.from || event.to) && (
                <span className="dispatch-event-route">
                  {event.from || '—'} → {event.to || '—'}
                </span>
              )}
              {event.heartbeat ? (
                <span className="dispatch-event-note">
                  {event.count > 1 && event.endTime && event.endTime !== event.time
                    ? `${event.time}–${event.endTime} · `
                    : ''}
                  约 {thresholds.heartbeatMinutes} 分钟无新记录（仅记录，不唤醒）
                </span>
              ) : event.note ? (
                <span className="dispatch-event-note">{event.note}</span>
              ) : null}
              {event.refs.length > 0 && (
                <span className="dispatch-event-refs" title={event.refs.join('\n')}>
                  附件 {event.refs.length} · {event.refs.map(basename).join('、')}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    );

    const renderDetail = (chain: DispatchChain) => {
      const timing = timingOf(chain.order);
      const durations = [
        ['排队', formatMs(timing.queue_ms)],
        ['开工延迟', formatMs(timing.start_delay_ms)],
        ['处理', formatMs(timing.work_ms)],
        ['总耗时', formatMs(timing.total_ms)],
      ].filter(([, value]) => Boolean(value));
      const last = chain.lastActivity
        ? `${clockOf(chain.lastActivity)} · ${Math.max(
            0,
            Math.floor((now - chain.lastActivity) / 60000),
          )} 分钟前`
        : '—';

      return (
        <div className="dispatch-detail">
          {chain.task && <p className="dispatch-task">{chain.task}</p>}
          <div className="dispatch-detail-meta">
            <span>
              完整单号 <b>{chain.key}</b>
            </span>
            <span>
              派单 <b>{chain.order.dispatcher || '—'}</b>
            </span>
            <span>
              接单 <b>{chain.order.assignee || '—'}</b>
            </span>
            <span>
              归属 <b>{chain.order.owner || '—'}</b>
            </span>
            <span>
              当前棒次 <b>{chain.order.current_owner || '—'}</b>
            </span>
            {chain.order.next && (
              <span>
                下一棒 <b>{chain.order.next}</b>
              </span>
            )}
            <span>
              最后活动 <b>{last}</b>
            </span>
            {chain.heartbeatCount > 0 && (
              <span>
                心跳记录 <b>{chain.heartbeatCount} 次</b>
              </span>
            )}
          </div>
          {durations.length > 0 && (
            <div className="dispatch-timing">
              {durations.map(([label, value]) => (
                <span key={label}>
                  {label} <b>{value}</b>
                </span>
              ))}
            </div>
          )}
          {renderEvents(chain)}
        </div>
      );
    };

    const renderChain = (chain: DispatchChain) => {
      const detailOpen = detailKey === chain.key;
      const mdOpen = md?.key === chain.key;
      return (
        <article key={chain.key} className={`dispatch-chain${chain.cancelled ? ' cancelled' : ''}`}>
          <div className="dispatch-chain-head">
            <span
              className="dispatch-chain-time"
              title={
                [
                  chain.order.dispatched_at
                    ? `派单 ${new Date(chain.order.dispatched_at).toLocaleString('zh-CN', { hour12: false })}`
                    : '',
                  chain.lastActivity
                    ? `最后活动 ${new Date(chain.lastActivity).toLocaleString('zh-CN', { hour12: false })}`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
            >
              {chain.latestTime}
            </span>
            <span className="dispatch-order" title={chain.key}>
              {chain.id}
            </span>
            <span className={`dispatch-chain-status ${chain.tone}`}>
              <i />
              {chain.statusText}
            </span>
            {chain.overdue && (
              <span className="dispatch-overdue" title="超时只催不替，不会自动关单或打回">
                {chain.overdue.text}
              </span>
            )}
            {chain.seeded && <span className="dispatch-seed">示例</span>}
            {chain.task && <span className="dispatch-text">{chain.task}</span>}
            <span className="dispatch-card-actions">
              <button
                type="button"
                className={`dispatch-view${detailOpen ? ' on' : ''}`}
                title={detailOpen ? '收起详情' : '事件时间线 / 耗时 / 任务原文'}
                onClick={() => setDetailKey(detailOpen ? '' : chain.key)}
              >
                {detailOpen ? '收起' : '详情'}
              </button>
              <button
                type="button"
                className={`dispatch-view${mdOpen ? ' on' : ''}`}
                title={mdOpen ? '收起单据文件' : `查看 ${chain.key} 的派单文件`}
                onClick={() => toggleMd(chain)}
              >
                单据
              </button>
            </span>
          </div>
          <div className="dispatch-chain-route">
            {chain.nodes.length === 0 && <span className="dispatch-link">没有接力信息</span>}
            {chain.nodes.map((node, index) => (
              <Fragment key={`${chain.key}-${index}-${node.raw}`}>
                {index > 0 && <span className="dispatch-link">→</span>}
                <button
                  type="button"
                  className={`dispatch-chip${node.active ? ' executing' : ''}`}
                  title={node.active ? `${node.label} · 当前棒次` : `定位会话 ${node.label}`}
                  onClick={() => openTarget(node.raw)}
                >
                  {node.active && <i />}
                  <span>{node.label}</span>
                  {node.label !== node.raw && <small>{node.raw}</small>}
                </button>
              </Fragment>
            ))}
          </div>
          {detailOpen && renderDetail(chain)}
          {mdOpen && md && (
            <div className="dispatch-md">
              <div className="dispatch-md-head">
                <span className="dispatch-md-path" title={md.path}>
                  只读 · {md.path}
                </span>
                <button type="button" aria-label="收起派单文件" onClick={closeMd}>
                  <Icon name="x" size={11} />
                </button>
              </div>
              <div className="dispatch-md-body">
                {md.loading ? (
                  <span className="dispatch-md-note">正在读取…</span>
                ) : md.error ? (
                  <span className="dispatch-md-note">{md.error}</span>
                ) : (
                  <Markdown text={md.text} className="doc-markdown" empty="这份派单文件是空的。" />
                )}
              </div>
            </div>
          )}
        </article>
      );
    };

    const live = Boolean(feed?.ok) && chains.length > 0;
    const failedDays = (feed?.days ?? []).filter((entry) => !entry.ok);
    const feedError = feed?.error || failedDays[0]?.error;
    const allFailed = feed !== null && !feed.ok && chains.length === 0;

    return (
      <div className="dispatch-panel">
        <div className="dispatch-head">
          <div className="dispatch-head-main">
            <span className="dispatch-title">
              <Icon name="activity" size={12} />
              派单链路
            </span>
            <span
              className="dispatch-meta"
              title={`插件按未受理 ${thresholds.staleMinutes} 分钟 / 未提交 ${thresholds.noticeMinutes} 分钟检测超时；notice.enabled 关闭时只记录心跳，不唤醒`}
            >
              {loading && chains.length === 0
                ? '正在读取…'
                : `${activeChains.length} 进行中 · ${doneChains.length} 已完成 · 只读`}
              {live && <i className="dispatch-live" title="正在跟随插件派单接口" />}
              {feedError && chains.length > 0 && (
                <span className="dispatch-meta-warn" title={feedError}>
                  部分日期读取失败
                </span>
              )}
            </span>
          </div>
          <div className="dispatch-actions">
            <button
              type="button"
              className="icon-btn"
              title="刷新派单（同时重扫引擎）"
              onClick={() => {
                setNow(Date.now());
                setReload((value) => value + 1);
                if (older) setHistoryReload((value) => value + 1);
                refreshEngine();
              }}
            >
              <Icon name="refresh" size={12} />
            </button>
          </div>
        </div>

        {chains.length === 0 ? (
          <div className="dispatch-empty">
            <Icon name="activity" size={20} />
            <p>
              {loading
                ? '正在读取派单接口…'
                : allFailed
                  ? `派单接口不可用${feedError ? `：${feedError}` : ''}。引擎启动后会自动恢复。`
                  : '今天和昨天还没有派单记录。插件产生 dispatch 后会出现在这里。'}
            </p>
            {!loading && !allFailed && older === null && (
              <button
                type="button"
                className="dispatch-history"
                onClick={() => {
                  setOlder({ loading: true, orders: [] });
                  setHistoryReload((value) => value + 1);
                }}
              >
                <Icon name="clock" size={11} />
                加载更早记录（最近 7 天）
              </button>
            )}
          </div>
        ) : (
          <div className="dispatch-columns">
            <section className="dispatch-col">
              <div className="dispatch-col-head static">
                <span className="dispatch-col-title">进行中</span>
                <em>{activeChains.length}</em>
                <span className="dispatch-col-hint">按天 · 默认展开</span>
              </div>
              <div className="dispatch-col-body">
                {activeGroups.map(([day, items]) => {
                  const open = !closedActiveDates.has(day);
                  return (
                    <div key={day} className="dispatch-date-group">
                      <button
                        type="button"
                        className={`dispatch-date${open ? ' open' : ''}`}
                        onClick={() => toggleActiveDate(day)}
                        title={day}
                      >
                        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
                        <span>{dayLabel(day)}</span>
                        <em>{items.length} 条</em>
                      </button>
                      {open && items.map(renderChain)}
                    </div>
                  );
                })}
                {activeChains.length === 0 && (
                  <div className="dispatch-col-empty">暂无进行中的派单</div>
                )}
              </div>
            </section>

            <section className="dispatch-col">
              <div className="dispatch-col-head static">
                <span className="dispatch-col-title">已完成</span>
                <em>{doneChains.length}</em>
                <span className="dispatch-col-hint">按天 · 默认折叠</span>
              </div>
              <div className="dispatch-col-body">
                {doneGroups.map(([day, items]) => {
                  const open = openDates.has(day);
                  return (
                    <div key={day} className="dispatch-date-group">
                      <button
                        type="button"
                        className={`dispatch-date${open ? ' open' : ''}`}
                        onClick={() => toggleDoneDate(day)}
                        title={day}
                      >
                        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
                        <span>{dayLabel(day)}</span>
                        <em>{items.length} 条</em>
                      </button>
                      {open && items.map(renderChain)}
                    </div>
                  );
                })}
                {doneChains.length === 0 && (
                  <div className="dispatch-col-empty">还没有已完成的派单</div>
                )}
                {older === null && (
                  <button
                    type="button"
                    className="dispatch-history"
                    onClick={() => {
                      setOlder({ loading: true, orders: [] });
                      setHistoryReload((value) => value + 1);
                    }}
                  >
                    <Icon name="clock" size={11} />
                    加载更早记录（最近 7 天）
                  </button>
                )}
                {older?.loading && (
                  <div className="dispatch-col-empty">正在读取更早记录…</div>
                )}
                {older && !older.loading && older.error && (
                  <button
                    type="button"
                    className="dispatch-history"
                    title={older.error}
                    onClick={() => setHistoryReload((value) => value + 1)}
                  >
                    <Icon name="refresh" size={11} />
                    更早记录读取失败，重试
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    );
  },
};

/** 派单文件带 YAML front matter，预览时只渲染正文。 */
function stripFrontMatter(text: string): string {
  const body = String(text || '');
  if (!body.startsWith('---')) return body;
  const end = body.indexOf('\n---', 3);
  if (end < 0) return body;
  return body.slice(end + 4).replace(/^\s+/, '');
}
