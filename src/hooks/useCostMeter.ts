import { useEffect, useState } from 'react';
import type { CostSnapshot } from '../engine/types';

const POLL_MS = 2_000;

/**
 * 只读订阅计费账本（余额 / 当日消耗 / 峰谷配置）。
 * 账本由引擎侧插件写入，这里按分钟轮询；读取失败时保留上一份可用快照。
 */
export function useCostMeter(root: string): CostSnapshot | null {
  const [cost, setCost] = useState<CostSnapshot | null>(null);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop || !root) {
      setCost(null);
      return;
    }

    let alive = true;
    const run = async () => {
      try {
        const snapshot = await desktop.costSnapshot(root);
        if (!alive) return;
        setCost((previous) => (snapshot.ok || !previous?.ok ? snapshot : previous));
      } catch {
        // 主进程不可用时保持现状，底栏自动省略余额项。
      }
    };

    void run();
    const timer = window.setInterval(() => {
      if (!document.hidden) void run();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [root]);

  return cost;
}
