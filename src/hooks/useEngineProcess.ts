import { useCallback, useEffect, useState } from 'react';
import type { EngineProcessInfo } from '../engine/types';

interface EngineProcess {
  info: EngineProcessInfo | null;
  start: () => Promise<void>;
  restart: () => Promise<void>;
}

/**
 * 订阅主进程托管的 dsh web 状态。
 * 桌面端首次挂载时如果引擎还没起，会主动触发一次启动；浏览器预览环境保持 null。
 */
export function useEngineProcess(): EngineProcess {
  const [info, setInfo] = useState<EngineProcessInfo | null>(null);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    let alive = true;

    desktop
      .engineStatus()
      .then((snapshot) => {
        if (!alive) return;
        setInfo(snapshot);
        if (snapshot.status === 'idle') {
          void desktop.engineStart().then((next) => {
            if (alive) setInfo(next);
          });
        }
      })
      .catch(() => undefined);

    const off = desktop.onEngineStatus((snapshot) => {
      if (alive) setInfo(snapshot);
    });

    return () => {
      alive = false;
      off();
    };
  }, []);

  const start = useCallback(async () => {
    const desktop = window.desktop;
    if (!desktop) return;
    setInfo(await desktop.engineStart());
  }, []);

  const restart = useCallback(async () => {
    const desktop = window.desktop;
    if (!desktop) return;
    setInfo(await desktop.engineRestart());
  }, []);

  return { info, start, restart };
}
