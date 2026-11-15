import { defaultBootConfig, normalizeBootConfig, type BootConfig } from './bootConfig';

export type Density = 'comfortable' | 'compact';
export type ThemeTone = 'dark' | 'light';
/** 文字色：跟随背景明暗自动判断，或手动固定成白 / 黑。 */
export type ThemeTextTone = 'auto' | 'white' | 'black';

/**
 * 视觉风格和配色是两个维度：配色决定主色与底色，风格决定几何、纹理和字体。
 * standard 标准，paper 纸稿档案，brutal 粗野印刷，terminal 终端，soft 柔光，glass 玻璃。
 */
export type ThemeStyle = 'standard' | 'paper' | 'brutal' | 'terminal' | 'soft' | 'glass';

/** 微调：每项都可以跟随风格，或者单独覆盖风格自带的默认值。 */
export type ThemeRadius = 'auto' | 'default' | 'sharp' | 'round';
export type ThemeTexture = 'auto' | 'none' | 'grid' | 'dots' | 'scan' | 'stars';
export type ThemeFont = 'auto' | 'sans' | 'mono' | 'serif';
export type ThemeShadow = 'auto' | 'flat' | 'hard' | 'soft';
export type ThemeTitlebar = 'auto' | 'ink' | 'panel';

export interface ThemeTweaks {
  radius: ThemeRadius;
  texture: ThemeTexture;
  font: ThemeFont;
  shadow: ThemeShadow;
  titlebar: ThemeTitlebar;
}

export const defaultThemeTweaks: ThemeTweaks = {
  radius: 'auto',
  texture: 'auto',
  font: 'auto',
  shadow: 'auto',
  titlebar: 'auto',
};

/** 解析后的取值：不再有“跟随风格”，可直接落到 data 属性上。 */
export interface ThemeLook {
  radius: 'default' | 'sharp' | 'round';
  texture: 'faint' | 'none' | 'grid' | 'dots' | 'scan' | 'stars';
  font: 'sans' | 'mono' | 'serif';
  shadow: 'style' | 'flat' | 'hard' | 'soft';
  titlebar: 'style' | 'ink' | 'panel';
}

/** 每个风格自带的几何与质感；“跟随风格”时用这一份。 */
const styleBaselines: Record<ThemeStyle, ThemeLook> = {
  standard: { radius: 'default', texture: 'faint', font: 'sans', shadow: 'style', titlebar: 'style' },
  paper: { radius: 'sharp', texture: 'grid', font: 'mono', shadow: 'hard', titlebar: 'ink' },
  brutal: { radius: 'sharp', texture: 'dots', font: 'sans', shadow: 'hard', titlebar: 'panel' },
  terminal: { radius: 'sharp', texture: 'scan', font: 'mono', shadow: 'flat', titlebar: 'ink' },
  soft: { radius: 'round', texture: 'faint', font: 'sans', shadow: 'soft', titlebar: 'panel' },
  glass: { radius: 'round', texture: 'none', font: 'sans', shadow: 'soft', titlebar: 'panel' },
};

export function resolveThemeLook(theme: ThemeDefinition): ThemeLook {
  const base = styleBaselines[theme.style] ?? styleBaselines.standard;
  const tw = theme.tweaks ?? defaultThemeTweaks;
  return {
    radius: tw.radius === 'auto' ? base.radius : tw.radius,
    texture: tw.texture === 'auto' ? base.texture : tw.texture,
    font: tw.font === 'auto' ? base.font : tw.font,
    shadow: tw.shadow === 'auto' ? base.shadow : tw.shadow,
    titlebar: tw.titlebar === 'auto' ? base.titlebar : tw.titlebar,
  };
}

/** 页面背景：纯色，或双色 / 三色渐变。 */
export type ThemeBackgroundMode = 'solid' | 'duo' | 'trio';

export type ThemeMediaKind = 'image' | 'video';

