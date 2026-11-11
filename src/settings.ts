import { defaultBootConfig, normalizeBootConfig, type BootConfig } from './bootConfig';

export type Density = 'comfortable' | 'compact';
export type ThemeTone = 'dark' | 'light';

export interface ThemeDefinition {
  id: string;
  name: string;
  tone: ThemeTone;
  accent: string;
  background: string;
  /** 背景光晕强度 0–100。 */
  glow: number;
  builtin?: boolean;
}

export const builtinThemes: ThemeDefinition[] = [
  {
    id: 'obsidian',
    name: '曜石黑',
    tone: 'dark',
    accent: '#b9c4d4',
    background: '#050608',
    glow: 26,
    builtin: true,
  },
  {
    id: 'nexus',
    name: '深空青',
    tone: 'dark',
    accent: '#38e1e6',
    background: '#050810',
    glow: 64,
    builtin: true,
  },
  {
    id: 'moon',
    name: '月夜蓝',
    tone: 'dark',
    accent: '#8fb7ff',
    background: '#070b17',
    glow: 46,
    builtin: true,
  },
  {
    id: 'day',
    name: '晨雾白',
    tone: 'light',
    accent: '#0a8f9c',
    background: '#eef3f9',
    glow: 28,
    builtin: true,
  },
  {
    id: 'forest',
    name: '森屿绿',
    tone: 'dark',
    accent: '#49d9a0',
    background: '#040f0b',
    glow: 52,
    builtin: true,
  },
  {
    id: 'sakura',
    name: '樱粉',
    tone: 'light',
    accent: '#d5538f',
    background: '#fbf0f5',
    glow: 34,
    builtin: true,
  },
  {
    id: 'violet',
    name: '星紫',
    tone: 'dark',
    accent: '#b18cff',
    background: '#08050f',
    glow: 58,
    builtin: true,
  },
];

export interface WorkbenchSettings {
  appearance: {
    motion: boolean;
    density: Density;
    themeId: string;
    themes: ThemeDefinition[];
    /** 引擎启动动画：开关、风格、速度与自定义日志行。 */
    boot: BootConfig;
  };
  workbench: {
    /** 派发任务后保持“运行中”的时长。 */
    dispatchHoldMs: number;
    /** 关闭窗口时收进系统托盘，而不是直接退出。 */
    closeToTray: boolean;
  };
  engine: {
    /** DSH 引擎安装目录（含 apps/cli）。留空时由主进程给出与程序同级的默认值。 */
    engineDir: string;
    dataPath: string;
    workspacePath: string;
    /** 文件工作台的浏览边界；默认是程序所在目录，可返回工具目录的上级。 */
    filesRoot: string;
    /** 技能目录：设置页“技能”清单与当前角色技能共用。 */
    skillsPath: string;
    /** 工具目录：引擎侧工具脚本的存放位置，也是文件工作台的默认入口。 */
    toolsPath: string;
    readOnly: boolean;
  };
  terminal: {
    /** 默认终端 shell 的 id：auto / git-bash / powershell / cmd，运行时再解析成实际路径。 */
    shell: string;
  };
}

export interface SettingsInput {
  appearance?: Partial<WorkbenchSettings['appearance']>;
  workbench?: Partial<WorkbenchSettings['workbench']>;
  engine?: Partial<WorkbenchSettings['engine']>;
  terminal?: Partial<WorkbenchSettings['terminal']>;
}

/**
 * 壳工程不在源码里绑定任何绝对路径：首次运行由主进程按程序所在位置推导，
 * 用户也可以在设置里逐项覆盖。开源分发时只需保证目录与程序的相对关系。
 */
export const defaultSettings: WorkbenchSettings = {
  appearance: {
    motion: true,
    density: 'comfortable',
    themeId: 'nexus',
    themes: builtinThemes,
    boot: defaultBootConfig,
  },
  workbench: {
    dispatchHoldMs: 4200,
    closeToTray: true,
  },
  engine: {
    engineDir: '',
    dataPath: '',
    workspacePath: '',
    filesRoot: '',
    skillsPath: '',
    toolsPath: '',
    readOnly: true,
  },
  terminal: {
    shell: 'auto',
  },
};

