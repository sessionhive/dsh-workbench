import { useEffect, useMemo, useState } from 'react';
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
} from '../engine/types';
import { categoryOf, listModules } from '../modules';
import {
  builtinThemes,
  mergeSettings,
  resolveTheme,
  rgba,
  type Density,
  type ThemeDefinition,
  type ThemeTone,
  type WorkbenchSettings,
} from '../settings';
import type { IconName } from '../types';
import type { TerminalShellOption } from '../terminal/types';
import { Icon } from './icons';
import { Markdown } from './Markdown';

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
  | 'health'
  | 'skills'
  | 'tools'
  | 'storage';

const TABS: Array<{ id: TabId; label: string; eyebrow: string; icon: IconName }> = [
  { id: 'themes', label: '主题', eyebrow: 'THEME', icon: 'palette' },
  { id: 'interface', label: '界面', eyebrow: 'INTERFACE', icon: 'monitor' },
  { id: 'engine', label: '引擎', eyebrow: 'ENGINE', icon: 'database' },
  { id: 'terminal', label: '终端', eyebrow: 'TERMINAL', icon: 'terminal' },
  { id: 'health', label: '体检', eyebrow: 'HEALTH', icon: 'activity' },
  { id: 'skills', label: '技能', eyebrow: 'SKILLS', icon: 'book' },
  { id: 'tools', label: '工具', eyebrow: 'TOOLS', icon: 'wrench' },
  { id: 'storage', label: '存档', eyebrow: 'STORAGE', icon: 'save' },
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
  glow: number;
}

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

  const [skillScan, setSkillScan] = useState<{
    loading: boolean;
    entries: EngineSkillEntry[];
    error: string;
  }>({ loading: false, entries: [], error: '' });
  const [skillSelected, setSkillSelected] = useState('');
  const [skillReload, setSkillReload] = useState(0);
  const [skillDoc, setSkillDoc] = useState({ text: '', loading: false, error: '' });

  const activeTheme = useMemo(() => resolveTheme(settings), [settings]);
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
      engine: { ...settings.engine, ...(next.engine ?? {}) },
      terminal: { ...settings.terminal, ...(next.terminal ?? {}) },
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

  const localChecks = useMemo<HealthCheck[]>(() => {    const modules = listModules();
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
    return [
      {
        id: 'workbench:runtime',
        group: '工作台',
        label: '桌面运行时',
        status: window.desktop ? 'ok' : 'fail',
        detail: window.desktop
          ? `preload 已连接 · ${statePath || '存档路径由主进程管理'}`
          : '浏览器预览环境没有 Electron preload',
        hint: window.desktop ? '' : '请在桌面客户端里打开设置，网页预览只能看界面。',
      },
      {
        id: 'workbench:modules',
        group: '工作台',
        label: '模块注册表',
        status: missing.length > 0 ? 'fail' : 'ok',
        detail:
          missing.length > 0
            ? `缺少 ${missing.map(([, name]) => name).join('、')}`
            : `${modules.length} 个模块已注册 · ${centerViews.length} 个可作为盒子`,
        hint: missing.length > 0 ? '检查 src/modules/index.ts 的内置模块注册。' : '',
      },
      {
        id: 'workbench:health',
        group: '工作台',
        label: '体检通道',
        status: health.report ? 'ok' : health.loading ? 'warn' : 'fail',
        detail: health.report
          ? `主进程返回 ${health.report.checks.length} 项检查`
          : health.loading
            ? '正在等待主进程结果'
            : health.error || '尚未执行体检',
        hint: health.report ? '' : '点击右上角「重新体检」。',
      },
    ];
  }, [health.error, health.loading, health.report, statePath]);

  const healthChecks = useMemo(
    () => [...localChecks, ...(health.report?.checks ?? [])],
    [health.report, localChecks],
  );

  const healthGroups = useMemo(() => {
    const preferred = ['工作台', '环境', '路径', '工具', '引擎', '核心插件'];
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

  const startNewTheme = () => {
    setDraft({
      id: `custom-${Date.now().toString(36)}`,
      name: '我的主题',
      tone: activeTheme.tone,
      accent: activeTheme.accent,
      background: activeTheme.background,
      glow: activeTheme.glow,
    });
  };

  const startEditTheme = (theme: ThemeDefinition) => {
    setDraft({
      id: theme.id,
      name: theme.name,
      tone: theme.tone,
      accent: theme.accent,
      background: theme.background,
      glow: theme.glow,
    });
  };

  const saveTheme = () => {
    if (!draft || !draft.name.trim()) return;
    const theme: ThemeDefinition = {
      id: draft.id,
      name: draft.name.trim(),
      tone: draft.tone,
      accent: draft.accent,
      background: draft.background,
      glow: draft.glow,
      builtin: false,
    };
    const themes = [
      ...settings.appearance.themes.filter((item) => item.id !== theme.id),
      theme,
    ];
    patch({ appearance: { ...settings.appearance, themes, themeId: theme.id } });
    setDraft(null);
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
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="设置">
        <div className="modal-head">
          <div className="settings-head-title">
            <h3>设置</h3>
            <span>SETTINGS</span>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭设置" onClick={onClose}>
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
                    <p>内置黑、青、蓝、白、绿、粉、紫七套配色；自定义主题会随存档保存。</p>
                  </div>
                  <button type="button" className="ghost-btn" onClick={startNewTheme}>
                    <Icon name="plus" size={13} />
                    新建主题
                  </button>
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
                            style={{
                              background: theme.background,
                              borderColor: rgba(theme.accent, 0.45),
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
                              {theme.tone === 'light' ? '日间' : '月间'} · 光晕 {theme.glow}%
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
                        <p>调整主色、底色和背景光晕，右侧即时预览。</p>
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
                                onClick={() => setDraft({ ...draft, tone: value })}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
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
                        <div className="settings-field-inline">
                          <span>背景光晕</span>
                          <div className="range-field">
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={2}
                              value={draft.glow}
                              onChange={(event) =>
                                setDraft({ ...draft, glow: Number(event.target.value) })
                              }
                            />
                            <span className="mono">{draft.glow}%</span>
                          </div>
                        </div>
                      </div>

                      <div
                        className="theme-preview-large"
                        style={{
                          background: draft.background,
                          borderColor: rgba(draft.accent, 0.4),
                        }}
                      >
                        <span
                          className="theme-preview-glow"
                          style={{
                            background: `radial-gradient(circle, ${rgba(draft.accent, 0.5)}, transparent 68%)`,
                            opacity: 0.25 + draft.glow / 160,
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
                          {draft.tone === 'light' ? '日间预览' : '月间预览'} · {draft.name || '未命名主题'}
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
                    <p>读取技能目录下的 SKILL.md；场景卡片引用的也是这里的技能文件。</p>
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
                      <span className="skill-owner">{skillScene?.name ?? '未归属场景'}</span>
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

                <p className="settings-note">
                  工具由模块注册表统一提供，启停与排序在会话的「模块装配」里按会话独立设置。
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
                          ? `${engine.scenes.length} 个场景 · ${engine.events.length} 条事件 · ${new Date(engine.scannedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
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
                      场景桌面里的终端盒子按这里的偏好启动。「自动」依次尝试 Git Bash、PowerShell、CMD，
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

            {tab === 'health' && (
              <section className="settings-pane health-pane">
                <div className="settings-pane-head">
                  <div>
                    <h4>一体体检</h4>
                    <p>
                      逐项检查工作台运行时、目录路径、工具与 DSH 核心插件。别人拿到客户端时，
                      先跑一遍体检就能看到哪一环没接好。
                    </p>
                  </div>
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
                              {check.hint && <p>{check.hint}</p>}
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
                        const next = mergeSettings(defaults ? { engine: defaults } : null);
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
          </div>
        </div>

        <div className="modal-foot">
          <span>自动保存 · 关闭后生效</span>
          <span className="spacer" />
          <span className="settings-foot-theme">
            <i style={{ background: activeTheme.accent }} />
            {activeTheme.name}
          </span>
          <button type="button" className="primary-btn" onClick={onClose}>
            <Icon name="check" size={13} />
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
