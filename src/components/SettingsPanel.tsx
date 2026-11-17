import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  bootLines,
  DEFAULT_BOOT_LINES,
  type BootConfig,
  type BootSpeed,
  type BootStyle,
} from '../bootConfig';
import type {
  EngineSkillEntry,
  EngineSnapshot,
  HealthCheck,
  HealthReport,
  HealthStatus,
  ToolScriptEntry,
} from '../engine/types';
import { categoryOf, listModules, originOf } from '../modules';
import { localExtensionsEnabled } from '../modules/local';
import {
  builtinThemes,
  defaultThemeTweaks,
  mergeSettings,
  mixHex,
  resolveTheme,
  resolveThemeLook,
  rgba,
  themeBackground,
  themeTextInk,
  type Density,
  type ThemeBackgroundMode,
  type ThemeDefinition,
  type ThemeMedia,
  type ThemeStyle,
  type ThemeTextTone,
  type ThemeTweaks,
  type ThemeTone,
  type WorkbenchSettings,
} from '../settings';
import type { IconName } from '../types';
import type { TerminalShellOption } from '../terminal/types';
import { Icon } from './icons';
import { Markdown } from './Markdown';
import { ThemeBackdrop } from './ThemeBackdrop';
import { VoiceStudio } from './VoiceStudio';

interface SettingsPanelProps {
  settings: WorkbenchSettings;
  engine: EngineSnapshot | null;
  engineLoading: boolean;
  engineError: string | null;
  statePath: string;
  onChange: (next: WorkbenchSettings) => void;
  onRefreshEngine: () => void;
  onClose: () => void;
}

type TabId =
  | 'themes'
  | 'interface'
  | 'engine'
  | 'terminal'
  | 'voice'
  | 'health'
  | 'skills'
  | 'tools'
  | 'storage'
  | 'about';

const TABS: Array<{ id: TabId; label: string; eyebrow: string; icon: IconName }> = [
  { id: 'themes', label: '主题', eyebrow: 'THEME', icon: 'palette' },
  { id: 'interface', label: '界面', eyebrow: 'INTERFACE', icon: 'monitor' },
  { id: 'engine', label: '引擎', eyebrow: 'ENGINE', icon: 'database' },
  { id: 'terminal', label: '终端', eyebrow: 'TERMINAL', icon: 'terminal' },
  { id: 'voice', label: '语音', eyebrow: 'VOICE', icon: 'volume' },
  { id: 'health', label: '体检', eyebrow: 'HEALTH', icon: 'activity' },
  { id: 'skills', label: '技能', eyebrow: 'SKILLS', icon: 'book' },
  { id: 'tools', label: '工具', eyebrow: 'TOOLS', icon: 'wrench' },
  { id: 'storage', label: '存档', eyebrow: 'STORAGE', icon: 'save' },
  { id: 'about', label: '关于', eyebrow: 'ABOUT', icon: 'spark' },
];

const HEALTH_LABEL: Record<HealthStatus, string> = {
  ok: '正常',
  warn: '提醒',
  fail: '异常',
};

const SLOT_LABEL: Record<string, string> = {
  'center.view': '中心',
  'detail.block': '详情',
  'command.action': '指令',
  'rail.widget': '侧栏',
  'status.item': '状态',
};

/** 预览时去掉 SKILL.md 的 frontmatter，名称与描述已由技能卡片展示。 */
function stripSkillFrontmatter(text: string) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return match ? text.slice(match[0].length).trimStart() : text;
}