/** 自定义背景素材：用户自己选的贴纸图或循环视频，只保存在本机存档里。 */
export interface ThemeMedia {
  kind: ThemeMediaKind;
  path: string;
  /** 主题色遮罩浓度 0–100，越高画面越沉、字越清楚。 */
  dim: number;
  /** 背景虚化像素 0–40。 */
  blur: number;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  tone: ThemeTone;
  accent: string;
  background: string;
  /** 背景光晕强度 0–100；纸稿风格会把它压到很低。 */
  glow: number;
  style: ThemeStyle;
  /** 风格之上的细调；缺省时全部跟随风格。 */
  tweaks: ThemeTweaks;
  /** 文字色：缺省按背景亮度自动判断，也可以固定白字或黑字。 */
  textTone?: ThemeTextTone;
  /** 背景渐变：缺省为单色。 */
  backgroundMode?: ThemeBackgroundMode;
  background2?: string;
  background3?: string;
  /** 自定义贴纸 / 视频背景；缺省时只用渐变与光晕。 */
  media?: ThemeMedia | null;
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
    style: 'standard',
    tweaks: defaultThemeTweaks,
    builtin: true,
  },
  {
    id: 'nexus',
    name: '深空青',
    tone: 'dark',
    accent: '#38e1e6',
    background: '#050810',
    glow: 64,
    style: 'standard',
    tweaks: defaultThemeTweaks,
    builtin: true,
  },
  {
    id: 'moon',
    name: '月夜蓝',
    tone: 'dark',
    accent: '#8fb7ff',
    background: '#070b17',
    glow: 46,
    style: 'standard',
    tweaks: defaultThemeTweaks,
    builtin: true,
  },
  {
    id: 'day',
    name: '晨雾白',
    tone: 'light',
    accent: '#0a8f9c',
    background: '#eef3f9',
    glow: 28,
    style: 'standard',
    tweaks: defaultThemeTweaks,
    builtin: true,
  },
  {
    id: 'forest',
    name: '森屿绿',
    tone: 'dark',
    accent: '#49d9a0',
    background: '#040f0b',
    glow: 52,
    style: 'standard',
    tweaks: defaultThemeTweaks,
    builtin: true,
  },
  {
    id: 'sakura',
    name: '樱粉',
    tone: 'light',
    accent: '#d5538f',
    background: '#fbf0f5',
    glow: 34,
    style: 'standard',
    tweaks: defaultThemeTweaks,
    builtin: true,
  },
  {
    id: 'violet',
    name: '星紫',
    tone: 'dark',
    accent: '#b18cff',
    background: '#08050f',
    glow: 58,
    style: 'standard',
    tweaks: defaultThemeTweaks,
    builtin: true,
  },
  {
    id: 'paper',
    name: '纸稿',
    tone: 'light',
    accent: '#2f4a5f',
    background: '#eee5d0',
    glow: 14,
    style: 'paper',
    tweaks: defaultThemeTweaks,
    builtin: true,
  },
  {
    id: 'frost',
    name: '琉璃',
    tone: 'dark',
    accent: '#7fe6ff',
    background: '#081120',
    backgroundMode: 'trio',
    background2: '#14365c',
    background3: '#3b2260',
    glow: 72,
    style: 'glass',
    tweaks: defaultThemeTweaks,
    builtin: true,
  },
  {
    id: 'galaxy',
    name: '星河',
    tone: 'dark',
    accent: '#b98cff',
    background: '#05030d',
    backgroundMode: 'trio',
    background2: '#2b1458',
    background3: '#071b3d',
    glow: 48,
    style: 'standard',
    tweaks: { ...defaultThemeTweaks, texture: 'stars' },
    builtin: true,
  },
];

/** 网页模块的固定站点；存在全局设置里，所有场景共用一份。 */
export interface WebSite {
  id: string;
  label: string;
  url: string;
}

export const defaultWebSites: WebSite[] = [
  { id: 'site-bilibili', label: '哔哩哔哩', url: 'https://www.bilibili.com' },
  { id: 'site-github', label: 'GitHub', url: 'https://github.com' },
  { id: 'site-google', label: 'Google', url: 'https://www.google.com' },
  { id: 'site-juejin', label: '掘金', url: 'https://juejin.cn' },
];

/** 收纳内置地址的版本号：升版本时只补新增项，不把用户删掉的地址加回来。 */
export const BROWSER_SEED_REV = 2;

