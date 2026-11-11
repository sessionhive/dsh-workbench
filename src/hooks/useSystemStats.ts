import { useEffect, useState } from 'react';

export interface SystemStats {
  cpu: number;
  mem: number;
}

function drift(value: number, amount: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value + (Math.random() * 2 - 1) * amount));
}

/**
 * Reads live CPU / memory from Electron main process.
 * Falls back to a gentle simulation when running in a plain browser.
 */
export function useSystemStats(): SystemStats {
  const [stats, setStats] = useState<SystemStats>({ cpu: 17, mem: 57 });

  useEffect(() => {
    let disposed = false;

    const tick = async () => {
      const desktop = window.desktop;
      if (desktop?.getSystemStats) {
        try {
          const next = await desktop.getSystemStats();
          if (!disposed) setStats({ cpu: next.cpu, mem: next.mem });
          return;
        } catch {
          // fall through to simulation
        }
      }
      if (!disposed) {
        setStats((prev) => ({
          cpu: Math.round(drift(prev.cpu, 3, 9, 38)),
          mem: Math.round(drift(prev.mem, 0.8, 48, 66)),
        }));
      }
    };

    tick();
    const timer = window.setInterval(tick, 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  return stats;
}
