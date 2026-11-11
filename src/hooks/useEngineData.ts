import { useCallback, useEffect, useState } from 'react';
import type { EngineSnapshot } from '../engine/types';

interface EngineData {
  engine: EngineSnapshot | null;
  loading: boolean;
  refresh: () => void;
  error: string | null;
}

/**
 * 只读扫描引擎数据目录。目录变化带防抖，手动刷新可立即重读。
 * 浏览器预览环境没有 IPC，返回 null 由模块走本地兜底。
 */
export function useEngineData(root: string): EngineData {
  const [engine, setEngine] = useState<EngineSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop || !root) {
      setEngine(null);
      setLoading(false);
      return;
    }

    let alive = true;
    let timer = 0;
    setLoading(true);

    const run = async () => {
      try {
        const snapshot = await desktop.scanEngine(root);
        if (!alive) return;
        setEngine(snapshot);
        setError(snapshot.ok ? null : snapshot.errors[0] ?? '引擎数据读取失败');
      } catch (reason) {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (alive) setLoading(false);
      }
    };

    timer = window.setTimeout(() => {
      void run();
    }, 260);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [root, tick]);

  return { engine, loading, refresh, error };
}
