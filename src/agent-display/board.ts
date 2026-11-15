import type { CostSnapshot, DispatchFeedResult, EngineSnapshot } from '../engine/types';
import { isSessionWorking, type EngineActivity } from '../engineActivity';
import type { Session } from '../types';

/**
 * 大屏共享快照：五款主题只是同一份内容的五种画法，
 * 所以数据在这一层收口，主题侧只做字段挑选。
 */
export interface BoardAgent {
  id: string;
  name: string;
  role: string;
  scene: string;
  color: string;
  working: boolean;
  unread: number;
  memory: number;
  skills: number;
  /** 词卡素材：会话名、职责、最近事件短句。 */
  words: string[];
}

export interface BoardTask {
  id: string;
  title: string;
  stage: string;
  owner: string;
  flow: string[];
  dispatchedAt: number;
  updatedAt: number;
  done: boolean;
  overdue: number;
  notes: string[];
}

export interface BoardPulse {
  at: number;
  kind: string;
  text: string;
  from: string;
  to: string;
}

export interface BoardSnapshot {
  at: number;
  engineReady: boolean;
  agents: BoardAgent[];
  tasks: BoardTask[];
  pulses: BoardPulse[];
  stats: {
    sessions: number;
    working: number;
    orders: number;
    doneToday: number;
    handoffs: number;
    overdue: number;
    eventsToday: number;
  };
  ledger: {
    todayCost: number;
    todayCalls: number;
    balance: number | null;
    currency: string;
  };
}

interface SnapshotInput {
  sessions: Session[];
  engine: EngineSnapshot | null;
  activity: EngineActivity;
  feed: DispatchFeedResult | null;
  cost: CostSnapshot | null;
  now?: number;
}

function clip(text: string, limit: number): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const clause = clean.split(/[。；;，,、！!？?：:]/)[0]?.trim() || clean;
  return clause.length > limit ? `${clause.slice(0, limit)}…` : clause;
}

function uniqueWords(list: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const value = clip(item, 10);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function stampOf(value?: string): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 场景信息按 id / 名称挂到会话上，补记忆数与技能数。 */
function sceneOf(engine: EngineSnapshot | null, session: Session) {
  if (!engine?.ok) return null;
  return (
    engine.scenes.find(
      (scene) =>
        (session.engine?.sceneId && scene.id === session.engine.sceneId) ||
        scene.name === session.name ||
        scene.name === session.scene,
    ) ?? null
  );
}

export function buildBoardSnapshot(input: SnapshotInput): BoardSnapshot {
  const { sessions, engine, activity, feed, cost } = input;
  const now = input.now ?? Date.now();

  /** 引擎事件里的 from/to 是 agent slug（如 video-clip），展示层要中文会话名。 */
  const nameOf = (key?: string): string => {
    const raw = String(key ?? '').trim();
    if (!raw) return '';
    const scene = engine?.scenes.find((item) => item.id === raw || item.name === raw);
    const session = sessions.find(
      (item) =>
        item.name === raw ||
        item.engine?.sceneId === raw ||
        (scene ? item.name === scene.name : false),
    );
    return session?.name || scene?.name || raw;
  };

  const agents: BoardAgent[] = sessions.map((session) => {
    const scene = sceneOf(engine, session);
    const eventWords = session.events.slice(0, 6).map((event) => event.text);
    return {
      id: session.id,
      name: session.name,
      role: session.role || session.scene || '',
      scene: session.scene,
      color: session.color,
      working: isSessionWorking(activity, session),
      unread: session.unread,
      memory: scene?.memoryCount ?? 0,
      skills: scene?.skillCount ?? 0,
      words: uniqueWords(
        [
          session.name,
          clip(session.role, 10),
          ...eventWords,
          scene?.mission ? clip(scene.mission, 10) : '',
        ],
        14,
      ),
    };
  });

  const orders = feed?.ok ? feed.orders : [];
  const tasks: BoardTask[] = orders
    .map((order) => {
      const events = (order.events ?? [])
        .map((event) => ({
          at: stampOf(event.ts),
          kind: String(event.type || event.status || 'event'),
          text: event.note || event.status || '',
          from: nameOf(event.from),
          to: nameOf(event.to),
        }))
        .sort((a, b) => b.at - a.at);
      const flow = Array.isArray(order.flow) ? order.flow.filter(Boolean).map(nameOf) : [];
      const lastAt = events[0]?.at || stampOf(order.submit_at || order.dispatched_at);
      const bare = String(order.task || '').replace(/^【[^】]*】\s*/, '');
      return {
        id: order.id || order.key,
        title: clip(bare || flow[flow.length - 1] || order.id, 16) || order.id,
        stage: String(order.stage || order.status || ''),
        owner: nameOf(order.current_owner || order.assignee || order.owner || ''),
        flow,
        dispatchedAt: stampOf(order.dispatched_at),
        updatedAt: lastAt,
        done: order.done === true || String(order.stage) === 'closed',
        overdue: typeof order.overdue?.minutes === 'number' ? order.overdue.minutes : 0,
        notes: uniqueWords(
          [order.task || '', ...events.map((event) => event.text)],
          16,
        ),
      };
    })
    .sort((a, b) => Number(a.done) - Number(b.done) || b.updatedAt - a.updatedAt);

  const pulses: BoardPulse[] = [];
  for (const order of orders) {
    for (const event of order.events ?? []) {
      const at = stampOf(event.ts);
      if (!at) continue;
      pulses.push({
        at,
        kind: String(event.type || event.status || 'event'),
        text: clip(event.note || event.status || '', 18),
        from: nameOf(event.from),
        to: nameOf(event.to),
      });
    }
  }
  pulses.sort((a, b) => b.at - a.at);

  const doneToday = tasks.filter((task) => task.done).length;
  const working = agents.filter((agent) => agent.working).length;
  const handoffs = orders.reduce(
    (total, order) => total + (typeof order.handoff_count === 'number' ? order.handoff_count : 0),
    0,
  );
  const overdue = tasks.filter((task) => task.overdue > 0 && !task.done).length;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const eventsToday = pulses.filter((pulse) => pulse.at >= dayStart.getTime()).length;

  return {
    at: now,
    engineReady: Boolean(engine?.ok && activity.ready),
    agents,
    tasks: tasks.slice(0, 24),
    pulses: pulses.slice(0, 40),
    stats: {
      sessions: agents.length,
      working,
      orders: tasks.length,
      doneToday,
      handoffs,
      overdue,
      eventsToday,
    },
    ledger: {
      todayCost: cost?.today?.cost ?? 0,
      todayCalls: cost?.today?.calls ?? 0,
      balance: cost?.balance?.total ?? null,
      currency: cost?.symbol || '¥',
    },
  };
}
