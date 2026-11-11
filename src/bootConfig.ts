export type BootStyle = 'log' | 'minimal';
export type BootSpeed = 'slow' | 'normal' | 'fast';

export interface BootConfig {
  enabled: boolean;
  style: BootStyle;
  speed: BootSpeed;
  /** 自定义日志行；留空时使用内置文案。支持 {port} 占位。 */
  lines: string[];
}

/** 内置启动日志：与 dsh web 的实际启动顺序对应。 */
export const DEFAULT_BOOT_LINES = [
  '$ dsh web --no-open --port {port}',
  '· 载入 DSH_HOME 与场景索引',
  '· 解析会话、技能与记忆索引',
  '✓ 引擎进程已启动',
  '✓ 本地服务 127.0.0.1:{port} 已监听',
  '· 等待官方页面握手',
];

export const BOOT_SPEED_FACTOR: Record<BootSpeed, number> = {
  slow: 1.55,
  normal: 1,
  fast: 0.62,
};

export const defaultBootConfig: BootConfig = {
  enabled: true,
  style: 'log',
  speed: 'normal',
  lines: [],
};

export function normalizeBootConfig(input: Partial<BootConfig> | null | undefined): BootConfig {
  const style: BootStyle = input?.style === 'minimal' ? 'minimal' : 'log';
  const speed: BootSpeed =
    input?.speed === 'slow' || input?.speed === 'fast' ? input.speed : 'normal';
  const lines = Array.isArray(input?.lines)
    ? input.lines
        .filter((line): line is string => typeof line === 'string')
        .map((line) => line.replace(/\s+$/, '').slice(0, 140))
        .filter((line) => line.trim().length > 0)
        .slice(0, 14)
    : [];
  return {
    enabled: input?.enabled !== false,
    style,
    speed,
    lines,
  };
}

/** 把 {port} 替换成实际端口，避免启动页里出现占位符。 */
export function bootLines(config: BootConfig, port?: string): string[] {
  const custom = config.lines.filter((line) => line.trim().length > 0);
  const source = custom.length > 0 ? custom : DEFAULT_BOOT_LINES;
  return source.map((line) => line.replace(/\{port\}/g, port || '3083'));
}
