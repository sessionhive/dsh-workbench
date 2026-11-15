import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import type { WebSite } from '../settings';
import type { ToastTone } from '../types';

type WebviewElement = HTMLElement & {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  loadURL: (url: string) => Promise<void>;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  getWebContentsId: () => number;
};

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** React 不认 webview 的布尔属性，用字符串写进 DOM；Electron 只看属性是否存在。 */
const ALLOW_POPUPS = { allowpopups: 'true' } as unknown as { allowpopups: boolean };

const WIN_MIN_W = 420;
const WIN_MIN_H = 300;
const WIN_DEFAULT_W = 880;
const WIN_DEFAULT_H = 580;

interface DockWindow {
  id: string;
  /** 固定站点 id；临时窗口为 null。 */
  siteId: string | null;
  /** webview 首次加载的地址，之后不再跟着导航变化，避免重新挂载。 */
  startUrl: string;
  title: string;
  accent: string;
  /** 关闭只隐藏，webview 继续驻留；彻底释放才会从数组里移除。 */
  open: boolean;
  transient: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

interface BrowserDockProps {
  sites: WebSite[];
  /** 置顶的地址 id，渲染时排在前面。 */
  pinned: string[];
  onUpdateSites: (updater: (sites: WebSite[]) => WebSite[]) => void;
  onUpdatePinned: (updater: (ids: string[]) => string[]) => void;
  notify: (message: string, tone?: ToastTone) => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hostOf(url: string) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 收纳里的地址只接受 http(s) 与 localhost，裸域名补 https。 */
function normalizeUrl(input: string) {
  const value = input.trim();
  if (!value) return '';
  const withScheme = /^https?:\/\//i.test(value)
    ? value
    : /^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(value)
      ? `http://${value}`
      : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (!/^https?:$/.test(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function nextBox(count: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(WIN_DEFAULT_W, Math.max(WIN_MIN_W, vw - 150));
  const h = Math.min(WIN_DEFAULT_H, Math.max(WIN_MIN_H, vh - 190));
  const step = 26;
  const n = count % 6;
  const x = clamp(Math.round((vw - w) / 2) + n * step, 8, Math.max(8, vw - w - 8));
  const y = clamp(68 + n * step, 56, Math.max(56, vh - h - 8));
  return { x, y, w, h };
}

/** 窗口基础层级：在引擎面板之上、抽屉与弹层之下；聚焦时整体重排，避免层级无限增长。 */
const Z_BASE = 160;

/** 把目标窗口放到最前：按当前层级整体重排，层级不会随操作次数无限增长。 */
function raiseWindow(list: DockWindow[], id: string): DockWindow[] {
  const target = list.find((item) => item.id === id);
  if (!target) return list;
  const ordered = [...list].sort((a, b) => a.z - b.z);
  if (ordered[ordered.length - 1]?.id === id) return list;
  const rest = ordered.filter((item) => item.id !== id);
  const nextZ = new Map(rest.map((item, index) => [item.id, Z_BASE + index]));
  nextZ.set(id, Z_BASE + rest.length);
  return list.map((item) => (nextZ.has(item.id) ? { ...item, z: nextZ.get(item.id)! } : item));
}

/** 判断两个地址是否指向同一站点：忽略大小写与结尾斜杠。 */
function sameSite(a: string, b: string) {
  return a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase();
}

function windowId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

/** 单个二级窗口：拖拽/缩放时只有自己重渲染，其他窗口与 webview 不跟着刷。 */
const DockBrowserWindow = memo(function DockBrowserWindow({
  win,
  onFocus,
  onMove,
  onResize,
  onClose,
  onRelease,
  onTitle,
  register,
  notify,
}: {
  win: DockWindow;
  onFocus: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onClose: (id: string) => void;
  onRelease: (id: string) => void;
  onTitle: (id: string, title: string) => void;
  register: (id: string, view: WebviewElement | null) => void;
  notify: (message: string, tone?: ToastTone) => void;
}) {
  const viewRef = useRef<WebviewElement | null>(null);
  const [src] = useState(win.startUrl);
  const [address, setAddress] = useState(win.startUrl);
  const [loading, setLoading] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const gripRef = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    register(win.id, view);

    const onStart = () => setLoading(true);
    const onStop = () => setLoading(false);
    const onNavigate = (event: Event) => {
      const url = (event as Event & { url?: string }).url;
      if (url) setAddress(url);
    };
    const onTitleEvent = (event: Event) => {
      const title = (event as Event & { title?: string }).title;
      if (title) onTitle(win.id, title);
    };

    view.addEventListener('did-start-loading', onStart);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('did-navigate', onNavigate);
    view.addEventListener('did-navigate-in-page', onNavigate);
    view.addEventListener('page-title-updated', onTitleEvent);
    return () => {
      register(win.id, null);
      view.removeEventListener('did-start-loading', onStart);
      view.removeEventListener('did-stop-loading', onStop);
      view.removeEventListener('did-navigate', onNavigate);
      view.removeEventListener('did-navigate-in-page', onNavigate);
      view.removeEventListener('page-title-updated', onTitleEvent);
    };
  }, [win.id, register, onTitle]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input')) return;
    onFocus(win.id);
    dragRef.current = { dx: event.clientX - win.x, dy: event.clientY - win.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    // 窗口失焦或指针在应用外抬起时不会再收到 pointerup，这里按按键状态兜底收尾。
    if (event.buttons === 0) {
      dragRef.current = null;
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    onMove(
      win.id,
      clamp(event.clientX - dragRef.current.dx, 8, Math.max(8, vw - win.w - 8)),
      clamp(event.clientY - dragRef.current.dy, 56, Math.max(56, vh - win.h - 8)),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* 指针已经释放时忽略 */
    }
  };

  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onFocus(win.id);
    gripRef.current = { sx: event.clientX, sy: event.clientY, w: win.w, h: win.h };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (!gripRef.current) return;
    if (event.buttons === 0) {
      gripRef.current = null;
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 上限先与最小值取大：窗口贴近右/下边缘时也不会把宽度压到最小值以下。
    const maxW = Math.max(WIN_MIN_W, vw - win.x - 8);
    const maxH = Math.max(WIN_MIN_H, vh - win.y - 8);
    const nextW = clamp(gripRef.current.w + (event.clientX - gripRef.current.sx), WIN_MIN_W, maxW);
    const nextH = clamp(gripRef.current.h + (event.clientY - gripRef.current.sy), WIN_MIN_H, maxH);
    onResize(win.id, Math.round(nextW), Math.round(nextH));
  };

  const endResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (!gripRef.current) return;
    gripRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* 指针已经释放时忽略 */
    }
  };

  const go = (raw: string) => {
    const target = normalizeUrl(raw);
    if (!target) {
      notify('请输入有效的网址', 'warn');
      return;
    }
    setAddress(target);
    const view = viewRef.current;
    if (view) void view.loadURL(target).catch(() => notify('页面加载失败', 'warn'));
  };

  const back = () => {
    const view = viewRef.current;
    if (view?.canGoBack()) view.goBack();
  };
  const forward = () => {
    const view = viewRef.current;
    if (view?.canGoForward()) view.goForward();
  };
  const reload = () => viewRef.current?.reload();

  const openExternal = async () => {
    const result = await window.desktop?.openExternal(address || win.startUrl);
    if (result && !result.ok) notify(result.error ?? '外部浏览器打开失败', 'warn');
  };

  return (
    <section
      className={`dock-win${win.open ? '' : ' is-hidden'}`}
      style={{
        left: win.x,
        top: win.y,
        width: win.w,
        height: win.h,
        zIndex: win.z,
        ['--dock-accent' as string]: win.accent,
      }}
      onPointerDown={() => onFocus(win.id)}
      aria-label={`浏览器窗口 ${win.title}`}
    >
      <header
        className="dock-win-head"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => {
          // 双击标题栏空白处最大化；双击按钮不应被顺带放大。
          if ((event.target as HTMLElement).closest('button')) return;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const box = {
            x: 12,
            y: 62,
            w: vw - 24,
            h: vh - 74,
          };
          onMove(win.id, box.x, box.y);
          onResize(win.id, box.w, box.h);
        }}
      >
        <span className="dock-win-fav">
          <Icon name="globe" size={13} />
        </span>
        <b title={address || win.startUrl}>{win.title || hostOf(address) || '浏览器'}</b>
        {win.transient && <em className="dock-win-tag">临时</em>}
        {!win.open && <em className="dock-win-tag muted">挂起</em>}
        <div className="dock-win-actions">
          <button
            type="button"
            title="彻底释放 · 下次打开重新加载"
            aria-label="彻底释放此窗口"
            onClick={() => onRelease(win.id)}
          >
            <Icon name="trash" size={12} />
          </button>
          <button
            type="button"
            title="关闭 · 保留页面状态，可从收纳重新打开"
            aria-label="关闭窗口并保留页面状态"
            onClick={() => onClose(win.id)}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      </header>

      <div className="dock-win-toolbar">
        <button type="button" className="icon-btn" title="后退" onClick={back}>
          <Icon name="arrowLeft" size={13} />
        </button>
        <button type="button" className="icon-btn" title="前进" onClick={forward}>
          <Icon name="arrowRight" size={13} />
        </button>
        <button type="button" className="icon-btn" title="刷新" onClick={reload}>
          <Icon name="refresh" size={13} />
        </button>
        <form
          className="dock-win-address"
          onSubmit={(event) => {
            event.preventDefault();
            go(address);
          }}
        >
          <Icon name="globe" size={12} />
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            placeholder="输入网址后回车"
            spellCheck={false}
          />
          {loading && <i className="dock-win-loading" />}
        </form>
        <button type="button" className="icon-btn" title="在系统浏览器打开" onClick={() => void openExternal()}>
          <Icon name="arrowUpRight" size={13} />
        </button>
      </div>

      <div className="dock-win-stage">
        <webview
          ref={viewRef as unknown as RefObject<HTMLElement>}
          className="dock-webview"
          src={src}
          partition="persist:workbench-web"
          useragent={CHROME_UA}
          {...ALLOW_POPUPS}
        />
      </div>

      {/* 底边独立一条：缩放握把不压在 webview 上，避免被页面吃掉鼠标事件。 */}
      <footer className="dock-win-foot">
        <span>{win.transient ? '临时窗口 · 来自页面弹窗' : '关闭保留页面 · 彻底释放后重新加载'}</span>
        <i
          className="dock-win-grip"
          title="拖拽调整大小"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />
      </footer>
    </section>
  );
});

export function BrowserDock({ sites, pinned, onUpdateSites, onUpdatePinned, notify }: BrowserDockProps) {
  const [wins, setWins] = useState<DockWindow[]>([]);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const winsRef = useRef(wins);
  winsRef.current = wins;
  const viewsRef = useRef<Record<string, WebviewElement | null>>({});

  const supported = Boolean(window.desktop);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const registerView = useCallback((id: string, view: WebviewElement | null) => {
    if (view) viewsRef.current[id] = view;
    else delete viewsRef.current[id];
  }, []);

  const focus = useCallback((id: string) => {
    setWins((prev) => raiseWindow(prev, id));
  }, []);

  const move = useCallback((id: string, x: number, y: number) => {
    setWins((prev) =>
      prev.map((item) => (item.id === id && (item.x !== x || item.y !== y) ? { ...item, x, y } : item)),
    );
  }, []);

  const resize = useCallback((id: string, w: number, h: number) => {
    setWins((prev) =>
      prev.map((item) => (item.id === id && (item.w !== w || item.h !== h) ? { ...item, w, h } : item)),
    );
  }, []);

  const setTitle = useCallback((id: string, title: string) => {
    setWins((prev) =>
      prev.some((item) => item.id === id && item.title !== title)
        ? prev.map((item) => (item.id === id ? { ...item, title } : item))
        : prev,
    );
  }, []);

  const close = useCallback((id: string) => {
    setWins((prev) =>
      prev.map((item) => (item.id === id ? { ...item, open: false } : item)),
    );
  }, []);

  const release = useCallback(
    (id: string) => {
      const target = winsRef.current.find((item) => item.id === id);
      if (!target) return;
      setWins((prev) => prev.filter((item) => item.id !== id));
      delete viewsRef.current[id];
      notify(`已释放「${target.title}」· 下次打开会重新加载`, 'info');
    },
    [notify],
  );

  const openSite = useCallback((site: WebSite) => {
    setOpen(false);
    setWins((prev) => {
      const existing = prev.find((item) => item.siteId === site.id);
      if (existing) {
        const shown = existing.open
          ? prev
          : prev.map((item) => (item.id === existing.id ? { ...item, open: true } : item));
        return raiseWindow(shown, existing.id);
      }
      const box = nextBox(prev.length);
      return [
        ...prev,
        {
          id: windowId('site'),
          siteId: site.id,
          startUrl: site.url,
          title: site.label,
          accent: 'var(--accent)',
          open: true,
          transient: false,
          z: Z_BASE + prev.length,
          ...box,
        },
      ];
    });
  }, []);

  const openTransient = useCallback((target: string) => {
    const host = hostOf(target) || '新页面';
    setWins((prev) => {
      const box = nextBox(prev.length);
      return [
        ...prev,
        {
          id: windowId('tmp'),
          siteId: null,
          startUrl: target,
          title: host,
          accent: '#8f80ff',
          open: true,
          transient: true,
          z: Z_BASE + prev.length,
          ...box,
        },
      ];
    });
  }, []);

  // 窗口内的 target=_blank 只认领自己的 webview，其他浏览器的跳转不受影响。
  useEffect(() => {
    const off = window.desktop?.onWebviewNewTab?.((payload) => {
      const owner = Object.values(viewsRef.current).some((view) => {
        try {
          return Boolean(view) && view!.getWebContentsId() === payload.id;
        } catch {
          return false;
        }
      });
      if (!owner) return;
      openTransient(payload.url);
    });
    return () => off?.();
  }, [openTransient]);

  // 应用窗口缩小时把二级窗口收回到可视区域，避免标题栏被挤出屏幕。
  useEffect(() => {
    const onResize = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setWins((prev) =>
        prev.map((item) => {
          const w = clamp(item.w, WIN_MIN_W, Math.max(WIN_MIN_W, vw - 16));
          const h = clamp(item.h, WIN_MIN_H, Math.max(WIN_MIN_H, vh - 64));
          const x = clamp(item.x, 8, Math.max(8, vw - w - 8));
          const y = clamp(item.y, 56, Math.max(56, vh - h - 8));
          return w === item.w && h === item.h && x === item.x && y === item.y
            ? item
            : { ...item, w, h, x, y };
        }),
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const addSite = (event: FormEvent) => {
    event.preventDefault();
    const target = normalizeUrl(url);
    if (!target) {
      notify('请填写完整的网页地址，例如 https://chatgpt.com', 'warn');
      return;
    }
    if (sites.some((site) => sameSite(site.url, target))) {
      notify('这个地址已经在收纳里了', 'info');
      return;
    }
    const site: WebSite = {
      id: `site-${Date.now().toString(36)}`,
      label: label.trim() || hostOf(target),
      url: target,
    };
    onUpdateSites((prev) => [...prev, site]);
    setLabel('');
    setUrl('');
    notify(`已加入浏览器收纳「${site.label}」`, 'success');
  };

  const removeSite = (site: WebSite) => {
    const affected = winsRef.current.filter((item) => item.siteId === site.id);
    onUpdateSites((prev) => prev.filter((item) => item.id !== site.id));
    if (affected.length) {
      setWins((prev) => prev.filter((item) => item.siteId !== site.id));
      affected.forEach((item) => delete viewsRef.current[item.id]);
    }
    notify(
      affected.length ? `已删除「${site.label}」并释放窗口` : `已删除「${site.label}」`,
      'info',
    );
  };

  const togglePin = (id: string) => {
    onUpdatePinned((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  // 置顶项排在前面，其余保持原有顺序；置顶数量随清单变化自动收敛。
  const orderedSites = useMemo(() => {
    if (!pinned.length) return sites;
    const pin = new Set(pinned);
    return [...sites.filter((site) => pin.has(site.id)), ...sites.filter((site) => !pin.has(site.id))];
  }, [sites, pinned]);
  const pinnedCount = pinned.filter((id) => sites.some((site) => site.id === id)).length;

  const transient = useMemo(() => wins.filter((item) => item.transient), [wins]);
  const alive = wins.length;

  return (
    <div className="browser-dock">
      <button
        type="button"
        className={`browser-dock-btn${open ? ' on' : ''}${alive ? ' busy' : ''}`}
        title="浏览器收纳 · 常用地址与二级浏览器窗口"
        aria-label="浏览器收纳"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="globe" size={15} />
        {alive > 0 && <i className="browser-dock-badge">{alive}</i>}
      </button>

      {/* 透明遮罩盖住整个应用（包括各个 webview），点任何其他位置都会先收起收纳。 */}
      {open && <div className="dock-pop-backdrop" onClick={() => setOpen(false)} />}

      {open && (
        <div className="browser-dock-pop" role="dialog" aria-label="浏览器收纳">
          <header className="dock-pop-head">
            <div>
              <strong>浏览器收纳</strong>
              <small>独立清单 · 关闭保留页面状态，释放后重新加载</small>
            </div>
            <span className="dock-pop-count">
              {sites.length} 个地址{pinnedCount ? ` · 置顶 ${pinnedCount}` : ''}
            </span>
          </header>

          <div className="dock-pop-scroll">
            {sites.length === 0 && (
              <p className="dock-pop-empty">还没有地址，把常用的网页 AI、文档或后台存在这里。</p>
            )}
            {orderedSites.map((site) => {
              const win = wins.find((item) => item.siteId === site.id);
              const state = win ? (win.open ? '运行中' : '已挂起') : '未打开';
              const isPinned = pinned.includes(site.id);
              return (
                <div
                  className={`dock-site-row${win?.open ? ' live' : ''}${isPinned ? ' pinned' : ''}`}
                  key={site.id}
                >
                  <button
                    type="button"
                    className="dock-site-main"
                    title={site.url}
                    onClick={() => openSite(site)}
                  >
                    <span className="dock-site-glyph">
                      <Icon name={isPinned ? 'pin' : 'globe'} size={12} />
                    </span>
                    <span className="dock-site-text">
                      <b>{site.label}</b>
                      <small>{hostOf(site.url)}</small>
                    </span>
                    <em className={`dock-site-state ${win ? (win.open ? 'on' : 'off') : ''}`}>
                      {state}
                    </em>
                  </button>
                  <button
                    type="button"
                    className={`dock-mini pin${isPinned ? ' on' : ''}`}
                    title={isPinned ? '取消置顶' : '置顶到清单最前'}
                    aria-label={isPinned ? `取消置顶 ${site.label}` : `置顶 ${site.label}`}
                    aria-pressed={isPinned}
                    onClick={() => togglePin(site.id)}
                  >
                    <Icon name="pin" size={11} />
                  </button>
                  {win && (
                    <button
                      type="button"
                      className="dock-mini"
                      title="彻底释放 · 下次打开重新加载"
                      aria-label={`释放 ${site.label}`}
                      onClick={() => release(win.id)}
                    >
                      <Icon name="trash" size={11} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="dock-mini del"
                    title="从收纳删除这个地址"
                    aria-label={`删除 ${site.label}`}
                    onClick={() => removeSite(site)}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </div>
              );
            })}

            {transient.length > 0 && (
              <>
                <div className="dock-pop-sub">临时窗口 · {transient.length}</div>
                {transient.map((win) => (
                  <div className={`dock-site-row${win.open ? ' live' : ''}`} key={win.id}>
                    <button
                      type="button"
                      className="dock-site-main"
                      title={win.startUrl}
                      onClick={() => {
                        setOpen(false);
                        setWins((prev) =>
                          raiseWindow(
                            prev.map((item) =>
                              item.id === win.id ? { ...item, open: true } : item,
                            ),
                            win.id,
                          ),
                        );
                      }}
                    >
                      <span className="dock-site-glyph">
                        <Icon name="panel" size={12} />
                      </span>
                      <span className="dock-site-text">
                        <b>{win.title}</b>
                        <small>{hostOf(win.startUrl)}</small>
                      </span>
                      <em className={`dock-site-state ${win.open ? 'on' : 'off'}`}>
                        {win.open ? '运行中' : '已挂起'}
                      </em>
                    </button>
                    <button
                      type="button"
                      className="dock-mini"
                      title="彻底释放这个临时窗口"
                      aria-label="释放临时窗口"
                      onClick={() => release(win.id)}
                    >
                      <Icon name="trash" size={11} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          <form className="dock-pop-form" onSubmit={addSite}>
            <div className="dock-pop-fields">
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="名称（例如 ChatGPT）"
                maxLength={24}
              />
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://chatgpt.com"
                spellCheck={false}
              />
            </div>
            <div className="dock-pop-actions">
              <small>{supported ? '独立清单 · 不影响网页模块的固定站点' : '仅在桌面客户端可用'}</small>
              <button type="submit" className="primary-btn" disabled={!url.trim() || !supported}>
                <Icon name="plus" size={11} />
                加入收纳
              </button>
            </div>
          </form>
        </div>
      )}

      {createPortal(
        <>
          {wins.map((win) => (
            <DockBrowserWindow
              key={win.id}
              win={win}
              onFocus={focus}
              onMove={move}
              onResize={resize}
              onClose={close}
              onRelease={release}
              onTitle={setTitle}
              register={registerView}
              notify={notify}
            />
          ))}
        </>,
        // 挂在应用根节点下，沿用同一套主题变量；固定定位不受栅格布局影响。
        document.querySelector('.app') ?? document.body,
      )}
    </div>
  );
}
