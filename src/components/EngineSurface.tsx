import { useEffect, useRef, useState, type RefObject } from 'react';
import type { BootConfig } from '../bootConfig';
import { setEngineActivity } from '../engineActivity';
import type { EngineProcessInfo } from '../engine/types';
import type { HarnessBinding } from '../types';
import { EngineBoot } from './EngineBoot';
import { Icon } from './icons';

type EngineTarget = 'workbench' | 'board';

interface EngineSurfaceProps {
  target: EngineTarget | null;
  info: EngineProcessInfo | null;
  /** 当前场景绑定的 Harness 会话；打开 DSH 时自动定位。 */
  harness?: HarnessBinding | null;
  /** 主题设置里的启动动画配置。 */
  boot?: BootConfig;
  onRestart: () => void;
}

interface WebviewElement extends HTMLElement {
  getURL?: () => string;
  loadURL?: (url: string) => Promise<void> | void;
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
}

type LoadPhase = 'loading' | 'ready' | 'failed';

const STATUS_TEXT: Record<EngineProcessInfo['status'], string> = {
  idle: 'DSH 引擎待启动',
  starting: 'DSH 引擎启动中',
  ready: 'DSH 引擎已连接',
  error: 'DSH 引擎未连接',
};

/** 每种宿主形态对应的停靠锚点：中枢台是中心画布，场景桌面是引擎盒子的内容区。 */
const ANCHOR_SELECTOR: Record<EngineTarget, string> = {
  workbench: '.center-body',
  board: '.board-tile.kind-module[data-module-id="session.chat"] .board-tile-body',
};

const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;
const ANCHOR_RETRY_MS = 320;

/**
 * 在官方页面里按标题定位会话行并切换。
 * Harness 没有 URL 会话路由，侧栏行是唯一稳定的入口；找不到时先展开折叠的会话列表。
 */
function harnessNavigator(title: string) {
  return `(async () => {
    const target = ${JSON.stringify(title)};
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clip = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const findRow = () => {
      const rows = [...document.querySelectorAll('[role="treeitem"]')];
      const exact = rows.find((row) =>
        [...row.querySelectorAll('span')].some((span) => clip(span.textContent) === target),
      );
      if (exact) return exact;
      return rows.find((row) => clip(row.innerText).startsWith(target)) || null;
    };
    let row = findRow();
    if (!row) {
      const expand = [...document.querySelectorAll('button')].find((button) =>
        /^展开其余/.test(clip(button.innerText)),
      );
      if (expand) {
        expand.click();
        await wait(600);
        row = findRow();
      }
    }
    if (!row) return 'missing';
    if (/selected/i.test(String(row.className))) return 'already';

    const rect = row.getBoundingClientRect();
    const x = rect.left + Math.max(10, rect.width / 2);
    const y = rect.top + Math.max(8, rect.height / 2);
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };
    row.dispatchEvent(new PointerEvent('pointerdown', base));
    row.dispatchEvent(new MouseEvent('mousedown', base));
    row.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
    row.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    row.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));

    await wait(350);
    if (!/selected/i.test(String(row.className))) {
      const key = Object.keys(row).find((name) => name.startsWith('__reactProps'));
      const onClick = key && row[key] ? row[key].onClick : null;
      if (typeof onClick === 'function') {
        onClick({
          currentTarget: row,
          target: row,
          preventDefault() {},
          stopPropagation() {},
          nativeEvent: { button: 0 },
        });
      }
    }
    return 'clicked';
  })()`;
}

/**
 * 读取官方页面的运行态。
 * 侧栏行本身没有忙碌标记，只能从当前会话的发送/停止按钮、running whale 和 aria-busy 判断。
 */
const ACTIVITY_PROBE = `(() => {
  const clip = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const selected = document.querySelector('[role="treeitem"][class*="selected"]');
  let title = '';
  if (selected) {
    const span = [...selected.querySelectorAll('span')].find((item) =>
      /title/i.test(String(item.className)),
    );
    title = clip(span ? span.textContent : selected.innerText).slice(0, 60);
  }
  const buttons = [...document.querySelectorAll('button')];
  const label = (button) => button.getAttribute('aria-label') || '';
  const stop = buttons.some((button) => /停止生成|停止|中断/.test(label(button)));
  const sending = buttons.some((button) => /正在发送消息/.test(label(button)));
  const whale = Boolean(document.querySelector('[class*="runningWhale"]'));
  const busy =
    stop || sending || whale || document.querySelectorAll('[aria-busy="true"]').length > 0;
  return { title, busy };
})()`;

/**
 * 官方 Harness 页面常驻层。
 * 全局只挂一个 webview：用 requestAnimationFrame 跟随宿主盒子的位置与尺寸，
 * 宿主不存在时只隐藏、不卸载，因此切换场景或模式都不会重载线程页面。
 */
