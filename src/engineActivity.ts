import { useSyncExternalStore } from 'react';
import type { Session } from './types';

/**
 * 官方 Harness 页面的运行态。
 * 侧栏会话行本身没有忙碌指示，唯一可靠的信号来自页面内部的会话列表：
 * 它记录了每个会话的 running 状态；DOM 上的发送/停止按钮只用来兜底。
 */
export interface EngineActivity {
  /** 官方页面是否已经可读取（进程就绪且页面 dom-ready）。 */
  ready: boolean;
  /** Harness 侧栏里当前选中的会话标题。 */
  activeTitle: string;
  /** 该会话是否正在执行（当前可见会话的 DOM 信号）。 */
  busy: boolean;
  /**
   * 正在执行的会话标题。
   * 来自页面会话列表的 running 标记，覆盖后台会话；读不到列表时退回
   * 当前会话的 DOM 观察（workingSince），直到确认空闲或超时。
   */
  working: string[];
}

const initialActivity: EngineActivity = {
  ready: false,
  activeTitle: '',
  busy: false,
  working: [],
};

/** 引擎页面返回的会话列表 running 标题；null 表示这一轮读不到列表。 */
export type ObservedRunning = string[] | null;

/** 后台会话长时间不可见时的兜底窗口，避免灯一直亮着。 */
const WORKING_TTL = 45 * 60 * 1000;

let activity = initialActivity;
let workingSince = new Map<string, number>();
const listeners = new Set<() => void>();

export function setEngineActivity(
  patch: Partial<EngineActivity> & { running?: ObservedRunning },
): void {
  const { running, ...rest } = patch;
  const next: EngineActivity = { ...activity, ...rest };
  const now = Date.now();

  if (next.ready === false) {
    workingSince = new Map();
  } else {
    // 会话列表是权威来源：整表替换，同时把兜底集合收敛到这一轮的结果。
    if (running !== undefined) {
      workingSince = new Map(
        dedupeTitles(running ?? []).map((title) => [normalizeTitle(title), now]),
      );
    }
    const title = normalizeTitle(next.activeTitle);
    if (next.ready && title) {
      if (next.busy) {
        workingSince.set(title, now);
      } else if (patch.activeTitle !== undefined || patch.busy !== undefined) {
        // 当前可见会话被确认空闲：只熄灭它自己，不误伤后台运行的会话。
        workingSince.delete(title);
      }
    }
    for (const [key, stamp] of workingSince) {
      if (now - stamp > WORKING_TTL) workingSince.delete(key);
    }
  }

  const working = [...workingSince.keys()];
  const same =
    next.ready === activity.ready &&
    next.activeTitle === activity.activeTitle &&
    next.busy === activity.busy &&
    working.length === activity.working.length &&
    working.every((title, index) => title === activity.working[index]);
  if (same) return;
  activity = { ...next, working };
  listeners.forEach((listener) => listener());
}

/** 标题列表去重并压成展示用的原始大小写。 */
function dedupeTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of titles) {
    const title = String(raw ?? '').replace(/\s+/g, ' ').trim();
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): EngineActivity {
  return activity;
}

export function useEngineActivity(): EngineActivity {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function titlesMatch(bindingTitle: string, activeTitle: string): boolean {
  const a = normalizeTitle(bindingTitle);
  const b = normalizeTitle(activeTitle);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/** 会话是否绑定到正在执行的某个 Harness 会话（含切走后仍在后台运行的）。 */
export function isSessionWorking(state: EngineActivity, session: Session): boolean {
  if (!state.ready || state.working.length === 0) return false;
  const binding = session.harness?.title;
  if (!binding) return false;
  return state.working.some((title) => titlesMatch(binding, title));
}

/** 按会话标题判断是否正在执行（引擎会话没有本地绑定时用场景名兜底）。 */
export function isTitleWorking(state: EngineActivity, title: string): boolean {
  if (!state.ready || state.working.length === 0) return false;
  return state.working.some((working) => titlesMatch(title, working));
}

export type SessionLight = 'working' | 'online' | 'idle';

/** 光灯状态：工作中橙、已绑定且引擎就绪绿、其余灰。 */
export function sessionLight(state: EngineActivity, session: Session): SessionLight {
  if (isSessionWorking(state, session)) return 'working';
  return session.harness?.title && state.ready ? 'online' : 'idle';
}
