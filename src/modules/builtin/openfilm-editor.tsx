import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Icon } from '../../components/icons';
import type { OpenfilmStatus } from '../../openfilm/types';
import type { ModuleDefinition, ModuleViewProps } from '../types';

type StudioView = HTMLElement & {
  reload: () => void;
  getURL: () => string;
};

const EMPTY_STATUS: OpenfilmStatus = {
  status: 'idle',
  error: '',
  attached: false,
  origin: '',
  editorUrl: '',
  project: null,
};

/** 编辑器地址带 launch key：只放内存，不进存档、不进日志。 */
function OpenfilmEditor({ notify }: { notify: ModuleViewProps['actions']['notify'] }) {
  const [status, setStatus] = useState<OpenfilmStatus>(EMPTY_STATUS);
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(false);
  const [frameError, setFrameError] = useState('');
  const viewRef = useRef<StudioView | null>(null);
  const srcRef = useRef('');
  srcRef.current = src;

  const apply = useCallback((next: OpenfilmStatus) => {
    setStatus(next);
    if (next.status !== 'ready' || !next.editorUrl) return;
    setSrc((previous) => {
      /* Studio 重启会换端口或 key：旧地址作废，其余情况保留当前项目页 */
      if (!previous || !previous.startsWith(`${next.origin}/`)) return next.editorUrl;
      return previous;
    });
  }, []);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    let alive = true;
    const listen = (next: OpenfilmStatus) => {
      if (alive) apply(next);
    };
    void bridge.openfilmStatus().then(listen);
    const off = bridge.onOpenfilmStatus(listen);
    void bridge.openfilmEnsure().then(listen);
    return () => {
      alive = false;
      off();
    };
  }, [apply]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const onStart = () => {
      setLoading(true);
      setFrameError('');
    };
    const onStop = () => setLoading(false);
    const onFail = (event: Event) => {
      const detail = event as Event & { errorDescription?: string; isMainFrame?: boolean };
      if (detail.isMainFrame === false) return;
      setLoading(false);
      setFrameError(detail.errorDescription || '编辑器页面加载失败');
    };
    view.addEventListener('did-start-loading', onStart);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('did-fail-load', onFail);
    return () => {
      view.removeEventListener('did-start-loading', onStart);
      view.removeEventListener('did-stop-loading', onStop);
      view.removeEventListener('did-fail-load', onFail);
    };
  }, [src]);

  const chooseProject = async () => {
    const bridge = window.desktop;
    if (!bridge) return;
    const picked = await bridge.openfilmChooseProject();
    if (picked.canceled || !picked.path) return;
    setLoading(true);
    const next = await bridge.openfilmOpenProject(picked.path);
    apply(next);
    if (next.status === 'ready') {
      setSrc(next.url || next.editorUrl);
      notify(`已打开影片 ${next.project?.name || ''}`.trim(), 'success');
    } else {
      notify(next.error || '打开影片失败', 'warn');
    }
    setLoading(false);
  };

  const retry = async () => {
    const bridge = window.desktop;
    if (!bridge) return;
    setFrameError('');
    setLoading(true);
    apply(await bridge.openfilmEnsure());
    setLoading(false);
  };

  const reload = () => {
    setFrameError('');
    setLoading(true);
    viewRef.current?.reload();
  };

  const openExternal = async () => {
    const target = srcRef.current;
    if (!target) return;
    const result = await window.desktop?.openfilmOpenExternal(target);
    if (result && !result.ok) notify(result.error || '无法在浏览器打开', 'warn');
  };

  const phase = status.status;
  const phaseText =
    phase === 'ready'
      ? status.attached
        ? '附着已有 Studio'
        : 'Studio 已连接'
      : phase === 'starting'
        ? '正在启动 Studio'
        : phase === 'error'
          ? 'Studio 未启动'
          : '准备中';
  const projectName = status.project?.name || '';

  return (
    <div className="openfilm-view">
      <div className="openfilm-bar">
        <span className="openfilm-brand">
          <Icon name="film" size={14} />
          OpenFilm Studio
        </span>
        <span className={`openfilm-dot ${phase}`} aria-hidden="true" />
        <span className="openfilm-phase" title={status.error || status.origin}>
          {phaseText}
        </span>
        {projectName && (
          <span className="openfilm-project" title={status.project?.path}>
            {projectName}
          </span>
        )}
        <span className="openfilm-spacer" />
        <button
          type="button"
          className="openfilm-btn"
          onClick={() => void chooseProject()}
          disabled={phase === 'starting'}
          title="选择影片目录（含 film.html）"
        >
          <Icon name="folder" size={12} />
          打开影片
        </button>
        <button
          type="button"
          className="openfilm-btn"
          onClick={reload}
          disabled={!src}
          title="重新载入编辑器页面"
        >
          <Icon name="refresh" size={12} />
        </button>
        <button
          type="button"
          className="openfilm-btn"
          onClick={() => void openExternal()}
          disabled={!src}
          title="在系统浏览器打开当前编辑页"
        >
          <Icon name="arrowUpRight" size={12} />
        </button>
      </div>
      <div className="openfilm-stage">
        {src ? (
          <webview
            ref={viewRef as unknown as RefObject<HTMLElement>}
            className="openfilm-frame"
            src={src}
            partition="persist:workbench-openfilm"
          />
        ) : null}
        {loading && <i className="openfilm-progress" aria-hidden="true" />}
        {!src && (
          <div className="openfilm-cover">
            <Icon name="film" size={30} />
            <h4>{phase === 'error' ? 'OpenFilm Studio 没有起来' : '正在启动 OpenFilm Studio'}</h4>
            <p>
              {phase === 'error'
                ? status.error || '请重试，或检查 openfilm 依赖是否完整。'
                : '第一次启动会拉起本地编辑器（127.0.0.1），并复用已经下载的 Chromium 与 ffmpeg。'}
            </p>
            {phase === 'error' && (
              <button type="button" className="ghost-btn" onClick={() => void retry()}>
                重新启动
              </button>
            )}
          </div>
        )}
        {frameError && src && (
          <div className="openfilm-cover overlay">
            <h4>编辑器加载失败</h4>
            <p>{frameError}</p>
            <button type="button" className="ghost-btn" onClick={reload}>
              重新载入
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export const openfilmModule: ModuleDefinition = {
  manifest: {
    id: 'openfilm.editor',
    name: 'OpenFilm 剪辑',
    version: '0.1.0',
    description:
      '内嵌 OpenFilm Studio：媒体库、画布、Inspector 与时间线；工作台托管本地 Studio 进程，agent 执行 openfilm open 时内嵌页面自动切到该影片。',
    icon: 'film',
    kind: ['view', 'tool'],
    slots: ['center.view'],
    category: 'workspace',
    origin: 'third-party',
    permissions: ['net:fetch'],
    persistState: false,
  },
  center: {
    tabLabel: '剪辑',
    title: 'OpenFilm 剪辑',
    subtitle: () => '内嵌 Studio · 工作台托管本地进程 · agent 打开影片时自动切换',
  },
  View: ({ actions }) => <OpenfilmEditor notify={actions.notify} />,
};