export function EngineSurface({ target, info, harness, boot, onRestart }: EngineSurfaceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<WebviewElement | null>(null);
  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [loadError, setLoadError] = useState('');
  const [lastUrl, setLastUrl] = useState('');
  const [loadOverlay, setLoadOverlay] = useState(false);
  const hasDesktop = Boolean(window.desktop);
  const url = info?.url ?? '';

  // 重启引擎时 url 会短暂为空：保留最后一次地址，避免卸载 webview 造成额外重载。
  useEffect(() => {
    if (url) setLastUrl(url);
  }, [url]);

  // 页面加载很快时不要闪一层动画：持续 220ms 后才覆盖。
  useEffect(() => {
    if (!url || phase !== 'loading') {
      setLoadOverlay(false);
      return;
    }
    const timer = window.setTimeout(() => setLoadOverlay(true), 220);
    return () => window.clearTimeout(timer);
  }, [url, phase]);

  useEffect(() => {
    if (!url) {
      setPhase('loading');
      setLoadError('');
      return;
    }
    const view = webviewRef.current;
    if (!view) return;

    const onStart = () => setPhase('loading');
    const onReady = () => {
      setPhase('ready');
      setLoadError('');
    };
    const onStop = () => setPhase('ready');
    const onFail = (event: Event) => {
      const detail = event as Event & { errorDescription?: string };
      setPhase('failed');
      setLoadError(detail.errorDescription || '官方页面加载失败');
    };

    view.addEventListener('did-start-loading', onStart);
    view.addEventListener('dom-ready', onReady);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('did-fail-load', onFail);

    return () => {
      view.removeEventListener('did-start-loading', onStart);
      view.removeEventListener('dom-ready', onReady);
      view.removeEventListener('did-stop-loading', onStop);
      view.removeEventListener('did-fail-load', onFail);
    };
  }, [url]);

  // 进入某个场景的 DSH 时，把官方页面切到该场景绑定的会话。
  useEffect(() => {
    const title = harness?.title;
    if (!target || !title) return;

    let cancelled = false;
    let timer = 0;
    let attempts = 0;

    const schedule = () => {
      if (cancelled || attempts >= 30) return;
      attempts += 1;
      timer = window.setTimeout(run, 400);
    };

    const run = async () => {
      if (cancelled) return;
      // dom-ready 之前 webview 还没准备好接收脚本，过早调用会抛未捕获拒绝。
      if (phase !== 'ready') {
        schedule();
        return;
      }
      const view = webviewRef.current;
      if (!view?.executeJavaScript || !view.getURL?.()) {
        schedule();
        return;
      }
      try {
        const result = await view.executeJavaScript(harnessNavigator(title), true);
        if (result === 'clicked' || result === 'already') return;
      } catch {
        // 页面仍在加载，继续等侧栏就绪。
      }
      schedule();
    };

    run();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [harness?.sessionId, harness?.title, phase, target, url]);

  // 进程未就绪时先熄灭光灯，避免页面消失后还留着上一次的忙碌状态。
  useEffect(() => {
    if (info?.status !== 'ready') {
      setEngineActivity({ ready: false, activeTitle: '', busy: false });
    }
  }, [info?.status]);

  // 轮询官方页面的运行态。侧栏没有逐行忙碌标记，只能盯当前会话的发送/停止信号。
  useEffect(() => {
    if (phase !== 'ready' || !url) return;

    let disposed = false;
    let timer = 0;

    const run = async () => {
      if (disposed) return;
      const view = webviewRef.current;
      if (view?.executeJavaScript) {
        try {
          const result = (await view.executeJavaScript(ACTIVITY_PROBE, true)) as
            | { title?: string; busy?: boolean }
            | null;
          if (!disposed && result && typeof result === 'object') {
            setEngineActivity({
              ready: true,
              activeTitle: typeof result.title === 'string' ? result.title : '',
              busy: Boolean(result.busy),
            });
          }
        } catch {
          // 页面切换瞬间执行上下文会失效，下一轮再试。
        }
      }
      if (!disposed) timer = window.setTimeout(run, 500);
    };

    timer = window.setTimeout(run, 260);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [phase, target, url]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let frame = 0;
    let anchor: HTMLElement | null = null;
    let lastSearch = 0;
    let visible = false;
    let focused = root.classList.contains('focused');
    let bounds = { left: -1, top: -1, width: -1, height: -1 };
    let lastClip = 'none';

    const hide = () => {
      if (!visible) return;
      visible = false;
      root.style.display = 'none';
      root.setAttribute('aria-hidden', 'true');
    };

    if (!target) {
      hide();
      return;
    }

    const selector = ANCHOR_SELECTOR[target];

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!anchor || !anchor.isConnected) {
        anchor = null;
        if (now - lastSearch < ANCHOR_RETRY_MS) return;
        lastSearch = now;
        anchor = document.querySelector<HTMLElement>(selector);
      }

      const rect = anchor?.getBoundingClientRect();
      const inView =
        rect &&
        rect.width >= MIN_WIDTH &&
        rect.height >= MIN_HEIGHT &&
        rect.right > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight &&
        rect.bottom > 0;

      if (!inView) {
        hide();
        return;
      }

      // 场景桌面是滚动容器：盒子滚出可视区时，常驻 webview 必须一起被裁掉，
      // 否则它会盖在顶栏、场景标签或底栏上，看起来“超出背景”。
      let clip = 'none';
      const stage = target === 'board' ? anchor?.closest('.board-stage') ?? null : null;
      if (stage) {
        const area = stage.getBoundingClientRect();
        const top = Math.max(0, Math.round(area.top - rect.top));
        const right = Math.max(0, Math.round(rect.right - area.right));
        const bottom = Math.max(0, Math.round(rect.bottom - area.bottom));
        const left = Math.max(0, Math.round(area.left - rect.left));
        if (top + bottom >= rect.height - 1 || left + right >= rect.width - 1) {
          hide();
          return;
        }
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        // 右下角的 18px 缺口留给尺寸手柄；底部或右侧被滚动裁掉时就不用留了。
        const notched =
          right === 0 && bottom === 0 && width - 18 > left && height - 18 > top;
        clip = notched
          ? `polygon(${left}px ${top}px, ${width - right}px ${top}px, ${width - right}px ${
              height - bottom - 18
            }px, ${width - right - 18}px ${height - bottom - 18}px, ${
              width - right - 18
            }px ${height - bottom}px, ${left}px ${height - bottom}px)`
          : `inset(${top}px ${right}px ${bottom}px ${left}px)`;
      }
      if (clip !== lastClip) {
        lastClip = clip;
        root.style.clipPath = clip;
      }

      const left = Math.round(rect.left);
      const top = Math.round(rect.top);
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (
        left !== bounds.left ||
        top !== bounds.top ||
        width !== bounds.width ||
        height !== bounds.height
      ) {
        bounds = { left, top, width, height };
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
        root.style.width = `${width}px`;
        root.style.height = `${height}px`;
      }

      if (!visible) {
        visible = true;
        root.style.display = 'flex';
        root.removeAttribute('aria-hidden');
      }

      // 专注模式下盒子没有尺寸手柄，不需要为手柄留出缺口。
      const nextFocused = Boolean(anchor?.closest('.board-focus-layer'));
      if (nextFocused !== focused) {
        focused = nextFocused;
        root.classList.toggle('focused', focused);
      }
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      hide();
      root.style.clipPath = '';
    };
  }, [target]);

  const retry = () => {
    setLoadError('');
    setPhase('loading');
    onRestart();
  };

  const engineStatus = info?.status ?? 'idle';
  const webviewSrc = url || lastUrl;
  const booting = hasDesktop && (engineStatus === 'idle' || engineStatus === 'starting');
  const showWebview = Boolean(webviewSrc);
  const showCard = !booting && !showWebview;

  return (
    <div
      ref={rootRef}
      className={`engine-surface${target === 'board' ? ' board' : ''}`}
      aria-hidden="true"
    >
      {showWebview && (
        <webview
          ref={webviewRef as unknown as RefObject<HTMLElement>}
          className="engine-surface-view"
          src={webviewSrc}
          partition="persist:dsh-engine"
        />
      )}

      {booting && (
        <EngineBoot
          overlay={showWebview}
          status={engineStatus}
          port={info?.port}
          boot={boot}
          onRestart={retry}
        />
      )}

      {showCard && (
        <div className="engine-surface-card">
          <span className={`engine-surface-mark ${engineStatus}`}>
            <Icon name={engineStatus === 'error' ? 'alert' : 'spark'} size={24} />
          </span>
          <h3>{hasDesktop ? STATUS_TEXT[engineStatus] : '官方页面仅桌面端可用'}</h3>
          <p>
            {hasDesktop
              ? engineStatus === 'error'
                ? info?.error
                : '引擎尚未启动，工作台会在启动时自动拉起。'
              : '浏览器预览环境没有 Electron 能力，无法嵌入 DSH 官方页面。'}
          </p>

          {hasDesktop && engineStatus === 'error' && info?.log && (
            <pre className="engine-surface-log">{info.log}</pre>
          )}

          {hasDesktop && (
            <div className="engine-surface-actions">
              <button type="button" className="ghost-btn" onClick={retry}>
                <Icon name="refresh" size={13} />
                启动引擎
              </button>
              {info?.port && <span className="engine-surface-hint">端口 {info.port}</span>}
            </div>
          )}
        </div>
      )}

      {showWebview && !booting && phase === 'loading' && loadOverlay && (
        <EngineBoot
          overlay
          status="ready"
          detail="正在加载官方页面"
          port={info?.port}
          boot={boot}
        />
      )}

      {showWebview && phase === 'failed' && (
        <div className="engine-surface-alert">
          <Icon name="alert" size={14} />
          <span>{loadError || '官方页面加载失败'}</span>
          <button type="button" className="ghost-btn" onClick={retry}>
            重试
          </button>
        </div>
      )}

      {showWebview && engineStatus === 'error' && (
        <div className="engine-surface-alert">
          <Icon name="alert" size={14} />
          <span>{info?.error}</span>
          <button type="button" className="ghost-btn" onClick={retry}>
            重启引擎
          </button>
        </div>
      )}
    </div>
  );
}
