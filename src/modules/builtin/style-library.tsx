import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from '../../components/Markdown';
import { Icon } from '../../components/icons';
import type { StyleScanItem, StyleScanResult } from '../../engine/types';
import type { ModuleDefinition, ModuleViewProps } from '../types';

const STYLE_ROOT_KEY = 'dsh-workbench.style-root';
const ROWS_PER_PAGE = 10;
/** 静帧以 data URL 驻留内存，只保留最近几页，浏览整个库时不会越攒越大。 */
const MAX_STILLS = 96;

interface StyleMeta {
  key: string;
  value: string;
}

interface ParsedStyle {
  title: string;
  meta: StyleMeta[];
  prompt: string;
}

interface ReaderState {
  item: StyleScanItem;
  loading: boolean;
  text: string;
  error?: string;
}

/** 解析风格 .md：标题、开头元信息与「风格提示词」段落，其余补充内容不单独展示。 */
function parseStyleDoc(text: string): ParsedStyle {
  const lines = text.split(/\r?\n/);
  const head = lines.find((line) => /^#\s+/.test(line)) || '';
  const meta: StyleMeta[] = [];
  for (const line of lines) {
    if (/^##\s/.test(line)) break;
    const match = line.match(/^-\s*([^：:]+)[：:]\s*(.+)$/);
    if (match) meta.push({ key: match[1].trim(), value: match[2].trim() });
  }
  const marker = text.search(/^##\s*风格提示词\s*$/m);
  const prompt = marker >= 0
    ? text
        .slice(marker)
        .replace(/^##[^\n]*\n/, '')
        .split(/^##\s/m)[0]
        .replace(/\n---\s*$/, '')
        .trim()
    : text.trim();
  return { title: head.replace(/^#\s+/, '').trim(), meta, prompt };
}

function absOf(root: string, relative: string) {
  const base = root.replace(/[\\/]+$/, '');
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return `${base}${sep}${relative.split('/').join(sep)}`;
}

function StyleLibrary({ actions }: { actions: ModuleViewProps['actions'] }) {
  const [customRoot, setCustomRoot] = useState(() => {
    try {
      return localStorage.getItem(STYLE_ROOT_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [scan, setScan] = useState<StyleScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanError, setScanError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(1000);
  const [stills, setStills] = useState<Record<string, { url?: string; error?: string }>>({});
  const [busyKeys, setBusyKeys] = useState<string[]>([]);
  const [reader, setReader] = useState<ReaderState | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const requestedRef = useRef(new Set<string>());
  const scanSeqRef = useRef(0);

  const load = useCallback(async () => {
    const desktop = window.desktop;
    if (!desktop) {
      setLoading(false);
      setScanError('桌面版才能读取本地风格库');
      return;
    }
    setLoading(true);
    setScanError('');
    // 重新扫描按一次新读取处理：作废旧静帧、清空请求记录，失败项也能重试。
    scanSeqRef.current += 1;
    requestedRef.current.clear();
    setStills({});
    try {
      const result = await desktop.scanStyles(customRoot || undefined);
      setScan(result);
      if (!result.ok) {
        setScanError(result.error || '扫描失败');
      } else {
        const names = new Set(result.categories.map((entry) => entry.name));
        setCategory((current) => (current === 'all' || names.has(current) ? current : 'all'));
      }
    } catch (error) {
      setScanError(String((error as Error)?.message || error));
    } finally {
      setLoading(false);
    }
  }, [customRoot]);

  useEffect(() => {
    void load();
  }, [load]);

  // 容器宽度决定列数：宽屏 3 列、常规 2 列、盒子窄栏 1 列；每页固定 10 行。
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scan?.root]);

  const items = scan?.items ?? [];
  const columns = width >= 780 ? 3 : width >= 500 ? 2 : 1;
  const pageSize = columns * ROWS_PER_PAGE;

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!keyword) return true;
      return `${item.id} ${item.title} ${item.category} ${item.series}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [items, category, query]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = useMemo(
    () => visible.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [visible, safePage, pageSize],
  );

  useEffect(() => {
    setPage(0);
  }, [query, category, pageSize]);

  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop || !scan) return;
    const seq = scanSeqRef.current;
    const keep = new Set(pageItems.map((item) => item.key));

    // 写入一张静帧；超出上限时淘汰不在当前页的旧图，并允许它们再次请求。
    const apply = (key: string, value: { url?: string; error?: string }) => {
      setStills((previous) => {
        const next = { ...previous, [key]: value };
        for (const stale of Object.keys(next)) {
          if (Object.keys(next).length <= MAX_STILLS) break;
          if (keep.has(stale) || stale === key) continue;
          delete next[stale];
          requestedRef.current.delete(stale);
        }
        return next;
      });
    };

    // 重新扫描后旧请求的结果直接丢弃，避免旧目录图片串进新列表。
    const stale = () => scanSeqRef.current !== seq;

    for (const item of pageItems) {
      if (!item.stillRelative || requestedRef.current.has(item.key)) continue;
      requestedRef.current.add(item.key);
      void desktop
        .readImage(scan.root, item.stillRelative)
        .then((result) => {
          if (stale()) return;
          if (result.ok && result.dataUrl) {
            apply(item.key, { url: result.dataUrl });
          } else {
            requestedRef.current.delete(item.key);
            apply(item.key, { error: result.error || '静帧读取失败' });
          }
        })
        .catch((error) => {
          if (stale()) return;
          requestedRef.current.delete(item.key);
          apply(item.key, { error: String((error as Error)?.message || error) });
        });
    }
  }, [pageItems, scan]);

  useEffect(() => {
    gridRef.current?.scrollTo({ top: 0 });
  }, [safePage]);

  useEffect(() => {
    if (!reader) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setReader(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [reader]);

  const goPage = (next: number) => setPage(Math.max(0, Math.min(pageCount - 1, next)));

  const copyText = async (text: string, message: string) => {
    const result = await window.desktop?.copyText(text);
    actions.notify(result?.ok === false ? '复制失败' : message, result?.ok === false ? 'warn' : 'success');
  };

  // 按卡片记录读取状态：一张卡在复制时，其他卡仍可操作。
  const markBusy = (key: string, on: boolean) => {
    setBusyKeys((previous) => {
      if (on) return previous.includes(key) ? previous : [...previous, key];
      return previous.filter((entry) => entry !== key);
    });
  };

  const copyPromptOf = async (item: StyleScanItem) => {
    if (!scan || busyKeys.includes(item.key)) return;
    markBusy(item.key, true);
    try {
      const result = await window.desktop?.previewFile(scan.root, item.relative);
      if (!result?.ok) {
        actions.notify(result?.error || '读取风格文件失败', 'warn');
        return;
      }
      const prompt = parseStyleDoc(result.text ?? '').prompt;
      if (!prompt) {
        actions.notify('这份文件没有「风格提示词」段落', 'info');
        return;
      }
      await copyText(prompt, `${item.id} 的提示词已复制`);
    } finally {
      markBusy(item.key, false);
    }
  };

  const copyRefOf = async (item: StyleScanItem) => {
    if (!scan) return;
    const payload = [
      '请引用这份代码动画风格，按文件里的「风格提示词」做画面与动效：',
      '',
      `风格：${item.id} ${item.title}`,
      `风格文件：${absOf(scan.root, item.relative)}`,
      '只引用这个文件位置，不要整段复述风格说明。',
    ].join('\n');
    await copyText(payload, `${item.id} 的引用位置已复制`);
  };

  const openReader = (item: StyleScanItem) => {
    if (!scan) return;
    const desktop = window.desktop;
    setReader({ item, loading: true, text: '' });
    if (!desktop) {
      setReader({ item, loading: false, text: '', error: '桌面版才能读取本地文件' });
      return;
    }
    void desktop
      .previewFile(scan.root, item.relative)
      .then((result) => {
        setReader((previous) =>
          previous && previous.item.key === item.key
            ? {
                item,
                loading: false,
                text: result.ok ? result.text ?? '' : '',
                error: result.ok ? undefined : result.error || '读取失败',
              }
            : previous,
        );
      })
      .catch((error) => {
        setReader((previous) =>
          previous && previous.item.key === item.key
            ? { item, loading: false, text: '', error: String((error as Error)?.message || error) }
            : previous,
        );
      });
  };

  const pickRoot = async () => {
    const desktop = window.desktop;
    if (!desktop) return;
    const chosen = await desktop.pickDirectory('选择代码动画风格库目录', scan?.root || '');
    if (!chosen) return;
    try {
      localStorage.setItem(STYLE_ROOT_KEY, chosen);
    } catch {
      /* ignore */
    }
    setCategory('all');
    setPage(0);
    setCustomRoot(chosen);
  };

  const useDefaultRoot = () => {
    try {
      localStorage.removeItem(STYLE_ROOT_KEY);
    } catch {
      /* ignore */
    }
    setCategory('all');
    setPage(0);
    setCustomRoot('');
  };

  if (scan?.missing || scanError) {
    return (
      <div className="style-lib">
        <div className="style-lib-empty">
          <span className="style-lib-empty-icon">
            <Icon name="palette" size={26} />
          </span>
          <strong>还没有找到风格库</strong>
          <p>
            默认位置是状态目录下的 <code>animation-styles</code>，里面需要有「风格提示词」文件夹。
            解压风格包后可以直接选择它的上一级目录。
          </p>
          {scan?.root && <code className="style-lib-empty-path">{scan.root}</code>}
          {scanError && <p className="style-lib-error">{scanError}</p>}
          <div className="style-lib-empty-actions">
            <button type="button" className="style-lib-btn primary" onClick={pickRoot}>
              <Icon name="folder" size={12} />
              选择目录
            </button>
            <button type="button" className="style-lib-btn" onClick={useDefaultRoot}>
              用默认目录
            </button>
            <button type="button" className="style-lib-btn" onClick={() => void load()}>
              <Icon name="refresh" size={12} />
              重新扫描
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="style-lib" ref={rootRef}>
      <div className="style-lib-bar">
        <label className="style-lib-search">
          <Icon name="search" size={12} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索编号、名字或分类…"
            spellCheck={false}
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
              <Icon name="x" size={10} />
            </button>
          )}
        </label>
        <div className="style-lib-cats">
          <button
            type="button"
            className={category === 'all' ? 'on' : ''}
            onClick={() => setCategory('all')}
          >
            全部 <em>{scan?.total ?? 0}</em>
          </button>
          {(scan?.categories ?? []).map((entry) => (
            <button
              type="button"
              key={entry.name}
              className={category === entry.name ? 'on' : ''}
              onClick={() => setCategory(entry.name)}
              title={entry.name}
            >
              {entry.name} <em>{entry.count}</em>
            </button>
          ))}
        </div>
        <div className="style-lib-tools">
          <span className="style-lib-count">{visible.length} 种</span>
          <button type="button" className="style-lib-btn" onClick={pickRoot}>
            <Icon name="folder" size={11} />
            目录
          </button>
          {customRoot && (
            <button type="button" className="style-lib-btn" onClick={useDefaultRoot}>
              默认
            </button>
          )}
          <button
            type="button"
            className="style-lib-btn icon"
            onClick={() => void load()}
            title="重新扫描"
            aria-label="重新扫描"
          >
            <Icon name="refresh" size={11} />
          </button>
        </div>
      </div>

      <div className="style-lib-body">
        <div className="style-lib-grid" ref={gridRef} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {loading ? (
            <div className="style-lib-grid-empty">正在扫描风格库…</div>
          ) : visible.length === 0 ? (
            <div className="style-lib-grid-empty">没有匹配的风格</div>
          ) : (
            pageItems.map((item) => {
              const still = stills[item.key];
              const busy = busyKeys.includes(item.key);
              return (
                <article className="style-card" key={item.key}>
                  <button
                    type="button"
                    className="style-card-shot"
                    onClick={() => openReader(item)}
                    title={`打开 ${item.id} ${item.title} 的风格文件`}
                  >
                    {still?.url ? (
                      <img src={still.url} alt={`${item.id} ${item.title}`} loading="lazy" />
                    ) : (
                      <span className="style-card-shot-empty">
                        <Icon name="image" size={20} />
                        <em>
                          {still?.error
                            ? '静帧不可用'
                            : item.stillRelative
                              ? '载入静帧…'
                              : item.id}
                        </em>
                      </span>
                    )}
                    {!item.stillRelative && <span className="style-card-no-still">无静帧</span>}
                  </button>
                  <div className="style-card-body">
                    <div className="style-card-head">
                      <strong>{item.id}</strong>
                      <span title={item.title}>{item.title}</span>
                    </div>
                    <div className="style-card-cat" title={item.category}>
                      {item.category}
                    </div>
                    <div className="style-card-actions">
                      <button
                        type="button"
                        className="style-lib-btn"
                        disabled={busy}
                        onClick={() => void copyPromptOf(item)}
                      >
                        <Icon name="copy" size={10} />
                        {busy ? '复制中…' : '复制提示词'}
                      </button>
                      <button
                        type="button"
                        className="style-lib-btn"
                        onClick={() => void copyRefOf(item)}
                      >
                        <Icon name="send" size={10} />
                        复制给 DSH
                      </button>
                      <button
                        type="button"
                        className="style-lib-btn"
                        onClick={() => openReader(item)}
                      >
                        <Icon name="book" size={10} />
                        打开文件
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>

      <div className="style-lib-pager">
        <button
          type="button"
          className="style-lib-btn"
          disabled={safePage <= 0}
          onClick={() => goPage(safePage - 1)}
        >
          <Icon name="chevronLeft" size={10} />
          上一页
        </button>
        <span className="style-lib-page-info">
          第 {safePage + 1} / {pageCount} 页 · 每页 {pageSize} 种
        </span>
        <button
          type="button"
          className="style-lib-btn"
          disabled={safePage >= pageCount - 1}
          onClick={() => goPage(safePage + 1)}
        >
          下一页
          <Icon name="chevronRight" size={10} />
        </button>
        <code className="style-lib-pager-path" title={scan?.root}>
          {scan?.root}
        </code>
      </div>

      {reader && (
        <div
          className="style-lib-reader-layer"
          onClick={(event) => {
            if (event.target === event.currentTarget) setReader(null);
          }}
        >
          <div
            className="style-lib-reader"
            role="dialog"
            aria-modal="true"
            aria-label={`${reader.item.id} 风格文件`}
          >
            <div className="style-lib-reader-head">
              <div className="style-lib-reader-title">
                <strong>
                  {reader.item.id} {reader.item.title}
                </strong>
                <small>
                  {reader.item.category} · {reader.item.relative}
                </small>
              </div>
              <div className="style-lib-reader-actions">
                <button
                  type="button"
                  className="style-lib-btn primary"
                  disabled={!reader.text}
                  onClick={() => {
                    const prompt = parseStyleDoc(reader.text).prompt;
                    if (prompt) void copyText(prompt, `${reader.item.id} 的提示词已复制`);
                  }}
                >
                  <Icon name="copy" size={10} />
                  复制提示词
                </button>
                <button
                  type="button"
                  className="style-lib-btn"
                  onClick={() => void copyRefOf(reader.item)}
                >
                  <Icon name="send" size={10} />
                  复制给 DSH
                </button>
                <button
                  type="button"
                  className="style-lib-btn icon"
                  onClick={() => setReader(null)}
                  aria-label="关闭阅读"
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            </div>
            <div className="style-lib-reader-body">
              {reader.loading ? (
                <p className="style-lib-prompt-note">正在读取…</p>
              ) : reader.error ? (
                <p className="style-lib-prompt-note error">{reader.error}</p>
              ) : (
                <Markdown text={reader.text} empty="这份文件是空的" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 代码动画风格库：卡片分页浏览本地风格包，复制提示词 / DSH 引用位置，或直接阅读 Markdown。 */
export const styleLibraryModule: ModuleDefinition = {
  manifest: {
    id: 'styles.library',
    name: '动画风格库',
    version: '0.2.0',
    description:
      '读取本地代码动画风格包：按 3×10 / 2×10 卡片分页浏览 341 种风格，卡片内可直接复制提示词、复制带文件路径的 DSH 引用，或在模块内阅读对应 Markdown。素材来自外部风格库，只读，不并入仓库。',
    icon: 'palette',
    kind: ['view', 'tool'],
    slots: ['center.view'],
    category: 'workspace',
    origin: 'third-party',
    permissions: ['fs:read'],
  },
  center: {
    tabLabel: '风格库',
    title: '代码动画风格库',
    subtitle: () => '本地风格包 · 卡片分页 · 静帧与 Markdown 只读 · 适配盒子宽度',
  },
  View: ({ actions }) => <StyleLibrary actions={actions} />,
};
