import { useEffect, useState } from 'react';
import type { EngineEventFeed } from '../engine/types';

const POLL_MS = 2200;
const HIDDEN_POLL_MS = 6000;

/**
 * 轻量订阅引擎事件尾部（events / dispatch）。
 * 只在神经元视图挂载时启用，页面隐藏时降频；读取范围与 engine:scan 一致。
 */
export function useEngineEvents(root: string, enabled: boolean): EngineEventFeed | null {
  const [feed, setFeed] = useState<EngineEventFeed | null>(null);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop || !root || !enabled) {
      setFeed(null);
      return;
    }

    let alive = true;
    let timer = 0;

    const run = async () => {
      let delay = POLL_MS;
      try {
        const next = await desktop.engineEvents(root);
        if (alive) setFeed(next);
      } catch {
        delay = HIDDEN_POLL_MS;
      }
      if (!alive) return;
      if (document.hidden) delay = HIDDEN_POLL_MS;
      timer = window.setTimeout(run, delay);
    };

    void run();
    const onVisibility = () => {
      if (!alive || document.hidden) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 120);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, root]);

  return feed;
}
