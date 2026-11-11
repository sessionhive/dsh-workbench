import { useEffect, useMemo, useState } from 'react';
import { categoryOf, listModules, MODULE_CATEGORIES } from '../modules';
import type { EngineSnapshot } from '../engine/types';
import { SESSION_ICONS, type SessionConfig, type SessionTemplate } from '../templates';
import type { IconName } from '../types';
import { Icon } from './icons';

interface NewSessionWizardProps {
  templates: SessionTemplate[];
  engine: EngineSnapshot | null;
  engineLoading: boolean;
  onCreate: (template: SessionTemplate, config: SessionConfig) => void;
  onSaveTemplate: (config: SessionConfig, existingId: string | null) => string;
  onDeleteTemplate: (id: string) => void;
  onClose: () => void;
}

function formOf(template: SessionTemplate): SessionConfig {
  return {
    name: template.name,
    role: template.role,
    scene: template.scene,
    model: template.model,
    color: template.color,
    icon: template.icon,
    modules: [...template.modules],
    harness: template.harness ?? null,
  };
}

const EMPTY_FORM: SessionConfig = {
  name: '',
  role: '',
  scene: '',
  model: '',
  color: '#5aa9ff',
  icon: 'spark',
  modules: [],
  harness: null,
};

export function NewSessionWizard({
  templates,
  engine,
  engineLoading,
  onCreate,
  onSaveTemplate,
  onDeleteTemplate,
  onClose,
}: NewSessionWizardProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? '');
  const [form, setForm] = useState<SessionConfig>(() =>
    templates[0] ? formOf(templates[0]) : EMPTY_FORM,
  );

  const selected = templates.find((template) => template.id === selectedId) ?? templates[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    setForm(formOf(selected));
    // 只在切换模板时重置表单，避免引擎刷新时覆盖用户输入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return templates;
    return templates.filter((template) =>
      `${template.name}${template.description}${template.role}${template.scene}${template.tags.join(' ')}`
        .toLowerCase()
        .includes(keyword),
    );
  }, [query, templates]);

  const builtin = filtered.filter((template) => template.source === 'builtin');
  const custom = filtered.filter((template) => template.source === 'custom');
  const engineList = filtered.filter((template) => template.source === 'engine');

  const modules = useMemo(
    () =>
      listModules()
        .filter((definition) =>
          definition.manifest.slots.some(
            (slot) => slot === 'center.view' || slot === 'detail.block',
          ),
        )
        .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name, 'zh')),
    [],
  );

  /** 引擎里登记过的 Harness 会话，按 sessionId 去重后供场景绑定。 */
  const harnessOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ sessionId: string; title: string; scene: string }> = [];
    for (const scene of engine?.scenes ?? []) {
      const list =
        scene.sessions?.length > 0
          ? scene.sessions
          : scene.primarySessionId
            ? [
                {
                  panelId: scene.primaryPanelId,
                  sessionId: scene.primarySessionId,
                  title: scene.primarySessionTitle || scene.name,
                },
              ]
            : [];
      for (const session of list) {
        if (!session.sessionId || seen.has(session.sessionId)) continue;
        seen.add(session.sessionId);
        options.push({
          sessionId: session.sessionId,
          title: session.title || scene.name,
          scene: scene.name,
        });
      }
    }
    return options;
  }, [engine]);

  const bindingMissing =
    Boolean(form.harness) &&
    !harnessOptions.some((option) => option.sessionId === form.harness?.sessionId);

  const chooseHarness = (sessionId: string) => {
    if (!sessionId) {
      setForm((current) => ({ ...current, harness: null }));
      return;
    }
    const option = harnessOptions.find((item) => item.sessionId === sessionId);
    if (!option) return;
    setForm((current) => ({
      ...current,
      harness: { sessionId: option.sessionId, title: option.title },
    }));
  };

  const toggleModule = (moduleId: string) => {
    setForm((current) => ({
      ...current,
      modules: current.modules.includes(moduleId)
        ? current.modules.filter((id) => id !== moduleId)
        : [...current.modules, moduleId],
    }));
  };

  const create = () => {
    if (!selected || !form.name.trim()) return;
    onCreate(selected, form);
  };

  const saveAsTemplate = () => {
    if (!form.name.trim()) return;
    const id = onSaveTemplate(form, null);
    setSelectedId(id);
  };

  const updateTemplate = () => {
    if (!selected || selected.source !== 'custom' || !form.name.trim()) return;
    onSaveTemplate(form, selected.id);
  };

  const removeTemplate = () => {
    if (!selected || selected.source !== 'custom') return;
    onDeleteTemplate(selected.id);
    const fallback = templates.find(
      (template) => template.source !== 'custom' || template.id !== selected.id,
    );
    setSelectedId(fallback?.id ?? '');
  };

  const listItem = (template: SessionTemplate, subtitle: string) => (
    <button
      key={template.id}
      type="button"
      className={`wizard-item${selected?.id === template.id ? ' active' : ''}`}
      onClick={() => setSelectedId(template.id)}
    >
      <span
        className="wizard-icon"
        style={{
          color: template.color,
          background: `${template.color}14`,
          borderColor: `${template.color}3d`,
        }}
      >
        <Icon name={template.icon} size={15} />
      </span>
      <span className="wizard-item-main">
        <strong>{template.name}</strong>
        <small>{subtitle}</small>
      </span>
      {template.source === 'custom' && <span className="wizard-custom-tag">自定义</span>}
    </button>
  );

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal wizard-modal" role="dialog" aria-modal="true" aria-label="新建会话">
        <div className="modal-head">
          <div>
            <div className="eyebrow">NEW SESSION</div>
            <h3>新建会话</h3>
            <p>从模板装配一个新角色会话；自定义模板会写入本地存档。</p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭新建会话" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="wizard-body">
          <div className="wizard-list">
            <label className="search wizard-search">
              <Icon name="search" size={13} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="筛选模板 / 场景"
                spellCheck={false}
              />
              {query && (
                <button type="button" aria-label="清空" onClick={() => setQuery('')}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </label>

            <div className="wizard-scroll">
              {builtin.length > 0 && <div className="wizard-group">内置模板</div>}
              {builtin.map((template) => listItem(template, template.role))}

              {custom.length > 0 && (
                <div className="wizard-group">
                  自定义模板 <span>{custom.length} 个</span>
                </div>
              )}
              {custom.map((template) =>
                listItem(template, `${template.scene} · ${template.modules.length} 个模块`),
              )}

              {(engineList.length > 0 || engineLoading) && (
                <div className="wizard-group">
                  引擎场景
                  <span>{engine?.ok ? `${engineList.length} 个` : engineLoading ? '读取中' : '未连接'}</span>
                </div>
              )}
              {engineList.map((template) =>
                listItem(template, `${template.scene} · ${template.description}`),
              )}

              {filtered.length === 0 && (
                <div className="wizard-empty">
                  {engineLoading ? '正在读取引擎场景…' : '没有匹配的模板。'}
                </div>
              )}
            </div>
          </div>

          <div className="wizard-config">
            {!selected ? (
              <div className="wizard-empty">先选择一个模板。</div>
            ) : (
              <>
                <div className="wizard-preview">
                  <span
                    className="identity-icon"
                    style={{
                      color: form.color,
                      background: `${form.color}14`,
                      borderColor: `${form.color}3d`,
                    }}
                  >
                    <Icon name={form.icon} size={22} />
                  </span>
                  <div>
                    <strong>{form.name || selected.name}</strong>
                    <p>{form.role || selected.role}</p>
                  </div>
                  <span className="scene-chip">
                    {selected.source === 'engine'
                      ? '引擎场景'
                      : selected.source === 'custom'
                        ? '自定义模板'
                        : '内置模板'}
                  </span>
                </div>

                <div className="wizard-fields">
                  <label>
                    <span>会话名称</span>
                    <input
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    <span>角色描述</span>
                    <input
                      value={form.role}
                      onChange={(event) => setForm({ ...form, role: event.target.value })}
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    <span>场景</span>
                    <input
                      value={form.scene}
                      onChange={(event) => setForm({ ...form, scene: event.target.value })}
                      spellCheck={false}
                    />
                  </label>
                  <p className="wizard-hint">
                    模型不再随会话创建选择，统一由 DSH 引擎侧管理。
                  </p>

                  <label className="wizard-binding">
                    <span>绑定 DSH 会话</span>
                    <select
                      value={form.harness?.sessionId ?? ''}
                      onChange={(event) => chooseHarness(event.target.value)}
                      disabled={!engine?.ok && !bindingMissing}
                    >
                      <option value="">不绑定 · 保持引擎当前会话</option>
                      {bindingMissing && form.harness && (
                        <option value={form.harness.sessionId}>
                          {form.harness.title} · 当前绑定
                        </option>
                      )}
                      {harnessOptions.map((option) => (
                        <option value={option.sessionId} key={option.sessionId}>
                          {option.scene} · {option.title}
                        </option>
                      ))}
                    </select>
                    <small>
                      {engineLoading
                        ? '正在读取引擎会话…'
                        : engine?.ok
                          ? '打开该场景的 DSH 页签或桌面盒子时，会自动切换到绑定的 Harness 会话。'
                          : '引擎未连接，暂时无法绑定会话。'}
                    </small>
                  </label>

                  <div className="wizard-identity-row">
                    <label>
                      <span>标识色</span>
                      <div className="wizard-colors">
                        {[ '#3bdeea', '#8f80ff', '#f6b64c', '#3ee0a3', '#e468d4', '#5aa9ff', '#ff8f6b', '#b6d66b' ].map(
                          (color) => (
                            <button
                              key={color}
                              type="button"
                              className={form.color === color ? 'on' : ''}
                              style={{ background: color }}
                              aria-label={`选择颜色 ${color}`}
                              onClick={() => setForm({ ...form, color })}
                            />
                          ),
                        )}
                      </div>
                    </label>
                    <label>
                      <span>标识图标</span>
                      <div className="wizard-icons">
                        {SESSION_ICONS.map((icon: IconName) => (
                          <button
                            key={icon}
                            type="button"
                            className={form.icon === icon ? 'on' : ''}
                            title={icon}
                            aria-label={`选择图标 ${icon}`}
                            onClick={() => setForm({ ...form, icon })}
                          >
                            <Icon name={icon} size={13} />
                          </button>
                        ))}
                      </div>
                    </label>
                  </div>
                </div>

                <div className="wizard-modules">
                  <div className="wizard-modules-head">
                    <span>预置模块</span>
                    <small>{form.modules.length} 个启用</small>
                  </div>
                  <div className="wizard-module-groups">
                    {MODULE_CATEGORIES.map((category) => {
                      const group = modules.filter(
                        (definition) => categoryOf(definition.manifest).id === category.id,
                      );
                      if (group.length === 0) return null;
                      return (
                        <div className="wizard-module-group" key={category.id}>
                          <div className="wizard-module-group-head">
                            <span>{category.label}</span>
                            <small>{category.hint}</small>
                          </div>
                          <div className="wizard-module-grid">
                            {group.map((definition) => {
                              const enabled = form.modules.includes(definition.manifest.id);
                              return (
                                <button
                                  key={definition.manifest.id}
                                  type="button"
                                  className={`wizard-module${enabled ? ' on' : ''}`}
                                  aria-pressed={enabled}
                                  onClick={() => toggleModule(definition.manifest.id)}
                                >
                                  <span className="wizard-module-icon">
                                    <Icon name={definition.manifest.icon} size={13} />
                                  </span>
                                  <span className="wizard-module-name">{definition.manifest.name}</span>
                                  <span className={`wizard-module-state${enabled ? ' on' : ''}`} aria-hidden="true">
                                    <Icon name="check" size={11} />
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <p className="wizard-note">
                  {selected.source === 'engine'
                    ? '创建后通过只读引用关联该引擎场景；也可以「另存为模板」把它变成可编辑的自定义模板。'
                    : selected.source === 'custom'
                      ? '修改后点击「更新模板」覆盖当前模板；模板只保存装配，不影响已创建的会话。'
                      : '创建后可在模块抽屉里随时调整装配；「另存为模板」会把当前表单保存为自定义模板。'}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="modal-foot wizard-foot">
          <span>{templates.length} 个可用模板</span>
          <span className="spacer" />
          {selected?.source === 'custom' && (
            <>
              <button type="button" className="ghost-btn danger" onClick={removeTemplate}>
                <Icon name="trash" size={13} />
                删除模板
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={updateTemplate}
                disabled={!form.name.trim()}
              >
                <Icon name="save" size={13} />
                更新模板
              </button>
            </>
          )}
          {selected && (
            <button
              type="button"
              className="ghost-btn"
              onClick={saveAsTemplate}
              disabled={!form.name.trim()}
            >
              <Icon name="tag" size={13} />
              另存为模板
            </button>
          )}
          <button type="button" className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={create}
            disabled={!selected || !form.name.trim()}
          >
            <Icon name="plus" size={13} />
            创建会话
          </button>
        </div>
      </div>
    </div>
  );
}
