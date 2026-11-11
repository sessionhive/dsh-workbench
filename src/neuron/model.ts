import type { EngineSnapshot } from '../engine/types';
import type { RoleId, Session } from '../types';

export type NeuronKind = 'core' | 'scene' | 'memory' | 'skill' | 'event';

export interface NeuronNode {
  id: string;
  label: string;
  kind: NeuronKind;
  color: string;
  size: number;
  pos: [number, number, number];
  sceneId?: string;
  sessionId?: RoleId;
  group?: string;
  meta?: string;
  detail?: string;
  tags?: string[];
  path?: string;
}

export interface NeuronEdge {
  a: string;
  b: string;
  kind: 'core' | 'memory' | 'skill' | 'event';
}

export interface NeuronStats {
  nodes: number;
  edges: number;
  scenes: number;
  memories: number;
  skills: number;
  mode: 'engine' | 'local';
}

export interface NeuronModel {
  nodes: NeuronNode[];
  edges: NeuronEdge[];
  stats: NeuronStats;
}

const PALETTE = ['#38e1e6', '#8f80ff', '#f6b64c', '#3ee0a3', '#e468d4', '#5aa9ff', '#ff8f6b', '#b6d66b'];
const CORE_ID = 'core';

function hash(input: string) {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value % 1000) / 1000;
}

function orbit(index: number, count: number, radius: number, phase = 0): [number, number, number] {
  const angle = (index / Math.max(1, count)) * Math.PI * 2 + phase;
  // 纵向按索引铺开，让节点落在球壳附近而不是挤在一条平面环上。
  const vertical = count <= 1 ? 0 : (index / (count - 1) - 0.5) * 0.98;
  const ring = Math.sqrt(Math.max(0.12, 1 - vertical * vertical));
  return [Math.cos(angle) * radius * ring, vertical * radius, Math.sin(angle) * radius * ring];
}

function short(text: string, limit = 120) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