/** 第 2 版新增的地址，仅用于给老存档补齐。 */
export const browserSeedRev2Sites: WebSite[] = [
  { id: 'ai-xinghuo', label: '讯飞星火', url: 'https://xinghuo.xfyun.cn' },
  { id: 'ai-tiangong', label: '天工AI', url: 'https://www.tiangong.cn' },
  { id: 'ai-hailuo', label: '海螺AI', url: 'https://hailuoai.com' },
  { id: 'ai-poe', label: 'Poe', url: 'https://poe.com' },
  { id: 'ai-mistral', label: 'Mistral', url: 'https://chat.mistral.ai' },
  { id: 'ai-aistudio', label: 'AI Studio', url: 'https://aistudio.google.com' },
  { id: 'ai-gemini-nano', label: 'NotebookLM', url: 'https://notebooklm.google.com' },
];

/** 顶栏浏览器收纳的内置地址：常用站点 + 主流网页 AI，独立于网页模块。 */
export const defaultAiSites: WebSite[] = [
  { id: 'ai-chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com' },
  { id: 'ai-claude', label: 'Claude', url: 'https://claude.ai' },
  { id: 'ai-gemini', label: 'Gemini', url: 'https://gemini.google.com' },
  { id: 'ai-deepseek', label: 'DeepSeek', url: 'https://chat.deepseek.com' },
  { id: 'ai-doubao', label: '豆包', url: 'https://www.doubao.com' },
  { id: 'ai-kimi', label: 'Kimi', url: 'https://kimi.moonshot.cn' },
  { id: 'ai-qwen', label: '通义千问', url: 'https://tongyi.aliyun.com' },
  { id: 'ai-yuanbao', label: '腾讯元宝', url: 'https://yuanbao.tencent.com' },
  { id: 'ai-yiyan', label: '文心一言', url: 'https://yiyan.baidu.com' },
  { id: 'ai-chatglm', label: '智谱清言', url: 'https://chatglm.cn' },
  { id: 'ai-perplexity', label: 'Perplexity', url: 'https://www.perplexity.ai' },
  { id: 'ai-grok', label: 'Grok', url: 'https://grok.com' },
  { id: 'ai-copilot', label: 'Copilot', url: 'https://copilot.microsoft.com' },
  { id: 'ai-metaso', label: '秘塔搜索', url: 'https://metaso.cn' },
  ...browserSeedRev2Sites,
];

