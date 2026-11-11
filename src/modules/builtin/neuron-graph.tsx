import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import type { EngineSnapshot } from '../../engine/types';
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
  scene: '场景',
  memory: '记忆',
  skill: '技能',
  event: '事件',
};

const KIND_COLOR: Record<NeuronNode['kind'], string> = {
  core: '#7fe3ff',
  scene: '#38e1e6',
  memory: '#dfe7ff',
  skill: '#6f8fd6',
  event: '#8f9bb3',
};

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
  const viewRef = useRef({ rx: -0.16, ry: -0.42, zoom: 1.05 });
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
  selectedIdRef.current = selectedId;
  queryRef.current = query;

  const model = useMemo(
    () => buildNeuronModel(sessions, engine, onlyMemory),
    [engine, onlyMemory, sessions],
  );

  const selected = model.nodes.find((node) => node.id === selectedId) ?? null;
  const motion = settings.appearance.motion;
  const theme = resolveTheme(settings);
  const light = theme.tone === 'light';
  const accent = theme.accent;

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
    const stars = Array.from({ length: 150 }, (_, index) => ({
      x: Math.abs((Math.sin(index * 12.9898) * 43758.5453) % 1),
      y: Math.abs((Math.sin(index * 78.233 + 1.7) * 12543.231) % 1),
      r: 0.35 + ((index * 7) % 10) / 10,
      phase: index * 0.7,
      tint: index % 5 === 0 ? accent : mixHex(accent, '#ffffff', 0.62),
    }));

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(320, rect.width);
      height = Math.max(260, rect.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
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

      const shell = light
        ? mixHex(theme.background, '#ffffff', 0.4)
        : mixHex(theme.background, '#ffffff', 0.035);
      const background = context.createRadialGradient(
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
        background.addColorStop(0, mixHex(theme.background, accent, 0.06));
        background.addColorStop(0.5, shell);
        background.addColorStop(1, mixHex(theme.background, '#000000', 0.3));
      }
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      // 星云 / 深空雾：用极低透明度的 accent 光团垫底，避免纯色平面。
      const nebulas = [
        { x: 0.3, y: 0.34, r: 0.44, color: accent, alpha: light ? 0.075 : 0.12 },
        {
          x: 0.72,
          y: 0.24,
          r: 0.34,
          color: mixHex(accent, light ? '#f0b34a' : '#7a5cff', 0.45),
          alpha: light ? 0.05 : 0.075,
        },
        {
          x: 0.6,
          y: 0.76,
          r: 0.42,
          color: mixHex(accent, light ? '#bfe4ff' : '#2a8bff', 0.5),
          alpha: light ? 0.05 : 0.06,
        },
      ];
      const glow = 0.55 + theme.glow / 120;
      const energy = light ? 1 : 0.76;
      context.globalCompositeOperation = light ? 'source-over' : 'screen';
      for (const nebula of nebulas) {
        const cloud = context.createRadialGradient(
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
        context.fillStyle = cloud;
        context.fillRect(0, 0, width, height);
      }
      context.globalCompositeOperation = 'source-over';

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

      // 贴地粒子 / 星点。
      for (const star of stars) {
        const alpha = motion
          ? (light ? 0.2 : 0.16) + Math.sin(time / 1600 + star.phase) * (light ? 0.16 : 0.11)
          : light
            ? 0.24
            : 0.18;
        context.globalAlpha = Math.max(0.04, alpha * (light ? 0.9 : 0.88));
        context.fillStyle = light ? mixHex(star.tint, theme.background, 0.35) : star.tint;
        context.beginPath();
        context.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;

      // 边缘暗角，让中心星图更聚焦。
      const vignette = context.createRadialGradient(
        centerX,
        centerY,
        Math.min(width, height) * 0.22,
        centerX,
        centerY,
        Math.max(width, height) * 0.78,
      );
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, light ? rgba(theme.background, 0.24) : 'rgba(0,0,0,0.5)');
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);

      const focusId = hoverRef.current || selectedIdRef.current;
      const focusNeighbors = new Set<string>();
      if (focusId) {
        focusNeighbors.add(focusId);
        for (const edge of model.edges) {
          if (edge.a === focusId) focusNeighbors.add(edge.b);
          if (edge.b === focusId) focusNeighbors.add(edge.a);
        }
      }

      const positions = new Map<string, ReturnType<typeof project>>();
      for (const node of model.nodes) positions.set(node.id, project(node.pos));

      const nodeById = new Map(model.nodes.map((node) => [node.id, node]));

      // 连线：轻微弧线 + 端点渐变 + 低透明度光晕，避免“蜘蛛网”平面感。
      for (const edge of model.edges) {
        const from = positions.get(edge.a);
        const to = positions.get(edge.b);
        if (!from || !to) continue;
        const focused = focusId ? focusNeighbors.has(edge.a) && focusNeighbors.has(edge.b) : false;
        const edgeDim = light ? 1 : 0.86;
        const alpha =
          (focusId ? (focused ? 0.55 : 0.03) : edge.kind === 'core' ? 0.3 : 0.14) * edgeDim;
        const colorA = nodeById.get(edge.a)?.color ?? accent;
        const colorB = nodeById.get(edge.b)?.color ?? accent;
        const controlX = (from.x + to.x) / 2 - (to.y - from.y) * 0.055;
        const controlY = (from.y + to.y) / 2 + (to.x - from.x) * 0.055;

        context.beginPath();
        context.moveTo(from.x, from.y);
        context.quadraticCurveTo(controlX, controlY, to.x, to.y);
        context.strokeStyle = rgba(edge.kind === 'core' ? accent : colorB, alpha * (light ? 0.24 : 0.19));
        context.lineWidth = focused ? 3.8 : 1.9;
        context.stroke();

        const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
        gradient.addColorStop(0, rgba(colorA, alpha));
        gradient.addColorStop(0.5, rgba(accent, alpha * 0.9));
        gradient.addColorStop(1, rgba(colorB, alpha));
        context.strokeStyle = gradient;
        context.lineWidth = focused ? 1.15 : 0.7;
        context.stroke();

        if (motion && focused) {
          const t = ((time / 2200 + edge.a.length * 0.07) % 1 + 1) % 1;
          const pointAt = (value: number) => {
            const inverse = 1 - value;
            return {
              x: inverse * inverse * from.x + 2 * inverse * value * controlX + value * value * to.x,
              y: inverse * inverse * from.y + 2 * inverse * value * controlY + value * value * to.y,
            };
          };
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
        const dim = (matched ? 1 : 0.16) * (focused ? 1 : 0.28);
        const depth = 0.72 + (point.z + 1.4) * 0.2;
        const radius = Math.max(2.2, node.size * 11 * point.persp);
        const isSelected = node.id === selectedIdRef.current;
        const isHover = node.id === hoverRef.current;
        const sprite = nodeSprite(node.color, light);

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
          isSelected ||
          isHover ||
          (matched && Boolean(queryRef.current.trim())) ||
          (matched && viewRef.current.zoom > 1.6 && node.kind !== 'event');
        if (showLabel) {
          const label = node.label.length > 10 ? `${node.label.slice(0, 10)}…` : node.label;
          const isCore = node.kind === 'core';
          const labelY = point.y + radius * 1.6 + (isCore ? 16 : 13);
          context.font = `${isCore ? 700 : 500} ${isCore ? 12 : 10}px "Segoe UI", "Microsoft YaHei", sans-serif`;
          const textWidth = context.measureText(label).width;
          const box = {
            x1: point.x - textWidth / 2 - 6,
            y1: labelY - (isCore ? 12 : 10),
            x2: point.x + textWidth / 2 + 6,
            y2: labelY + 4,
          };
          const priority = isSelected || isHover || isCore;
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
          }
        }

        hits.push({ id: node.id, x: point.x, y: point.y, radius: Math.max(8, radius * 1.4), z: point.z });
      }

      hitRef.current = hits.sort((a, b) => b.z - a.z);
      context.globalAlpha = 1;
    };

    const loop = (time: number) => {
      if (disposed) return;
      if (document.hidden) {
        frame = requestAnimationFrame(loop);
        return;
      }
      if (auto && motion && !dragRef.current.active) {
        viewRef.current.ry += 0.0011;
        dirty = true;
      }
      if (dirty) {
        draw(time);
        dirty = false;
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
        viewRef.current.ry += dx * 0.0072;
        viewRef.current.rx = Math.max(-1.25, Math.min(1.25, viewRef.current.rx + dy * 0.0055));
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
    viewRef.current = { rx: -0.16, ry: -0.42, zoom: 1.05 };
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
            placeholder="搜场景 / 技能 / 记忆…"
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
            {engine?.ok ? `只读 · ${engine.scenes.length} 个引擎场景` : engineLoading ? '正在读取引擎数据…' : '本地会话兜底'}
          </span>
          <span>
            {model.stats.nodes} 节点 · {model.stats.edges} 连线 · {model.stats.scenes} 场景 · {model.stats.memories} 记忆
          </span>
        </div>

        <div className="neuron-legend">
          {(['scene', 'memory', 'skill', 'event'] as NeuronNode['kind'][]).map((kind) => (
            <span key={kind}>
              <i style={{ background: kind === 'scene' ? accent : KIND_COLOR[kind] }} />
              {KIND_LABEL[kind]}
            </span>
          ))}
        </div>

        <div className="neuron-hint">拖拽旋转 · 滚轮缩放 · 点击节点看详情 · 双击定位会话</div>

        {selected && (
          <div className="neuron-detail">
            <div className="neuron-detail-head">
              <span className="neuron-kind" style={{ color: KIND_COLOR[selected.kind], borderColor: `${KIND_COLOR[selected.kind]}55` }}>
                {KIND_LABEL[selected.kind]}
              </span>
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
              {selected.sessionId && (
                <button type="button" className="ghost-btn" onClick={() => actions.selectSession(selected.sessionId!)}>
                  定位会话
                </button>
              )}
              {selected.path && engine?.root && window.desktop && (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() =>
                    window.desktop?.openPath(`${engine.root}/${selected.path?.replace(/^[\\/]+/, '')}`)
                  }
                >
                  打开目录
                </button>
              )}
            </div>
          </div>
        )}

        {engineLoading && !engine && <div className="neuron-loading">正在连接引擎数据…</div>}
      </div>
    </div>
  );
}

/** 神经元视图：把引擎场景、技能、记忆和本地会话事件投影成可交互的 3D 星图。 */
export const neuronViewModule: ModuleDefinition = {
  manifest: {
    id: 'neuron.view',
    name: '记忆神经元',
    version: '0.1.0',
    description: '3D 星图式展示场景、技能、记忆与会话事件，支持拖拽旋转、缩放、搜索与定位。',
    icon: 'neuron',
    kind: ['view'],
    slots: ['center.view'],
    category: 'core',
    permissions: ['sessions:read'],
  },
  center: {
    tabLabel: '神经元',
    title: '记忆神经元',
    subtitle: ({ sessionCount }) => `场景 / 技能 / 记忆的只读投影 · 关联 ${sessionCount} 个会话`,
  },
  View: (props) => <NeuronGraph {...props} />,
};
