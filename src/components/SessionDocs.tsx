import { useEffect, useMemo, useState } from 'react';
import { agentPathsOf, resolveSessionScene } from '../engine/scene';
import type { EngineSnapshot } from '../engine/types';
import { useEngineDoc } from '../hooks/useEngineDoc';
import type { Session, ToastTone } from '../types';
import { Markdown } from './Markdown';
import { Icon } from './icons';

type DocTab = 'card' | 'skill' | 'summary';

interface RoleCard {
  name?: string;
  mission?: string;
  responsibilities?: string[];
  boundaries?: string[];
  status?: string;
  [key: string]: unknown;
}

function linesOf(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function CardDoc({
  root,
  relative,
  notify,
}: {
  root: string;
  relative: string;
  notify: (message: string, tone?: ToastTone) => void;
}) {
  const doc = useEngineDoc(root, relative);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: '',
    status: '',
    mission: '',
    responsibilities: '',
    boundaries: '',
  });

  const card = useMemo<RoleCard | null>(() => {
    if (!doc.text.trim()) return null;
    try {
      const parsed = JSON.parse(doc.text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as RoleCard)
        : null;
    } catch {
      return null;
    }
  }, [doc.text]);

  useEffect(() => {
    if (!card) return;
    setForm({
      name: String(card.name ?? ''),
      status: String(card.status ?? ''),
      mission: String(card.mission ?? ''),
      responsibilities: Array.isArray(card.responsibilities)
        ? card.responsibilities.join('\n')
        : '',
      boundaries: Array.isArray(card.boundaries) ? card.boundaries.join('\n') : '',
    });
  }, [card]);

  const save = async () => {
    if (!card) return;
    const next: RoleCard = {
      ...card,
      name: form.name.trim(),
      status: form.status.trim(),
      mission: form.mission.trim(),
      responsibilities: linesOf(form.responsibilities),
      boundaries: linesOf(form.boundaries),
    };
    const result = await doc.save(`${JSON.stringify(next, null, 2)}\n`);
    if (result.ok) {
      setEditing(false);
      notify('角色卡已保存', 'success');
    } else {
      notify(result.error || '角色卡保存失败', 'warn');
    }
  };

  return (
    <div className="doc-panel">
      <div className="doc-panel-head">
        <span className="doc-path" title={relative}>
          {relative}
        </span>
        <div className="doc-actions">
          <button type="button" className="icon-btn" title="重新读取" onClick={() => void doc.reload()}>
            <Icon name="refresh" size={12} />
          </button>
          {card && (
            <button
              type="button"
              className={`doc-edit${editing ? ' on' : ''}`}
              onClick={() => setEditing((value) => !value)}
            >
              <Icon name="pen" size={11} />
              {editing ? '预览' : '编辑'}
            </button>
          )}
        </div>
      </div>

      {doc.loading && <div className="doc-state">正在读取角色卡…</div>}
      {!doc.loading && doc.error && <div className="doc-state warn">{doc.error}</div>}
      {!doc.loading && !doc.error && !card && (
        <div className="doc-state">角色卡不存在或不是合法 JSON。</div>
      )}

      {card && !editing && (
        <div className="role-card">
          <div className="role-card-head">
            <strong>{card.name || '未命名角色'}</strong>
            {card.status && <span className="role-status">{card.status}</span>}
          </div>
          {card.mission && <p className="role-mission">{card.mission}</p>}
          {Array.isArray(card.responsibilities) && card.responsibilities.length > 0 && (
            <div className="role-section">
              <span>职责</span>
              <ul>
                {card.responsibilities.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(card.boundaries) && card.boundaries.length > 0 && (
            <div className="role-section">
              <span>边界</span>
              <ul>
                {card.boundaries.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {card && editing && (
        <div className="doc-editor">
          <div className="doc-editor-grid">
            <label>
              <span>名称</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>
              <span>状态</span>
              <input
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value })}
              />
            </label>
          </div>
          <label>
            <span>使命</span>
            <textarea
              rows={3}
              value={form.mission}
              onChange={(event) => setForm({ ...form, mission: event.target.value })}
            />
          </label>
          <label>
            <span>职责（每行一条）</span>
            <textarea
              rows={4}
              value={form.responsibilities}
              onChange={(event) => setForm({ ...form, responsibilities: event.target.value })}
            />
          </label>
          <label>
            <span>边界（每行一条）</span>
            <textarea
              rows={3}
              value={form.boundaries}
              onChange={(event) => setForm({ ...form, boundaries: event.target.value })}
            />
          </label>
          <div className="doc-editor-foot">
            <button type="button" className="ghost-btn" onClick={() => setEditing(false)}>
              取消
            </button>
            <button type="button" className="primary-btn" onClick={() => void save()} disabled={doc.saving}>
              <Icon name="check" size={12} />
              {doc.saving ? '保存中' : '保存角色卡'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillDoc({
  root,
  relative,
  notify,
}: {
  root: string;
  relative: string;
  notify: (message: string, tone?: ToastTone) => void;
}) {
  const doc = useEngineDoc(root, relative);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!editing) setDraft(doc.text);
  }, [doc.text, editing]);

  const save = async () => {
    const result = await doc.save(draft);
    if (result.ok) {
      setEditing(false);
      notify('技能已保存', 'success');
    } else {
      notify(result.error || '技能保存失败', 'warn');
    }
  };

  return (
    <div className="doc-panel">
      <div className="doc-panel-head">
        <span className="doc-path" title={relative}>
          {relative}
        </span>
        <div className="doc-actions">
          <button type="button" className="icon-btn" title="重新读取" onClick={() => void doc.reload()}>
            <Icon name="refresh" size={12} />
          </button>
          <button
            type="button"
            className={`doc-edit${editing ? ' on' : ''}`}
            onClick={() => setEditing((value) => !value)}
          >
            <Icon name="pen" size={11} />
            {editing ? '预览' : '编辑'}
          </button>
        </div>
      </div>

      {doc.loading && <div className="doc-state">正在读取技能…</div>}
      {!doc.loading && doc.error && <div className="doc-state warn">{doc.error}</div>}
      {!doc.loading && !doc.error && !editing && (
        <Markdown text={doc.text} empty="该场景还没有技能文件。" className="doc-markdown" />
      )}
      {!doc.loading && !doc.error && editing && (
        <div className="doc-editor">
          <textarea
            className="doc-raw"
            rows={12}
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="doc-editor-foot">
            <span className="doc-limit">上限 32KB · 保存后引擎下一轮读取</span>
            <span className="spacer" />
            <button type="button" className="ghost-btn" onClick={() => setEditing(false)}>
              取消
            </button>
            <button type="button" className="primary-btn" onClick={() => void save()} disabled={doc.saving}>
              <Icon name="check" size={12} />
              {doc.saving ? '保存中' : '保存技能'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryDoc({ root, relative }: { root: string; relative: string }) {
  const doc = useEngineDoc(root, relative);
  return (
    <div className="doc-panel">
      <div className="doc-panel-head">
        <span className="doc-path" title={relative}>
          {relative}
        </span>
        <div className="doc-actions">
          <span className="doc-readonly">只读</span>
          <button type="button" className="icon-btn" title="重新读取" onClick={() => void doc.reload()}>
            <Icon name="refresh" size={12} />
          </button>
        </div>
      </div>
      {doc.loading && <div className="doc-state">正在读取上一轮总结…</div>}
      {!doc.loading && doc.error && <div className="doc-state warn">{doc.error}</div>}
      {!doc.loading && !doc.error && (
        <Markdown text={doc.text} empty="还没有 summary.md。" className="doc-markdown" />
      )}
    </div>
  );
}

interface SessionDocsProps {
  session: Session;
  engine: EngineSnapshot | null;
  root: string;
  notify: (message: string, tone?: ToastTone) => void;
}

/** 会话详情里的引擎文档：角色卡 / 技能 / 上一轮总结。 */
export function SessionDocs({ session, engine, root, notify }: SessionDocsProps) {
  const [tab, setTab] = useState<DocTab>('card');
  const scene = useMemo(() => resolveSessionScene(session, engine), [engine, session]);
  const paths = useMemo(() => (scene ? agentPathsOf(scene) : null), [scene]);

  useEffect(() => {
    setTab('card');
  }, [session.id]);

  return (
    <div className="session-docs">
      <div className="doc-tabs" role="tablist" aria-label="引擎文档">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'card'}
          className={tab === 'card' ? 'on' : ''}
          onClick={() => setTab('card')}
        >
          角色卡
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'skill'}
          className={tab === 'skill' ? 'on' : ''}
          onClick={() => setTab('skill')}
        >
          技能
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'summary'}
          className={tab === 'summary' ? 'on' : ''}
          onClick={() => setTab('summary')}
        >
          上一轮总结
        </button>
        <span className="doc-tabs-spacer" />
        {scene && <span className="doc-scene">{scene.name}</span>}
      </div>

      {!scene || !paths ? (
        <div className="doc-empty">
          <Icon name="database" size={18} />
          <p>中枢调度没有绑定引擎场景，角色卡、技能和总结只对场景会话可用。</p>
        </div>
      ) : tab === 'card' ? (
        <CardDoc key={`card-${paths.card}`} root={root} relative={paths.card} notify={notify} />
      ) : tab === 'skill' && paths.skill ? (
        <SkillDoc key={`skill-${paths.skill}`} root={root} relative={paths.skill} notify={notify} />
      ) : tab === 'skill' ? (
        <div className="doc-empty">
          <p>该场景没有登记技能目录。</p>
        </div>
      ) : (
        <SummaryDoc key={`summary-${paths.summary}`} root={root} relative={paths.summary} />
      )}
    </div>
  );
}
