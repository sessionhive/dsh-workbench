import { agentPathsOf } from '../engine/scene';
import type { EngineSnapshot } from '../engine/types';
import type { RoleId, Session } from '../types';

export type NeuronKind = 'core' | 'scene' | 'card' | 'skill' | 'memory' | 'event';

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
  /** 会话下方的分类节点（角色卡 / 技能 / 今日记忆），用于区分叶子节点。 */
  role?: 'group';
}

export interface NeuronEdge {
  a: string;
  b: string;
  kind: 'core' | 'card' | 'memory' | 'skill' | 'event';
}

export interface NeuronStats {
  nodes: number;
  edges: number;
  scenes: number;
  memories: number;
  skills: number;
  cards: number;
  mode: 'engine' | 'local';
}

export interface NeuronModel {
  nodes: NeuronNode[];
  edges: NeuronEdge[];
  stats: NeuronStats;
}

const PALETTE = ['#38e1e6', '#8f80ff', '#f6b64c', '#3ee0a3', '#e468d4', '#5aa9ff', '#ff8f6b', '#b6d66b'];
const CORE_ID = 'core';
const TAU = Math.PI * 2;
const GROUP_DISTANCE = 0.25;
const LEAF_DISTANCE = 0.13;

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

function unit(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/** 以会话到中心的径向为轴，给三个分支节点布置一个稳定的三脚架坐标系。 */
function sceneFrame(position: [number, number, number]) {
  const radial = unit(
    position[0] === 0 && position[1] === 0 && position[2] === 0 ? [0, 1, 0] : position,
  );
  const up: [number, number, number] = Math.abs(radial[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0];
  const tangent = unit([
    up[1] * radial[2] - up[2] * radial[1],
    up[2] * radial[0] - up[0] * radial[2],
    up[0] * radial[1] - up[1] * radial[0],
  ]);
  const bitangent = unit([
    radial[1] * tangent[2] - radial[2] * tangent[1],
    radial[2] * tangent[0] - radial[0] * tangent[2],
    radial[0] * tangent[1] - radial[1] * tangent[0],
  ]);
  return { radial, tangent, bitangent };
}

function branchPos(
  origin: [number, number, number],
  frame: ReturnType<typeof sceneFrame>,
  angle: number,
  distance: number,
  lift = 0.12,
): [number, number, number] {
  const cos = Math.cos(angle) * distance;
  const sin = Math.sin(angle) * distance;
  return [
    origin[0] + frame.radial[0] * lift + frame.tangent[0] * cos + frame.bitangent[0] * sin,
    origin[1] + frame.radial[1] * lift + frame.tangent[1] * cos + frame.bitangent[1] * sin,
    origin[2] + frame.radial[2] * lift + frame.tangent[2] * cos + frame.bitangent[2] * sin,
  ];
}

/** 本地日期键，与引擎 memory/<YYYY-MM-DD>/ 目录保持一致。 */
function todayKey() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function fileLabel(file: string) {
  const base = file.split('/').pop() || file;
  return base.replace(/\.[^.]+$/, '') || base;
}

export function buildNeuronModel(
  sessions: Session[],
  engine: EngineSnapshot | null,
  onlyMemory: boolean,
): NeuronModel {
  const nodes: NeuronNode[] = [
    {
      id: CORE_ID,
      label: 'DSH中枢',
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
  const today = todayKey();

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
        detail: short(scene.mission || scene.summaryText || '该会话暂无摘要。', 180),
        tags: [scene.skill, scene.primarySessionId ? '已绑定会话' : '未绑定会话'].filter(Boolean),
        path: scene.memoryRoot,
      };
      nodes.push(node);
      sceneNodes.push(node);
      edges.push({ a: CORE_ID, b: node.id, kind: 'core' });

      const frame = sceneFrame(node.pos);
      const shared = {
        sceneId: scene.id,
        sessionId: local?.id,
        group: scene.group,
      };

      // 角色卡：直接挂在会话下，承载角色、职责与状态。
      if (!onlyMemory) {
        const cardPaths = agentPathsOf(scene);
        const card: NeuronNode = {
          id: `card-${scene.id}`,
          label: '角色卡',
          kind: 'card',
          color: '#f0c674',
          size: 0.62,
          pos: branchPos(node.pos, frame, -Math.PI / 2, GROUP_DISTANCE, 0.16),
          ...shared,
          role: 'group',
          meta: `${scene.name} · ${scene.status || '角色'}`,
          detail: short(
            scene.mission ||
              scene.responsibilities.join('；') ||
              scene.summaryText ||
              '该会话暂无角色卡描述。',
            180,
          ),
          tags: [scene.status, ...scene.responsibilities.slice(0, 2)].filter(Boolean),
          path: cardPaths.card,
        };
        nodes.push(card);
        edges.push({ a: node.id, b: card.id, kind: 'card' });

        // 技能：先给分类节点，再挂具体技能文件。
        const skillGroup: NeuronNode = {
          id: `skill-group-${scene.id}`,
          label: '技能',
          kind: 'skill',
          color: '#6f8fd6',
          size: 0.58,
          pos: branchPos(node.pos, frame, (Math.PI * 7) / 6, GROUP_DISTANCE, 0.1),
          ...shared,
          role: 'group',
          meta: `${scene.skillCount} 个技能文件`,
          detail: scene.skill ? `skills/${scene.skill}` : '该会话未配置技能目录。',
          path: scene.skill ? `skills/${scene.skill}` : undefined,
        };
        nodes.push(skillGroup);
        edges.push({ a: node.id, b: skillGroup.id, kind: 'skill' });

        scene.skillFiles.slice(0, 3).forEach((file, skillIndex, list) => {
          const id = `skill-${scene.id}-${file}`;
          const angle = (skillIndex / Math.max(1, list.length)) * TAU + hash(id) * 0.7;
          const leaf: NeuronNode = {
            id,
            label: fileLabel(file),
            kind: 'skill',
            color: '#8fb0ff',
            size: 0.4,
            pos: branchPos(skillGroup.pos, frame, angle, LEAF_DISTANCE, 0.03),
            sceneId: scene.id,
            sessionId: local?.id,
            meta: `${scene.name} · 技能`,
            detail: file,
            path: `skills/${scene.skill}/${file}`,
          };
          nodes.push(leaf);
          edges.push({ a: skillGroup.id, b: id, kind: 'skill' });
        });
      }

      // 今日记忆：只投影当天日期目录下的文件，没有写入时保留空分支。
      const todayFiles = scene.memoryFiles
        .filter((file) => file.startsWith(`${today}/`) && !/(^|\/)INDEX\.md$/i.test(file))
        .slice(0, 4);
      const memoryGroup: NeuronNode = {
        id: `memory-group-${scene.id}`,
        label: '今日记忆',
        kind: 'memory',
        color: '#cfd9ff',
        size: 0.58,
        pos: branchPos(node.pos, frame, (Math.PI * 11) / 6, GROUP_DISTANCE, 0.1),
        ...shared,
        role: 'group',
        meta: todayFiles.length > 0 ? `${today} · ${todayFiles.length} 条` : `${today} · 暂无写入`,
        detail:
          todayFiles.length > 0
            ? `今天写入的 ${todayFiles.length} 条记忆。`
            : '今天还没有新的记忆文件，空白分支会保留到当天有写入为止。',
        path: todayFiles.length > 0 ? `${scene.memoryRoot}/memory/${today}` : undefined,
      };
      nodes.push(memoryGroup);
      edges.push({ a: node.id, b: memoryGroup.id, kind: 'memory' });

      todayFiles.forEach((file, memoryIndex, list) => {
        const id = `memory-${scene.id}-${file}`;
        const angle = (memoryIndex / Math.max(1, list.length)) * TAU + hash(id) * 0.7;
        const leaf: NeuronNode = {
          id,
          label: fileLabel(file),
          kind: 'memory',
          color: '#dfe7ff',
          size: 0.42,
          pos: branchPos(memoryGroup.pos, frame, angle, LEAF_DISTANCE, 0.03),
          sceneId: scene.id,
          sessionId: local?.id,
          meta: `${scene.name} · 今日记忆`,
          detail: file,
          path: `${scene.memoryRoot}/memory/${file}`.replace(/\/+/g, '/'),
        };
        nodes.push(leaf);
        edges.push({ a: memoryGroup.id, b: id, kind: 'memory' });
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
        meta: `${session.scene} · ${session.model}`,
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
      memories: nodes.filter((node) => node.kind === 'memory' && node.role !== 'group').length,
      skills: nodes.filter((node) => node.kind === 'skill' && node.role !== 'group').length,
      cards: nodes.filter((node) => node.kind === 'card').length,
      mode: engine?.ok ? 'engine' : 'local',
    },
  };
}