export function buildNeuronModel(
  sessions: Session[],
  engine: EngineSnapshot | null,
  onlyMemory: boolean,
): NeuronModel {
  const nodes: NeuronNode[] = [
    {
      id: CORE_ID,
      label: 'DSH 记忆',
      kind: 'core',
      color: '#7fe3ff',
      size: 1.55,
      pos: [0, 0, 0],
      meta: engine?.ok ? '引擎数据只读' : '本地会话兜底',
      detail: engine?.ok
        ? `数据源 ${engine.root}`
        : '尚未连接到引擎数据目录，当前展示本地会话与事件。',
    },
  ];
  const edges: NeuronEdge[] = [];
  const sceneNodes: NeuronNode[] = [];
  const localScenes = sessions.filter((session) => session.id !== 'hub');
  const usedSessionIds = new Set<string>();

  const sceneColor = (sceneId: string) => {
    const local = sessions.find(
      (session) => session.engine?.sceneId === sceneId || session.scene === sceneId,
    );
    if (local) return local.color;
    return PALETTE[Math.floor(hash(sceneId) * PALETTE.length) % PALETTE.length];
  };

  if (engine?.ok) {
    const scenes = engine.scenes.slice(0, 10);
    scenes.forEach((scene, index) => {
      const local = localScenes.find(
        (session) => session.engine?.sceneId === scene.id || session.name === scene.name,
      );
      if (local) usedSessionIds.add(local.id);
      const node: NeuronNode = {
        id: `scene-${scene.id}`,
        label: scene.name,
        kind: 'scene',
        color: sceneColor(scene.id),
        size: 1.05,
        pos: orbit(index, scenes.length, 0.86, -Math.PI / 2),
        sceneId: scene.id,
        sessionId: local?.id,
        group: scene.group,
        meta: `${scene.memoryCount} 记忆 · ${scene.skillCount} 技能`,
        detail: short(scene.mission || scene.summaryText || '该场景暂无摘要。', 180),
        tags: [scene.skill, scene.primarySessionId ? '已绑定会话' : '未绑定会话'].filter(Boolean),
        path: scene.memoryRoot,
      };
      nodes.push(node);
      sceneNodes.push(node);
      edges.push({ a: CORE_ID, b: node.id, kind: 'core' });

      if (!onlyMemory) {
        scene.skillFiles.slice(0, 4).forEach((file, skillIndex) => {
          const id = `skill-${scene.id}-${file}`;
          const angle = (skillIndex / 4) * Math.PI * 2 + hash(id) * 1.4;
          nodes.push({
            id,
            label: file.split('/').pop()?.replace(/\.[^.]+$/, '') || file,
            kind: 'skill',
            color: '#6f8fd6',
            size: 0.5,
            pos: [
              node.pos[0] + Math.cos(angle) * 0.22,
              node.pos[1] + 0.18 + Math.sin(angle) * 0.08,
              node.pos[2] + Math.sin(angle) * 0.22,
            ],
            sceneId: scene.id,
            meta: '技能文件',
            detail: file,
            path: `skills/${scene.skill}/${file}`,
          });
          edges.push({ a: node.id, b: id, kind: 'skill' });
        });
      }

      const memoryFiles = scene.memoryFiles.slice(0, onlyMemory ? 8 : 5);
      memoryFiles.forEach((file, memoryIndex) => {
        const id = `memory-${scene.id}-${file}`;
        const angle = (memoryIndex / Math.max(1, memoryFiles.length)) * Math.PI * 2;
        const spread = 0.16 + hash(id) * 0.12;
        nodes.push({
          id,
          label: file.split('/').pop()?.replace(/\.[^.]+$/, '') || file,
          kind: 'memory',
          color: '#dfe7ff',
          size: 0.44,
          pos: [
            node.pos[0] + Math.cos(angle) * spread,
            node.pos[1] + (hash(`${id}y`) - 0.5) * 0.24,
            node.pos[2] + Math.sin(angle) * spread,
          ],
          sceneId: scene.id,
          meta: `${scene.name} · 记忆`,
          detail: file,
          path: `${scene.memoryRoot}/memory/${file}`.replace(/\/+/g, '/'),
        });
        edges.push({ a: node.id, b: id, kind: 'memory' });
      });
    });
  }

  localScenes
    .filter((session) => !usedSessionIds.has(session.id))
    .slice(0, 8)
    .forEach((session, index, list) => {
      const node: NeuronNode = {
        id: `local-${session.id}`,
        label: session.name,
        kind: 'scene',
        color: session.color || PALETTE[index % PALETTE.length],
        size: 0.95,
        pos: orbit(index, list.length, engine?.ok ? 1.16 : 0.78, Math.PI / 8),
        sessionId: session.id,
        group: session.scene,
        meta: `${session.role} · ${session.model}`,
        detail: session.summary,
        tags: [session.status, ...session.modules.filter((item) => item.enabled).slice(0, 2).map((item) => item.moduleId)],
      };
      nodes.push(node);
      sceneNodes.push(node);
      edges.push({ a: CORE_ID, b: node.id, kind: 'core' });

      session.events.slice(0, onlyMemory ? 3 : 2).forEach((event, eventIndex) => {
        const id = `local-event-${session.id}-${event.id}`;
        nodes.push({
          id,
          label: event.time,
          kind: 'event',
          color: session.color || '#8f9bb3',
          size: 0.38,
          pos: [
            node.pos[0] + (hash(id) - 0.5) * 0.38,
            node.pos[1] + (eventIndex - 0.5) * 0.12,
            node.pos[2] + (hash(`${id}z`) - 0.5) * 0.38,
          ],
          sessionId: session.id,
          meta: `${session.name} · 事件`,
          detail: event.text,
        });
        edges.push({ a: node.id, b: id, kind: 'event' });
      });
    });

  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
    degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
  }
  for (const node of nodes) {
    node.size += Math.min(0.45, (degree.get(node.id) ?? 0) * 0.035);
  }

  return {
    nodes,
    edges,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      scenes: nodes.filter((node) => node.kind === 'scene').length,
      memories: nodes.filter((node) => node.kind === 'memory').length,
      skills: nodes.filter((node) => node.kind === 'skill').length,
      mode: engine?.ok ? 'engine' : 'local',
    },
  };
}
