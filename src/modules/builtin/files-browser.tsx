import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../components/icons';
import type { FileEntry, FileListing, FilePreviewResult } from '../../engine/types';
import type { ToastTone } from '../../types';
import { useModuleState } from '../state';
import type { ModuleDefinition } from '../types';

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileGlyph(entry: FileEntry) {
  if (entry.type === 'dir') return '▸';
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'css', 'html', 'cjs', 'mjs'].includes(entry.ext)) return '{ }';
  if (['md', 'txt', 'log'].includes(entry.ext)) return '¶';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(entry.ext)) return '◫';
  return '·';
}

function absolutePath(root: string, relative: string) {
  if (!relative || relative === '.') return root;
  const separator = window.desktop?.platform === 'win32' ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${separator}${relative.split('/').join(separator)}`;
}

function folderName(root: string) {
  return root.split(/[\\/]+/).filter(Boolean).pop() ?? '根目录';
}

interface FilesState {
  /** 场景固定目录（相对浏览根目录）；空字符串表示未固定。 */
  pinned: string;
}

interface FilesBrowserProps {
  /** 浏览边界；文件工作台可以返回上级，但不会越过这里。 */
  root: string;
  /** 首次打开的默认目录，通常是设置里的工具目录。 */
  preferredPath: string;
  notify: (message: string, tone?: ToastTone) => void;
}

function FilesBrowser({ root, preferredPath, notify }: FilesBrowserProps) {
  const [state, setState] = useModuleState<FilesState>({ pinned: '' });
  const pinned = typeof state?.pinned === 'string' ? state.pinned : '';
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  const [relative, setRelative] = useState('.');
  const [listing, setListing] = useState<FileListing | null>(null);
  const [preview, setPreview] = useState<FilePreviewResult | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 预览请求序号：快速点两个文件时只接受最后一次的结果。 */
  const previewSeqRef = useRef(0);
  /** 当前选中文件的最新值；保存期间切走文件时用来丢弃过期的界面更新。 */
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const load = useCallback(
    async (nextRelative: string) => {
      if (!root || !window.desktop) return false;
      previewSeqRef.current += 1;
      setLoading(true);
      let result: FileListing;
      try {
        result = await window.desktop.listDirectory(root, nextRelative);
      } catch (error) {
        result = {
          ok: false,
          root,
          relative: nextRelative,
          entries: [],
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        setLoading(false);
      }
      if (!result.ok) {
        setListing(result);
        setHint(`无法读取目录：${result.error ?? '未知错误'}`);
        return false;
      }
      setListing(result);
      setHint('');
      setRelative(nextRelative);
      setPreview(null);
      setSelected('');
      setEditing(false);
      setDraft('');
      setDirty(false);
      return true;
    },
    [root],
  );

  // 进入场景时优先回到固定目录；没有固定就落在工具目录；都不可用时退回根目录。
  useEffect(() => {
    let alive = true;
    setReady(false);
    setHint('');
    const start = async () => {
      if (!root || !window.desktop) {
        setReady(true);
        return;
      }
      const pinnedTarget = pinnedRef.current;
      if (pinnedTarget) {
        const ok = await load(pinnedTarget);
        if (!alive) return;
        if (ok) {
          setReady(true);
          return;
        }
        setHint('固定目录已不可用，已回到默认目录。');
      }
      if (preferredPath) {
        const resolved = await window.desktop.resolvePath(root, preferredPath);
        if (!alive) return;
        if (resolved.ok && resolved.relative) {
          const ok = await load(resolved.relative);
          if (!alive) return;
          if (ok) {
            setReady(true);
            return;
          }
        } else {
          setHint('工具目录不在浏览根目录内，已从根目录打开。');
        }
      }
      await load('.');
      if (!alive) return;
      setReady(true);
    };
    void start();
    return () => {
      alive = false;
    };
  }, [load, preferredPath, root]);

  const confirmDiscard = () =>
    !dirty || window.confirm('当前文件有未保存的修改，确定放弃吗？');

  const goTo = (next: string) => {
    if (!confirmDiscard()) return;
    void load(next);
  };

  const openEntry = async (entry: FileEntry) => {
    const next = relative === '.' ? entry.name : `${relative}/${entry.name}`;
    if (entry.type === 'dir') {
      goTo(next);
      return;
    }
    if (next === selected) return;
    if (!confirmDiscard()) return;
    if (!window.desktop) return;

    setSelected(next);
    setEditing(false);
    setDraft('');
    setDirty(false);
    const seq = ++previewSeqRef.current;
    let result: FilePreviewResult;
    try {
      result = await window.desktop.previewFile(root, next);
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    // 快速连点两个文件时，只让最后一次预览落到界面。
    if (seq !== previewSeqRef.current) return;
    setPreview(result);
    if (result.ok && !result.binary && !result.truncated) setDraft(result.text ?? '');
  };

  const goUp = () => {
    if (relative === '.' || !relative) return;
    const parts = relative.split('/').filter(Boolean);
    parts.pop();
    goTo(parts.length ? parts.join('/') : '.');
  };

  const startEdit = () => {
    if (!preview?.ok || preview.binary || preview.truncated) return;
    setDraft(preview.text ?? '');
    setDirty(false);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDirty(false);
    setDraft(preview?.text ?? '');
  };

  const save = async () => {
    if (!window.desktop || !selected || !editing || saving) return;
    const target = selected;
    setSaving(true);
    try {
      const result = await window.desktop.writeFile(root, target, draft);
      if (!result.ok) {
        notify(`保存失败：${result.error ?? '未知错误'}`, 'warn');
        return;
      }
      notify(`已保存 ${target.split('/').pop()}`, 'success');
      // 保存期间已经切到别的文件：不要用旧草稿覆盖新文件的预览。
      if (selectedRef.current !== target) return;
      setPreview((current) =>
        current ? { ...current, text: draft, size: result.size ?? current.size } : current,
      );
      setEditing(false);
      setDirty(false);
    } catch (error) {
      notify(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'warn');
    } finally {
      setSaving(false);
    }
  };

  const copyPath = async (targetRelative: string) => {
    if (!targetRelative) return;
    const target = absolutePath(root, targetRelative);
    const label = targetRelative === relative ? '目录' : '文件';
    try {
      if (window.desktop) {
        const result = await window.desktop.copyText(target);
        if (!result.ok) {
          notify(result.error ?? '复制失败，请检查剪贴板权限', 'warn');
          return;
        }
      } else {
        await navigator.clipboard.writeText(target);
      }
      notify(`已复制${label}路径`, 'success');
    } catch {
      notify('复制失败，请检查剪贴板权限', 'warn');
    }
  };

  /** 图钉绑定的是当前目录；再点一次解除，下次打开回到默认入口。 */
  const togglePin = () => {
    const active = pinned === relative;
    setState({ pinned: active ? '' : relative });
    notify(
      active
        ? '已解除目录固定 · 下次打开回到工具目录'
        : `已固定当前目录${relative === '.' ? '（根目录）' : `：${relative}`} · 下次打开自动恢复`,
      active ? 'info' : 'success',
    );
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  };

  const rootLabel = folderName(root);
  const breadcrumb = relative === '.' ? [rootLabel] : [rootLabel, ...relative.split('/').filter(Boolean)];
  const editable = Boolean(preview?.ok && !preview.binary && !preview.truncated);
  const pinnedHere = pinned === relative;

  return (
    <div className="files-view">
      <div className="files-toolbar">
        <button type="button" className="icon-btn" onClick={goUp} disabled={relative === '.'} title="上一级">
          <Icon name="arrowLeft" size={14} />
        </button>
        <button type="button" className="icon-btn" onClick={() => goTo(relative)} title="刷新">
          <Icon name="refresh" size={14} />
        </button>
        <div className="files-path" title={absolutePath(root, relative)}>
          {breadcrumb.map((part, index) => (
            <span key={`${part}-${index}`}>
              {index > 0 && <i>/</i>}
              <button
                type="button"
                onClick={() => {
                  if (index === 0) goTo('.');
                  else goTo(breadcrumb.slice(1, index + 1).join('/'));
                }}
              >
                {part}
              </button>
            </span>
          ))}
        </div>
        {pinned && !pinnedHere && (
          <button
            type="button"
            className="ghost-btn files-action files-pin-jump"
            title="回到这个场景固定的目录"
            onClick={() => goTo(pinned)}
          >
            <Icon name="pin" size={12} />
            回固定
          </button>
        )}
        <button
          type="button"
          className={`ghost-btn files-action files-pin${pinnedHere ? ' on' : ''}`}
          disabled={!root}
          aria-pressed={pinnedHere}
          title={pinnedHere ? '解除目录固定' : '固定当前目录到本场景'}
          onClick={togglePin}
        >
          <Icon name="pin" size={12} />
          {pinnedHere ? '已固定' : '固定目录'}
        </button>
        <button
          type="button"
          className="ghost-btn files-action"
          disabled={!root}
          title={selected ? '复制选中文件的完整路径' : '复制当前目录的完整路径'}
          onClick={() => void copyPath(selected || relative)}
        >
          <Icon name="copy" size={12} />
          复制路径
        </button>
        {window.desktop && (
          <button
            type="button"
            className="icon-btn"
            title="在资源管理器中打开"
            onClick={() => window.desktop?.openPath(absolutePath(root, relative))}
          >
            <Icon name="arrowUpRight" size={14} />
          </button>
        )}
      </div>

      {hint && (
        <div className="files-hint">
          <Icon name="alert" size={12} />
          {hint}
        </div>
      )}

      {!root ? (
        <div className="files-empty">
          尚未配置文件浏览根目录，请在设置「引擎」页签里选择。
        </div>
      ) : !ready ? (
        <div className="files-empty">正在定位目录…</div>
      ) : (
        <div className="files-split">
          <div className="files-list">
            {loading && <div className="files-loading">读取中…</div>}
            {!loading && listing?.ok && listing.entries.length === 0 && (
              <div className="files-empty">这个目录是空的。</div>
            )}
            {!loading &&
              listing?.entries.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  className={`files-row${
                    selected === (relative === '.' ? entry.name : `${relative}/${entry.name}`)
                      ? ' selected'
                      : ''
                  }`}
                  onClick={() => void openEntry(entry)}
                >
                  <span className={`files-glyph ${entry.type}`}>{fileGlyph(entry)}</span>
                  <span className="files-name">{entry.name}</span>
                  {entry.type === 'file' && <span className="files-size">{formatSize(entry.size)}</span>}
                  {entry.type === 'dir' && <span className="files-size">目录</span>}
                </button>
              ))}
            {!loading && listing && !listing.ok && (
              <div className="files-empty">读取失败：{listing.error}</div>
            )}
          </div>

          <div className="files-preview">
            {!selected && <div className="files-empty">选择左侧文件查看内容。</div>}
            {selected && (
              <>
                <div className="files-preview-head">
                  <div className="files-preview-title">
                    <span>{selected.split('/').pop()}</span>
                    {dirty && <em>未保存</em>}
                    <small>{preview?.size != null ? formatSize(preview.size) : ''}</small>
                  </div>
                  <div className="files-preview-actions">
                    {editable && !editing && (
                      <button type="button" className="ghost-btn files-action" onClick={startEdit}>
                        <Icon name="pen" size={12} />
                        编辑
                      </button>
                    )}
                    {editing && (
                      <>
                        <button
                          type="button"
                          className="ghost-btn files-action"
                          onClick={cancelEdit}
                          disabled={saving}
                        >
                          <Icon name="x" size={12} />
                          取消
                        </button>
                        <button
                          type="button"
                          className="primary-btn files-action"
                          onClick={() => void save()}
                          disabled={saving || !dirty}
                          title="Ctrl S 保存"
                        >
                          <Icon name="save" size={12} />
                          {saving ? '保存中' : '保存'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {editing ? (
                  <textarea
                    className="files-editor"
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setDirty(event.target.value !== (preview?.text ?? ''));
                    }}
                    onKeyDown={onEditorKeyDown}
                    spellCheck={false}
                    autoFocus
                  />
                ) : preview?.ok ? (
                  preview.binary ? (
                    <div className="files-empty">二进制文件，暂不预览。</div>
                  ) : (
                    <>
                      <pre>{preview.text}</pre>
                      {preview.truncated && (
                        <div className="files-truncated">仅显示前 200KB，文件较大，编辑已禁用。</div>
                      )}
                    </>
                  )
                ) : (
                  <div className="files-empty">{preview?.error || '预览失败'}</div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 文件工作台：从工具目录进入，可向上返回，可把目录固定到当前场景。 */
export const filesBrowserModule: ModuleDefinition = {
  manifest: {
    id: 'files.browser',
    name: '文件工作台',
    version: '0.3.0',
    description: '浏览文件浏览根目录下的文件，预览、编辑并保存文本文件，可把当前目录固定到场景。',
    icon: 'folder',
    kind: ['view', 'tool'],
    slots: ['center.view'],
    category: 'workspace',
    permissions: ['fs:read', 'fs:write'],
    persistState: true,
  },
  center: {
    tabLabel: '文件',
    title: '文件工作台',
    subtitle: ({ sessionCount }) => `工具目录起步 · 可返回上级 · 当前 ${sessionCount} 个会话共享`,
  },
  View: ({ settings, actions }) => (
    <FilesBrowser
      root={settings.engine.filesRoot || settings.engine.workspacePath}
      preferredPath={settings.engine.toolsPath}
      notify={actions.notify}
    />
  ),
};
