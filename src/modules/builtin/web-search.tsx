import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import { Icon } from '../../components/icons';
import { useModuleState } from '../state';
import type { ModuleDefinition } from '../types';

type WebviewElement = HTMLElement & {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  loadURL: (url: string) => Promise<void>;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
};

const HOME_URL = 'https://www.google.com';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type EngineId = 'google' | 'bing' | 'baidu';

const ENGINES: Array<{ id: EngineId; label: string; base: string }> = [
  { id: 'google', label: 'Google', base: 'https://www.google.com/search?q=' },
  { id: 'bing', label: 'Bing', base: 'https://www.bing.com/search?q=' },
  { id: 'baidu', label: '百度', base: 'https://www.baidu.com/s?wd=' },
];

interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

interface PinnedSite {
  id: string;
  label: string;
  url: string;
}

interface BrowserState {
  tabs: BrowserTab[];
  activeId: string;
  sites: PinnedSite[];
  engine: EngineId;
}

const DEFAULT_SITES: PinnedSite[] = [
  { id: 'site-bilibili', label: '哔哩哔哩', url: 'https://www.bilibili.com' },
  { id: 'site-github', label: 'GitHub', url: 'https://github.com' },
  { id: 'site-google', label: 'Google', url: 'https://www.google.com' },
  { id: 'site-juejin', label: '掘金', url: 'https://juejin.cn' },
];

function tabId() {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

function blankTab(): BrowserTab {
  return { id: tabId(), url: '', title: '新标签页' };
}

const FALLBACK_STATE: BrowserState = {
  tabs: [blankTab()],
  activeId: '',
  sites: DEFAULT_SITES,
  engine: 'google',
};
FALLBACK_STATE.activeId = FALLBACK_STATE.tabs[0].id;

function hostLabel(url: string) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 地址栏输入解析：完整 URL、裸域名、localhost 或搜索词。 */
function toTarget(input: string, engine: EngineId) {
  const value = input.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(value)) return `http://${value}`;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(value) && !/\s/.test(value)) {
    return `https://${value}`;
  }
  const base = ENGINES.find((item) => item.id === engine)?.base ?? ENGINES[0].base;
  return `${base}${encodeURIComponent(value)}`;
}

/** 每个标签一个常驻 webview，切走只用 CSS 隐藏，回来不重新加载。 */
function TabFrame({
  tab,
  active,
  register,
  onNavigate,
  onTitle,
  onLoading,
}: {
  tab: BrowserTab;
  active: boolean;
  register: (id: string, view: WebviewElement | null) => void;
  onNavigate: (id: string, url: string) => void;
  onTitle: (id: string, title: string) => void;
  onLoading: (id: string, loading: boolean) => void;
}) {
  const ref = useRef<WebviewElement | null>(null);
  const [startUrl] = useState(tab.url);

  useEffect(() => {
    const view = ref.current;
    if (!view) return;
    register(tab.id, view);

    const onStart = () => onLoading(tab.id, true);
    const onStop = () => onLoading(tab.id, false);
    const onNavigateEvent = (event: Event) => {
      const url = (event as Event & { url?: string }).url;
      if (url) onNavigate(tab.id, url);
    };
    const onTitleEvent = (event: Event) => {
      const title = (event as Event & { title?: string }).title;
      if (title) onTitle(tab.id, title);
    };

    view.addEventListener('did-start-loading', onStart);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('did-navigate', onNavigateEvent);
    view.addEventListener('did-navigate-in-page', onNavigateEvent);
    view.addEventListener('page-title-updated', onTitleEvent);
    return () => {
      register(tab.id, null);
      view.removeEventListener('did-start-loading', onStart);
      view.removeEventListener('did-stop-loading', onStop);
      view.removeEventListener('did-navigate', onNavigateEvent);
      view.removeEventListener('did-navigate-in-page', onNavigateEvent);
      view.removeEventListener('page-title-updated', onTitleEvent);
    };
  }, [tab.id, register, onNavigate, onTitle, onLoading]);

  return (
    <webview
      ref={ref as unknown as RefObject<HTMLElement>}
      className={`web-frame${active ? ' active' : ''}`}
      src={startUrl}
      partition="persist:workbench-web"
      useragent={CHROME_UA}
    />
  );
}