export const defaultBrowserSites: WebSite[] = [
  ...defaultWebSites,
  ...defaultAiSites,
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
  web: {
    /** 全网共用一份固定站点，避免每个场景各加一遍。 */
    sites: WebSite[];
    /** 旧存档把站点存在各个会话里，首次读取时并入全局列表。 */
    migrated: boolean;
  };
  /** 顶栏浏览器收纳：独立的一份地址清单，与网页模块互不影响。 */
  browser: {
    sites: WebSite[];
    /** 内置网页 AI 只播一次种，避免用户删掉后又被加回来。 */
    seeded: boolean;
    /** 上次播种到的内置版本；升版本时只补新增项。 */
    seedRev: number;
    /** 置顶的地址 id，清单里排在前面；地址删除后自动清理。 */
    pinned: string[];
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
  web?: Partial<WorkbenchSettings['web']>;
  browser?: Partial<WorkbenchSettings['browser']>;
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
  web: {
    sites: defaultWebSites,
    migrated: false,
  },
  browser: {
    sites: defaultBrowserSites.map((site) => ({ ...site })),
    seeded: true,
    seedRev: BROWSER_SEED_REV,
    pinned: [],
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

const themeStyles: ThemeStyle[] = ['standard', 'paper', 'brutal', 'terminal', 'soft', 'glass'];

function pickOption<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** 微调值只接受已知选项，坏档一律退回“跟随风格”。 */
function normalizeTweaks(input?: Partial<ThemeTweaks> | null): ThemeTweaks {
  return {
    radius: pickOption(input?.radius, ['auto', 'default', 'sharp', 'round'], 'auto'),
    texture: pickOption(input?.texture, ['auto', 'none', 'grid', 'dots', 'scan', 'stars'], 'auto'),
    font: pickOption(input?.font, ['auto', 'sans', 'mono', 'serif'], 'auto'),
    shadow: pickOption(input?.shadow, ['auto', 'flat', 'hard', 'soft'], 'auto'),
    titlebar: pickOption(input?.titlebar, ['auto', 'ink', 'panel'], 'auto'),
  };
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;

/** 按扩展名判断素材类型：图片和视频共用一套选择入口，但渲染方式不同。 */
export function themeMediaKindFor(fileName: string): ThemeMediaKind | null {
  if (IMAGE_EXT.test(fileName)) return 'image';
  if (VIDEO_EXT.test(fileName)) return 'video';
  return null;
}

function normalizeHex(input: unknown, fallback: string): string {
  return typeof input === 'string' && HEX_COLOR.test(input) ? input : fallback;
}

/** 素材只接受本机绝对路径与已知扩展名；坏档直接丢掉，不留半截路径。 */
function normalizeMedia(input: unknown): ThemeMedia | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<ThemeMedia>;
  const target = typeof raw.path === 'string' ? raw.path.trim() : '';
  const kind = target ? themeMediaKindFor(target) : null;
  if (!target || !kind) return null;
  if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(target)) return null;
  return {
    kind,
    path: target,
    dim: Math.max(0, Math.min(100, Number(raw.dim ?? 52))),
    blur: Math.max(0, Math.min(40, Number(raw.blur ?? 0))),
  };
}

function normalizeTheme(input: Partial<ThemeDefinition>, index: number): ThemeDefinition {
  const style = pickOption(input.style, themeStyles, 'standard');
  const tone: ThemeTone = style === 'paper' || input.tone === 'light' ? 'light' : 'dark';
  const background = normalizeHex(input.background, '#050810');
  const accent = normalizeHex(input.accent, '#38e1e6');
  return {
    id: input.id || `custom-${index}`,
    name: input.name?.trim() || `自定义主题 ${index + 1}`,
    tone,
    accent,
    background,
    backgroundMode: pickOption<ThemeBackgroundMode>(
      input.backgroundMode,
      ['solid', 'duo', 'trio'],
      'solid',
    ),
    background2: normalizeHex(input.background2, mixHex(background, accent, 0.58)),
    background3: normalizeHex(input.background3, mixHex(background, '#4f7dff', 0.42)),
    media: normalizeMedia(input.media),
    glow: Math.max(0, Math.min(100, Number(input.glow ?? 55))),
    style,
    tweaks: normalizeTweaks(input.tweaks),
    textTone: pickOption<ThemeTextTone>(input.textTone, ['auto', 'white', 'black'], 'auto'),
    builtin: false,
  };
}

function normalizeSites(input: unknown): WebSite[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const sites: WebSite[] = [];
  input.forEach((item, index) => {
    const site = item as Partial<WebSite> | null;
    if (!site || typeof site.url !== 'string' || !/^https?:\/\//i.test(site.url)) return;
    const key = site.url.trim().replace(/\/+$/, '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    sites.push({
      id: typeof site.id === 'string' && site.id ? site.id : `site-${index}`,
      label: typeof site.label === 'string' && site.label.trim() ? site.label.trim() : key,
      url: site.url.trim(),
    });
  });
  return sites;
}

function siteKey(url: string) {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/** 按地址去重追加：只补 base 里没有的项，保持已有顺序不变。 */
function appendSites(base: WebSite[], extra: WebSite[]): WebSite[] {
  const seen = new Set(base.map((site) => siteKey(site.url)));
  const added: WebSite[] = [];
  extra.forEach((site) => {
    const key = siteKey(site.url);
    if (seen.has(key)) return;
    seen.add(key);
    added.push({ ...site });
  });
  return added.length ? [...base, ...added] : base;
}

/** 置顶只存 id，过滤空值并去重；站点删除后的清理在更新入口完成。 */
function normalizePins(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input.filter((id): id is string => {
    if (typeof id !== 'string' || !id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * 浏览器收纳的内置地址：新装直接给全量；老存档只在未播种时补齐缺失项，
 * 之后用户删掉哪个就保持删除，不再回填。内置清单升版时只补该版新增项。
 */
function mergeBrowserSettings(
  input?: Partial<WorkbenchSettings['browser']>,
): WorkbenchSettings['browser'] {
  const stored = normalizeSites(input?.sites);
  let sites: WebSite[];
  let seedRev = BROWSER_SEED_REV;

  if (!stored) {
    sites = defaultBrowserSites.map((site) => ({ ...site }));
  } else if (input?.seeded !== true) {
    sites = appendSites(stored, defaultBrowserSites);
  } else {
    const rev = typeof input.seedRev === 'number' ? input.seedRev : 1;
    if (rev >= BROWSER_SEED_REV) {
      sites = stored;
      seedRev = rev;
    } else {
      sites = appendSites(stored, browserSeedRev2Sites);
    }
  }

  // 置顶只保留仍存在的地址，避免删除站点后留下无效 id。
  const alive = new Set(sites.map((site) => site.id));
  return {
    sites,
    seeded: true,
    seedRev,
    pinned: normalizePins(input?.pinned).filter((id) => alive.has(id)),
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
  const storedSites = normalizeSites(input?.web?.sites);
  return {
    appearance: {
      motion: appearance.motion ?? defaultSettings.appearance.motion,
      density: appearance.density === 'compact' ? 'compact' : 'comfortable',
      themeId,
      themes,
      boot: normalizeBootConfig(appearance.boot),
    },
    workbench: { ...defaultSettings.workbench, ...(input?.workbench ?? {}) },
    web: {
      sites: storedSites ?? defaultWebSites,
      migrated: input?.web?.migrated === true,
    },
    browser: mergeBrowserSettings(input?.browser),
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

/** 主色上的文字：亮的主色配深字，暗的主色配浅字。 */
function accentTextColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0b141c' : '#f7fbff';
}

function hexLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * 背景综合亮度：把渐变的几个色停、素材遮罩和玻璃面板一起折算成一档 0–1。
 * 文字要落在面板上，所以玻璃的半透明白也要算进去。
 */
function themeBackgroundLuminance(theme: ThemeDefinition): number {
  const mode = theme.backgroundMode ?? 'solid';
  const second = theme.background2 ?? mixHex(theme.background, theme.accent, 0.55);
  const third = theme.background3 ?? mixHex(theme.background, '#4f7dff', 0.4);
  const stops = mode === 'solid' ? [theme.background] : mode === 'duo' ? [theme.background, second] : [theme.background, second, third];
  let value = stops.reduce((sum, hex) => sum + hexLuminance(hex), 0) / stops.length;
  if (theme.media) {
    const dim = Math.max(0, Math.min(100, theme.media.dim ?? 52)) / 100;
    const cover = 0.24 + dim * 0.62;
    value = value * (1 - cover) + hexLuminance(theme.background) * cover;
  }
  if (theme.style === 'glass') {
    const white = theme.tone === 'light' ? 0.52 : 0.16;
    value = value * (1 - white) + white;
  }
  return value;
}

/** 解析文字色：纸稿固定黑字，手动指定优先，否则按背景亮度自动选白字或黑字。 */
export function themeTextInk(theme: ThemeDefinition): 'white' | 'black' {
  if (theme.style === 'paper') return 'black';
  if (theme.textTone === 'white' || theme.textTone === 'black') return theme.textTone;
  return themeBackgroundLuminance(theme) > 0.56 ? 'black' : 'white';
}

/** 把主题翻译成 CSS 变量，挂到应用根节点上。 */
export function themeVariables(theme: ThemeDefinition): Record<string, string> {
  const paper = theme.style === 'paper';
  const light = paper || theme.tone === 'light';
  const look = resolveThemeLook(theme);
  const panelSolid = light ? mixHex(theme.background, '#ffffff', 0.62) : mixHex(theme.background, '#ffffff', 0.055);
  const bg1 = light ? mixHex(theme.background, '#ffffff', 0.34) : mixHex(theme.background, '#ffffff', 0.035);
  const surface = light ? mixHex(theme.background, '#ffffff', 0.46) : mixHex(theme.background, '#ffffff', 0.06);
  const surfaceDeep = light ? mixHex(theme.background, '#ffffff', 0.24) : mixHex(theme.background, '#000000', 0.2);
  const inset = light ? mixHex(theme.background, '#ffffff', 0.58) : mixHex(theme.background, '#000000', 0.46);
  const secondary = mixHex(theme.accent, light ? '#f0b34a' : '#4f7dff', 0.36);
  const stageTop = light ? mixHex(theme.background, '#ffffff', 0.56) : mixHex(theme.background, '#ffffff', 0.05);
  const stageBottom = light ? mixHex(theme.background, '#ffffff', 0.14) : mixHex(theme.background, '#000000', 0.2);

  // 微调用到的派生色：粗边框、纹理、投影、标题条和主色上的文字色。
  // 文字色先看主题的显式选择，再看背景亮度；纸稿在下面的分支里固定成纸面墨色。
  const ink = themeTextInk(theme);
  const textMain = ink === 'black' ? '#101820' : '#f4f8fd';
  const textSecond = ink === 'black' ? '#3b4854' : '#c6d4e4';
  const textMuted = ink === 'black' ? '#64717d' : '#93a5b8';
  const lineMain = light ? 'rgba(55, 92, 128, 0.11)' : 'rgba(123, 164, 214, 0.14)';
  const lineStrong = light ? rgba(theme.accent, 0.3) : 'rgba(123, 190, 240, 0.28)';
  const uiInk = light ? mixHex(theme.background, '#1b2732', 0.84) : mixHex(theme.background, '#f2f6fc', 0.78);
  const uiLine = rgba(theme.accent, light ? 0.12 : 0.09);
  const uiShadowInk = light ? 'rgba(28, 40, 51, 0.2)' : 'rgba(0, 0, 0, 0.6)';
  const softShadow = light ? '0 24px 54px rgba(46, 74, 99, 0.14)' : '0 24px 60px rgba(0, 0, 0, 0.4)';
  const barInk =
    theme.style === 'paper'
      ? '#2c3d4f'
      : theme.style === 'terminal'
        ? light
          ? '#14201f'
          : '#060b0b'
        : light
          ? mixHex(theme.background, '#131d26', 0.86)
          : mixHex(theme.background, '#000000', 0.62);
  const barInkGrad = `linear-gradient(180deg, ${barInk}, ${mixHex(barInk, '#000000', 0.28)})`;
  const accentInk = accentTextColor(theme.accent);
  const fontStack =
    look.font === 'mono'
      ? '"Cascadia Code", "JetBrains Mono", Consolas, monospace'
      : look.font === 'serif'
        ? '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", Georgia, serif'
        : '"Microsoft YaHei UI", "PingFang SC", "Segoe UI", system-ui, sans-serif';
  const variables: Record<string, string> = {
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
    '--text': textMain,
    '--text-2': textSecond,
    '--muted': textMuted,
    '--line': lineMain,
    '--line-strong': lineStrong,
    '--theme-glow': String(Math.max(0, Math.min(100, theme.glow)) / 100),
    '--font-sans': fontStack,
    '--ui-ink': uiInk,
    '--ui-line': uiLine,
    '--ui-shadow-ink': uiShadowInk,
    '--soft-shadow': softShadow,
    '--accent-ink': accentInk,
    '--bar-ink': barInk,
    '--bar-ink-grad': barInkGrad,
    '--bar-text': '#f6eedb',
    '--bar-text-2': '#d8ccb3',
    '--bar-muted': '#a79b82',
    '--bar-line': 'rgba(246, 238, 219, 0.22)',
    '--bar-line-strong': 'rgba(246, 238, 219, 0.42)',
    '--tb-text': textMain,
    '--tb-text-2': textSecond,
    '--tb-muted': textMuted,
    '--tb-line': lineMain,
    '--tb-line-strong': lineStrong,
    colorScheme: light ? 'light' : 'dark',
  };

  if (paper) {
    // 纸稿不靠推导色：面板是纸，边线是墨，标题条是墨色板。固定下来才不会被底色带偏。
    Object.assign(variables, {
      '--bg-1': mixHex(theme.background, '#ffffff', 0.18),
      '--panel-solid': '#f8f2e3',
      '--panel': 'rgba(250, 245, 233, 0.92)',
      '--panel-grad': 'linear-gradient(180deg, rgba(251, 246, 235, 0.96), rgba(241, 233, 215, 0.94))',
      '--card-grad': 'linear-gradient(180deg, rgba(252, 247, 237, 0.98), rgba(243, 235, 219, 0.96))',
      '--titlebar-grad': 'linear-gradient(180deg, #2c3d4f, #23323f)',
      '--overlay-solid': 'rgba(247, 241, 228, 0.985)',
      '--field-bg': 'rgba(226, 215, 191, 0.52)',
      '--field-bg-soft': 'rgba(226, 215, 191, 0.34)',
      '--surface-rgb': '247, 241, 227',
      '--inset-rgb': '226, 215, 191',
      '--stage-top': 'rgba(245, 237, 221, 0.9)',
      '--stage-bottom': 'rgba(233, 222, 200, 0.94)',
      '--stage-glow': 'rgba(47, 74, 95, 0.045)',
      '--stage-glow-2': 'rgba(214, 160, 52, 0.06)',
      '--grid-line': 'rgba(47, 74, 95, 0.11)',
      '--sheet-rgb': '236, 225, 203',
      '--text': '#24313b',
      '--text-2': '#4b5a64',
      '--muted': '#83796a',
      '--line': 'rgba(47, 74, 95, 0.22)',
      '--line-strong': 'rgba(47, 74, 95, 0.42)',
      '--shadow': '3px 4px 0 rgba(36, 49, 59, 0.16)',
      '--paper-ink': theme.accent,
      '--paper-ink-rgb': hexToRgb(theme.accent).join(', '),
      '--theme-glow': '0.08',
    });
  }
  if (theme.style === 'glass') {
    // 玻璃的“透”在变量层完成：面板换成低不透明度白，边框、高光和模糊交给 CSS。
    Object.assign(variables, {
      '--panel': rgba(surface, light ? 0.52 : 0.4),
      '--panel-grad': light
        ? 'linear-gradient(158deg, rgba(255, 255, 255, 0.74), rgba(255, 255, 255, 0.4) 52%, rgba(255, 255, 255, 0.24))'
        : 'linear-gradient(158deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 48%, rgba(255, 255, 255, 0.02))',
      '--card-grad': light
        ? 'linear-gradient(158deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.36))'
        : 'linear-gradient(158deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.04))',
      '--titlebar-grad': light
        ? 'linear-gradient(180deg, rgba(255, 255, 255, 0.66), rgba(255, 255, 255, 0.26))'
        : 'linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.02))',
      '--overlay-solid': rgba(
        mixHex(theme.background, light ? '#ffffff' : '#000000', light ? 0.7 : 0.12),
        light ? 0.92 : 0.88,
      ),
      '--field-bg': light ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.07)',
      '--field-bg-soft': light ? 'rgba(255, 255, 255, 0.38)' : 'rgba(255, 255, 255, 0.05)',
    });
  }
  return variables;
}

/** 背景渐变层：solid 返回空串，交给各风格自己的底色渐变。 */
function themeGradient(theme: ThemeDefinition): string {
  const mode = theme.backgroundMode ?? 'solid';
  if (mode === 'solid') return '';
  const second = theme.background2 ?? mixHex(theme.background, theme.accent, 0.55);
  const third = theme.background3 ?? mixHex(theme.background, '#4f7dff', 0.4);
  return mode === 'duo'
    ? `linear-gradient(150deg, ${theme.background}, ${second})`
    : `linear-gradient(150deg, ${theme.background}, ${second} 52%, ${third})`;
}

/** 背景素材的地址：交给主进程的只读协议，不把本机路径直接暴露成 file://。 */
export function themeMediaUrl(target: string): string {
  return `workbench-media://media?p=${encodeURIComponent(target)}`;
}

/** 素材之上的一层主题色遮罩：保证视频再亮，文字和面板也压得住。 */
export function themeMediaScrim(theme: ThemeDefinition): string {
  const [r, g, b] = hexToRgb(theme.background);
  const dim = Math.max(0, Math.min(100, theme.media?.dim ?? 52)) / 100;
  const top = 0.24 + dim * 0.62;
  const bottom = Math.min(0.96, top + 0.12);
  const light = theme.tone === 'light';
  return [
    `radial-gradient(1100px 740px at 14% -12%, ${rgba(theme.accent, light ? 0.18 : 0.24)}, transparent 62%)`,
    `linear-gradient(180deg, rgba(${r}, ${g}, ${b}, ${top}), rgba(${r}, ${g}, ${b}, ${bottom}))`,
  ].join(', ');
}

export function themeBackground(theme: ThemeDefinition): string {
  const glow = Math.max(0, Math.min(100, theme.glow)) / 100;
  const light = theme.tone === 'light';
  const bg1 = light ? mixHex(theme.background, '#ffffff', 0.34) : mixHex(theme.background, '#ffffff', 0.035);
  const secondary = mixHex(theme.accent, light ? '#f0b34a' : '#4f7dff', 0.36);
  const texture = resolveThemeLook(theme).texture;
  const gradient = themeGradient(theme);
  if (theme.style === 'paper') {
    // 方格纸：细线每 26px 一道，再叠一层很淡的暖光，避免宣纸似的死平。
    const layers = [
      'radial-gradient(1200px 760px at 20% -12%, rgba(255, 252, 242, 0.9), transparent 62%)',
      gradient || `linear-gradient(180deg, ${mixHex(theme.background, '#ffffff', 0.2)}, ${theme.background} 74%)`,
    ];
    if (texture === 'grid') {
      layers.unshift(
        `repeating-linear-gradient(0deg, ${rgba(theme.accent, 0.075)} 0 1px, transparent 1px 26px)`,
        `repeating-linear-gradient(90deg, ${rgba(theme.accent, 0.075)} 0 1px, transparent 1px 26px)`,
      );
    }
    return layers.join(', ');
  }
  if (theme.style === 'brutal') {
    // 粗野：底色尽量平，靠边框和硬投影撑结构，只留一点主色热气。
    return [
      `radial-gradient(900px 560px at 10% -10%, ${rgba(theme.accent, 0.14 * glow)}, transparent 62%)`,
      gradient || `linear-gradient(180deg, ${bg1}, ${theme.background} 72%)`,
    ].join(', ');
  }
  if (theme.style === 'terminal') {
    // 终端：几乎纯色，顶部一点荧光，扫描线交给 .app::before。
    return [
      `radial-gradient(900px 520px at 50% -18%, ${rgba(theme.accent, 0.16 * glow)}, transparent 60%)`,
      gradient ||
        `linear-gradient(180deg, ${mixHex(theme.background, light ? '#ffffff' : '#000000', light ? 0.04 : 0.06)}, ${theme.background} 82%)`,
    ].join(', ');
  }
  if (theme.style === 'soft') {
    // 柔光：大半径漫射，像磨砂亚克力后面的灯。
    return [
      `radial-gradient(1200px 820px at 8% -14%, ${rgba(theme.accent, 0.12 + 0.22 * glow)}, transparent 64%)`,
      `radial-gradient(1000px 700px at 92% -2%, ${rgba(secondary, 0.1 + 0.16 * glow)}, transparent 60%)`,
      gradient || `linear-gradient(180deg, ${bg1}, ${theme.background} 76%)`,
    ].join(', ');
  }
  if (theme.style === 'glass') {
    // 玻璃：底色必须有层次，面板才有东西可以透。单色时用主色和辅色自行调一段渐变。
    const base =
      gradient ||
      `linear-gradient(150deg, ${theme.background}, ${mixHex(theme.background, theme.accent, 0.48)} 54%, ${mixHex(theme.background, secondary, 0.44)})`;
    return [
      `radial-gradient(1100px 760px at 12% -14%, ${rgba(theme.accent, (light ? 0.1 : 0.16) + 0.3 * glow)}, transparent 62%)`,
      `radial-gradient(920px 640px at 88% 6%, ${rgba(secondary, 0.06 + 0.22 * glow)}, transparent 58%)`,
      base,
    ].join(', ');
  }
  if (light) {
    return [
      `radial-gradient(1100px 720px at 12% -10%, ${rgba(theme.accent, 0.1 * glow + 0.03)}, transparent 64%)`,
      `radial-gradient(880px 600px at 92% -4%, ${rgba(secondary, 0.07 * glow)}, transparent 60%)`,
      gradient || `linear-gradient(180deg, ${bg1}, ${theme.background} 75%)`,
    ].join(', ');
  }
  return [
    `radial-gradient(1200px 780px at 16% -12%, ${rgba(theme.accent, 0.34 * glow)}, transparent 60%)`,
    `radial-gradient(900px 620px at 88% -6%, ${rgba(secondary, 0.24 * glow)}, transparent 56%)`,
    gradient || `linear-gradient(180deg, ${bg1}, ${theme.background} 70%)`,
  ].join(', ');
}
