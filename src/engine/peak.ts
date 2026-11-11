import type { CostPeakConfig } from './types';

export interface PeakState {
  inPeak: boolean;
  /** 当前处于节假日（全天谷价） */
  holiday: boolean;
  /** 当前处于周末（全天谷价） */
  weekend: boolean;
  /** 下一次峰谷切换的时间戳 */
  nextAtMs: number;
  /** 下一次切换是否进入高峰 */
  nextIntoPeak: boolean;
}

const CST_OFFSET = 8 * 3600000;
const DAY_MS = 86400000;
const HOUR_MS = 3600000;

const pad = (value: number) => String(value).padStart(2, '0');

/** 引擎按北京时间判日：UTC+8 的本地日序号。 */
function localDayIndex(ms: number) {
  return Math.floor((ms + CST_OFFSET) / DAY_MS);
}

function localDayKey(ms: number) {
  return new Date(localDayIndex(ms) * DAY_MS).toISOString().slice(0, 10);
}

function isHoliday(config: CostPeakConfig, ms: number) {
  return config.holidays.includes(localDayKey(ms));
}

function isWeekend(ms: number) {
  // 0 = 周日，6 = 周六
  const day = (localDayIndex(ms) + 4) % 7;
  return day === 0 || day === 6;
}

/** 与 dsh-cost-meter 一致：周末/节假日全天谷价，高峰窗口按 UTC 小时。 */
export function peakPhaseAt(
  config: CostPeakConfig | null | undefined,
  ms: number,
): 'peak' | 'off' | null {
  if (!config || !config.enabled || !config.windows.length || !Number.isFinite(ms)) return null;
  const effectiveAt = Date.parse(config.effectiveAt || '');
  if (Number.isFinite(effectiveAt) && ms < effectiveAt) return null;
  if (isHoliday(config, ms) || isWeekend(ms)) return 'off';
  const hour = new Date(ms).getUTCHours();
  const inWindow = config.windows.some(({ start, end }) =>
    start < end ? hour >= start && hour < end : hour >= start || hour < end,
  );
  return inWindow ? 'peak' : 'off';
}

/** 峰谷只会在整点切换，向后找最近的相位变化点。 */
export function peakStateAt(
  config: CostPeakConfig | null | undefined,
  ms: number,
): PeakState | null {
  const phase = peakPhaseAt(config, ms);
  if (phase === null || !config) return null;

  let nextAtMs = 0;
  let nextIntoPeak = false;
  const firstBoundary = Math.floor(ms / HOUR_MS) * HOUR_MS + HOUR_MS;
  for (let step = 0; step < 24 * 16; step += 1) {
    const at = firstBoundary + step * HOUR_MS;
    const next = peakPhaseAt(config, at);
    if (next === null || next === phase) continue;
    nextAtMs = at;
    nextIntoPeak = next === 'peak';
    break;
  }
  if (!nextAtMs) return null;

  return {
    inPeak: phase === 'peak',
    holiday: isHoliday(config, ms),
    weekend: isWeekend(ms),
    nextAtMs,
    nextIntoPeak,
  };
}

export function formatCountdown(deltaMs: number): string {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return '即将切换';
  const total = Math.ceil(deltaMs / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return hours > 0 ? `${days}天${hours}小时` : `${days}天`;
  if (hours > 0) return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`;
  if (minutes > 0) return `${minutes}分`;
  return `${seconds}秒`;
}

export function formatBalance(
  value: number | null | undefined,
  decimals: number,
  symbol: string,
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${symbol}--`;
  const digits = Math.max(0, Math.min(4, Math.round(decimals)));
  return `${symbol}${value.toFixed(digits)}`;
}

export function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 高峰窗口显示为北京时间，例如 09:00–12:00 / 14:00–18:00。 */
export function formatPeakWindows(config: CostPeakConfig | null | undefined): string {
  if (!config || !config.windows.length) return '';
  return config.windows
    .map(({ start, end }) => {
      const toCst = (hour: number) => pad((hour + 8) % 24);
      return `${toCst(start)}:00–${toCst(end)}:00`;
    })
    .join(' / ');
}