function formatSize(size: number) {
  if (!size) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDay(ms: number) {
  if (!ms) return '';
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`switch${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

interface ThemeDraft {
  id: string;
  name: string;
  tone: ThemeTone;
  accent: string;
  background: string;
  backgroundMode: ThemeBackgroundMode;
  background2: string;
  background3: string;
  media: ThemeMedia | null;
  glow: number;
  style: ThemeStyle;
  tweaks: ThemeTweaks;
  textTone: ThemeTextTone;
}

const styleNames: Record<ThemeStyle, string> = {
  standard: '标准',
  paper: '纸稿',
  brutal: '粗野',
  terminal: '终端',
  soft: '柔光',
  glass: '玻璃',
};
const styleOptions: Array<[ThemeStyle, string]> = [
  ['standard', '标准'],
  ['paper', '纸稿'],
  ['brutal', '粗野'],
  ['terminal', '终端'],
  ['soft', '柔光'],
  ['glass', '玻璃'],
];

const backgroundModes: Array<[ThemeBackgroundMode, string]> = [
  ['solid', '纯色'],
  ['duo', '双色'],
  ['trio', '三色'],
];

/** 从主题（或当前草稿）抄一份，渐变与素材缺省时给出可编辑的默认值。 */
function draftFromTheme(theme: ThemeDefinition, id: string, name: string): ThemeDraft {
  return {
    id,
    name,
    tone: theme.tone,
    accent: theme.accent,
    background: theme.background,
    backgroundMode: theme.backgroundMode ?? 'solid',
    background2: theme.background2 ?? mixHex(theme.background, theme.accent, 0.58),
    background3: theme.background3 ?? mixHex(theme.background, '#4f7dff', 0.42),
    media: theme.media ? { ...theme.media } : null,
    glow: theme.glow,
    style: theme.style,
    tweaks: { ...(theme.tweaks ?? defaultThemeTweaks) },
    textTone: theme.textTone ?? 'auto',
  };
}

function fileName(target: string) {
  return target.split(/[\\/]/).filter(Boolean).pop() ?? target;
}

const paperBackground = '#eee5d0';

/** 纸稿的皮肤是固定浅色纸面，深色底色会让整页读起来发脏，切换时顺手校正。 */
function isDarkColor(hex: string): boolean {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return false;
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

type TweakKey = keyof ThemeTweaks;

const tweakOptions: Array<{
  key: TweakKey;
  label: string;
  hint: string;
  options: Array<[string, string]>;
}> = [
  { key: 'radius', label: '圆角', hint: '面板与控件的圆角，标准为 16px', options: [['auto', '跟随'], ['default', '标准'], ['sharp', '直角'], ['round', '圆润']] },
  { key: 'texture', label: '纹理', hint: '背景网格、扫描线或星空', options: [['auto', '跟随'], ['none', '无'], ['grid', '方格'], ['dots', '点阵'], ['scan', '扫描'], ['stars', '星空']] },
  { key: 'font', label: '字体', hint: '界面正文字体', options: [['auto', '跟随'], ['sans', '无衬线'], ['mono', '等宽'], ['serif', '衬线']] },
  { key: 'shadow', label: '阴影', hint: '面板投影方式', options: [['auto', '跟随'], ['flat', '扁平'], ['hard', '硬边'], ['soft', '柔光']] },
  { key: 'titlebar', label: '标题栏', hint: '顶栏底色与文字', options: [['auto', '跟随'], ['ink', '墨色'], ['panel', '面板']] },
];

function parsePreviewLine(raw: string) {
  const value = raw.trim();
  const prefix = value[0] ?? '';
  const marked = '$✓!·›'.includes(prefix);
  const glyph = marked ? prefix : '·';
  const tone = glyph === '✓' ? 'ok' : glyph === '!' ? 'warn' : glyph === '$' ? 'cmd' : 'dim';
  return { glyph, tone, text: marked ? value.slice(1).trim() : value };
}

export function SettingsPanel({
  settings,
  engine,
  engineLoading,
  engineError,
  statePath,
  onChange,
  onRefreshEngine,
  onClose,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<TabId>('themes');
  const [engineDir, setEngineDir] = useState(settings.engine.engineDir);
  const [dataPath, setDataPath] = useState(settings.engine.dataPath);
  const [workspacePath, setWorkspacePath] = useState(settings.engine.workspacePath);
  const [filesRoot, setFilesRoot] = useState(settings.engine.filesRoot);
  const [skillsPath, setSkillsPath] = useState(settings.engine.skillsPath);
  const [toolsPath, setToolsPath] = useState(settings.engine.toolsPath);
  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  const [templateId, setTemplateId] = useState(settings.appearance.themeId);

  const [skillScan, setSkillScan] = useState<{
    loading: boolean;
    entries: EngineSkillEntry[];
    error: string;
  }>({ loading: false, entries: [], error: '' });
  const [skillSelected, setSkillSelected] = useState('');
  const [skillReload, setSkillReload] = useState(0);
  const [skillDoc, setSkillDoc] = useState({ text: '', loading: false, error: '' });

  const [toolScan, setToolScan] = useState<{
    loading: boolean;
    root: string;
    missing: boolean;
    entries: ToolScriptEntry[];
    error: string;
  }>({ loading: false, root: '', missing: false, entries: [], error: '' });
  const [toolReload, setToolReload] = useState(0);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    let alive = true;
    void window.desktop
      ?.version?.()
      .then((value) => {
        if (alive && typeof value === 'string') setAppVersion(value);
      })
      .catch(() => {
        /* 读不到版本时显示「开发版」 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const activeTheme = useMemo(() => resolveTheme(settings), [settings]);
  const templateTheme = useMemo(
    () => settings.appearance.themes.find((theme) => theme.id === templateId) ?? activeTheme,
    [settings.appearance.themes, templateId, activeTheme],
  );
  const draftLook = useMemo(
    () => (draft ? resolveThemeLook({ ...draft, builtin: false }) : null),
    [draft],
  );
  const moduleCatalog = useMemo(() => listModules(), []);

  useEffect(() => {
    setEngineDir(settings.engine.engineDir);
    setDataPath(settings.engine.dataPath);
    setWorkspacePath(settings.engine.workspacePath);
    setFilesRoot(settings.engine.filesRoot);
    setSkillsPath(settings.engine.skillsPath);
    setToolsPath(settings.engine.toolsPath);
  }, [
    settings.engine.engineDir,
    settings.engine.dataPath,
    settings.engine.workspacePath,
    settings.engine.filesRoot,
    settings.engine.skillsPath,
    settings.engine.toolsPath,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (draft) setDraft(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draft, onClose]);

  const patch = (next: Partial<WorkbenchSettings>) => {
    onChange({
      appearance: { ...settings.appearance, ...(next.appearance ?? {}) },
      workbench: { ...settings.workbench, ...(next.workbench ?? {}) },
      web: settings.web,
      browser: settings.browser,
      engine: { ...settings.engine, ...(next.engine ?? {}) },
      terminal: { ...settings.terminal, ...(next.terminal ?? {}) },
      voice: { ...settings.voice, ...(next.voice ?? {}) },
    });
  };

  const boot = settings.appearance.boot;
  const patchBoot = (next: Partial<BootConfig>) => {
    patch({
      appearance: {
        ...settings.appearance,
        boot: { ...settings.appearance.boot, ...next },
      },
    });
  };
  const previewLines = useMemo(() => bootLines(boot, '3083').slice(0, 3), [boot]);

  const pickEngine = async () => {
    const picked = await window.desktop?.pickEngineRoot(dataPath);
    if (!picked) return;
    setDataPath(picked);
    patch({ engine: { ...settings.engine, dataPath: picked } });
  };

  const pickWorkspace = async () => {
    const picked = await window.desktop?.pickWorkspaceRoot(workspacePath);
    if (!picked) return;
    setWorkspacePath(picked);
    patch({ engine: { ...settings.engine, workspacePath: picked } });
  };

  const pickEngineDir = async () => {
    const picked = await window.desktop?.pickDirectory('选择 DSH 引擎安装目录', engineDir);
    if (!picked) return;
    setEngineDir(picked);
    patch({ engine: { ...settings.engine, engineDir: picked } });
  };

  const pickFilesRoot = async () => {
    const picked = await window.desktop?.pickDirectory('选择文件浏览根目录', filesRoot);
    if (!picked) return;
    setFilesRoot(picked);
    patch({ engine: { ...settings.engine, filesRoot: picked } });
  };

  const pickSkills = async () => {
    const picked = await window.desktop?.pickDirectory('选择技能目录', skillsPath);
    if (!picked) return;
    setSkillsPath(picked);
    patch({ engine: { ...settings.engine, skillsPath: picked } });
  };

  const pickTools = async () => {
    const picked = await window.desktop?.pickDirectory('选择工具目录', toolsPath);
    if (!picked) return;
    setToolsPath(picked);
    patch({ engine: { ...settings.engine, toolsPath: picked } });
  };

  const commitPaths = () => {
    if (
      engineDir !== settings.engine.engineDir ||
      dataPath !== settings.engine.dataPath ||
      workspacePath !== settings.engine.workspacePath ||
      filesRoot !== settings.engine.filesRoot ||
      skillsPath !== settings.engine.skillsPath ||
      toolsPath !== settings.engine.toolsPath
    ) {
      patch({
        engine: {
          ...settings.engine,
          engineDir,
          dataPath,
          workspacePath,
          filesRoot,
          skillsPath,
          toolsPath,
        },
      });
    }
  };

  const useDefaultPaths = async () => {
    const defaults = await window.desktop?.defaultPaths();
    if (!defaults) return;
    const next = {
      ...settings.engine,
      engineDir: defaults.engineDir,
      dataPath: defaults.dataPath,
      workspacePath: defaults.workspacePath,
      filesRoot: defaults.filesRoot,
      skillsPath: defaults.skillsPath,
      toolsPath: defaults.toolsPath,
    };
    setEngineDir(next.engineDir);
    setDataPath(next.dataPath);
    setWorkspacePath(next.workspacePath);
    setFilesRoot(next.filesRoot);
    setSkillsPath(next.skillsPath);
    setToolsPath(next.toolsPath);
    patch({ engine: next });
  };

  const skillsRoot = settings.engine.skillsPath;

  useEffect(() => {
    if (tab !== 'skills') return;
    let alive = true;
    setSkillScan((prev) => ({ ...prev, loading: true, error: '' }));
    void (async () => {
      try {
        const result = await window.desktop?.scanSkills(skillsRoot);
        if (!alive) return;
        if (!result) {
          setSkillScan({ loading: false, entries: [], error: '浏览器预览环境无法读取技能目录' });
          return;
        }
        setSkillScan({
          loading: false,
          entries: result.ok ? result.entries : [],
          error: result.ok ? '' : result.error || '读取技能目录失败',
        });
      } catch (error) {
        if (!alive) return;
        setSkillScan({
          loading: false,
          entries: [],
          error: `读取技能目录失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [tab, skillsRoot, skillReload]);

  const toolsRoot = settings.engine.toolsPath;

  useEffect(() => {
    if (tab !== 'tools') return;
    let alive = true;
    setToolScan((prev) => ({ ...prev, loading: true, error: '' }));
    void (async () => {
      try {
        const result = await window.desktop?.scanTools(toolsRoot);
        if (!alive) return;
        if (!result) {
          setToolScan({
            loading: false,
            root: toolsRoot,
            missing: false,
            entries: [],
            error: '浏览器预览环境无法读取工具目录',
          });
          return;
        }
        setToolScan({
          loading: false,
          root: result.root,
          missing: result.missing,
          entries: result.ok ? result.entries : [],
          error: result.ok ? '' : result.error || '读取工具目录失败',
        });
      } catch (error) {
        if (!alive) return;
        setToolScan({
          loading: false,
          root: toolsRoot,
          missing: false,
          entries: [],
          error: `读取工具目录失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [tab, toolsRoot, toolReload]);

  useEffect(() => {
    if (tab !== 'skills' || skillScan.entries.length === 0) return;
    if (skillScan.entries.some((entry) => entry.id === skillSelected)) return;
    setSkillSelected(skillScan.entries[0].id);
  }, [tab, skillScan.entries, skillSelected]);

  useEffect(() => {
    if (tab !== 'skills' || !skillSelected) return;
    let alive = true;
    setSkillDoc({ text: '', loading: true, error: '' });
    void (async () => {
      try {
        // 按设置里的技能目录读取，预览和「技能」页签扫描保持一致。
        const result = await window.desktop?.readSkillDoc(skillsRoot, skillSelected);
        if (!alive) return;
        setSkillDoc({
          text: result?.ok ? result.text ?? '' : '',
          loading: false,
          error: result?.ok ? '' : result?.error || '无法读取 SKILL.md',
        });
      } catch (error) {
        if (!alive) return;
        setSkillDoc({
          text: '',
          loading: false,
          error: `无法读取 SKILL.md：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [tab, skillSelected, skillsRoot]);

  const skillScene = useMemo(() => {
    if (!engine?.ok || !skillSelected) return null;
    return engine.scenes.find((scene) => scene.skill === skillSelected) ?? null;
  }, [engine, skillSelected]);

  const [health, setHealth] = useState<{
    loading: boolean;
    report: HealthReport | null;
    error: string;
  }>({ loading: false, report: null, error: '' });
  const [healthTick, setHealthTick] = useState(0);

  useEffect(() => {
    if (tab !== 'health') return;
    if (!window.desktop?.healthCheck) {
      setHealth({ loading: false, report: null, error: '浏览器预览环境无法执行主进程体检' });
      return;
    }
    let alive = true;
    setHealth((previous) => ({ ...previous, loading: true, error: '' }));
    void (async () => {
      try {
        const report = await window.desktop!.healthCheck(settings.engine);
        if (!alive) return;
        if (!report) {
          setHealth({ loading: false, report: null, error: '体检没有返回结果' });
          return;
        }
        setHealth({ loading: false, report, error: '' });
      } catch (error) {
        if (!alive) return;
        setHealth({
          loading: false,
          report: null,
          error: `体检失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [
    tab,
    healthTick,
    settings.engine.engineDir,
    settings.engine.dataPath,
    settings.engine.workspacePath,
    settings.engine.filesRoot,
    settings.engine.skillsPath,
    settings.engine.toolsPath,
  ]);

  const [shells, setShells] = useState<TerminalShellOption[]>([]);
  const [shellsLoading, setShellsLoading] = useState(false);
  const [shellsError, setShellsError] = useState('');

  useEffect(() => {
    if (tab !== 'terminal') return;
    if (!window.desktop?.terminalShells) {
      setShells([]);
      setShellsError('浏览器预览环境无法探测本机 shell');
      return;
    }
    let alive = true;
    setShellsLoading(true);
    void (async () => {
      try {
        const list = await window.desktop!.terminalShells();
        if (!alive) return;
        setShells(Array.isArray(list) ? list : []);
        setShellsError('');
      } catch (error) {
        if (!alive) return;
        setShells([]);
        setShellsError(`探测本机 shell 失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (alive) setShellsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tab]);

  const chosenShell = shells.find((shell) => shell.id === settings.terminal.shell) ?? null;

  const localChecks = useMemo<HealthCheck[]>(() => {
    const modules = listModules();
    const required: Array<[string, string]> = [
      ['neuron.view', '神经元'],
      ['files.browser', '文件工作台'],
      ['web.search', '网页浏览'],
      ['terminal.console', '终端'],
      ['todo.list', '待办清单'],
      ['memory.search', '记忆检索'],
    ];
    const missing = required.filter(
      ([id]) => !modules.some((definition) => definition.manifest.id === id),
    );
    const centerViews = modules.filter(
      (definition) => definition.View && definition.manifest.slots.includes('center.view'),
    );
    const external = modules.filter(
      (definition) => originOf(definition.manifest).id === 'third-party',
    );
    return [
      {
        id: 'workbench:modules',
        group: '工作台',
        label: '工作台装配',
        status: missing.length > 0 ? 'fail' : 'ok',
        detail:
          missing.length > 0
            ? `缺少 ${missing.map(([, name]) => name).join('、')}`
            : `${localExtensionsEnabled ? '本机扩展构建' : '公开构建'} · ${modules.length} 个模块 · ${centerViews.length} 个盒子${
                external.length > 0 ? ` · ${external.length} 个外部` : ''
              }`,
        hint:
          missing.length > 0
            ? '检查 src/modules/index.ts 的内置模块注册。'
            : localExtensionsEnabled
              ? '外部模块只在本机开发/打包时加载；公开构建 npm run build 不包含它们。'
              : '从 Git 克隆的版本不会显示外部模块按钮。',
      },
    ];
  }, []);

  const healthChecks = useMemo(
    () => [...localChecks, ...(health.report?.checks ?? [])],
    [health.report, localChecks],
  );

  const healthGroups = useMemo(() => {
    const preferred = ['环境', '工作台', '路径', '工具', '引擎', '核心插件'];
    const names = Array.from(new Set(healthChecks.map((check) => check.group)));
    const order = [
      ...preferred.filter((name) => names.includes(name)),
      ...names.filter((name) => !preferred.includes(name)),
    ];
    return order.map((name) => ({
      name,
      checks: healthChecks.filter((check) => check.group === name),
    }));
  }, [healthChecks]);

  const healthSummary = useMemo(() => {
    const total = healthChecks.length;
    const failed = healthChecks.filter((check) => check.status === 'fail').length;
    const warned = healthChecks.filter((check) => check.status === 'warn').length;
    const status: HealthStatus = failed > 0 ? 'fail' : warned > 0 ? 'warn' : 'ok';
    return { total, failed, warned, passed: total - failed - warned, status };
  }, [healthChecks]);

  const [healthCopied, setHealthCopied] = useState(false);
  useEffect(() => {
    if (!healthCopied) return;
    const timer = window.setTimeout(() => setHealthCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [healthCopied]);

  const copyHealthReport = async () => {
    if (!window.desktop?.copyText || healthChecks.length === 0) return;
    const lines = [
      'DSH 中枢 · 体检报告',
      `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      `结论：${HEALTH_LABEL[healthSummary.status]} · ${healthSummary.passed}/${healthSummary.total} 项通过`,
      '',
    ];
    healthGroups.forEach((group) => {
      lines.push(`[${group.name}]`);
      group.checks.forEach((check) => {
        lines.push(`${HEALTH_LABEL[check.status]} · ${check.label}：${check.detail}`);
        if (check.hint && check.status !== 'ok') lines.push(`  提示：${check.hint}`);
      });
      lines.push('');
    });
    try {
      const result = await window.desktop.copyText(lines.join('\n'));
      setHealthCopied(Boolean(result?.ok));
    } catch {
      // 剪贴板 IPC 失败时保持按钮原状，不中断设置页。
      setHealthCopied(false);
    }
  };

  const startNewTheme = (base: ThemeDefinition = activeTheme) => {
    setDraft(draftFromTheme(base, `custom-${Date.now().toString(36)}`, '我的主题'));
  };

  const startEditTheme = (theme: ThemeDefinition) => {
    setDraft(draftFromTheme(theme, theme.id, theme.name));
  };

  const saveTheme = () => {
    if (!draft || !draft.name.trim()) return;
    const theme: ThemeDefinition = {
      id: draft.id,
      name: draft.name.trim(),
      tone: draft.style === 'paper' ? 'light' : draft.tone,
      accent: draft.accent,
      background: draft.background,
      backgroundMode: draft.backgroundMode,
      background2: draft.background2,
      background3: draft.background3,
      media: draft.media ? { ...draft.media } : null,
      glow: draft.style === 'paper' ? Math.min(draft.glow, 30) : draft.glow,
      style: draft.style,
      tweaks: { ...draft.tweaks },
      textTone: draft.textTone,
      builtin: false,
    };
    const themes = [
      ...settings.appearance.themes.filter((item) => item.id !== theme.id),
      theme,
    ];
    patch({ appearance: { ...settings.appearance, themes, themeId: theme.id } });
    setDraft(null);
  };

  /** 完成按钮：正在编辑的主题草稿直接落盘，不需要先点「保存并应用」。 */
  const finishSettings = () => {
    if (draft && draft.name.trim()) saveTheme();
    onClose();
  };

  const pickThemeMedia = async (kind: ThemeMedia['kind']) => {
    const picked = await window.desktop?.pickFile?.(
      kind,
      kind === 'video' ? '选择背景视频' : '选择背景图片',
    );
    if (!picked) return;
    if (picked.kind !== 'image' && picked.kind !== 'video') return;
    const mediaKind = picked.kind;
    setDraft((current) =>
      current
        ? {
            ...current,
            media: {
              kind: mediaKind,
              path: picked.path,
              dim: current.media?.dim ?? 52,
              blur: current.media?.blur ?? 0,
            },
          }
        : current,
    );
  };

  const openLink = (url: string) => {
    void window.desktop?.openExternal?.(url);
  };

  const deleteTheme = (theme: ThemeDefinition) => {
    const themes = settings.appearance.themes.filter((item) => item.id !== theme.id);
    patch({
      appearance: {
        ...settings.appearance,
        themes,
        themeId: settings.appearance.themeId === theme.id ? 'nexus' : settings.appearance.themeId,
      },
    });
    if (draft?.id === theme.id) setDraft(null);
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) finishSettings();
      }}
    >
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="设置">
        <div className="modal-head">
          <div className="settings-head-title">
            <h3>设置</h3>
            <span>SETTINGS</span>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭设置" onClick={finishSettings}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="settings-body">
          <nav className="settings-tabs" aria-label="设置分类">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? 'on' : ''}
                onClick={() => setTab(item.id)}
              >
                <Icon name={item.icon} size={14} />
                <span>{item.label}</span>
                <small>{item.eyebrow}</small>
              </button>
            ))}
            <div className="settings-tab-foot">
              <span className="theme-dot" style={{ background: activeTheme.accent }} />
              {activeTheme.name}
            </div>
          </nav>

          <div className="settings-content">
            {tab === 'themes' && (
              <section className="settings-pane">
                <div className="settings-pane-head">
                  <div>
                    <h4>主题与外观</h4>
                    <p>
                      十套内置主题、六种风格；「纸稿」「粗野」「终端」「柔光」「玻璃」各自带一套几何与质感。自定义主题还能调双色 / 三色渐变、贴纸或视频背景，并逐项微调。新建时可以先选一个主题当模板，从它的配色与风格开始改。
                    </p>
                  </div>
                  <div className="theme-new-bar">
                    <label className="theme-template-pick" title="新建主题时以哪个主题为模板">
                      <span>模板</span>
                      <select
                        value={templateTheme.id}
                        onChange={(event) => setTemplateId(event.target.value)}
                      >
                        {settings.appearance.themes.map((theme) => (
                          <option key={theme.id} value={theme.id}>
                            {theme.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => startNewTheme(templateTheme)}
                    >
                      <Icon name="plus" size={13} />
                      新建主题
                    </button>
                  </div>
                </div>

                <div className="theme-grid">
                  {settings.appearance.themes.map((theme) => {
                    const active = activeTheme.id === theme.id;
                    return (
                      <div key={theme.id} className={`theme-card${active ? ' active' : ''}`}>
                        <button
                          type="button"
                          className="theme-card-main"
                          onClick={() =>
                            patch({ appearance: { ...settings.appearance, themeId: theme.id } })
                          }
                        >
                          <span
                            className="theme-swatch"
                            data-style={theme.style}
                            style={{
                              background:
                                theme.style === 'paper' ||
                                theme.style === 'glass' ||
                                (theme.backgroundMode ?? 'solid') !== 'solid'
                                  ? themeBackground(theme)
                                  : theme.background,
                              borderColor:
                                theme.style === 'paper'
                                  ? rgba(theme.accent, 0.55)
                                  : rgba(theme.accent, 0.45),
                            }}
                          >
                            <i style={{ background: theme.accent }} />
                            <b
                              style={{
                                background: rgba(theme.accent, 0.39),
                                borderColor: rgba(theme.accent, 0.6),
                              }}
                            />
                            <em style={{ background: rgba(theme.accent, 0.4) }} />
                          </span>
                          <span className="theme-card-text">
                            <strong>{theme.name}</strong>
                            <small>
                              {styleNames[theme.style]} ·{' '}
                              {theme.tone === 'light' ? '日间' : '月间'} · 光晕 {theme.glow}%
                              {theme.backgroundMode && theme.backgroundMode !== 'solid'
                                ? theme.backgroundMode === 'duo'
                                  ? ' · 双色'
                                  : ' · 三色'
                                : ''}
                              {theme.media ? (theme.media.kind === 'video' ? ' · 视频' : ' · 贴纸') : ''}
                            </small>
                          </span>
                          {active && <span className="theme-active-dot" />}
                        </button>
                        {!theme.builtin && (
                          <div className="theme-card-actions">
                            <button
                              type="button"
                              aria-label={`编辑主题 ${theme.name}`}
                              title="编辑主题"
                              onClick={() => startEditTheme(theme)}
                            >
                              <Icon name="pen" size={12} />
                            </button>
                            <button
                              type="button"
                              aria-label={`删除主题 ${theme.name}`}
                              title="删除主题"
                              onClick={() => deleteTheme(theme)}
                            >
                              <Icon name="trash" size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {draft && (
                  <div className="theme-editor">
                    <div className="settings-pane-head compact">
                      <div>
                        <h4>{builtinThemes.some((theme) => theme.id === draft.id) ? '编辑主题' : '自定义主题'}</h4>
                        <p>配色和风格分开调；风格给几何与质感，下面五项微调可以逐项覆盖，文字色可跟随背景亮度或固定白 / 黑，右侧即时预览。背景支持双色 / 三色渐变和贴纸、视频素材。</p>
                      </div>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="取消编辑主题"
                        onClick={() => setDraft(null)}
                      >
                        <Icon name="x" size={13} />
                      </button>
                    </div>

                    <div className="theme-editor-grid">
                      <div className="theme-editor-fields">
                        <label className="settings-field-inline">
                          <span>主题名称</span>
                          <input
                            value={draft.name}
                            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                            spellCheck={false}
                          />
                        </label>
                        <div className="settings-field-inline">
                          <span>风格</span>
                          <div className="density-picker wide">
                            {styleOptions.map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                className={draft.style === value ? 'on' : ''}
                                onClick={() =>
                                  setDraft({
                                    ...draft,
                                    style: value,
                                    tone: value === 'paper' ? 'light' : draft.tone,
                                    glow:
                                      value === 'paper' ? Math.min(draft.glow, 30) : draft.glow,
                                    background:
                                      value === 'paper' && isDarkColor(draft.background)
                                        ? paperBackground
                                        : draft.background,
                                  })
                                }
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="settings-field-inline">
                          <span>明暗模式</span>
                          <div className="density-picker">
                            {(
                              [
                                ['dark', '月间'],
                                ['light', '日间'],
                              ] as Array<[ThemeTone, string]>
                            ).map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                className={draft.tone === value ? 'on' : ''}
                                disabled={draft.style === 'paper' && value === 'dark'}
                                title={
                                  draft.style === 'paper' && value === 'dark'
                                    ? '纸稿风格固定为日间'
                                    : undefined
                                }
                                onClick={() => setDraft({ ...draft, tone: value })}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="settings-field-inline">
                          <span title="跟随背景亮度自动选白字或黑字，也可以手动固定">文字色</span>
                          <div className="density-picker">
                            {(
                              [
                                ['auto', '跟随'],
                                ['white', '白字'],
                                ['black', '黑字'],
                              ] as Array<[ThemeTextTone, string]>
                            ).map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                className={draft.textTone === value ? 'on' : ''}
                                onClick={() => setDraft({ ...draft, textTone: value })}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="theme-tweaks">
                          <span className="theme-tweaks-label">微调</span>
                          {tweakOptions.map((item) => (
                            <div className="settings-field-inline" key={item.key}>
                              <span title={item.hint}>{item.label}</span>
                              <div className="density-picker wide">
                                {item.options.map(([value, label]) => (
                                  <button
                                    key={value}
                                    type="button"
                                    className={draft.tweaks[item.key] === value ? 'on' : ''}
                                    onClick={() =>
                                      setDraft({
                                        ...draft,
                                        tweaks: {
                                          ...draft.tweaks,
                                          [item.key]: value,
                                        } as ThemeTweaks,
                                      })
                                    }
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                        <label className="settings-field-inline">
                          <span>主色</span>
                          <div className="color-field">
                            <input
                              type="color"
                              value={draft.accent}
                              onChange={(event) => setDraft({ ...draft, accent: event.target.value })}
                            />
                            <code>{draft.accent}</code>
                          </div>
                        </label>
                        <label className="settings-field-inline">
                          <span>底色</span>
                          <div className="color-field">
                            <input
                              type="color"
                              value={draft.background}
                              onChange={(event) =>
                                setDraft({ ...draft, background: event.target.value })
                              }
                            />
                            <code>{draft.background}</code>
                          </div>
                        </label>
                        <div className="theme-tweaks">
                          <span className="theme-tweaks-label">背景</span>
                          <div className="settings-field-inline">
                            <span>渐变</span>
                            <div className="density-picker wide">
                              {backgroundModes.map(([value, label]) => (
                                <button
                                  key={value}
                                  type="button"
                                  className={draft.backgroundMode === value ? 'on' : ''}
                                  onClick={() => setDraft({ ...draft, backgroundMode: value })}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                          {draft.backgroundMode !== 'solid' && (
                            <label className="settings-field-inline">
                              <span>第二色</span>
                              <div className="color-field">
                                <input
                                  type="color"
                                  value={draft.background2}
                                  onChange={(event) =>
                                    setDraft({ ...draft, background2: event.target.value })
                                  }
                                />
                                <code>{draft.background2}</code>
                              </div>
                            </label>
                          )}
                          {draft.backgroundMode === 'trio' && (
                            <label className="settings-field-inline">
                              <span>第三色</span>
                              <div className="color-field">
                                <input
                                  type="color"
                                  value={draft.background3}
                                  onChange={(event) =>
                                    setDraft({ ...draft, background3: event.target.value })
                                  }
                                />
                                <code>{draft.background3}</code>
                              </div>
                            </label>
                          )}
                          <div className="settings-field-inline">
                            <span>素材</span>
                            {draft.media ? (
                              <div className="theme-media-field">
                                <span className="theme-media-chip" title={draft.media.path}>
                                  <Icon name={draft.media.kind === 'video' ? 'film' : 'image'} size={12} />
                                  <b>{fileName(draft.media.path)}</b>
                                </span>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  aria-label="移除背景素材"
                                  title="移除背景素材"
                                  onClick={() => setDraft({ ...draft, media: null })}
                                >
                                  <Icon name="x" size={12} />
                                </button>
                              </div>
                            ) : (
                              <div className="theme-media-field">
                                <button
                                  type="button"
                                  className="ghost-btn"
                                  onClick={() => void pickThemeMedia('image')}
                                >
                                  <Icon name="image" size={12} />
                                  选择图片
                                </button>
                                <button
                                  type="button"
                                  className="ghost-btn"
                                  onClick={() => void pickThemeMedia('video')}
                                >
                                  <Icon name="film" size={12} />
                                  选择视频
                                </button>
                              </div>
                            )}
                          </div>
                          {draft.media && (
                            <>
                              <div className="settings-field-inline">
                                <span>遮罩浓度</span>
                                <div className="range-field">
                                  <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={2}
                                    value={draft.media.dim}
                                    onChange={(event) =>
                                      setDraft({
                                        ...draft,
                                        media: { ...draft.media!, dim: Number(event.target.value) },
                                      })
                                    }
                                  />
                                  <span className="mono">{draft.media.dim}%</span>
                                </div>
                              </div>
                              <div className="settings-field-inline">
                                <span>素材模糊</span>
                                <div className="range-field">
                                  <input
                                    type="range"
                                    min={0}
                                    max={40}
                                    step={1}
                                    value={draft.media.blur}
                                    onChange={(event) =>
                                      setDraft({
                                        ...draft,
                                        media: { ...draft.media!, blur: Number(event.target.value) },
                                      })
                                    }
                                  />
                                  <span className="mono">{draft.media.blur}px</span>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                        <div className="settings-field-inline">
                          <span>背景光晕</span>
                          <div className="range-field">
                            <input
                              type="range"
                              min={0}
                              max={draft.style === 'paper' ? 30 : 100}
                              step={2}
                              value={draft.style === 'paper' ? Math.min(draft.glow, 30) : draft.glow}
                              onChange={(event) =>
                                setDraft({ ...draft, glow: Number(event.target.value) })
                              }
                              title={draft.style === 'paper' ? '纸稿风格上限定为 30%' : undefined}
                            />
                            <span className="mono">
                              {draft.style === 'paper' ? Math.min(draft.glow, 30) : draft.glow}%
                            </span>
                          </div>
                        </div>
                      </div>

                      <div
                        className="theme-preview-large"
                        data-style={draft.style}
                        data-tone={draft.tone}
                        data-ink={themeTextInk({ ...draft, builtin: false })}
                        data-radius={draftLook?.radius}
                        data-texture={draftLook?.texture}
                        data-font={draftLook?.font}
                        data-shadow={draftLook?.shadow}
                        style={{
                          background: themeBackground(draft),
                          borderColor: rgba(draft.accent, 0.4),
                        }}
                      >
                        <ThemeBackdrop theme={draft} className="theme-preview-backdrop" />
                        <span
                          className="theme-preview-texture"
                          data-texture={draftLook?.texture}
                          style={{ '--preview-line': rgba(draft.accent, 0.22) } as CSSProperties}
                        />
                        <span
                          className="theme-preview-glow"
                          style={{
                            background: `radial-gradient(circle, ${rgba(draft.accent, 0.5)}, transparent 68%)`,
                            opacity:
                              draft.style === 'paper' ? 0.12 : 0.25 + draft.glow / 160,
                          }}
                        />
                        <div className="theme-preview-window">
                          <span className="theme-preview-bar" style={{ background: rgba(draft.accent, 0.5) }} />
                          <div className="theme-preview-body">
                            <i style={{ background: draft.accent }} />
                            <b />
                            <b />
                            <em style={{ borderColor: rgba(draft.accent, 0.6) }} />
                          </div>
                        </div>
                        <small>
                          {styleNames[draft.style]}预览 ·{' '}
                          {draft.name || '未命名主题'}
                        </small>
                      </div>
                    </div>

                    <div className="theme-editor-foot">
                      <button type="button" className="ghost-btn" onClick={() => setDraft(null)}>
                        取消
                      </button>
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={saveTheme}
                        disabled={!draft.name.trim()}
                      >
                        <Icon name="check" size={13} />
                        保存并应用
                      </button>
                    </div>
                  </div>
                )}

                <div className="settings-subhead boot-section-head">
                  <div>
                    <h4>启动动画</h4>
                    <p>DSH 引擎拉起和官方页面加载时覆盖在引擎区；关闭后保留静态状态页。</p>
                  </div>
                  <Toggle
                    checked={boot.enabled}
                    label="启用启动动画"
                    onChange={(value) => patchBoot({ enabled: value })}
                  />
                </div>

                <div className="boot-preview" data-enabled={boot.enabled ? 'on' : 'off'}>
                  <div className="boot-preview-head">
                    <b>DSH</b>
                    <span>ENGINE · 本地引擎</span>
                    <em>{boot.enabled ? '启动中' : '静态'}</em>
                  </div>
                  {boot.enabled && boot.style === 'log' ? (
                    <div className="boot-preview-log">
                      {previewLines.map((line, index) => {
                        const meta = parsePreviewLine(line);
                        return (
                          <div className="boot-preview-line" data-tone={meta.tone} key={index}>
                            <span>+{(0.2 + index * 0.6).toFixed(1)}s</span>
                            <i>{meta.glyph}</i>
                            <b>{meta.text}</b>
                          </div>
                        );
                      })}
                      <div className="boot-preview-line current">
                        <span>+1.2s</span>
                        <i>›</i>
                        <b>
                          正在拉起本地引擎进程
                          <em className="boot-caret" />
                        </b>
                      </div>
                    </div>
                  ) : boot.enabled ? (
                    <div className="boot-preview-mini">
                      <b>DSH</b>
                      <span>引擎</span>
                      <p>
                        正在拉起本地引擎进程
                        <i className="boot-caret" />
                      </p>
                      <div className="boot-preview-track">
                        <i />
                      </div>
                    </div>
                  ) : (
                    <div className="boot-preview-static">
                      <span>DSH 引擎</span>
                      <p>正在拉起本地引擎进程</p>
                    </div>
                  )}
                </div>

                {boot.enabled && (
                  <div className="settings-row">
                    <div>
                      <strong>动画风格</strong>
                      <p>日志流按终端顺序逐行打印；极简只保留状态与进度。</p>
                    </div>
                    <div className="density-picker">
                      {(
                        [
                          ['log', '日志流'],
                          ['minimal', '极简'],
                        ] as Array<[BootStyle, string]>
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={boot.style === value ? 'on' : ''}
                          onClick={() => patchBoot({ style: value })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {boot.enabled && (
                  <div className="settings-row">
                    <div>
                      <strong>播放速度</strong>
                      <p>日志逐行出现的节奏；引擎启动较慢时可调慢。</p>
                    </div>
                    <div className="density-picker">
                      {(
                        [
                          ['slow', '舒缓'],
                          ['normal', '标准'],
                          ['fast', '快速'],
                        ] as Array<[BootSpeed, string]>
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={boot.speed === value ? 'on' : ''}
                          onClick={() => patchBoot({ speed: value })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {boot.enabled && boot.style === 'log' && (
                  <div className="settings-field boot-lines-field">
                    <label htmlFor="boot-lines">自定义启动日志</label>
                    <textarea
                      id="boot-lines"
                      className="boot-lines-input"
                      rows={4}
                      value={boot.lines.join('\n')}
                      placeholder={DEFAULT_BOOT_LINES.slice(0, 3).join('\n')}
                      onChange={(event) => patchBoot({ lines: event.target.value.split('\n') })}
                      spellCheck={false}
                    />
                    <div className="boot-lines-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => patchBoot({ lines: [...DEFAULT_BOOT_LINES] })}
                      >
                        填入默认文案
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => patchBoot({ lines: [] })}
                      >
                        恢复内置文案
                      </button>
                    </div>
                    <p className="settings-note">
                      每行一条，按顺序打印；$ 命令、✓ 完成、! 警告，{'{port}'} 占位会替换为实际端口。
                      留空时使用内置文案。
                    </p>
                  </div>
                )}

                <p className="settings-note">
                  自定义主题只影响界面配色，不改变模块数据。日间模式会同步调整神经元背景与文字对比。
                </p>
              </section>
            )}

            {tab === 'interface' && (
              <section className="settings-pane">
                <div className="settings-pane-head">
                  <div>
                    <h4>界面与动效</h4>
                    <p>控制信息密度与动画开销，适合不同屏幕尺寸。</p>
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>界面动效</strong>
                    <p>神经元自转、脉冲连线、过渡动画。关闭后降低渲染占用。</p>
                  </div>
                  <Toggle
                    checked={settings.appearance.motion}
                    label="界面动效"
                    onChange={(value) =>
                      patch({ appearance: { ...settings.appearance, motion: value } })
                    }
                  />
                </div>
                <div className="settings-row">
                  <div>
                    <strong>信息密度</strong>
                    <p>紧凑模式会收窄间距，适合小屏或同时查看多个面板。</p>
                  </div>
                  <div className="density-picker">
                    {(
                      [
                        ['comfortable', '舒适'],
                        ['compact', '紧凑'],
                      ] as Array<[Density, string]>
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={settings.appearance.density === value ? 'on' : ''}
                        onClick={() =>
                          patch({ appearance: { ...settings.appearance, density: value } })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>关闭窗口时</strong>
                    <p>
                      收进托盘后引擎继续运行，点托盘图标即可回来；托盘菜单里也能随时切换。
                    </p>
                  </div>
                  <div className="density-picker">
                    {(
                      [
                        [true, '最小化到托盘'],
                        [false, '直接退出'],
                      ] as Array<[boolean, string]>
                    ).map(([value, label]) => (
                      <button
                        key={label}
                        type="button"
                        className={settings.workbench.closeToTray === value ? 'on' : ''}
                        onClick={() =>
                          patch({
                            workbench: { ...settings.workbench, closeToTray: value },
                          })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {tab === 'skills' && (
              <section className="settings-pane">
                <div className="settings-pane-head">
                  <div>
                    <h4>工作台技能</h4>
                    <p>读取技能目录下的 SKILL.md；会话卡片引用的也是这里的技能文件。</p>
                  </div>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setSkillReload((value) => value + 1)}
                    disabled={skillScan.loading}
                    title="重新扫描技能目录"
                  >
                    <Icon name="refresh" size={13} />
                    刷新
                  </button>
                </div>

                <div className="skill-root mono" title={skillsRoot}>
                  {skillsRoot}
                </div>

                <div className="skill-panes">
                  <div className="skill-list">
                    {skillScan.loading && <div className="settings-note">正在扫描技能…</div>}
                    {!skillScan.loading && skillScan.error && (
                      <div className="settings-note danger-text">{skillScan.error}</div>
                    )}
                    {!skillScan.loading && !skillScan.error && skillScan.entries.length === 0 && (
                      <div className="settings-note">技能目录里还没有 SKILL.md。</div>
                    )}
                    {skillScan.entries.map((entry) => {
                      const owner = engine?.scenes.find((scene) => scene.skill === entry.id);
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          className={`skill-card${skillSelected === entry.id ? ' on' : ''}`}
                          onClick={() => setSkillSelected(entry.id)}
                        >
                          <span className="skill-card-icon">
                            <Icon name="book" size={14} />
                          </span>
                          <span className="skill-card-main">
                            <strong>{entry.name || entry.id}</strong>
                            <small>{entry.description || entry.id}</small>
                          </span>
                          {owner && <span className="skill-owner">{owner.name}</span>}
                        </button>
                      );
                    })}
                  </div>

                  <div className="skill-preview">
                    <div className="skill-preview-head">
                      <span className="mono">skills/{skillSelected || '—'}/SKILL.md</span>
                      <span className="skill-owner">{skillScene?.name ?? '未归属会话'}</span>
                      <span className="doc-readonly">只读</span>
                    </div>
                    <div className="skill-preview-body">
                      {skillDoc.loading ? (
                        <div className="settings-note">正在读取…</div>
                      ) : skillDoc.error ? (
                        <div className="settings-note danger-text">{skillDoc.error}</div>
                      ) : (
                        <Markdown
                          text={stripSkillFrontmatter(skillDoc.text)}
                          empty="这个技能还没有正文。"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {tab === 'tools' && (
              <section className="settings-pane">
                <div className="settings-pane-head">
                  <div>
                    <h4>工作台工具</h4>
                    <p>当前注册的能力模块；每个工具按槽位装配到会话的中心视图、详情栏或侧栏。</p>
                  </div>
                  <span className="settings-badge">{moduleCatalog.length} 个工具</span>
                </div>

                <div className="settings-field">
                  <label>工具目录</label>
                  <div className="state-path mono">{toolsPath}</div>
                  <p className="settings-note">
                    工具目录在「引擎」页签里修改；工作台模块从注册表读取。
                  </p>
                </div>

                <div className="tool-grid">
                  {moduleCatalog.map((definition) => {
                    const meta = categoryOf(definition.manifest);
                    const origin = originOf(definition.manifest);
                    return (
                      <div className="tool-card" key={definition.manifest.id}>
                        <div className="tool-card-head">
                          <span className="tool-card-icon">
                            <Icon name={definition.manifest.icon} size={16} />
                          </span>
                          <div className="tool-card-title">
                            <strong>{definition.manifest.name}</strong>
                            <span className="mono">v{definition.manifest.version}</span>
                          </div>
                          <span className={`origin-badge ${origin.id}`} title={origin.hint}>
                            {origin.short}
                          </span>
                          <span className="tool-category">{meta.label}</span>
                        </div>
                        <p>{definition.manifest.description}</p>
                        <div className="tool-card-tags">
                          {definition.manifest.slots.map((slot) => (
                            <span key={slot}>{SLOT_LABEL[slot] ?? slot}</span>
                          ))}
                          <span className="mono">{definition.manifest.id}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="tools-dir">
                  <div className="settings-pane-head">
                    <div>
                      <h4>目录工具脚本</h4>
                      <p>
                        只读扫描「工具目录」里的脚本；摘要优先取 README 的对应段落，其次取脚本头部注释，不执行脚本。
                      </p>
                    </div>
                    <div className="tools-dir-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => setToolReload((value) => value + 1)}
                        disabled={toolScan.loading}
                        title="重新扫描工具目录"
                      >
                        <Icon name="refresh" size={13} />
                        刷新
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => void window.desktop?.openPath(toolScan.root || toolsRoot)}
                        disabled={!window.desktop}
                        title="在资源管理器打开工具目录"
                      >
                        <Icon name="folder" size={13} />
                        打开目录
                      </button>
                    </div>
                  </div>
                  <div className="state-path mono" title={toolScan.root || toolsRoot}>
                    {toolScan.root || toolsRoot || '未配置工具目录'}
                  </div>
                  {toolScan.loading && <div className="settings-note">正在扫描工具目录…</div>}
                  {!toolScan.loading && toolScan.error && (
                    <div className="settings-note danger-text">{toolScan.error}</div>
                  )}
                  {!toolScan.loading && !toolScan.error && toolScan.missing && (
                    <div className="settings-note">工具目录还不存在，可以到「引擎」页签重新选择。</div>
                  )}
                  {!toolScan.loading &&
                    !toolScan.error &&
                    !toolScan.missing &&
                    toolScan.entries.length === 0 && (
                      <div className="settings-note">
                        目录里还没有脚本。新增 .mjs / .js / .py 等文件后点刷新即可。
                      </div>
                    )}
                  <div className="tool-grid">
                    {toolScan.entries.map((entry) => (
                      <div className="tool-card" key={entry.id}>
                        <div className="tool-card-head">
                          <span className="tool-card-icon">
                            <Icon name="wrench" size={16} />
                          </span>
                          <div className="tool-card-title">
                            <strong>{entry.name}</strong>
                            <span className="mono">{formatSize(entry.size)}</span>
                          </div>
                          <span className="tool-category">{entry.ext}</span>
                        </div>
                        <p>{entry.summary || '脚本头部还没有用途说明。'}</p>
                        <div className="tool-card-tags">
                          <span className="mono">{entry.id}</span>
                          {entry.modified ? <span>{formatDay(entry.modified)}</span> : null}
                          <span>只读</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="settings-note">
                  工具由模块注册表统一提供，启停与排序在会话的「模块装配」里按会话独立设置。
                  「引擎」「外部」标记的能力来自引擎或第三方项目，发布工作台时不要并入仓库。
                </p>
              </section>
            )}

            {tab === 'engine' && (
              <section className="settings-pane">
                <div className="settings-pane-head">
                  <div>
                    <h4>路径与引擎</h4>
                    <p>
                      壳工程不写死绝对路径：目录全部来自这里，或由程序位置推导。引擎页面仍由工作台托管启动，只读投影不读取凭据。
                    </p>
                  </div>
                  <button type="button" className="ghost-btn" onClick={() => void useDefaultPaths()}>
                    <Icon name="restore" size={13} />
                    使用默认路径
                  </button>
                </div>

                <div className="settings-field">
                  <label htmlFor="engine-dir">引擎安装目录</label>
                  <div className="field-line">
                    <input
                      id="engine-dir"
                      value={engineDir}
                      onChange={(event) => setEngineDir(event.target.value)}
                      onBlur={commitPaths}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitPaths();
                        }
                      }}
                      placeholder="包含 apps/cli 的 DSH 引擎目录"
                      spellCheck={false}
                    />
                    <button type="button" className="ghost-btn" onClick={() => void pickEngineDir()}>
                      选择
                    </button>
                  </div>
                  <p className="settings-note">用于拉起 dsh web；修改后重启客户端生效。</p>
                </div>

                <div className="settings-field">
                  <label htmlFor="engine-path">引擎数据目录（.dsh）</label>
                  <div className="field-line">
                    <input
                      id="engine-path"
                      value={dataPath}
                      onChange={(event) => setDataPath(event.target.value)}
                      onBlur={commitPaths}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitPaths();
                        }
                      }}
                      spellCheck={false}
                    />
                    <button type="button" className="ghost-btn" onClick={() => void pickEngine()}>
                      选择
                    </button>
                  </div>
                  <p className="settings-note">
                    只读取 registry、角色卡、summary、记忆/技能文件名和事件索引，不读取
                    .credentials.yaml。
                  </p>
                </div>

                <div className="settings-field">
                  <label htmlFor="workspace-path">工作区目录（文件浏览）</label>
                  <div className="field-line">
                    <input
                      id="workspace-path"
                      value={workspacePath}
                      onChange={(event) => setWorkspacePath(event.target.value)}
                      onBlur={commitPaths}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitPaths();
                        }
                      }}
                      spellCheck={false}
                    />
                    <button type="button" className="ghost-btn" onClick={() => void pickWorkspace()}>
                      选择
                    </button>
                  </div>
                </div>

                <div className="settings-field">
                  <label htmlFor="files-root">文件浏览根目录</label>
                  <div className="field-line">
                    <input
                      id="files-root"
                      value={filesRoot}
                      onChange={(event) => setFilesRoot(event.target.value)}
                      onBlur={commitPaths}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitPaths();
                        }
                      }}
                      placeholder="文件工作台可以向上返回的边界"
                      spellCheck={false}
                    />
                    <button type="button" className="ghost-btn" onClick={() => void pickFilesRoot()}>
                      选择
                    </button>
                  </div>
                  <p className="settings-note">
                    文件工作台默认从工具目录打开，可一路返回上级，但不会越过这个边界；.dsh 与凭据路径始终不可浏览。
                  </p>
                </div>

                <div className="settings-field">
                  <label htmlFor="skills-path">技能目录（SKILL.md）</label>
                  <div className="field-line">
                    <input
                      id="skills-path"
                      value={skillsPath}
                      onChange={(event) => setSkillsPath(event.target.value)}
                      onBlur={commitPaths}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitPaths();
                        }
                      }}
                      spellCheck={false}
                    />
                    <button type="button" className="ghost-btn" onClick={() => void pickSkills()}>
                      选择
                    </button>
                  </div>
                  <p className="settings-note">
                    「技能」页签按这份目录扫描 SKILL.md；当前会话的角色技能也读取同一目录。
                  </p>
                </div>

                <div className="settings-field">
                  <label htmlFor="tools-path-engine">工具目录</label>
                  <div className="field-line">
                    <input
                      id="tools-path-engine"
                      value={toolsPath}
                      onChange={(event) => setToolsPath(event.target.value)}
                      onBlur={commitPaths}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitPaths();
                        }
                      }}
                      spellCheck={false}
                    />
                    <button type="button" className="ghost-btn" onClick={() => void pickTools()}>
                      选择
                    </button>
                  </div>
                  <p className="settings-note">
                    预留给引擎侧工具脚本；「工具」页签展示的是工作台已注册的能力模块。
                  </p>
                </div>

                <div className="settings-row engine-status-row">
                  <div>
                    <strong>扫描状态</strong>
                    <p>
                      {engineLoading
                        ? '正在读取引擎数据…'
                        : engine?.ok
                          ? `${engine.scenes.length} 个会话 · ${engine.events.length} 条事件 · ${new Date(engine.scannedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
                          : engineError || '尚未连接引擎数据目录'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={onRefreshEngine}
                    disabled={engineLoading}
                  >
                    <Icon name="refresh" size={13} />
                    重新扫描
                  </button>
                </div>
              </section>
            )}

            {tab === 'terminal' && (
              <section className="settings-pane">
                <div className="settings-pane-head">
                  <div>
                    <h4>终端默认 shell</h4>
                    <p>
                      会话桌面里的终端盒子按这里的偏好启动。「自动」依次尝试 Git Bash、PowerShell、CMD，
                      换一台机器也会按 PATH 重新探测，不写死安装路径。
                    </p>
                  </div>
                  <span className="settings-badge">
                    {shellsLoading
                      ? '探测中'
                      : `${shells.filter((shell) => shell.available).length} 个可用`}
                  </span>
                </div>

                <div className="settings-shell-grid">
                  {shells.map((shell) => {
                    const selected = settings.terminal.shell === shell.id;
                    return (
                      <button
                        type="button"
                        key={shell.id}
                        className={`settings-shell${selected ? ' on' : ''}`}
                        disabled={!shell.available}
                        aria-pressed={selected}
                        onClick={() => patch({ terminal: { shell: shell.id } })}
                      >
                        <span className="settings-shell-icon">
                          <Icon name={shell.id === 'cmd' ? 'command' : 'terminal'} size={15} />
                        </span>
                        <span className="settings-shell-body">
                          <strong>
                            {shell.label}
                            {selected && <em>当前</em>}
                          </strong>
                          <small title={shell.path || undefined}>
                            {shell.id === 'auto'
                              ? '按可用性自动挑选，优先 Git Bash'
                              : shell.available
                                ? shell.path
                                : '本机没有找到这个 shell'}
                          </small>
                        </span>
                        {selected && (
                          <span className="settings-shell-check">
                            <Icon name="check" size={12} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {shells.length === 0 && (
                  <p className="settings-note">
                    {shellsLoading ? '正在读取本机 shell…' : shellsError || '没有探测到可用的 shell。'}
                  </p>
                )}

                <div className="settings-row engine-status-row">
                  <div>
                    <strong>启动目录</strong>
                    <p>
                      {settings.engine.workspacePath ||
                        '尚未设置工作区目录，终端会使用程序所在目录。可在「引擎」页签里配置。'}
                    </p>
                  </div>
                  <span className="settings-badge">{chosenShell?.label ?? '自动'}</span>
                </div>

                <p className="settings-note">
                  终端盒子里的分栏比例会自动保存；修改默认 shell 后，新的终端盒子会按新选择启动，已经打开的盒子点右上角重启即可切换。
                </p>
              </section>
            )}

            {tab === 'voice' && (
              <section className="settings-pane">
                <div className="settings-pane-head">
                  <div>
                    <h4>引擎语音播报</h4>
                    <p>
                      用固定音色朗读当前会话的回复；本地复刻用参考音频，Edge 用预置音色。
                      简报按段落整篇读完，代码和表格自动跳过。
                    </p>
                  </div>
                  <span className="settings-badge">
                    {settings.voice.enabled ? '自动朗读' : '已关闭'}
                  </span>
                </div>

                <div className="settings-row">
                  <div>
                    <strong>自动朗读当前会话</strong>
                    <p>
                      只在官方页面里当前打开的会话收尾时朗读；后台会话不读，启动前就有的旧回复也不会补念。
                    </p>
                  </div>
                  <Toggle
                    checked={settings.voice.enabled}
                    label="自动朗读当前会话"
                    onChange={(value) =>
                      patch({ voice: { ...settings.voice, enabled: value } })
                    }
                  />
                </div>

                <VoiceStudio
                  voice={settings.voice}
                  onChange={(next) => patch({ voice: next })}
                />
              </section>
            )}

            {tab === 'health' && (
              <section className="settings-pane health-pane">
                <div className="settings-pane-head">
                  <div>
                    <h4>一体体检</h4>
                    <p>
                      按「环境 → 工作台 → 路径 → 工具 → 引擎 → 核心插件」一条链路检查，同一环节合并成一行。
                      本地语音属于个人部署，不在体检范围内；别人拿到客户端时，先跑一遍体检就能看到哪一环没接好。
                    </p>
                  </div>
                  <div className="health-pane-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => void copyHealthReport()}
                      disabled={health.loading || healthChecks.length === 0}
                    >
                      <Icon name="copy" size={13} />
                      {healthCopied ? '已复制' : '复制报告'}
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => setHealthTick((value) => value + 1)}
                      disabled={health.loading}
                    >
                      <Icon name="refresh" size={13} />
                      {health.loading ? '检查中' : '重新体检'}
                    </button>
                  </div>
                </div>

                <div className={`health-summary ${healthSummary.status}`}>
                  <span className="health-badge">
                    <Icon
                      name={
                        healthSummary.status === 'ok'
                          ? 'check'
                          : healthSummary.status === 'warn'
                            ? 'alert'
                            : 'x'
                      }
                      size={13}
                    />
                    {HEALTH_LABEL[healthSummary.status]}
                  </span>
                  <div className="health-summary-text">
                    <strong>
                      {healthSummary.passed}/{healthSummary.total || 0} 项通过
                    </strong>
                    <small>
                      {healthSummary.failed > 0
                        ? `${healthSummary.failed} 项异常需要处理`
                        : healthSummary.warned > 0
                          ? `${healthSummary.warned} 项提醒，可按提示确认`
                          : health.loading
                            ? '正在收集检查结果…'
                            : '没有发现问题'}
                      {health.report
                        ? ` · ${new Date(health.report.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
                        : ''}
                    </small>
                  </div>
                  <div className="health-legend">
                    <span><i className="ok" />正常 {healthSummary.passed}</span>
                    <span><i className="warn" />提醒 {healthSummary.warned}</span>
                    <span><i className="fail" />异常 {healthSummary.failed}</span>
                  </div>
                </div>

                {health.error && <p className="health-error">{health.error}</p>}

                <div className="health-groups">
                  {healthGroups.map((group) => {
                    const issues = group.checks.filter((check) => check.status !== 'ok').length;
                    return (
                      <section className="health-group" key={group.name}>
                        <header>
                          <span>{group.name}</span>
                          <em>{issues > 0 ? `${issues} 项待确认` : '全部正常'}</em>
                        </header>
                        {group.checks.map((check) => (
                          <div className={`health-item ${check.status}`} key={check.id}>
                            <span className="health-dot" />
                            <div className="health-item-body">
                              <strong>{check.label}</strong>
                              <small title={check.detail}>{check.detail}</small>
                              {check.hint && check.status !== 'ok' && <p>{check.hint}</p>}
                            </div>
                            <span className="health-state">{HEALTH_LABEL[check.status]}</span>
                          </div>
                        ))}
                      </section>
                    );
                  })}
                </div>

                <p className="settings-note">
                  体检只统计目录状态与允许清单里的文件，不读取 .credentials.yaml，也不读取插件源码。
                </p>
              </section>
            )}

            {tab === 'storage' && (
              <section className="settings-pane">
                <div className="settings-pane-head">
                  <div>
                    <h4>本地存档</h4>
                    <p>会话、模块装配、待办、模板和设置自动写入该文件。</p>
                  </div>
                </div>
                <div className="settings-field">
                  <label>存档路径</label>
                  <div className="state-path mono">{statePath || '浏览器预览环境无本地存档'}</div>
                  <p className="settings-note">引擎数据只读，不进入存档。</p>
                </div>
                <div className="settings-actions">
                  <button
                    type="button"
                    className="ghost-btn danger"
                    onClick={() => {
                      void (async () => {
                        const defaults = await window.desktop?.defaultPaths();
                        const next = mergeSettings(
                          defaults
                            ? { engine: defaults, web: settings.web }
                            : { web: settings.web },
                        );
                        onChange(next);
                        setEngineDir(next.engine.engineDir);
                        setDataPath(next.engine.dataPath);
                        setWorkspacePath(next.engine.workspacePath);
                        setFilesRoot(next.engine.filesRoot);
                        setSkillsPath(next.engine.skillsPath);
                        setToolsPath(next.engine.toolsPath);
                        setDraft(null);
                      })();
                    }}
                  >
                    <Icon name="refresh" size={13} />
                    恢复默认设置
                  </button>
                </div>
              </section>
            )}

            {tab === 'about' && (
              <section className="settings-pane about-pane">
                <div className="settings-pane-head">
                  <div>
                    <h4>关于 DSH 中枢</h4>
                    <p>
                      围绕 DSH 引擎的本地桌面工作台：Electron 负责窗口与系统能力，React
                      负责会话桌面、盒子布局和模块装配。
                    </p>
                  </div>
                  <span className="about-version mono">{appVersion ? `v${appVersion}` : '开发版'}</span>
                </div>

                <div className="about-hero">
                  <span className="about-mark">DSH</span>
                  <div>
                    <strong>DSH 中枢 · 集成工作台</strong>
                    <p>
                      把引擎的会话、记忆、技能与本机工具投射到一块可编排的桌面上。外壳以 MIT
                      许可开源，引擎本体不随仓库分发。
                    </p>
                  </div>
                </div>

                <details className="about-guide">
                  <summary>
                    <span>
                      <strong>使用指南</strong>
                      <small>目录 → 引擎 → 插件 → 绑定会话，六步跑通；只体验界面可跳过流程。</small>
                    </span>
                    <Icon name="chevronDown" size={13} />
                  </summary>
                  <div className="about-guide-body">
                    <ol>
                      <li>
                        <b>准备目录</b>
                        按 <code>app / engines / data / workspace</code> 四层放置：客户端、DSH
                        引擎、<code>.dsh</code> 数据与会话工作目录各自分开。
                      </li>
                      <li>
                        <b>安装引擎</b>
                        把 DSH 引擎解压到 <code>engines/</code>，在「引擎」页签选择引擎目录与{' '}
                        <code>data/.dsh</code>。
                      </li>
                      <li>
                        <b>安装插件</b>
                        在引擎里安装并初始化 <code>dsh-collab</code>，角色卡、记忆、技能与工单会写进{' '}
                        <code>data/.dsh</code>。
                      </li>
                      <li>
                        <b>绑定工作目录</b>
                        把工作目录指向 <code>workspace/</code>，终端与文件盒子默认从这里开始。
                      </li>
                      <li>
                        <b>添加会话</b>
                        打开 DSH 引擎 → 设置 → 会话协作，添加一个引擎会话。
                      </li>
                      <li>
                        <b>绑进工作台</b>
                        回到工作台新建会话并绑定该引擎会话，再添加模块盒子，<kbd>Ctrl</kbd>+
                        <kbd>S</kbd> 保存布局。
                      </li>
                    </ol>
                    <p className="about-guide-note">
                      额外补充：外部模块只在本机扩展构建里出现，公开构建不携带；本地语音属于个人部署；
                      装好后到「体检」页跑一遍，就能看到哪一环还没接好。
                    </p>
                  </div>
                </details>

                <div className="about-links">
                  <button
                    type="button"
                    className="about-link"
                    onClick={() => openLink('https://github.com/sessionhive/dsh-workbench')}
                  >
                    <span className="about-link-icon">
                      <Icon name="git" size={15} />
                    </span>
                    <span>
                      <strong>GitHub 仓库</strong>
                      <small>github.com/sessionhive/dsh-workbench</small>
                    </span>
                    <Icon name="arrowUpRight" size={13} />
                  </button>
                  <button
                    type="button"
                    className="about-link"
                    onClick={() => openLink('https://github.com/sessionhive/dsh-collab')}
                  >
                    <span className="about-link-icon">
                      <Icon name="book" size={15} />
                    </span>
                    <span>
                      <strong>协作插件 dsh-collab</strong>
                      <small>角色卡、记忆、技能与工单的数据来源</small>
                    </span>
                    <Icon name="arrowUpRight" size={13} />
                  </button>
                  <button
                    type="button"
                    className="about-link"
                    onClick={() => openLink('https://github.com/sessionhive/dsh-workbench/tree/main/docs')}
                  >
                    <span className="about-link-icon">
                      <Icon name="filePlus" size={15} />
                    </span>
                    <span>
                      <strong>使用文档</strong>
                      <small>使用流程、引擎接入、项目结构与部署清单</small>
                    </span>
                    <Icon name="arrowUpRight" size={13} />
                  </button>
                  <button
                    type="button"
                    className="about-link"
                    onClick={() => openLink('https://github.com/sessionhive/dsh-workbench/issues')}
                  >
                    <span className="about-link-icon">
                      <Icon name="bug" size={15} />
                    </span>
                    <span>
                      <strong>问题与建议</strong>
                      <small>遇到 bug 或有新点子，欢迎开 Issue</small>
                    </span>
                    <Icon name="arrowUpRight" size={13} />
                  </button>
                </div>

                <div className="about-star">
                  <span className="about-star-icon">
                    <Icon name="star" size={18} />
                  </span>
                  <div>
                    <strong>觉得好用的话，给仓库点一颗星</strong>
                    <p>
                      一颗 Star 是最直接的支持，也能让更多人发现这个项目。欢迎在 Issues
                      里聊想法，或者直接提 PR。
                    </p>
                  </div>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => openLink('https://github.com/sessionhive/dsh-workbench')}
                  >
                    <Icon name="star" size={13} />
                    去点星
                  </button>
                </div>

                <p className="settings-note">
                  工作台只做本地壳与界面，不收集遥测；会话、主题、路径与背景素材路径都保存在你自己的机器上。
                </p>
              </section>
            )}
          </div>
        </div>

        <div className="modal-foot">
          <span>{draft ? '完成时自动保存当前主题' : '自动保存 · 关闭后生效'}</span>
          <span className="spacer" />
          <span className="settings-foot-theme">
            <i style={{ background: activeTheme.accent }} />
            {activeTheme.name}
          </span>
          <button type="button" className="primary-btn" onClick={finishSettings}>
            <Icon name="check" size={13} />
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
