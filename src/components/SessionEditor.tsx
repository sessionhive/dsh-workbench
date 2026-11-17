import { useEffect, useMemo, useState } from 'react';
import type { EngineSnapshot } from '../engine/types';
import { categoryOf, listModules, MODULE_CATEGORIES, MODULE_ORIGINS, originOf } from '../modules';
import type { ModuleInstance } from '../modules/types';
import { SESSION_ICONS, SESSION_PALETTE, type SessionConfig } from '../templates';
import type { HarnessBinding, IconName, Session } from '../types';
import { Icon } from './icons';

interface SessionEditorProps {
  session: Session;
  engine: EngineSnapshot | null;
  onSave: (patch: Partial<Session>) => void;
  onSaveTemplate: (config: SessionConfig) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function SessionEditor({
  session,
  engine,
  onSave,
  onSaveTemplate,
  onDelete,
  onClose,
}: SessionEditorProps) {
  const [confirming, setConfirming] = useState(false);
  const [form, setForm] = useState({
    name: session.name,
    role: session.role,
    scene: session.scene,
    model: session.model,
    color: session.color,
    icon: session.icon,
  });
  const [harness, setHarness] = useState<HarnessBinding | null>(session.harness ?? null);
  const [modules, setModules] = useState<ModuleInstance[]>(session.modules);

  useEffect(() => {
    setConfirming(false);
    setHarness(session.harness ?? null);
  }, [session.id, session.harness]);

  const moduleGroups = useMemo(() => {
    const registered = listModules()
      .filter((definition) =>
        definition.manifest.slots.some(
          (slot) => slot === 'center.view' || slot === 'detail.block',
        ),
      )
      .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name, 'zh'));
    return MODULE_CATEGORIES.map((category) => ({
      category,
      rows: registered
        .filter((definition) => categoryOf(definition.manifest).id === category.id)
        .map((definition) => ({
          definition,
          enabled: Boolean(
            modules.find((instance) => instance.moduleId === definition.manifest.id)?.enabled,
          ),
        })),
    })).filter((group) => group.rows.length > 0);
  }, [modules]);

  // 公开构建不注册本机扩展；存档里遗留的外部模块不计入已启用数量。
  const registeredIds = useMemo(
    () => new Set(moduleGroups.flatMap((group) => group.rows.map((row) => row.definition.manifest.id))),
    [moduleGroups],
  );
  const enabledModules = modules.filter(
    (instance) => instance.enabled && registeredIds.has(instance.moduleId),
  ).length;
  const visibleOrigins = useMemo(
    () =>
      MODULE_ORIGINS.filter((origin) =>
        moduleGroups.some((group) =>
          group.rows.some((row) => originOf(row.definition.manifest).id === origin.id),
        ),
      ),
    [moduleGroups],
  );

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
      for (const item of list) {
        if (!item.sessionId || seen.has(item.sessionId)) continue;
        seen.add(item.sessionId);
        options.push({
          sessionId: item.sessionId,
          title: item.title || scene.name,
          scene: scene.name,
        });
      }
    }
    return options;
  }, [engine]);

  const bindingMissing =
    Boolean(harness) && !harnessOptions.some((option) => option.sessionId === harness?.sessionId);

  const chooseHarness = (sessionId: string) => {
    if (!sessionId) {
      setHarness(null);
      return;
    }
    const option = harnessOptions.find((item) => item.sessionId === sessionId);
    if (option) setHarness({ sessionId: option.sessionId, title: option.title });
  };

  const toggleModule = (moduleId: string) => {
    setModules((current) => {
      const existing = current.find((instance) => instance.moduleId === moduleId);
      if (existing) {
        return current.map((instance) =>
          instance.moduleId === moduleId ? { ...instance, enabled: !instance.enabled } : instance,
        );
      }
      return [...current, { moduleId, enabled: true, order: current.length, config: {} }];
    });
  };

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

  const save = () => {
    if (!form.name.trim()) return;
    onSave({
      name: form.name.trim(),
      role: form.role.trim() || session.role,
      scene: form.scene.trim() || session.scene,
      model: form.model.trim() || session.model,
      color: form.color,
      icon: form.icon,
      modules,
      harness: harness ?? undefined,
    });
  };

  const saveAsTemplate = () => {
    if (!form.name.trim()) return;
    onSaveTemplate({
      name: form.name.trim(),
      role: form.role,
      scene: form.scene,
      model: form.model,
      color: form.color,
      icon: form.icon,
      modules: modules.filter((instance) => instance.enabled).map((instance) => instance.moduleId),
      harness,
    });
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal editor-modal" role="dialog" aria-modal="true" aria-label="编辑会话身份">
        <div className="modal-head">
          <div>
            <div className="eyebrow">SESSION SETTINGS</div>
            <h3>编辑会话</h3>
            <p>调整名称、标识与模块装配；保存后立即生效。</p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭编辑" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="modal-scroll editor-scroll">
          <div className="editor-preview">
            <span
              className="identity-icon"
              style={{
                color: form.color,
                background: `${form.color}14`,
                borderColor: `${form.color}3d`,
              }}
            >
              <Icon name={form.icon} size={24} />
            </span>
            <div>
              <strong>{form.name || '未命名会话'}</strong>
            </div>
          </div>

          <div className="wizard-fields editor-fields">
            <label>
              <span>会话名称</span>
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                spellCheck={false}
                autoFocus
              />
            </label>
            <p className="wizard-hint">角色与模型由 DSH 引擎侧管理，这里只调整会话名称与装配。</p>

            <label className="wizard-binding">
              <span>绑定 DSH 会话</span>
              <select
                value={harness?.sessionId ?? ''}
                onChange={(event) => chooseHarness(event.target.value)}
                disabled={!engine?.ok && !bindingMissing}
              >
                <option value="">不绑定 · 保持引擎当前会话</option>
                {bindingMissing && harness && (
                  <option value={harness.sessionId}>{harness.title} · 当前绑定</option>
                )}
                {harnessOptions.map((option) => (
                  <option value={option.sessionId} key={option.sessionId}>
                    {option.scene} · {option.title}
                  </option>
                ))}
              </select>
              <small>
                {engine?.ok
                  ? '打开本会话的 DSH 页签或桌面盒子时，会自动切换到绑定的 Harness 会话。'
                  : '引擎数据未连接，暂时只保留已有绑定。'}
              </small>
            </label>

            <div className="wizard-identity-row">
              <label>
                <span>标识色</span>
                <div className="wizard-colors">
                  {SESSION_PALETTE.map(
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

          <div className="editor-modules">
            <div className="wizard-modules-head">
              <span>模块装配</span>
              <div className="origin-legend" aria-label="模块来源图例">
                {visibleOrigins.map((origin) => (
                  <em key={origin.id} className={origin.id} title={origin.hint}>
                    <i />
                    {origin.short}
                  </em>
                ))}
              </div>
              <small>{enabledModules} 个启用</small>
            </div>
            <div className="wizard-module-groups">
              {moduleGroups.map(({ category, rows }) => (
                <div className="wizard-module-group" key={category.id}>
                  <div className="wizard-module-group-head">
                    <span>{category.label}</span>
                    <small>{category.hint}</small>
                  </div>
                  <div className="wizard-module-grid">
                    {rows.map(({ definition, enabled }) => {
                      const origin = originOf(definition.manifest);
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
                        <span className="wizard-module-label">
                          <span className="wizard-module-name">{definition.manifest.name}</span>
                          <span className={`origin-badge compact ${origin.id}`} title={origin.hint}>
                            {origin.short}
                          </span>
                        </span>
                        <span className={`wizard-module-state${enabled ? ' on' : ''}`} aria-hidden="true">
                          <Icon name="check" size={11} />
                        </span>
                      </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="editor-modules-note">
              这里的启停会随「保存变更」写入当前会话，与模块抽屉共享同一份装配。
            </p>
          </div>
        </div>

        <div className="modal-foot">
          {onDelete ? (
            <button
              type="button"
              className={`ghost-btn danger editor-delete${confirming ? ' confirming' : ''}`}
              onClick={() => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                onDelete();
              }}
              onBlur={() => setConfirming(false)}
            >
              <Icon name="trash" size={13} />
              {confirming ? '确认删除？' : '删除会话'}
            </button>
          ) : (
            <span className="editor-protected">中枢会话不可删除</span>
          )}
          <button
            type="button"
            className="ghost-btn editor-template"
            onClick={saveAsTemplate}
            disabled={!form.name.trim()}
            title="把当前会话的身份与模块装配保存为自定义模板"
          >
            <Icon name="tag" size={13} />
            另存为模板
          </button>
          <span className="spacer" />
          <span className="editor-save-note">修改会立即写入本地存档</span>
          <button type="button" className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary-btn" onClick={save} disabled={!form.name.trim()}>
            <Icon name="check" size={13} />
            保存变更
          </button>
        </div>
      </div>
    </div>
  );
}
