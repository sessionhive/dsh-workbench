import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { isSessionWorking, isTitleWorking, useEngineActivity } from '../../engineActivity';
import type { EngineEvent, EngineSnapshot } from '../../engine/types';
import { useEngineEvents } from '../../hooks/useEngineEvents';
import { buildNeuronModel, type NeuronNode } from '../../neuron/model';
import { mixHex, resolveTheme, rgba, type WorkbenchSettings } from '../../settings';
import type { Session } from '../../types';
import type { ModuleActions, ModuleDefinition } from '../types';

interface NeuronGraphProps {
  sessions: Session[];
  engine: EngineSnapshot | null;
  engineLoading: boolean;
  refreshEngine: () => void;
  settings: WorkbenchSettings;
  actions: ModuleActions;
}

interface ScreenNode {
  id: string;
  x: number;
  y: number;
  radius: number;
  z: number;
}

const KIND_LABEL: Record<NeuronNode['kind'], string> = {
  core: '内核',
  scene: '会话',
  card: '角色卡',
  memory: '记忆',
  skill: '技能',
  event: '事件',
};

const KIND_COLOR: Record<NeuronNode['kind'], string> = {
  core: '#7fe3ff',
  scene: '#38e1e6',
  card: '#f0c674',
  memory: '#dfe7ff',
  skill: '#6f8fd6',
  event: '#8f9bb3',
};

const CORE_ID = 'core';

/** 与主进程只读白名单保持一致；白名单外的文件只提供「打开文件」。 */
const READABLE_FILE =
  /^(?:agents\/[A-Za-z0-9._-]+\/(?:card\.json|summary\.md|memory\/.+\.(?:md|markdown|txt))|skills\/[A-Za-z0-9._-]+\/SKILL\.md)$/i;

function readablePath(node: NeuronNode) {
  const path = node.path?.replace(/\\/g, '/').replace(/^\/+/, '') ?? '';
  return path && READABLE_FILE.test(path) ? path : '';
}

function isFileNode(node: NeuronNode) {
  return Boolean(node.path && /\.[A-Za-z0-9]+$/.test(node.path.replace(/[\\/]+$/, '')));
}

/** 打开目录/文件的白名单前缀：与主进程 engine:open-path 保持一致。 */
function openableRelative(node: NeuronNode) {
  const path = node.path?.replace(/\\/g, '/').replace(/^\/+/, '') ?? '';
  return /^(agents|skills)\/[A-Za-z0-9._-]+\//i.test(`${path}/`) ? path : '';
}

