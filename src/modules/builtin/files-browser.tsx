import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icons';
import { Markdown } from '../../components/Markdown';
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

function normalizeAbsolute(value: string) {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** 返回上一级绝对目录；已经是盘符 / 文件系统根目录时返回空串。 */
function parentDirectory(target: string) {
  const normalized = normalizeAbsolute(target);
  if (!normalized || /^[A-Za-z]:$/.test(normalized)) return '';
  const index = normalized.lastIndexOf('/');
  if (index < 0) return '';
  if (index === 0) return '/';
  const head = normalized.slice(0, index);
  return /^[A-Za-z]:$/.test(head) ? `${head}/` : head;
}

/** 把绝对路径拆成浏览根目录 + 相对路径，交给现有的 fs IPC 通道。 */
function splitAbsolute(target: string) {
  const normalized = target.replace(/\\/g, '/');
  const drive = /^([A-Za-z]:)\/?/.exec(normalized);
  if (drive) {
    const rest = normalized.slice(drive[0].length).replace(/^\/+/, '');
    return {
      root: `${drive[1]}${window.desktop?.platform === 'win32' ? '\\' : '/'}`,
      relative: rest || '.',
    };
  }
  return { root: '/', relative: normalized.replace(/^\/+/, '') || '.' };
}

function isAbsolutePath(value: string) {
  return /^(?:[A-Za-z]:[\\/]|[\\/])/.test(value);
}

/** 预览方式：Markdown 渲染成稿，HTML 按页面渲染，其余文本仍显示原文。 */
function previewMode(name: string) {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (extension === 'html' || extension === 'htm') return 'html';
  return 'text';
}

function fileUrl(target: string) {
  return encodeURI(`file:///${target.replace(/\\/g, '/').replace(/^\/+/, '')}`);
}

/** 面包屑覆盖整条绝对路径，盘符以上不能再返回。 */
function pathCrumbs(absolute: string) {
  const normalized = absolute.replace(/\\/g, '/');
  const drive = /^([A-Za-z]:)/.exec(normalized);
  const body = drive ? normalized.slice(2) : normalized;
  const parts = body.split('/').filter(Boolean);
  const crumbs = drive
    ? [{ label: drive[1], absolute: `${drive[1]}/` }]
    : [{ label: '/', absolute: '/' }];
  parts.forEach((label, index) => {
    const prefix = `/${parts.slice(0, index + 1).join('/')}`;
    crumbs.push({ label, absolute: drive ? `${drive[1]}${prefix}` : prefix });
  });
  return crumbs;
}

const DEFAULT_SPLIT_X = 0.34;
const MIN_SPLIT_X = 0.18;
const MAX_SPLIT_X = 0.66;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

interface RecentFile {
  /** 绝对路径；切换目录后仍能定位。 */
  path: string;
  name: string;
  at: number;
}

interface FilesState {
  /** 会话固定目录；新值为绝对路径，旧存档里的相对路径按浏览根目录解释。 */
  pinned: string;
  /** 左栏宽度占整个文件工作区的比例。 */
  splitX: number;
  /** 左栏底部「最近打开」；按打开时间倒序，最多 6 条。 */
  recent: RecentFile[];
}

interface FilesBrowserProps {
  /** 起始浏览根目录；可以继续返回上级，直到盘符根目录。 */
  root: string;
  /** 首次打开的默认目录，通常是设置里的工具目录。 */
  preferredPath: string;
  notify: (message: string, tone?: ToastTone) => void;
}

function FilesBrowser({ root, preferredPath, notify }: FilesBrowserProps) {
  const [state, setState] = useModuleState<FilesState>({
    pinned: '',
    splitX: DEFAULT_SPLIT_X,
    recent: [],
  });
  const pinned = typeof state?.pinned === 'string' ? state.pinned : '';
  const recent = Array.isArray(state?.recent)
    ? state.recent.filter(
        (item): item is RecentFile =>
          Boolean(item) && typeof item.path === 'string' && typeof item.name === 'string',
      )
    : [];
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  const splitX = clamp(
    Number(state?.splitX ?? DEFAULT_SPLIT_X),
    MIN_SPLIT_X,
    MAX_SPLIT_X,
  );

  const baseState = useCallback(
    (previous: FilesState | undefined): FilesState => ({
      pinned: typeof previous?.pinned === 'string' ? previous.pinned : '',
      splitX:
        typeof previous?.splitX === 'number' && Number.isFinite(previous.splitX)
          ? previous.splitX
          : DEFAULT_SPLIT_X,
      recent: Array.isArray(previous?.recent)
        ? previous.recent
            .filter(
              (item): item is RecentFile =>
                Boolean(item) && typeof item.path === 'string' && typeof item.name === 'string',
            )
            .slice(0, 6)
        : [],
    }),
    [],
  );

  const [baseRoot, setBaseRoot] = useState(root);
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
  const [creating, setCreating] = useState<'dir' | 'file' | null>(null);
  const [createName, setCreateName] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
    relative: string;
  } | null>(null);
  /** 菜单里的删除按钮第一次点击只切到「再次点击确认」，第二次才真正删除。 */
  const [menuConfirm, setMenuConfirm] = useState(false);
  const [liveSplit, setLiveSplit] = useState<number | null>(null);
  const liveSplitRef = useRef<number | null>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const renderedSplit = clamp(liveSplit ?? splitX, MIN_SPLIT_X, MAX_SPLIT_X);
  /** 预览请求序号：快速点两个文件时只接受最后一次的结果。 */
  const previewSeqRef = useRef(0);
  /** 当前选中文件的最新值；保存期间切走文件时用来丢弃过期的界面更新。 */
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const load = useCallback(
    async (nextRelative: string, nextRoot: string) => {
      if (!nextRoot || !window.desktop) return false;
      previewSeqRef.current += 1;
      setLoading(true);
      let result: FileListing;
      try {
        result = await window.desktop.listDirectory(nextRoot, nextRelative);
      } catch (error) {
        result = {
          ok: false,
          root: nextRoot,
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
      setBaseRoot(nextRoot);
      setRelative(nextRelative);
      setPreview(null);
      setSelected('');
      setEditing(false);
      setDraft('');
      setDirty(false);
      return true;
    },
    [],
  );

  // 进入会话时优先回到固定目录；没有固定就落在工具目录；都不可用时退回根目录。
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
        const target = isAbsolutePath(pinnedTarget) ? splitAbsolute(pinnedTarget) : { root, relative: pinnedTarget };
        const ok = await load(target.relative, target.root);
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
          const ok = await load(resolved.relative, root);
          if (!alive) return;
          if (ok) {
            setReady(true);
            return;
          }
        } else {
          setHint('工具目录不在浏览根目录内，已从根目录打开。');
        }
      }
      const ok = await load('.', root);
      if (!alive) return;
      if (!ok) setBaseRoot(root);
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
    void load(next, baseRoot);
  };

  /** 跳到任意绝对目录：允许越过工作目录，但不会越过盘符根目录。 */
  const goToAbsolute = (target: string) => {
    if (!confirmDiscard()) return;
    const next = splitAbsolute(target);
    void load(next.relative, next.root);
  };

  /** 记录最近打开；同一文件只保留一条，最多 6 条。 */
  const rememberRecent = (path: string, name: string) => {
    setState((previous) => {
      const base = baseState(previous);
      const normalized = normalizeAbsolute(path);
      const next = [
        { path, name, at: Date.now() },
        ...base.recent.filter((item) => normalizeAbsolute(item.path) !== normalized),
      ].slice(0, 6);
      return { ...base, recent: next };
    });
  };

  const forgetRecent = (path: string) => {
    const normalized = normalizeAbsolute(path);
    setState((previous) => {
      const base = baseState(previous);
      return {
        ...base,
        recent: base.recent.filter((item) => normalizeAbsolute(item.path) !== normalized),
      };
    });
  };

  /** 预览指定根目录下的文件，并刷新选中态与最近打开。 */
  const previewFileAt = async (rootValue: string, next: string) => {
    if (!window.desktop) return null;
    setSelected(next);
    setEditing(false);
    setDraft('');
    setDirty(false);
    const seq = ++previewSeqRef.current;
    let result: FilePreviewResult;
    try {
      result = await window.desktop.previewFile(rootValue, next);
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    // 快速连点两个文件时，只让最后一次预览落到界面。
    if (seq !== previewSeqRef.current) return result;
    setPreview(result);
    if (result.ok && !result.binary && !result.truncated) {
      setDraft(result.text ?? '');
      rememberRecent(absolutePath(rootValue, next), next.split('/').pop() ?? next);
    }
    return result;
  };

  const openEntry = async (entry: FileEntry) => {
    const next = relative === '.' ? entry.name : `${relative}/${entry.name}`;
    if (entry.protected) {
      notify(entry.type === 'dir' ? '受保护的引擎目录不可浏览' : '受保护的引擎文件不可预览', 'warn');
      return;
    }
    if (entry.type === 'dir') {
      goTo(next);
      return;
    }
    if (next === selected) return;
    if (!confirmDiscard()) return;
    await previewFileAt(baseRoot, next);
  };

  /** 从「最近打开」跳回文件：先切到父目录，再预览。 */
  const openRecent = async (item: RecentFile) => {
    if (!confirmDiscard()) return;
    const target = splitAbsolute(item.path);
    const parentRelative =
      target.relative === '.'
        ? '.'
        : target.relative.split('/').slice(0, -1).join('/') || '.';
    const ok = await load(parentRelative, target.root);
    if (!ok) {
      forgetRecent(item.path);
      notify('文件已不存在或不可访问，已从最近打开移除', 'warn');
      return;
    }
    const result = await previewFileAt(target.root, target.relative);
    if (result && !result.ok) {
      forgetRecent(item.path);
      notify(`无法打开：${result.error ?? '未知错误'}`, 'warn');
    }
  };

  const startCreate = (kind: 'dir' | 'file') => {
    if (!confirmDiscard()) return;
    setCreating(kind);
    setCreateName('');
  };

  const cancelCreate = () => {
    if (createBusy) return;
    setCreating(null);
    setCreateName('');
  };

  const submitCreate = async () => {
    if (!creating || createBusy || !window.desktop) return;
    const name = createName.trim();
    if (!name) {
      cancelCreate();
      return;
    }
    const kind = creating;
    setCreateBusy(true);
    try {
      const result =
        kind === 'dir'
          ? await window.desktop.createDirectory(baseRoot, relative, name)
          : await window.desktop.createFile(baseRoot, relative, name);
      if (!result.ok) {
        notify(`${kind === 'dir' ? '新建目录' : '新建文件'}失败：${result.error ?? '未知错误'}`, 'warn');
        return;
      }
      setCreating(null);
      setCreateName('');
      const ok = await load(relative, baseRoot);
      if (ok && kind === 'file' && result.relative) {
        await previewFileAt(baseRoot, result.relative);
      }
      notify(kind === 'dir' ? `已新建目录 ${name}` : `已新建文件 ${name}`, 'success');
    } catch (error) {
      notify(
        `${kind === 'dir' ? '新建目录' : '新建文件'}失败：${
          error instanceof Error ? error.message : String(error)
        }`,
        'warn',
      );
    } finally {
      setCreateBusy(false);
    }
  };

  /** 右键菜单：只对当前目录里的普通条目开放，受保护条目直接拦掉。 */
  const openMenu = (event: ReactMouseEvent, entry: FileEntry, entryRelative: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (entry.protected) {
      notify('受保护的引擎条目不可删除', 'warn');
      return;
    }
    setMenuConfirm(false);
    setMenu({ x: event.clientX, y: event.clientY, entry, relative: entryRelative });
  };

  const closeMenu = () => {
    setMenu(null);
    setMenuConfirm(false);
  };

  const removeEntry = async (entry: FileEntry, entryRelative: string) => {
    closeMenu();
    if (!window.desktop) return;
    if (entry.protected) {
      notify('受保护的引擎条目不可删除', 'warn');
      return;
    }
    const name = entryRelative.split('/').pop() ?? entry.name;
    const targetAbsolute = absolutePath(baseRoot, entryRelative);
    let result: { ok: boolean; error?: string };
    try {
      result = await window.desktop.removePath(baseRoot, entryRelative);
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (!result.ok) {
      notify(`删除失败：${result.error ?? '未知错误'}`, 'warn');
      return;
    }
    // 清掉落在被删目录里的固定入口和最近打开记录。
    const targetKey = normalizeAbsolute(targetAbsolute);
    const under = (value: string) => {
      const normalized = normalizeAbsolute(value);
      return normalized === targetKey || normalized.startsWith(`${targetKey}/`);
    };
    setState((previous) => {
      const base = baseState(previous);
      const pinnedAbsolute = base.pinned
        ? isAbsolutePath(base.pinned)
          ? base.pinned
          : absolutePath(baseRoot, base.pinned)
        : '';
      return {
        ...base,
        pinned: pinnedAbsolute && under(pinnedAbsolute) ? '' : base.pinned,
        recent: base.recent.filter((item) => !under(item.path)),
      };
    });
    await load(relative, baseRoot);
    notify(`已删除${entry.type === 'dir' ? '目录' : '文件'} ${name}`, 'success');
  };

  // 右键菜单打开时，Esc、失焦、窗口尺寸变化都关闭，避免浮层留在屏幕上。
  useEffect(() => {
    if (!menu) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
        setMenuConfirm(false);
      }
    };
    const close = () => {
      setMenu(null);
      setMenuConfirm(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  const parent = parentDirectory(baseRoot);
  const canGoUp = relative !== '.' || Boolean(parent);

  const goUp = () => {
    if (!confirmDiscard()) return;
    if (relative !== '.' && relative) {
      const parts = relative.split('/').filter(Boolean);
      parts.pop();
      void load(parts.length ? parts.join('/') : '.', baseRoot);
      return;
    }
    if (parent) void load('.', parent);
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
      const result = await window.desktop.writeFile(baseRoot, target, draft);
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

  const currentAbsolute = absolutePath(baseRoot, relative);

  const copyPath = async (targetRelative: string) => {
    if (!targetRelative) return;
    const target = absolutePath(baseRoot, targetRelative);
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

  const pinnedTarget = pinned
    ? isAbsolutePath(pinned)
      ? pinned
      : absolutePath(root, pinned)
    : '';
  const pinnedHere =
    Boolean(pinnedTarget) &&
    normalizeAbsolute(pinnedTarget) === normalizeAbsolute(currentAbsolute);

  /** 图钉绑定当前绝对目录；再点一次解除，下次打开回到默认入口。 */
  const togglePin = () => {
    setState((previous) => ({ ...baseState(previous), pinned: pinnedHere ? '' : currentAbsolute }));
    notify(
      pinnedHere
        ? '已解除目录固定 · 下次打开回到工具目录'
        : `已固定当前目录：${currentAbsolute} · 下次打开自动恢复`,
      pinnedHere ? 'info' : 'success',
    );
  };

  const startSplit = (event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const apply = (value: number) => {
      const next = clamp(value, MIN_SPLIT_X, MAX_SPLIT_X);
      liveSplitRef.current = next;
      setLiveSplit(next);
    };
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      apply((moveEvent.clientX - rect.left) / rect.width);
    };
    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('files-splitting');
      document.body.style.cursor = '';
      const settled = liveSplitRef.current;
      liveSplitRef.current = null;
      setLiveSplit(null);
      if (settled != null) {
        setState((previous) => ({ ...baseState(previous), splitX: settled }));
      }
    };
    document.body.classList.add('files-splitting');
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
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

  const crumbs = useMemo(() => pathCrumbs(currentAbsolute), [currentAbsolute]);
  const editable = Boolean(preview?.ok && !preview.binary && !preview.truncated);
  const selectedName = selected.split('/').pop() ?? '';
  const selectedMode = previewMode(selectedName);
  const selectedAbsolute = selected ? absolutePath(baseRoot, selected) : '';
  const renderRichPreview = Boolean(
    preview?.ok && !preview.binary && !preview.truncated && selectedMode !== 'text',
  );

  return (
    <div className="files-view">
      <div className="files-toolbar">
        <button
          type="button"
          className="icon-btn"
          onClick={goUp}
          disabled={!canGoUp}
          title={canGoUp ? '上一级（可越过工作目录）' : '已经到达盘符根目录'}
        >
          <Icon name="arrowLeft" size={14} />
        </button>
        <button type="button" className="icon-btn" onClick={() => goTo(relative)} title="刷新">
          <Icon name="refresh" size={14} />
        </button>
        <div className="files-path" title={currentAbsolute}>
          {crumbs.map((part, index) => (
            <span key={part.absolute}>
              {index > 0 && <i>/</i>}
              <button type="button" onClick={() => goToAbsolute(part.absolute)}>
                {part.label}
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          className="icon-btn"
          title="新建目录"
          aria-label="新建目录"
          disabled={!root || !ready || createBusy}
          onClick={() => startCreate('dir')}
        >
          <Icon name="folderPlus" size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="新建文件"
          aria-label="新建文件"
          disabled={!root || !ready || createBusy}
          onClick={() => startCreate('file')}
        >
          <Icon name="filePlus" size={14} />
        </button>
        {pinnedTarget && !pinnedHere && (
          <button
            type="button"
            className="ghost-btn files-action files-pin-jump"
            title="回到这个会话固定的目录"
            onClick={() => goToAbsolute(pinnedTarget)}
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
          title={pinnedHere ? '解除目录固定' : '固定当前目录到本会话'}
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
            onClick={() => window.desktop?.openPath(currentAbsolute)}
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
        <div
          className="files-split"
          ref={splitRef}
          style={{ gridTemplateColumns: `minmax(180px, ${renderedSplit * 100}%) 7px minmax(0, 1fr)` }}
        >
          <div className="files-pane">
            <div className="files-list">
              {creating && (
                <div className={`files-create ${creating}`}>
                  <span className={`files-glyph ${creating === 'dir' ? 'dir' : 'file'}`}>
                    {creating === 'dir' ? '▸' : '·'}
                  </span>
                  <input
                    className="files-create-input"
                    value={createName}
                    placeholder={creating === 'dir' ? '新目录名称' : '新文件名（含扩展名）'}
                    spellCheck={false}
                    autoFocus
                    disabled={createBusy}
                    onChange={(event) => setCreateName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void submitCreate();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelCreate();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="files-create-btn ok"
                    title="确认新建 · Enter"
                    aria-label="确认新建"
                    disabled={createBusy || !createName.trim()}
                    onClick={() => void submitCreate()}
                  >
                    <Icon name="check" size={12} />
                  </button>
                  <button
                    type="button"
                    className="files-create-btn"
                    title="取消 · Esc"
                    aria-label="取消新建"
                    disabled={createBusy}
                    onClick={cancelCreate}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              )}
              {loading && <div className="files-loading">读取中…</div>}
              {!loading && listing?.ok && listing.entries.length === 0 && (
                <div className="files-empty">这个目录是空的。</div>
              )}
              {!loading &&
                listing?.entries.map((entry) => {
                  const entryRelative = relative === '.' ? entry.name : `${relative}/${entry.name}`;
                  return (
                    <button
                      key={entry.name}
                      type="button"
                      className={`files-row${entry.hidden ? ' hidden-entry' : ''}${
                        entry.protected ? ' protected' : ''
                      }${selected === entryRelative ? ' selected' : ''}`}
                      title={
                        entry.protected
                          ? '受保护的引擎目录 · 只显示名字'
                          : `${entry.name} · 右键可删除`
                      }
                      onClick={() => void openEntry(entry)}
                      onContextMenu={(event) => openMenu(event, entry, entryRelative)}
                    >
                      <span className={`files-glyph ${entry.type}`}>
                        {entry.protected ? <Icon name="shield" size={12} /> : fileGlyph(entry)}
                      </span>
                      <span className="files-name">{entry.name}</span>
                      {entry.protected ? (
                        <span className="files-size">受保护</span>
                      ) : entry.type === 'file' ? (
                        <span className="files-size">{formatSize(entry.size)}</span>
                      ) : (
                        <span className="files-size">目录</span>
                      )}
                    </button>
                  );
                })}
              {!loading && listing && !listing.ok && (
                <div className="files-empty">读取失败：{listing.error}</div>
              )}
            </div>

            {recent.length > 0 && (
              <div className="files-recent">
                <div className="files-recent-head">
                  <span>
                    <Icon name="clock" size={11} />
                    最近打开
                  </span>
                  <button
                    type="button"
                    title="清空最近打开"
                    aria-label="清空最近打开"
                    onClick={() =>
                      setState((previous) => ({ ...baseState(previous), recent: [] }))
                    }
                  >
                    <Icon name="x" size={10} />
                  </button>
                </div>
                {recent.map((item) => (
                  <div className="files-recent-row" key={normalizeAbsolute(item.path)}>
                    <button
                      type="button"
                      className="files-recent-open"
                      title={item.path}
                      onClick={() => void openRecent(item)}
                    >
                      <span className="files-recent-name">{item.name}</span>
                      <small>
                        {item.path.replace(/\\/g, '/').split('/').slice(-2, -1)[0] ?? ''}
                      </small>
                    </button>
                    <button
                      type="button"
                      className="files-recent-remove"
                      title="从最近打开移除"
                      aria-label={`从最近打开移除 ${item.name}`}
                      onClick={() => forgetRecent(item.path)}
                    >
                      <Icon name="x" size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            className="files-split-handle"
            role="separator"
            aria-orientation="vertical"
            title="左右拖动调整文件列表与预览的比例"
            onPointerDown={startSplit}
          >
            <i />
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
                  ) : renderRichPreview && selectedMode === 'markdown' ? (
                    <div className="files-render files-render-md">
                      <Markdown text={preview.text ?? ''} empty="空文件" />
                    </div>
                  ) : renderRichPreview && selectedMode === 'html' ? (
                    <div className="files-render files-render-html">
                      {/* 用独立 webview 加载本地页面：样式、脚本和相对资源都按文件原始目录解析。 */}
                      <webview
                        key={selectedAbsolute}
                        className="files-html-frame"
                        partition="workbench-html-preview"
                        src={fileUrl(selectedAbsolute)}
                      />
                    </div>
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

      {menu &&
        createPortal(
          <>
            <div
              className="files-menu-backdrop"
              onPointerDown={closeMenu}
              onContextMenu={(event) => {
                event.preventDefault();
                closeMenu();
              }}
            />
            <div
              className="files-menu"
              role="menu"
              aria-label={`${menu.entry.name} 的操作`}
              style={{
                left: Math.min(menu.x, window.innerWidth - 200),
                top: Math.min(menu.y, window.innerHeight - 104),
              }}
            >
              <div className="files-menu-head" title={menu.relative}>
                <span className={`files-glyph ${menu.entry.type}`}>{fileGlyph(menu.entry)}</span>
                <span className="files-menu-name">{menu.entry.name}</span>
              </div>
              <button
                type="button"
                role="menuitem"
                className={`files-menu-item danger${menuConfirm ? ' confirming' : ''}`}
                onClick={() => {
                  if (!menuConfirm) {
                    setMenuConfirm(true);
                    return;
                  }
                  void removeEntry(menu.entry, menu.relative);
                }}
              >
                <Icon name="trash" size={12} />
                {menuConfirm
                  ? menu.entry.type === 'dir'
                    ? '再次点击删除目录'
                    : '再次点击删除文件'
                  : '删除'}
                <small>{menuConfirm ? '不可撤销' : '需再次确认'}</small>
              </button>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

/** 文件工作台：从工具目录进入，可越过工作目录返回上级，可把目录固定到当前会话。 */
export const filesBrowserModule: ModuleDefinition = {
  manifest: {
    id: 'files.browser',
    name: '文件工作台',
    version: '0.7.0',
    description:
      '浏览本机文件，支持新建目录与文件、右键删除（二次确认）、最近打开、越过工作目录向上导航、拖拽调整列表与预览宽度；受保护的引擎目录只显示名字；Markdown 与 HTML 按渲染效果预览，编辑时显示原文，并可直接保存文本文件。',
    icon: 'folder',
    kind: ['view', 'tool'],
    slots: ['center.view'],
    category: 'workspace',
    permissions: ['fs:read', 'fs:write', 'fs:delete'],
    persistState: true,
  },
  center: {
    tabLabel: '文件',
    title: '文件工作台',
    subtitle: ({ sessionCount }) => `工具目录起步 · 可返回盘符根目录 · 当前 ${sessionCount} 个会话共享`,
  },
  View: ({ settings, actions }) => (
    <FilesBrowser
      root={settings.engine.filesRoot || settings.engine.workspacePath}
      preferredPath={settings.engine.toolsPath}
      notify={actions.notify}
    />
  ),
};