function WebSearch({ notify }: { notify: (message: string, tone?: 'info' | 'success' | 'warn') => void }) {
  const [state, setState] = useModuleState<BrowserState>(FALLBACK_STATE);
  const [address, setAddress] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [sitesOpen, setSitesOpen] = useState(false);
  const [siteLabel, setSiteLabel] = useState('');
  const [siteUrl, setSiteUrl] = useState('');

  const views = useRef<Record<string, WebviewElement | null>>({});
  const stateRef = useRef(state);
  stateRef.current = state;
  const setStateRef = useRef(setState);
  setStateRef.current = setState;
  const popRef = useRef<HTMLDivElement | null>(null);
  const pinRef = useRef<HTMLButtonElement | null>(null);

  const supported = Boolean(window.desktop);
  const tabs = state.tabs.length > 0 ? state.tabs : FALLBACK_STATE.tabs;
  const activeTab = tabs.find((tab) => tab.id === state.activeId) ?? tabs[0];

  const update = useCallback((next: (prev: BrowserState) => BrowserState) => {
    setStateRef.current(next);
  }, []);

  useEffect(() => {
    setAddress(activeTab?.url ?? '');
  }, [activeTab?.id, activeTab?.url]);

  /** 固定站点浮层：点浮层外面或按 Esc 就收起，不用再点一次图钉。 */
  useEffect(() => {
    if (!sitesOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popRef.current?.contains(target) || pinRef.current?.contains(target)) return;
      setSitesOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSitesOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [sitesOpen]);

  const register = useCallback((id: string, view: WebviewElement | null) => {
    if (view) views.current[id] = view;
    else delete views.current[id];
  }, []);

  const handleNavigate = useCallback(
    (id: string, url: string) => {
      update((prev) => ({
        ...prev,
        tabs: prev.tabs.map((tab) =>
          tab.id === id && tab.url !== url ? { ...tab, url } : tab,
        ),
      }));
      if (stateRef.current.activeId === id) setAddress(url);
    },
    [update],
  );

  const handleTitle = useCallback(
    (id: string, title: string) => {
      update((prev) => ({
        ...prev,
        tabs: prev.tabs.map((tab) => (tab.id === id ? { ...tab, title } : tab)),
      }));
    },
    [update],
  );

  const handleLoading = useCallback((id: string, loading: boolean) => {
    setLoadingId((current) => (loading ? id : current === id ? null : current));
  }, []);

  const navigate = useCallback(
    (raw: string) => {
      const current = stateRef.current;
      const tab = current.tabs.find((item) => item.id === current.activeId);
      if (!tab) return;
      const target = toTarget(raw, current.engine);
      if (!target) return;
      setAddress(target);
      update((prev) => ({
        ...prev,
        tabs: prev.tabs.map((item) =>
          item.id === tab.id
            ? {
                ...item,
                url: target,
                title:
                  item.url === target && item.title
                    ? item.title
                    : hostLabel(target) || item.title,
              }
            : item,
        ),
      }));
      const view = views.current[tab.id];
      if (view && tab.url) void view.loadURL(target).catch(() => {});
    },
    [update],
  );

  const newTab = useCallback(() => {
    const tab = blankTab();
    update((prev) => ({ ...prev, tabs: [...prev.tabs, tab], activeId: tab.id }));
    setAddress('');
    setSitesOpen(false);
  }, [update]);

  const closeTab = useCallback(
    (id: string) => {
      update((prev) => {
        const index = prev.tabs.findIndex((tab) => tab.id === id);
        let nextTabs = prev.tabs.filter((tab) => tab.id !== id);
        if (nextTabs.length === 0) nextTabs = [blankTab()];
        const activeId =
          prev.activeId === id
            ? nextTabs[Math.min(Math.max(index, 0), nextTabs.length - 1)].id
            : prev.activeId;
        return { ...prev, tabs: nextTabs, activeId };
      });
    },
    [update],
  );

  const activate = useCallback(
    (id: string) => {
      update((prev) => ({ ...prev, activeId: id }));
      setSitesOpen(false);
    },
    [update],
  );

  const openSites = () => {
    if (!sitesOpen) {
      setSiteLabel('');
      setSiteUrl(activeTab?.url ?? '');
    }
    setSitesOpen((open) => !open);
  };

  const pinAddress = (rawUrl: string, label: string) => {
    const target = toTarget(rawUrl, stateRef.current.engine);
    if (!/^https?:\/\//i.test(target)) {
      notify('请填写一个完整的网址，例如 https://www.bilibili.com', 'warn');
      return false;
    }
    const key = target.replace(/\/+$/, '');
    if (stateRef.current.sites.some((site) => site.url.replace(/\/+$/, '') === key)) {
      notify('这个地址已经固定过了', 'info');
      return false;
    }
    const site: PinnedSite = {
      id: `site-${Date.now().toString(36)}`,
      label: label.trim() || hostLabel(target) || target,
      url: target,
    };
    update((prev) => ({ ...prev, sites: [...prev.sites, site] }));
    notify(`已固定「${site.label}」`, 'success');
    return true;
  };

  const pinSite = (event: FormEvent) => {
    event.preventDefault();
    if (pinAddress(siteUrl, siteLabel)) {
      setSiteLabel('');
      setSiteUrl('');
    }
  };

  const pinCurrent = () => {
    const url = activeTab?.url;
    if (!url) {
      notify('当前标签页还没有打开网页', 'info');
      return;
    }
    if (pinAddress(url, siteLabel)) {
      setSiteLabel('');
      setSiteUrl('');
    }
  };

  const removeSite = (id: string) => {
    update((prev) => ({ ...prev, sites: prev.sites.filter((site) => site.id !== id) }));
  };

  const setEngine = (engine: EngineId) => {
    update((prev) => ({ ...prev, engine }));
  };

  const openExternal = async () => {
    if (!window.desktop) return;
    const result = await window.desktop.openExternal(activeTab?.url || HOME_URL);
    if (!result.ok) notify(result.error ?? '外部浏览器打开失败', 'warn');
  };

  const goHome = () => navigate(HOME_URL);
  const back = () => {
    const view = views.current[activeTab.id];
    if (view?.canGoBack()) view.goBack();
  };
  const forward = () => {
    const view = views.current[activeTab.id];
    if (view?.canGoForward()) view.goForward();
  };
  const reload = () => views.current[activeTab.id]?.reload();

  const siteButtons = useMemo(
    () =>
      state.sites.map((site) => (
        <button
          type="button"
          className="web-site-chip"
          key={site.id}
          title={site.url}
          onClick={() => {
            setSitesOpen(false);
            navigate(site.url);
          }}
        >
          <span>{site.label.slice(0, 2)}</span>
          {site.label}
        </button>
      )),
    [navigate, state.sites],
  );

  if (!supported) {
    return (
      <div className="webview-fallback">
        <Icon name="globe" size={26} />
        <strong>网页检索需要在桌面客户端中使用</strong>
        <p>浏览器预览环境不支持 Electron webview，启动客户端即可正常加载网页。</p>
      </div>
    );
  }

  const loading = loadingId === activeTab.id;

  return (
    <div className="web-view web-view-tabbed">
      <div className="web-tabs" role="tablist" aria-label="浏览器标签页">
        <div className="web-tabstrip">
          {tabs.map((tab) => (
            <div
              className={`web-tab${tab.id === activeTab.id ? ' on' : ''}`}
              key={tab.id}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                closeTab(tab.id);
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === activeTab.id}
                className="web-tab-main"
                title={tab.url || '新标签页'}
                onClick={() => activate(tab.id)}
              >
                <Icon name={tab.url ? 'globe' : 'plus'} size={11} />
                <span>{tab.title || hostLabel(tab.url) || '新标签页'}</span>
              </button>
              <button
                type="button"
                className="web-tab-close"
                aria-label="关闭标签页"
                title="关闭标签页"
                onClick={() => closeTab(tab.id)}
              >
                <Icon name="x" size={10} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="icon-btn web-tab-add"
            title="新建标签页"
            aria-label="新建标签页"
            onClick={newTab}
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
      </div>

      <div className="web-toolbar">
        <button type="button" className="icon-btn" title="后退" onClick={back}>
          <Icon name="arrowLeft" size={14} />
        </button>
        <button type="button" className="icon-btn" title="前进" onClick={forward}>
          <Icon name="arrowRight" size={14} />
        </button>
        <button type="button" className="icon-btn" title="刷新" onClick={reload}>
          <Icon name="refresh" size={14} />
        </button>
        <button type="button" className="icon-btn" title="首页" onClick={goHome}>
          <Icon name="home" size={14} />
        </button>

        <form
          className="web-address"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(address);
          }}
        >
          <Icon name="globe" size={13} />
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            placeholder="输入网址或搜索"
            spellCheck={false}
          />
          {loading && <i className="web-loading" />}
        </form>

        <button
          type="button"
          ref={pinRef}
          className={`icon-btn web-pin-btn${sitesOpen ? ' on' : ''}`}
          title="固定站点 · 管理这个盒子的常用地址"
          aria-expanded={sitesOpen}
          onClick={openSites}
        >
          <Icon name="pin" size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="在 Chrome / 默认浏览器打开"
          onClick={() => void openExternal()}
        >
          <Icon name="arrowUpRight" size={14} />
        </button>
      </div>

      {sitesOpen && (
        <div className="web-sites-pop" role="dialog" aria-label="固定站点" ref={popRef}>
          <header>
            <strong>固定站点 · {state.sites.length}</strong>
            <button
              type="button"
              className="icon-btn"
              aria-label="收起固定站点"
              onClick={() => setSitesOpen(false)}
            >
              <Icon name="x" size={12} />
            </button>
          </header>
          <div className="web-sites-pop-list">
            {state.sites.length === 0 && (
              <p className="web-sites-empty">还没有固定站点，把常用地址存在这里。</p>
            )}
            {state.sites.map((site) => (
              <div className="web-site-row" key={site.id}>
                <button
                  type="button"
                  className="web-site-open"
                  title={site.url}
                  onClick={() => {
                    setSitesOpen(false);
                    navigate(site.url);
                  }}
                >
                  <b>{site.label}</b>
                  <small>{site.url}</small>
                </button>
                <button
                  type="button"
                  className="web-site-del"
                  title="取消固定"
                  aria-label={`取消固定 ${site.label}`}
                  onClick={() => removeSite(site.id)}
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            ))}
          </div>
          <form className="web-sites-form" onSubmit={pinSite}>
            <input
              value={siteLabel}
              onChange={(event) => setSiteLabel(event.target.value)}
              placeholder="名称（例如 B站）"
            />
            <input
              value={siteUrl}
              onChange={(event) => setSiteUrl(event.target.value)}
              placeholder="https://www.bilibili.com"
              spellCheck={false}
            />
            <div className="web-sites-actions">
              <button
                type="button"
                className="ghost-btn web-site-current"
                onClick={pinCurrent}
                disabled={!activeTab?.url}
                title={activeTab?.url || '当前标签页还没有打开网页'}
              >
                <Icon name="pin" size={11} />
                固定当前页
              </button>
              <button type="submit" className="primary-btn" disabled={!siteUrl.trim()}>
                固定这个地址
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="web-stage">
        {tabs.map((tab) =>
          tab.url ? (
            <TabFrame
              key={tab.id}
              tab={tab}
              active={tab.id === activeTab.id}
              register={register}
              onNavigate={handleNavigate}
              onTitle={handleTitle}
              onLoading={handleLoading}
            />
          ) : null,
        )}

        {!activeTab.url && (
          <div className="web-start">
            <span className="web-start-glyph">
              <Icon name="globe" size={24} />
            </span>
            <strong>新标签页</strong>
            <p>地址栏可以输入网址，也可以直接搜索。固定站点只保存在这个浏览器盒子里。</p>

            {siteButtons.length > 0 && <div className="web-start-sites">{siteButtons}</div>}

            <div className="web-start-engine">
              <span>默认搜索</span>
              {ENGINES.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={state.engine === item.id ? 'on' : ''}
                  onClick={() => setEngine(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <button type="button" className="ghost-btn web-start-pin" onClick={openSites}>
              <Icon name="pin" size={12} />
              固定一个常用地址
            </button>
          </div>
        )}
      </div>

      <span className="web-current" title={activeTab.url || activeTab.title}>
        {activeTab.url || `${tabs.length} 个标签 · ${state.sites.length} 个固定站点`}
      </span>
    </div>
  );
}

/** 网页浏览：多标签常驻 webview，常用地址可固定在这个盒子里。 */
export const webSearchModule: ModuleDefinition = {
  manifest: {
    id: 'web.search',
    name: '网页浏览',
    version: '0.3.0',
    description: '多标签浏览，常用地址可固定；每个标签保持自己的页面，切换不重载。',
    icon: 'globe',
    kind: ['view', 'tool'],
    slots: ['center.view'],
    category: 'workspace',
    permissions: ['net:fetch'],
    persistState: true,
  },
  center: {
    tabLabel: '网页',
    title: '网页浏览',
    subtitle: () => '多标签 · 固定站点 · Chromium 内嵌',
  },
  View: ({ actions }) => <WebSearch notify={actions.notify} />,
};