function normalizeTheme(input: Partial<ThemeDefinition>, index: number): ThemeDefinition {
  const tone: ThemeTone = input.tone === 'light' ? 'light' : 'dark';
  return {
    id: input.id || `custom-${index}`,
    name: input.name?.trim() || `自定义主题 ${index + 1}`,
    tone,
    accent: /^#[0-9a-f]{6}$/i.test(input.accent ?? '') ? input.accent! : '#38e1e6',
    background: /^#[0-9a-f]{6}$/i.test(input.background ?? '') ? input.background! : '#050810',
    glow: Math.max(0, Math.min(100, Number(input.glow ?? 55))),
    builtin: false,
  };
}

export function mergeSettings(input: SettingsInput | null | undefined): WorkbenchSettings {
  const appearance = input?.appearance ?? {};
  const storedThemes = Array.isArray(appearance.themes) ? appearance.themes : [];
  const custom = storedThemes
    .filter((theme) => theme && !theme.builtin && !builtinThemes.some((item) => item.id === theme.id))
    .map((theme, index) => normalizeTheme(theme, index));
  const themes = [...builtinThemes, ...custom];
  const themeId = themes.some((theme) => theme.id === appearance.themeId)
    ? appearance.themeId!
    : defaultSettings.appearance.themeId;
  return {
    appearance: {
      motion: appearance.motion ?? defaultSettings.appearance.motion,
      density: appearance.density === 'compact' ? 'compact' : 'comfortable',
      themeId,
      themes,
      boot: normalizeBootConfig(appearance.boot),
    },
    workbench: { ...defaultSettings.workbench, ...(input?.workbench ?? {}) },
    engine: { ...defaultSettings.engine, ...(input?.engine ?? {}) },
    terminal: {
      shell:
        typeof input?.terminal?.shell === 'string' && input.terminal.shell.trim()
          ? input.terminal.shell.trim()
          : defaultSettings.terminal.shell,
    },
  };
}