function formatBytes(size?: number) {
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileDocState {
  loading: boolean;
  text?: string;
  size?: number;
  error?: string;
}

type PulseKind = 'message' | 'dispatch' | 'wake' | 'receipt' | 'close' | 'handover';

const PULSE_LABEL: Record<PulseKind, string> = {
  message: '消息',
  dispatch: '派单',
  wake: '唤醒',
  receipt: '回执',
  close: '关闭',
  handover: '交接',
};

const PULSE_COLOR: Record<PulseKind, string> = {
  message: '#38e1e6',
  dispatch: '#8f80ff',
  wake: '#f6b64c',
  receipt: '#3ee0a3',
  close: '#3ee0a3',
  handover: '#e468d4',
};

interface PulseSpec {
  key: string;
  fromId: string;
  toId: string;
  kind: PulseKind;
  status: string;
  start: number;
  duration: number;
  line: boolean;
}

interface Ripple {
  id: string;
  start: number;
  duration: number;
  color: string;
}

interface FeedItem {
  key: string;
  stamp: number;
  time: string;
  kind: PulseKind;
  label: string;
  fromId: string | null;
  toId: string | null;
  fromLabel: string;
  toLabel: string;
  nodes: string[];
}

function normalizeKind(event: EngineEvent): PulseKind | null {
  const raw = String(event.type || event.event || '').toLowerCase();
  if (
    raw === 'message' ||
    raw === 'dispatch' ||
    raw === 'wake' ||
    raw === 'receipt' ||
    raw === 'close' ||
    raw === 'handover'
  ) {
    return raw;
  }
  return null;
}

function eventTime(event: EngineEvent): number {
  const parsed = event.ts ? Date.parse(event.ts) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function clockLabel(event: EngineEvent): string {
  const stamp = eventTime(event);
  if (!stamp) return '—';
  return new Date(stamp).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function pulseColor(kind: PulseKind, status: string): string {
  if (kind === 'close' && /cancel|fail/i.test(status)) return '#f6b64c';
  return PULSE_COLOR[kind];
}

const spriteCache = new Map<string, HTMLCanvasElement>();

function nodeSprite(color: string, light: boolean) {
  const key = `${color}|${light ? 'day' : 'night'}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 62);
    gradient.addColorStop(0, light ? 'rgba(255,255,255,0.98)' : '#ffffff');
    gradient.addColorStop(0.08, light ? rgba(color, 0.9) : rgba(color, 0.94));
    gradient.addColorStop(0.16, light ? rgba(color, 0.66) : rgba(color, 0.68));
    gradient.addColorStop(0.28, rgba(color, light ? 0.34 : 0.36));
    gradient.addColorStop(0.48, rgba(color, light ? 0.13 : 0.16));
    gradient.addColorStop(0.72, rgba(color, light ? 0.05 : 0.05));
    gradient.addColorStop(1, rgba(color, 0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  spriteCache.set(key, canvas);
  return canvas;
}

export function NeuronGraph({
  sessions,
  engine,
  engineLoading,
  refreshEngine,
  settings,
  actions,
}: NeuronGraphProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef({ rx: -0.16, ry: -0.42, zoom: 1.33 });
  const hitRef = useRef<ScreenNode[]>([]);
  const dragRef = useRef({ active: false, moved: false, x: 0, y: 0 });
  const hoverRef = useRef<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [onlyMemory, setOnlyMemory] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const selectedIdRef = useRef<string | null>(null);
  const queryRef = useRef('');
  const dirtyRef = useRef<() => void>(() => undefined);
  const pulseRef = useRef<PulseSpec[]>([]);
  const pendingRef = useRef<PulseSpec[]>([]);
  const rippleRef = useRef<Ripple[]>([]);
  const heatRef = useRef(new Map<string, number>());
  const cooldownRef = useRef(new Map<string, number>());
  const seenRef = useRef(new Set<string>());
  const baselineRef = useRef(false);
  const pairRef = useRef<string[]>([]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [fileView, setFileView] = useState<{ path: string; title: string } | null>(null);
  const [fileDoc, setFileDoc] = useState<FileDocState | null>(null);
  const [fileExpanded, setFileExpanded] = useState(false);
  const fileSeqRef = useRef(0);
  const openFileRef = useRef<(node: NeuronNode) => void>(() => undefined);
  selectedIdRef.current = selectedId;
  queryRef.current = query;

  const activity = useEngineActivity();
  const feed = useEngineEvents(engine?.root ?? '', Boolean(engine?.ok));

  const model = useMemo(
    () => buildNeuronModel(sessions, engine, onlyMemory),
    [engine, onlyMemory, sessions],
  );

  const selected = model.nodes.find((node) => node.id === selectedId) ?? null;
  const motion = settings.appearance.motion;
  const theme = resolveTheme(settings);
  const light = theme.tone === 'light';
  const accent = theme.accent;

  const closeFile = () => {
    fileSeqRef.current += 1;
    setFileView(null);
    setFileDoc(null);
    setFileExpanded(false);
  };

  const openFile = (node: NeuronNode) => {
    const target = readablePath(node);
    const root = engine?.root;
    const desktop = window.desktop;
    if (!target || !root || !desktop) return;
    const seq = ++fileSeqRef.current;
    setFileView({ path: target, title: node.label });
    setFileDoc({ loading: true });
    setFileExpanded(true);
    void desktop
      .readEngineDoc(root, target)
      .then((result) => {
        if (seq !== fileSeqRef.current) return;
        setFileDoc({
          loading: false,
          text: result.text ?? '',
          size: result.size,
          error: result.ok ? undefined : result.error || '无法读取该文件',
        });
      })
      .catch((error: unknown) => {
        if (seq !== fileSeqRef.current) return;
        setFileDoc({
          loading: false,
          error: String((error as Error)?.message ?? error),
        });
      });
  };
  openFileRef.current = openFile;

  useEffect(() => {
    if (!fileView) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      fileSeqRef.current += 1;
      setFileView(null);
      setFileDoc(null);
      setFileExpanded(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [fileView]);

  // 只把官方页面正在执行的会话映射成工作节点；其余会话只显示“最近活动”。
  const workingNodes = useMemo(() => {
    const ids = new Set<string>();
    if (!activity.ready || activity.working.length === 0) return ids;
    for (const node of model.nodes) {
      if (node.kind !== 'scene') continue;
      const local =
        sessions.find((session) => session.id === node.sessionId) ??
        sessions.find(
          (session) => session.engine?.sceneId && session.engine.sceneId === node.sceneId,
        );
      if (local && isSessionWorking(activity, local)) {
        ids.add(node.id);
        continue;
      }
      if (node.label && isTitleWorking(activity, node.label)) ids.add(node.id);
    }
    return ids;
  }, [activity, model.nodes, sessions]);
  const workingRef = useRef(workingNodes);
  workingRef.current = workingNodes;

  useEffect(() => {
    if (workingNodes.size) dirtyRef.current();
  }, [workingNodes]);

  // 事件终点解析：场景 id / 会话 id / 标题都尽量落到一个节点上，找不到就不连线。
  const resolverRef = useRef<(raw?: string) => string | null>(() => null);
  resolverRef.current = (raw) => {
    const key = String(raw ?? '').trim();
    if (!key) return null;
    if (key === 'host' || key === CORE_ID) return CORE_ID;

    const direct = model.nodes.find(
      (node) =>
        node.kind === 'scene' &&
        (node.sceneId === key || node.sessionId === key || node.label === key),
    );
    if (direct) return direct.id;

    const scene = engine?.scenes.find(
      (item) =>
        item.id === key ||
        item.name === key ||
        item.sessions.some((entry) => entry.sessionId === key),
    );
    if (scene) {
      const node = model.nodes.find((item) => item.sceneId === scene.id);
      if (node) return node.id;
    }

    const local = sessions.find(
      (session) =>
        session.id === key ||
        session.harness?.title === key ||
        session.engine?.sceneId === key,
    );
    if (local) {
      const node = model.nodes.find(
        (item) => item.sessionId === local.id || item.sceneId === local.engine?.sceneId,
      );
      if (node) return node.id;
    }
    return null;
  };

  const labelRef = useRef<(id: string | null, fallback?: string) => string>(() => '');
  labelRef.current = (id, fallback) => {
    if (!id) return fallback || '未知';
    return model.nodes.find((node) => node.id === id)?.label ?? fallback ?? id;
  };

  // 引擎事件增量：首轮只建立基线，之后的新事件才触发脉冲。
  useEffect(() => {
    if (!feed?.ok) return;
    const unique = new Map<string, { event: EngineEvent; kind: PulseKind }>();
    for (const event of [...feed.events, ...feed.dispatches]) {
      const kind = normalizeKind(event);
      if (!kind) continue;
      const key = `${event.ts || ''}|${kind}|${event.from || ''}|${event.to || ''}|${event.status || ''}|${event.order_id || ''}`;
      if (!unique.has(key)) unique.set(key, { event, kind });
    }

    const buildItem = (key: string, event: EngineEvent, kind: PulseKind): FeedItem => {
      const fromId = resolverRef.current(event.from);
      const toId = resolverRef.current(event.to);
      const sceneId = kind === 'handover' ? resolverRef.current(event.scene) : null;
      const sceneLabel = sceneId ? labelRef.current(sceneId, event.scene) : '';
      const fromLabel = fromId
        ? labelRef.current(fromId, event.from)
        : kind === 'handover'
          ? sceneLabel || '原会话'
          : '宿主';
      const toLabel = toId
        ? labelRef.current(toId, event.to)
        : kind === 'handover'
          ? '新会话'
          : '未建会话';
      return {
        key,
        stamp: eventTime(event),
        time: clockLabel(event),
        kind,
        label: PULSE_LABEL[kind],
        fromId,
        toId,
        fromLabel,
        toLabel,
        nodes: [fromId, toId].filter((item): item is string => Boolean(item)),
      };
    };

    const entries = [...unique.entries()].map(([key, value]) => ({
      key,
      ...value,
      stamp: eventTime(value.event),
    }));

    if (!baselineRef.current) {
      entries.forEach((entry) => seenRef.current.add(entry.key));
      baselineRef.current = true;
      setFeedItems(
        entries
          .sort((a, b) => b.stamp - a.stamp)
          .slice(0, 6)
          .map((entry) => buildItem(entry.key, entry.event, entry.kind)),
      );
      return;
    }

    const now = performance.now();
    const fresh = entries
      .filter((entry) => !seenRef.current.has(entry.key))
      .sort((a, b) => a.stamp - b.stamp)
      .slice(-6);
    if (fresh.length === 0) return;
    fresh.forEach((entry) => seenRef.current.add(entry.key));
    if (seenRef.current.size > 300) {
      seenRef.current = new Set([...seenRef.current].slice(-200));
    }

    for (const entry of fresh) {
      const item = buildItem(entry.key, entry.event, entry.kind);
      const fromId = item.fromId ?? CORE_ID;
      if (!item.toId) continue;
      if (!motion) {
        heatRef.current.set(item.toId, now);
        continue;
      }
      const wake = entry.kind === 'wake';
      const duration =
        entry.kind === 'dispatch' ? 1100 : entry.kind === 'handover' ? 1200 : wake ? 720 : 950;
      const pulse: PulseSpec = {
        key: entry.key,
        fromId,
        toId: item.toId,
        kind: entry.kind,
        status: entry.event.status || '',
        start: now,
        duration,
        line: !wake,
      };
      const edgeKey = `${pulse.fromId}->${pulse.toId}:${pulse.kind}`;
      const last = cooldownRef.current.get(edgeKey) ?? -Infinity;
      if (now - last < 700 || pulseRef.current.length >= 4) {
        if (pendingRef.current.length >= 8) pendingRef.current.shift();
        pendingRef.current.push(pulse);
      } else {
        cooldownRef.current.set(edgeKey, now);
        pulseRef.current.push(pulse);
      }
    }
    dirtyRef.current();

    setFeedItems((previous) => {
      const merged = new Map(previous.map((item) => [item.key, item]));
      fresh.forEach((entry) =>
        merged.set(entry.key, buildItem(entry.key, entry.event, entry.kind)),
      );
      return [...merged.values()].sort((a, b) => b.stamp - a.stamp).slice(0, 6);
    });
  }, [feed, motion]);

  // 换引擎目录时重置基线与缓存，避免拿旧事件补放动画。
  useEffect(() => {
    baselineRef.current = false;
    seenRef.current = new Set();
    pulseRef.current = [];
    pendingRef.current = [];
    rippleRef.current = [];
    heatRef.current.clear();
    cooldownRef.current.clear();
    setFeedItems([]);
  }, [engine?.root]);

  useEffect(() => {
    if (selectedId && !model.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(null);
    }
  }, [model.nodes, selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    let dirty = true;
    let disposed = false;
    let lastPaint = 0;

    // 三层星野：远层细密、近层略亮，靠缓慢漂移和闪烁形成视差，不额外占帧。
    const stars = Array.from({ length: 186 }, (_, index) => {
      const depth = index < 108 ? 0 : index < 164 ? 1 : 2;
      const size =
        depth === 0
          ? 0.3 + ((index * 3) % 10) / 26
          : depth === 1
            ? 0.45 + ((index * 5) % 10) / 18
            : 0.72 + ((index * 7) % 10) / 13;
      return {
        x: Math.abs((Math.sin(index * 12.9898) * 43758.5453) % 1),
        y: Math.abs((Math.sin(index * 78.233 + 1.7) * 12543.231) % 1),
        r: size,
        alpha: depth === 0 ? 0.14 : depth === 1 ? 0.22 : 0.34,
        speed: depth === 0 ? 0.0000014 : depth === 1 ? 0.0000034 : 0.0000072,
        phase: index * 0.7,
        depth,
        tint: index % 7 === 0 ? accent : mixHex(accent, '#ffffff', 0.66),
      };
    });

    // 背景与暗角都属于静态层，按尺寸/主题缓存到离屏画布，避免每帧重建渐变。
    const baseLayer = document.createElement('canvas');
    const vignetteLayer = document.createElement('canvas');

    const paintBase = () => {
      const scale = Math.min(2, dpr);
      baseLayer.width = Math.max(1, Math.round(width * scale));
      baseLayer.height = Math.max(1, Math.round(height * scale));
      const layer = baseLayer.getContext('2d');
      if (layer) {
        layer.setTransform(scale, 0, 0, scale, 0, 0);
        layer.clearRect(0, 0, width, height);
        const shell = light
          ? mixHex(theme.background, '#ffffff', 0.4)
          : mixHex(theme.background, '#ffffff', 0.035);
        const background = layer.createRadialGradient(
          width * 0.5,
          height * 0.46,
          0,
          width * 0.5,
          height * 0.46,
          Math.max(width, height) * 0.74,
        );
        if (light) {
          background.addColorStop(0, '#fdfefe');
          background.addColorStop(0.45, shell);
          background.addColorStop(1, mixHex(theme.background, '#dde7f1', 0.45));
        } else {
          background.addColorStop(0, mixHex(theme.background, accent, 0.07));
          background.addColorStop(0.5, shell);
          background.addColorStop(1, mixHex(theme.background, '#000000', 0.3));
        }
        layer.fillStyle = background;
        layer.fillRect(0, 0, width, height);

        const nebulas = [
          { x: 0.3, y: 0.34, r: 0.44, color: accent, alpha: light ? 0.075 : 0.13 },
          {
            x: 0.72,
            y: 0.24,
            r: 0.34,
            color: mixHex(accent, light ? '#f0b34a' : '#7a5cff', 0.45),
            alpha: light ? 0.05 : 0.08,
          },
          {
            x: 0.6,
            y: 0.76,
            r: 0.42,
            color: mixHex(accent, light ? '#bfe4ff' : '#2a8bff', 0.5),
            alpha: light ? 0.05 : 0.065,
          },
        ];
        const glow = 0.55 + theme.glow / 120;
        const energy = light ? 1 : 0.76;
        layer.globalCompositeOperation = light ? 'source-over' : 'screen';
        for (const nebula of nebulas) {
          const cloud = layer.createRadialGradient(
            width * nebula.x,
            height * nebula.y,
            0,
            width * nebula.x,
            height * nebula.y,
            Math.max(width, height) * nebula.r,
          );
          cloud.addColorStop(0, rgba(nebula.color, nebula.alpha * glow * energy));
          cloud.addColorStop(0.55, rgba(nebula.color, nebula.alpha * 0.32 * glow * energy));
          cloud.addColorStop(1, rgba(nebula.color, 0));
          layer.fillStyle = cloud;
          layer.fillRect(0, 0, width, height);
        }
        layer.globalCompositeOperation = 'source-over';
      }

      vignetteLayer.width = Math.max(1, Math.round(width * scale));
      vignetteLayer.height = Math.max(1, Math.round(height * scale));
      const shade = vignetteLayer.getContext('2d');
      if (shade) {
        shade.setTransform(scale, 0, 0, scale, 0, 0);
        shade.clearRect(0, 0, width, height);
        const vignette = shade.createRadialGradient(
          width / 2,
          height / 2,
          Math.min(width, height) * 0.22,
          width / 2,
          height / 2,
          Math.max(width, height) * 0.78,
        );
        vignette.addColorStop(0, 'rgba(0,0,0,0)');
        vignette.addColorStop(1, light ? rgba(theme.background, 0.24) : 'rgba(0,0,0,0.5)');
        shade.fillStyle = vignette;
        shade.fillRect(0, 0, width, height);
      }
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(320, rect.width);
      height = Math.max(260, rect.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      paintBase();
      dirty = true;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();

    const rotatePoint = (position: [number, number, number]) => {
      const { rx, ry } = viewRef.current;
      const cy = Math.cos(ry);
      const sy = Math.sin(ry);
      const cx = Math.cos(rx);
      const sx = Math.sin(rx);
      const x1 = position[0] * cy - position[2] * sy;
      const z1 = position[0] * sy + position[2] * cy;
      const y2 = position[1] * cx - z1 * sx;
      const z2 = position[1] * sx + z1 * cx;
      return { x: x1, y: y2, z: z2 };
    };

    const project = (position: [number, number, number]) => {
      const rotated = rotatePoint(position);
      const scale = Math.min(width, height) * 0.36 * viewRef.current.zoom;
      const persp = 3.2 / (3.2 - rotated.z * 0.72);
      return {
        x: width / 2 + rotated.x * scale * persp,
        y: height / 2 + rotated.y * scale * persp,
        z: rotated.z,
        persp,
      };
    };

    const isMatch = (node: NeuronNode) => {
      const keyword = queryRef.current.trim().toLowerCase();
      if (!keyword) return true;
      return `${node.label} ${node.meta ?? ''} ${node.detail ?? ''} ${node.group ?? ''}`
        .toLowerCase()
        .includes(keyword);
    };

    const draw = (time: number) => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      context.drawImage(baseLayer, 0, 0, width, height);

      // 结构环：给出星图的空间参考，旋转时形成高级仪器感。
      const centerX = width / 2;
      const centerY = height / 2;
      const base = Math.min(width, height) * 0.36 * viewRef.current.zoom;
      context.save();
      context.translate(centerX, centerY);
      for (let ring = 1; ring <= 3; ring += 1) {
        context.beginPath();
        context.ellipse(0, 0, base * ring * 0.82, base * ring * 0.3, -0.12, 0, Math.PI * 2);
        context.strokeStyle = light
          ? rgba(accent, 0.07 - ring * 0.012)
          : rgba(accent, (0.1 - ring * 0.016) * 0.72);
        context.lineWidth = 0.8;
        context.setLineDash(ring === 2 ? [2, 7] : [1, 5]);
        context.stroke();
      }
      context.setLineDash([]);
      context.restore();

      // 分层星野：远层漂移慢、近层略亮；静止时保留星点，不做闪烁。
      for (const star of stars) {
        const drift = motion ? (time * star.speed) % 1 : 0;
        const x = (star.x + drift) % 1;
        const twinkle = motion
          ? 0.55 + 0.45 * Math.sin(time / (1300 + star.depth * 520) + star.phase)
          : 0.82;
        context.globalAlpha = Math.max(0.03, star.alpha * twinkle * (light ? 0.95 : 1));
        context.fillStyle = light ? mixHex(star.tint, theme.background, 0.24) : star.tint;
        context.beginPath();
        context.arc(x * width, star.y * height, star.r, 0, Math.PI * 2);
        context.fill();
        if (star.depth === 2 && motion) {
          context.globalAlpha = 0.11 * twinkle;
          context.strokeStyle = light ? rgba(theme.background, 0.22) : star.tint;
          context.lineWidth = 0.6;
          const arm = star.r * 4.2;
          context.beginPath();
          context.moveTo(x * width - arm, star.y * height);
          context.lineTo(x * width + arm, star.y * height);
          context.moveTo(x * width, star.y * height - arm);
          context.lineTo(x * width, star.y * height + arm);
          context.stroke();
        }
      }
      context.globalAlpha = 1;

      // 偶发流星：暗色主题下每 17 秒掠过一颗，作为低频动态点缀。
      if (motion && !light) {
        const cycle = 17000;
        const phase = (time + 5200) % cycle;
        if (phase < 1250) {
          const progress = phase / 1250;
          const fade = Math.sin(Math.PI * progress);
          const headX = width * (0.16 + progress * 0.62);
          const headY = height * (0.24 + progress * 0.34);
          const tailX = headX - 92;
          const tailY = headY - 50;
          const trail = context.createLinearGradient(tailX, tailY, headX, headY);
          trail.addColorStop(0, rgba(accent, 0));
          trail.addColorStop(1, rgba(mixHex(accent, '#ffffff', 0.55), 0.52 * fade));
          context.strokeStyle = trail;
          context.lineWidth = 1.3;
          context.lineCap = 'round';
          context.beginPath();
          context.moveTo(tailX, tailY);
          context.lineTo(headX, headY);
          context.stroke();
          context.fillStyle = rgba('#ffffff', 0.72 * fade);
          context.beginPath();
          context.arc(headX, headY, 1.4, 0, Math.PI * 2);
          context.fill();
          context.lineCap = 'butt';
        }
      }

      // 边缘暗角，让中心星图更聚焦。
      context.drawImage(vignetteLayer, 0, 0, width, height);

      const focusId = hoverRef.current || selectedIdRef.current;
      const focusNeighbors = new Set<string>();
      if (focusId) {
        focusNeighbors.add(focusId);
        for (const edge of model.edges) {
          if (edge.a === focusId) focusNeighbors.add(edge.b);
          if (edge.b === focusId) focusNeighbors.add(edge.a);
        }
      }
      const workingSet = workingRef.current;
      const pair = new Set(pairRef.current);
      const pairHot = pair.size > 1;

      const positions = new Map<string, ReturnType<typeof project>>();
      for (const node of model.nodes) positions.set(node.id, project(node.pos));

      const nodeById = new Map(model.nodes.map((node) => [node.id, node]));

      // 连线：轻微弧线 + 端点渐变 + 低透明度光晕，避免“蜘蛛网”平面感。
      for (const edge of model.edges) {
        const from = positions.get(edge.a);
        const to = positions.get(edge.b);
        if (!from || !to) continue;
        const focused = focusId ? focusNeighbors.has(edge.a) && focusNeighbors.has(edge.b) : false;
        const paired = pairHot && pair.has(edge.a) && pair.has(edge.b);
        const hierarchy = nodeById.get(edge.b)?.role === 'group';
        const edgeDim = light ? 1 : 0.86;
        const alpha =
          (pairHot
            ? paired
              ? 0.62
              : pair.has(edge.a) || pair.has(edge.b)
                ? 0.12
                : 0.04
            : focusId
              ? focused
                ? 0.55
                : 0.03
              : edge.kind === 'core'
                ? light
                  ? 0.4
                  : 0.3
                : hierarchy
                  ? light
                    ? 0.44
                    : 0.26
                  : light
                    ? 0.24
                    : 0.14) * edgeDim;
        if (alpha < 0.015) continue;
        const colorA = nodeById.get(edge.a)?.color ?? accent;
        const colorB = nodeById.get(edge.b)?.color ?? accent;
        const controlX = (from.x + to.x) / 2 - (to.y - from.y) * 0.055;
        const controlY = (from.y + to.y) / 2 + (to.x - from.x) * 0.055;
        const pointAt = (value: number) => {
          const inverse = 1 - value;
          return {
            x: inverse * inverse * from.x + 2 * inverse * value * controlX + value * value * to.x,
            y: inverse * inverse * from.y + 2 * inverse * value * controlY + value * value * to.y,
          };
        };

        if (hierarchy) context.setLineDash([3, 5]);
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.quadraticCurveTo(controlX, controlY, to.x, to.y);
        context.strokeStyle = rgba(
          edge.kind === 'core' ? accent : colorB,
          alpha * (light ? 0.28 : hierarchy ? 0.26 : 0.19),
        );
        context.lineWidth = focused || paired ? 3.8 : 1.9;
        context.stroke();

        const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
        gradient.addColorStop(0, rgba(colorA, alpha));
        gradient.addColorStop(0.5, rgba(accent, alpha * 0.9));
        gradient.addColorStop(1, rgba(colorB, alpha));
        context.strokeStyle = gradient;
        context.lineWidth = paired ? 1.5 : focused ? 1.15 : hierarchy ? 0.85 : 0.7;
        context.stroke();
        context.setLineDash([]);

        if (motion && focused) {
          const t = ((time / 2200 + edge.a.length * 0.07) % 1 + 1) % 1;
          const head = pointAt(t);
          const tail = pointAt(Math.max(0, t - 0.035));
          const trail = context.createLinearGradient(tail.x, tail.y, head.x, head.y);
          trail.addColorStop(0, rgba(accent, 0));
          trail.addColorStop(1, rgba(accent, 0.9));
          context.strokeStyle = trail;
          context.lineWidth = 1.4;
          context.beginPath();
          context.moveTo(tail.x, tail.y);
          context.lineTo(head.x, head.y);
          context.stroke();

          context.fillStyle = light ? accent : '#ffffff';
          context.beginPath();
          context.arc(head.x, head.y, 1.7, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = rgba(accent, 0.28);
          context.beginPath();
          context.arc(head.x, head.y, 5.5, 0, Math.PI * 2);
          context.fill();
        } else if (motion && edge.kind === 'core' && !pairHot) {
          // 待机流动：中心向外的连线上始终保持几颗缓慢外流的光点。
          const span = 8200;
          const phase = (edge.b.charCodeAt(0) * 131 + edge.b.length * 47) % span;
          for (let dot = 0; dot < 2; dot += 1) {
            const t = (((time + phase + (dot * span) / 2) % span) / span);
            const point = pointAt(t);
            const fade = Math.sin(Math.PI * t);
            context.globalAlpha = 0.24 * fade;
            context.fillStyle = rgba(accent, 0.5);
            context.beginPath();
            context.arc(point.x, point.y, 4.4, 0, Math.PI * 2);
            context.fill();
            context.globalAlpha = 0.85 * fade;
            context.fillStyle = light
              ? mixHex(accent, '#ffffff', 0.3)
              : mixHex(accent, '#ffffff', 0.55);
            context.beginPath();
            context.arc(point.x, point.y, 1.7, 0, Math.PI * 2);
            context.fill();
          }
          context.globalAlpha = 1;
        }
      }

      const sorted = [...model.nodes].sort((a, b) => (positions.get(a.id)?.z ?? 0) - (positions.get(b.id)?.z ?? 0));
      const hits: ScreenNode[] = [];
      const labelBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

      for (const node of sorted) {
        const point = positions.get(node.id);
        if (!point) continue;
        const matched = isMatch(node);
        const focused = !focusId || focusNeighbors.has(node.id);
        const dim =
          (matched ? 1 : 0.16) *
          (focused ? 1 : 0.28) *
          (pairHot ? (pair.has(node.id) ? 1 : 0.22) : 1);
        const depth = 0.72 + (point.z + 1.4) * 0.2;
        const radius = Math.max(2.2, node.size * 11 * point.persp);
        const isSelected = node.id === selectedIdRef.current;
        const isHover = node.id === hoverRef.current;
        const isWorking = workingSet.has(node.id);
        const sprite = nodeSprite(node.color, light);

        if (isWorking) {
          const cycle = motion ? 0.5 + 0.5 * Math.sin(time / 420) : 0.7;
          const haloRadius = radius * (2.15 + cycle * 0.26);
          const halo = context.createRadialGradient(
            point.x,
            point.y,
            radius * 0.7,
            point.x,
            point.y,
            haloRadius * 1.55,
          );
          halo.addColorStop(0, rgba(accent, light ? 0.2 : 0.26));
          halo.addColorStop(0.55, rgba(accent, light ? 0.08 : 0.1));
          halo.addColorStop(1, rgba(accent, 0));
          context.globalAlpha = 1;
          context.fillStyle = halo;
          context.beginPath();
          context.arc(point.x, point.y, haloRadius * 1.55, 0, Math.PI * 2);
          context.fill();

          context.strokeStyle = rgba(accent, light ? 0.58 : 0.78);
          context.lineWidth = 1.2;
          const spin = motion ? time / 520 : 0.6;
          for (let arc = 0; arc < 2; arc += 1) {
            context.beginPath();
            context.arc(
              point.x,
              point.y,
              haloRadius,
              spin + arc * Math.PI,
              spin + arc * Math.PI + 1.15,
            );
            context.stroke();
          }
        }

        context.globalCompositeOperation = light ? 'source-over' : 'lighter';
        context.globalAlpha = Math.min(1, depth * dim * (light ? 0.75 : 0.66));
        context.drawImage(
          sprite,
          point.x - radius * 3.3,
          point.y - radius * 3.3,
          radius * 6.6,
          radius * 6.6,
        );
        context.globalAlpha = Math.min(1, dim * (light ? 1 : 0.9));
        context.drawImage(
          sprite,
          point.x - radius * 1.95,
          point.y - radius * 1.95,
          radius * 3.9,
          radius * 3.9,
        );
        context.globalCompositeOperation = 'source-over';

        context.globalAlpha = Math.min(1, dim);
        context.fillStyle = node.color;
        context.beginPath();
        context.arc(point.x, point.y, Math.max(1.4, radius * 0.34), 0, Math.PI * 2);
        context.fill();

        context.fillStyle = light ? mixHex(node.color, '#ffffff', 0.55) : 'rgba(255,255,255,0.9)';
        context.beginPath();
        context.arc(point.x, point.y, Math.max(0.8, radius * 0.15), 0, Math.PI * 2);
        context.fill();

        if (light) {
          context.globalAlpha = Math.min(0.55, dim * 0.5);
          context.strokeStyle = rgba(node.color, 0.55);
          context.lineWidth = 0.9;
          context.beginPath();
          context.arc(point.x, point.y, Math.max(2, radius * 0.95), 0, Math.PI * 2);
          context.stroke();
        }

        if (node.kind === 'scene' && node.sessionId) {
          context.globalAlpha = Math.min(0.55, dim * 0.55);
          context.strokeStyle = rgba(node.color, 0.5);
          context.lineWidth = 0.8;
          context.beginPath();
          context.arc(point.x, point.y, radius * 1.2 + 4, 0, Math.PI * 2);
          context.stroke();
        }

        // 分支组（角色卡 / 技能 / 今日记忆）：双环标记，和普通叶子区分开。
        if (node.role === 'group') {
          context.globalAlpha = Math.min(0.5, dim * 0.5);
          context.strokeStyle = rgba(node.color, 0.4);
          context.lineWidth = 0.8;
          context.beginPath();
          context.arc(point.x, point.y, radius * 1.5 + 3, 0, Math.PI * 2);
          context.stroke();

          context.globalAlpha = Math.min(0.36, dim * 0.36);
          context.strokeStyle = rgba(node.color, 0.3);
          context.lineWidth = 0.7;
          context.setLineDash([2, 4]);
          context.beginPath();
          context.arc(point.x, point.y, radius * 2.05 + 5, 0, Math.PI * 2);
          context.stroke();
          context.setLineDash([]);
        }

        if (pairHot && pair.has(node.id)) {
          context.globalAlpha = 0.9;
          context.strokeStyle = light ? mixHex(accent, '#000000', 0.18) : accent;
          context.lineWidth = 1.4;
          context.beginPath();
          context.arc(point.x, point.y, radius * 1.65 + 4, 0, Math.PI * 2);
          context.stroke();
        }

        if (isSelected || isHover) {
          const pulse = isSelected ? 1.8 + Math.sin(time / 420) * 1.6 : 1;
          context.globalAlpha = isSelected ? 0.9 : 0.55;
          context.strokeStyle = light ? mixHex(node.color, '#000000', 0.18) : node.color;
          context.lineWidth = isSelected ? 1.3 : 1;
          context.beginPath();
          context.arc(point.x, point.y, radius * 1.5 + 3 + pulse, 0, Math.PI * 2);
          context.stroke();

          if (isSelected) {
            context.fillStyle = rgba(node.color, 0.9);
            for (let tick = 0; tick < 4; tick += 1) {
              const angle = (Math.PI / 2) * tick + Math.PI / 4;
              const inner = radius * 1.5 + 8 + pulse;
              const outer = inner + 4;
              context.beginPath();
              context.moveTo(point.x + Math.cos(angle) * inner, point.y + Math.sin(angle) * inner);
              context.lineTo(point.x + Math.cos(angle) * outer, point.y + Math.sin(angle) * outer);
              context.lineWidth = 1.4;
              context.strokeStyle = rgba(node.color, 0.85);
              context.stroke();
            }
          }
        }

        const showLabel =
          node.kind === 'core' ||
          (node.kind === 'scene' && Boolean(node.sessionId)) ||
          node.role === 'group' ||
          isSelected ||
          isHover ||
          isWorking ||
          pairHot ||
          (matched && Boolean(queryRef.current.trim())) ||
          (matched && viewRef.current.zoom > 1.6 && node.kind !== 'event');
        if (showLabel) {
          const isGroup = node.role === 'group';
          const label = node.label.length > 10 ? `${node.label.slice(0, 10)}…` : node.label;
          const isCore = node.kind === 'core';
          const labelY = point.y + radius * (isGroup ? 1.45 : 1.6) + (isCore ? 16 : isGroup ? 10 : 13);
          context.font = `${isCore ? 700 : isGroup ? 600 : 500} ${isCore ? 12 : isGroup ? 9 : 10}px "Segoe UI", "Microsoft YaHei", sans-serif`;
          const textWidth = context.measureText(label).width;
          const box = {
            x1: point.x - textWidth / 2 - (isGroup ? 4 : 6),
            y1: labelY - (isCore ? 12 : isGroup ? 8 : 10),
            x2: point.x + textWidth / 2 + (isGroup ? 4 : 6),
            y2: labelY + (isGroup ? 3 : 4),
          };
          const priority = isSelected || isHover || isCore || isWorking;
          const collides = labelBoxes.some(
            (other) =>
              box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1,
          );
          if (priority || !collides) {
            labelBoxes.push(box);
            context.globalAlpha = Math.min(1, dim * (isCore ? 1 : 0.82));
            context.fillStyle = light
              ? 'rgba(255, 255, 255, 0.94)'
              : rgba(mixHex(theme.background, '#000000', 0.28), 0.66);
            context.strokeStyle = rgba(node.color, priority ? (light ? 0.62 : 0.5) : light ? 0.3 : 0.16);
            context.lineWidth = 0.8;
            context.beginPath();
            context.roundRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1, 6);
            context.fill();
            context.stroke();

            context.textAlign = 'center';
            context.fillStyle = light
              ? isSelected || isHover
                ? '#0b1929'
                : '#31445a'
              : isSelected || isHover
                ? '#f4fbff'
                : 'rgba(221, 236, 250, 0.86)';
            context.fillText(label, point.x, labelY);

            if (isWorking) {
              context.font = '600 9px "Segoe UI", "Microsoft YaHei", sans-serif';
              context.fillStyle = rgba(accent, light ? 0.92 : 0.98);
              context.fillText('工作中', point.x, labelY + 12);
            }
          }
        }

        hits.push({ id: node.id, x: point.x, y: point.y, radius: Math.max(8, radius * 1.4), z: point.z });
      }

      // 最近活动余晖：按时间指数衰减，不冒充“正在工作”。
      for (const [id, at] of heatRef.current) {
        const age = Math.max(0, time - at);
        if (age > 90000) {
          heatRef.current.delete(id);
          continue;
        }
        const point = positions.get(id);
        const node = nodeById.get(id);
        if (!point || !node) continue;
        const baseRadius = Math.max(2.2, node.size * 11 * point.persp);
        const fade = Math.exp(-age / 32000);
        context.globalAlpha = Math.min(0.72, 0.12 + fade * 0.46) * (light ? 0.85 : 1);
        context.strokeStyle = rgba(node.color, 0.8);
        context.lineWidth = 1;
        context.beginPath();
        context.arc(point.x, point.y, baseRadius * (1.85 + (1 - fade) * 0.8), 0, Math.PI * 2);
        context.stroke();
      }

      // 消息 / 派单脉冲：沿节点连线走，到达后由涟漪接棒。
      const curveAt = (
        from: { x: number; y: number },
        controlX: number,
        controlY: number,
        to: { x: number; y: number },
        value: number,
      ) => {
        const inverse = 1 - value;
        return {
          x: inverse * inverse * from.x + 2 * inverse * value * controlX + value * value * to.x,
          y: inverse * inverse * from.y + 2 * inverse * value * controlY + value * value * to.y,
        };
      };

      for (let index = pulseRef.current.length - 1; index >= 0; index -= 1) {
        const pulse = pulseRef.current[index];
        const progress = (time - pulse.start) / pulse.duration;
        if (progress >= 1) {
          pulseRef.current.splice(index, 1);
          heatRef.current.set(pulse.toId, time);
          if (positions.has(pulse.toId)) {
            rippleRef.current.push({
              id: pulse.toId,
              start: time,
              duration: 680,
              color: pulseColor(pulse.kind, pulse.status),
            });
          }
          continue;
        }
        const from = positions.get(pulse.fromId);
        const to = positions.get(pulse.toId);
        if (!from || !to) {
          pulseRef.current.splice(index, 1);
          continue;
        }
        const color = pulseColor(pulse.kind, pulse.status);
        const controlX = (from.x + to.x) / 2 - (to.y - from.y) * 0.055;
        const controlY = (from.y + to.y) / 2 + (to.x - from.x) * 0.055;

        if (!pulse.line) {
          const target = nodeById.get(pulse.toId);
          const baseRadius = Math.max(2, (target?.size ?? 1) * 11 * to.persp);
          const burst = Math.min(1, Math.max(0, progress) * 1.35);
          for (let ring = 0; ring < 3; ring += 1) {
            const value = Math.min(1, burst + ring * 0.14);
            if (value <= 0) continue;
            context.globalAlpha = (1 - value) * 0.72;
            context.strokeStyle = rgba(color, 0.95);
            context.lineWidth = 1.4;
            context.beginPath();
            context.arc(to.x, to.y, baseRadius * (1 + value * ring * 0.8 + value * 1.4), 0, Math.PI * 2);
            context.stroke();
          }
          continue;
        }

        const t = Math.min(1, Math.max(0, progress));
        const head = curveAt(from, controlX, controlY, to, t);
        const tail = curveAt(
          from,
          controlX,
          controlY,
          to,
          Math.max(0, t - (pulse.kind === 'dispatch' ? 0.12 : 0.18)),
        );

        context.globalAlpha = 0.26 * (1 - t * 0.25);
        context.strokeStyle = rgba(color, 0.9);
        context.lineWidth = 2.4;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.quadraticCurveTo(controlX, controlY, to.x, to.y);
        context.stroke();

        const trail = context.createLinearGradient(tail.x, tail.y, head.x, head.y);
        trail.addColorStop(0, rgba(color, 0));
        trail.addColorStop(1, rgba(color, 0.96));
        context.globalAlpha = 1;
        context.strokeStyle = trail;
        context.lineWidth = pulse.kind === 'dispatch' ? 2.4 : 1.8;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(tail.x, tail.y);
        context.lineTo(head.x, head.y);
        context.stroke();

        const headPoint = (point: { x: number; y: number }, size: number) => {
          context.fillStyle = rgba(color, 0.3);
          context.beginPath();
          context.arc(point.x, point.y, size * 4.2, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = light ? mixHex(color, '#ffffff', 0.35) : '#ffffff';
          context.beginPath();
          context.arc(point.x, point.y, size, 0, Math.PI * 2);
          context.fill();
        };
        headPoint(head, pulse.kind === 'dispatch' ? 2.2 : 1.8);
        if (pulse.kind === 'dispatch') {
          headPoint(curveAt(from, controlX, controlY, to, Math.max(0, t - 0.08)), 1.4);
        }
      }
      context.lineCap = 'butt';

      for (let index = rippleRef.current.length - 1; index >= 0; index -= 1) {
        const ripple = rippleRef.current[index];
        const t = (time - ripple.start) / ripple.duration;
        const point = positions.get(ripple.id);
        if (t >= 1 || !point) {
          rippleRef.current.splice(index, 1);
          continue;
        }
        const node = nodeById.get(ripple.id);
        const baseRadius = Math.max(2.2, (node?.size ?? 1) * 11 * point.persp);
        const ease = 1 - Math.pow(1 - t, 2);
        context.globalAlpha = (1 - t) * 0.8;
        context.strokeStyle = rgba(ripple.color, 0.95);
        context.lineWidth = 1.6 - t * 0.8;
        context.beginPath();
        context.arc(point.x, point.y, baseRadius * (1.2 + ease * 2.2), 0, Math.PI * 2);
        context.stroke();
        if (t < 0.6) {
          context.globalAlpha = (1 - t) * 0.4;
          context.beginPath();
          context.arc(point.x, point.y, baseRadius * (1.1 + ease * 1.2), 0, Math.PI * 2);
          context.stroke();
        }
      }

      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      hitRef.current = hits.sort((a, b) => b.z - a.z);
    };

    const loop = (time: number) => {
      if (disposed) return;
      if (document.hidden) {
        frame = requestAnimationFrame(loop);
        return;
      }
      const delta = lastPaint ? Math.min(64, time - lastPaint) : 16.67;
      if (motion && pendingRef.current.length > 0 && pulseRef.current.length < 4) {
        const next = pendingRef.current.shift();
        if (next) {
          next.start = time;
          pulseRef.current.push(next);
          dirty = true;
        }
      }
      if (auto && motion && !dragRef.current.active) {
        // 按真实帧间隔推进，限帧后旋转速度不变。
        viewRef.current.ry += 0.000066 * delta;
        dirty = true;
      }
      if (motion && (pulseRef.current.length > 0 || rippleRef.current.length > 0)) dirty = true;
      if (motion && (heatRef.current.size > 0 || workingRef.current.size > 0)) dirty = true;
      if (dirty) {
        draw(time);
        dirty = false;
        lastPaint = time;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const markDirty = () => {
      dirty = true;
    };
    dirtyRef.current = markDirty;

    const hitAt = (x: number, y: number) =>
      hitRef.current.find((hit) => {
        const dx = x - hit.x;
        const dy = y - hit.y;
        return dx * dx + dy * dy <= hit.radius * hit.radius;
      }) ?? null;

    const onPointerDown = (event: PointerEvent) => {
      dragRef.current = { active: true, moved: false, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('dragging');
    };

    const onPointerMove = (event: PointerEvent) => {
      if (dragRef.current.active) {
        const dx = event.clientX - dragRef.current.x;
        const dy = event.clientY - dragRef.current.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true;
        // 水平、垂直都跟随鼠标方向：抓住星图前侧往下拖，前侧就往下走。
        viewRef.current.ry -= dx * 0.0072;
        viewRef.current.rx = Math.max(-1.25, Math.min(1.25, viewRef.current.rx - dy * 0.0055));
        dragRef.current.x = event.clientX;
        dragRef.current.y = event.clientY;
        markDirty();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const hit = hitAt(event.clientX - rect.left, event.clientY - rect.top);
      const next = hit?.id ?? null;
      if (next !== hoverRef.current) {
        hoverRef.current = next;
        canvas.style.cursor = next ? 'pointer' : 'grab';
        markDirty();
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const wasMoved = dragRef.current.moved;
      dragRef.current.active = false;
      canvas.classList.remove('dragging');
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      if (!wasMoved) {
        const rect = canvas.getBoundingClientRect();
        const hit = hitAt(event.clientX - rect.left, event.clientY - rect.top);
        selectedIdRef.current = hit?.id ?? null;
        setSelectedId(hit?.id ?? null);
        markDirty();
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const next = viewRef.current.zoom * Math.exp(-event.deltaY * 0.0011);
      viewRef.current.zoom = Math.max(0.55, Math.min(2.6, next));
      markDirty();
    };

    const onDoubleClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const hit = hitAt(event.clientX - rect.left, event.clientY - rect.top);
      const node = model.nodes.find((item) => item.id === hit?.id);
      if (!node) return;
      // 文件节点双击直接进入只读查看；其余节点保持定位会话。
      if (readablePath(node)) {
        selectedIdRef.current = node.id;
        setSelectedId(node.id);
        openFileRef.current(node);
        return;
      }
      if (node.sessionId) actions.selectSession(node.sessionId);
      else if (node.sceneId) {
        const local = sessions.find((session) => session.engine?.sceneId === node.sceneId);
        if (local) actions.selectSession(local.id);
        else actions.notify(`「${node.label}」尚未创建本地会话，可用新建会话套用该模板`);
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.style.cursor = 'grab';

    const onVisibility = () => markDirty();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      dirtyRef.current = () => undefined;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDoubleClick);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, auto, light, motion, model, sessions, actions, theme]);

  useEffect(() => {
    dirtyRef.current();
  }, [query, selectedId]);

  const resetView = () => {
    viewRef.current = { rx: -0.16, ry: -0.42, zoom: 1.33 };
    selectedIdRef.current = null;
    setSelectedId(null);
  };

  const selectFirstMatch = () => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return;
    const hit = model.nodes.find((node) =>
      `${node.label} ${node.meta ?? ''} ${node.detail ?? ''}`.toLowerCase().includes(keyword),
    );
    if (hit) setSelectedId(hit.id);
  };

  return (
    <div className={`neuron-view${motion ? '' : ' no-motion'}`}>
      <div ref={wrapRef} className="neuron-stage">
        <canvas ref={canvasRef} className="neuron-canvas" />

        <div className="neuron-search">
          <Icon name="search" size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                selectFirstMatch();
              }
            }}
            placeholder="搜会话 / 角色卡 / 技能 / 记忆…"
            spellCheck={false}
          />
          {query && (
            <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>

        <div className="neuron-actions">
          <button type="button" className={auto ? 'on' : ''} onClick={() => setAuto((value) => !value)}>
            ⟳ 自转
          </button>
          <button type="button" onClick={resetView}>
            ⤾ 复位
          </button>
          <button
            type="button"
            className={onlyMemory ? 'on' : ''}
            onClick={() => setOnlyMemory((value) => !value)}
          >
            ◐ 只看记忆
          </button>
          <button type="button" onClick={refreshEngine} disabled={engineLoading}>
            ↻ {engineLoading ? '读取中' : '重读'}
          </button>
        </div>

        <div className="neuron-status">
          <span className={`neuron-source ${engine?.ok ? 'live' : ''}`}>
            {engine?.ok ? `只读 · ${engine.scenes.length} 个引擎会话` : engineLoading ? '正在读取引擎数据…' : '本地会话兜底'}
          </span>
          <span>
            {model.stats.nodes} 节点 · {model.stats.edges} 连线 · {model.stats.scenes} 个会话 ·{' '}
            {model.stats.cards} 角色卡 · {model.stats.memories} 今日记忆
          </span>
        </div>

        <div className="neuron-legend">
          {(['scene', 'card', 'skill', 'memory', 'event'] as NeuronNode['kind'][]).map((kind) => (
            <span key={kind}>
              <i style={{ background: kind === 'scene' ? accent : KIND_COLOR[kind] }} />
              {KIND_LABEL[kind]}
            </span>
          ))}
        </div>

        <div className="neuron-hint">拖拽旋转 · 滚轮缩放 · 点击节点看详情 · 双击定位会话</div>

        <div className="neuron-feed">
          <div className="neuron-feed-head">
            <span className={feed?.ok ? 'live' : ''} />
            活动流
            <em>{feed?.ok ? '实时' : '未连接'}</em>
          </div>
          {feedItems.length === 0 ? (
            <p>暂无会话事件</p>
          ) : (
            feedItems.map((item) => (
              <button
                key={item.key}
                type="button"
                title={`${item.time} ${PULSE_LABEL[item.kind]}：${item.fromLabel} → ${item.toLabel}`}
                onMouseEnter={() => {
                  pairRef.current = item.nodes;
                  dirtyRef.current();
                }}
                onMouseLeave={() => {
                  pairRef.current = [];
                  dirtyRef.current();
                }}
                onClick={() => {
                  const target = item.toId ?? item.fromId;
                  if (!target) return;
                  selectedIdRef.current = target;
                  setSelectedId(target);
                }}
              >
                <span className="t">{item.time}</span>
                <span className={`k k-${item.kind}`}>{item.label}</span>
                <span className="r">
                  {item.fromLabel} → {item.toLabel}
                </span>
              </button>
            ))
          )}
        </div>

        {selected && (
          <div className="neuron-detail">
            <div className="neuron-detail-head">
              <span className="neuron-kind" style={{ color: KIND_COLOR[selected.kind], borderColor: `${KIND_COLOR[selected.kind]}55` }}>
                {KIND_LABEL[selected.kind]}
              </span>
              {workingNodes.has(selected.id) && <span className="neuron-working">工作中</span>}
              <button type="button" aria-label="关闭详情" onClick={() => setSelectedId(null)}>
                <Icon name="x" size={12} />
              </button>
            </div>
            <strong>{selected.label}</strong>
            {selected.meta && <p className="neuron-detail-meta">{selected.meta}</p>}
            {selected.detail && <p>{selected.detail}</p>}
            {selected.tags && selected.tags.length > 0 && (
              <div className="neuron-tags">
                {selected.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            )}
            <div className="neuron-detail-actions">
              {readablePath(selected) && engine?.root && window.desktop && (
                <button
                  type="button"
                  className="ghost-btn"
                  title="在当前视图里只读查看文件内容"
                  onClick={() => openFile(selected)}
                >
                  查看文件
                </button>
              )}
              {selected.sessionId && (
                <button type="button" className="ghost-btn" onClick={() => actions.selectSession(selected.sessionId!)}>
                  定位会话
                </button>
              )}
              {selected.path && engine?.root && window.desktop && (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    const relative = openableRelative(selected);
                    if (!relative) {
                      actions.notify('该节点没有可打开的目录或文件', 'warn');
                      return;
                    }
                    void window.desktop
                      ?.openEnginePath(engine.root, relative)
                      .then((result) => {
                        if (!result?.ok) actions.notify(result?.error || '无法打开该路径', 'warn');
                      });
                  }}
                >
                  {isFileNode(selected) ? '打开文件' : '打开目录'}
                </button>
              )}
            </div>
          </div>
        )}

        {fileView && (
          <aside
            className={`neuron-file-panel${fileExpanded ? ' expanded' : ''}`}
            role="dialog"
            aria-label={`查看文件 ${fileView.title}`}
          >
            <div className="neuron-file-head">
              <div>
                <span className="neuron-kind" style={{ color: '#f0c674', borderColor: '#f0c67455' }}>
                  只读
                </span>
                <strong>{fileView.title}</strong>
                <code title={fileView.path}>{fileView.path}</code>
              </div>
              <div className="neuron-file-tools">
                {fileDoc?.size != null && <span>{formatBytes(fileDoc.size)}</span>}
                <button
                  type="button"
                  aria-label={fileExpanded ? '收起文件预览' : '展开文件预览'}
                  title={fileExpanded ? '收起' : '展开'}
                  onClick={() => setFileExpanded((value) => !value)}
                >
                  <Icon name={fileExpanded ? 'chevronLeft' : 'chevronRight'} size={13} />
                </button>
                <button type="button" aria-label="关闭文件预览" onClick={closeFile}>
                  <Icon name="x" size={13} />
                </button>
              </div>
            </div>
            <div className="neuron-file-body">
              {fileDoc?.loading ? (
                <span className="neuron-file-note">正在读取…</span>
              ) : fileDoc?.error ? (
                <span className="neuron-file-note">{fileDoc.error}</span>
              ) : (
                <pre>{fileDoc?.text ?? ''}</pre>
              )}
            </div>
          </aside>
        )}

        {engineLoading && !engine && <div className="neuron-loading">正在连接引擎数据…</div>}
      </div>
    </div>
  );
}

/** 神经元视图：把引擎会话、技能、记忆和本地会话事件投影成可交互的 3D 星图。 */
export const neuronViewModule: ModuleDefinition = {
  manifest: {
    id: 'neuron.view',
    name: '记忆神经元',
    version: '0.1.0',
    description: '3D 星图式展示会话、角色卡、技能与今日记忆，支持拖拽旋转、缩放、搜索与定位。',
    icon: 'neuron',
    kind: ['view'],
    slots: ['center.view'],
    category: 'core',
    permissions: ['sessions:read'],
  },
  center: {
    tabLabel: '神经元',
    title: '记忆神经元',
    subtitle: ({ sessionCount }) =>
      `会话 / 角色卡 / 技能 / 今日记忆的只读投影 · 关联 ${sessionCount} 个会话`,
  },
  View: (props) => <NeuronGraph {...props} />,
};
