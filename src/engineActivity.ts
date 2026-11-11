import { useSyncExternalStore } from 'react';
import type { Session } from './types';

/**
 * 官方 Harness 页面的运行态。
 * 侧栏会话行本身没有忙碌指示，唯一可靠的信号来自当前会话：
 * 发送中按钮、停止生成按钮、running whale 以及 aria-busy。
 */
export interface EngineActivity {
  /** 官方页面是否已经可读取（进程就绪且页面 dom-ready）。 */
  ready: boolean;
  /** Harness 侧栏里当前选中的会话标题。 */
  activeTitle: string;
  /** 该会话是否正在执行。 */
  busy: boolean;
}

const initialActivity: EngineActivity = {
  ready: false,
  activeTitle: '',
  busy: false,
};

let activity = initialActivity;
const listeners = new Set<() => void>();

export function setEngineActivity(patch: Partial<EngineActivity>): void {
  const next: EngineActivity = { ...activity, ...patch };
  if (
    next.ready === activity.ready &&
    next.activeTitle === activity.activeTitle &&
    next.busy === activity.busy
  ) {
    return;
  }
  activity = next;
  listeners.forEach((listener) => listener());
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

/** 会话是否绑定到正在执行的那个 Harness 会话。 */
export function isSessionWorking(state: EngineActivity, session: Session): boolean {
  if (!state.ready || !state.busy) return false;
  const binding = session.harness?.title;
  return binding ? titlesMatch(binding, state.activeTitle) : false;
}

export type SessionLight = 'working' | 'online' | 'idle';

/** 光灯状态：工作中橙、已绑定且引擎就绪绿、其余灰。 */
export function sessionLight(state: EngineActivity, session: Session): SessionLight {
  if (isSessionWorking(state, session)) return 'working';
  return session.harness?.title && state.ready ? 'online' : 'idle';
}