export function resolveTheme(settings: WorkbenchSettings): ThemeDefinition {
  return (
    settings.appearance.themes.find((theme) => theme.id === settings.appearance.themeId) ??
    builtinThemes.find((theme) => theme.id === 'nexus') ??
    builtinThemes[0]
  );
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) return [56, 225, 230];
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function mixHex(a: string, b: string, weight: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const ratio = Math.max(0, Math.min(1, weight));
  return `#${[ar + (br - ar) * ratio, ag + (bg - ag) * ratio, ab + (bb - ab) * ratio]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** 把主题翻译成 CSS 变量，挂到应用根节点上。 */
export function themeVariables(theme: ThemeDefinition): Record<string, string> {
  const light = theme.tone === 'light';
  const panelSolid = light ? mixHex(theme.background, '#ffffff', 0.62) : mixHex(theme.background, '#ffffff', 0.055);
  const bg1 = light ? mixHex(theme.background, '#ffffff', 0.34) : mixHex(theme.background, '#ffffff', 0.035);
  const surface = light ? mixHex(theme.background, '#ffffff', 0.46) : mixHex(theme.background, '#ffffff', 0.06);
  const surfaceDeep = light ? mixHex(theme.background, '#ffffff', 0.24) : mixHex(theme.background, '#000000', 0.2);
  const inset = light ? mixHex(theme.background, '#ffffff', 0.58) : mixHex(theme.background, '#000000', 0.46);
  const secondary = mixHex(theme.accent, light ? '#f0b34a' : '#4f7dff', 0.36);
  const stageTop = light ? mixHex(theme.background, '#ffffff', 0.56) : mixHex(theme.background, '#ffffff', 0.05);
  const stageBottom = light ? mixHex(theme.background, '#ffffff', 0.14) : mixHex(theme.background, '#000000', 0.2);
  return {
    '--accent': theme.accent,
    '--accent-rgb': hexToRgb(theme.accent).join(', '),
    '--accent-soft': rgba(theme.accent, light ? 0.1 : 0.12),
    '--bg-0': theme.background,
    '--bg-1': bg1,
    '--panel-solid': panelSolid,
    '--panel': rgba(panelSolid, light ? 0.86 : 0.8),
    '--panel-grad': light
      ? `linear-gradient(180deg, ${rgba(mixHex(theme.background, '#ffffff', 0.78), 0.84)}, ${rgba(mixHex(theme.background, '#ffffff', 0.6), 0.92)})`
      : `linear-gradient(180deg, ${rgba(surface, 0.82)}, ${rgba(surfaceDeep, 0.9)})`,
    '--card-grad': light
      ? `linear-gradient(180deg, ${rgba(mixHex(theme.background, '#ffffff', 0.8), 0.9)}, ${rgba(mixHex(theme.background, '#ffffff', 0.62), 0.94)})`
      : `linear-gradient(180deg, ${rgba(surface, 0.72)}, ${rgba(surfaceDeep, 0.88)})`,
    '--titlebar-grad': light
      ? `linear-gradient(180deg, ${rgba(mixHex(theme.background, '#ffffff', 0.84), 0.72)}, ${rgba(mixHex(theme.background, '#ffffff', 0.7), 0.44)})`
      : `linear-gradient(180deg, ${rgba(surface, 0.92)}, ${rgba(surfaceDeep, 0.6)})`,
    '--overlay-solid': light
      ? rgba(mixHex(theme.background, '#ffffff', 0.76), 0.965)
      : rgba(mixHex(theme.background, '#ffffff', 0.045), 0.985),
    '--field-bg': rgba(inset, light ? 0.62 : 0.5),
    '--field-bg-soft': rgba(inset, light ? 0.46 : 0.38),
    '--surface-rgb': hexToRgb(surface).join(', '),
    '--inset-rgb': hexToRgb(inset).join(', '),
    '--stage-top': rgba(stageTop, light ? 0.76 : 0.92),
    '--stage-bottom': rgba(stageBottom, light ? 0.7 : 0.94),
    '--stage-glow': rgba(theme.accent, light ? 0.07 : 0.13),
    '--stage-glow-2': rgba(secondary, light ? 0.04 : 0.07),
    '--grid-line': light ? 'rgba(55, 95, 135, 0.038)' : rgba(theme.accent, 0.05),
    '--sheet-rgb': hexToRgb(mixHex(theme.background, light ? '#ffffff' : '#000000', light ? 0.2 : 0.3)).join(', '),
    '--text': light ? '#20303f' : '#e9f1fb',
    '--text-2': light ? '#4d6072' : '#a7b6cb',
    '--muted': light ? '#7e8fa2' : '#66768d',
    '--line': light ? 'rgba(55, 92, 128, 0.11)' : 'rgba(123, 164, 214, 0.14)',
    '--line-strong': light ? rgba(theme.accent, 0.3) : 'rgba(123, 190, 240, 0.28)',
    '--theme-glow': String(Math.max(0, Math.min(100, theme.glow)) / 100),
    colorScheme: light ? 'light' : 'dark',
  };
}

export function themeBackground(theme: ThemeDefinition): string {
  const glow = Math.max(0, Math.min(100, theme.glow)) / 100;
  const light = theme.tone === 'light';
  const bg1 = light ? mixHex(theme.background, '#ffffff', 0.34) : mixHex(theme.background, '#ffffff', 0.035);
  const secondary = mixHex(theme.accent, light ? '#f0b34a' : '#4f7dff', 0.36);
  if (light) {
    return [
      `radial-gradient(1100px 720px at 12% -10%, ${rgba(theme.accent, 0.1 * glow + 0.03)}, transparent 64%)`,
      `radial-gradient(880px 600px at 92% -4%, ${rgba(secondary, 0.07 * glow)}, transparent 60%)`,
      `linear-gradient(180deg, ${bg1}, ${theme.background} 75%)`,
    ].join(', ');
  }
  return [
    `radial-gradient(1200px 780px at 16% -12%, ${rgba(theme.accent, 0.34 * glow)}, transparent 60%)`,
    `radial-gradient(900px 620px at 88% -6%, ${rgba(secondary, 0.24 * glow)}, transparent 56%)`,
    `linear-gradient(180deg, ${bg1}, ${theme.background} 70%)`,
  ].join(', ');
}
