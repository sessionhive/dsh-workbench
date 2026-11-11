import type { EngineScene, EngineSnapshot } from './types';
import type { Session } from '../types';

/** 会话 → 引擎场景：优先用创建时的场景引用，其次用绑定会话的标题/ID 反查。 */
export function resolveSessionScene(
  session: Session,
  engine: EngineSnapshot | null,
): EngineScene | null {
  if (!engine?.ok) return null;
  if (session.engine?.sceneId) {
    return engine.scenes.find((scene) => scene.id === session.engine?.sceneId) ?? null;
  }
  const binding = session.harness ?? session.engine;
  if (!binding) return null;
  const title = 'title' in binding ? binding.title : undefined;
  return (
    engine.scenes.find((scene) => {
      if (binding.sessionId && scene.primarySessionId === binding.sessionId) return true;
      if (binding.sessionId && scene.sessions.some((item) => item.sessionId === binding.sessionId)) {
        return true;
      }
      if (title && scene.sessions.some((item) => item.title === title)) return true;
      return false;
    }) ?? null
  );
}

export interface AgentPaths {
  agentId: string;
  card: string;
  summary: string;
  memoryRoot: string;
  skill: string;
}

/** 场景对应的角色卡 / 总结 / 记忆 / 技能相对路径。 */
export function agentPathsOf(scene: EngineScene): AgentPaths {
  const memoryRoot = (scene.memoryRoot || `agents/${scene.id}`).replace(/\\/g, '/').replace(/\/$/, '');
  const agentId = memoryRoot.split('/').pop() || scene.id;
  return {
    agentId,
    card: `agents/${agentId}/card.json`,
    summary: `agents/${agentId}/summary.md`,
    memoryRoot: `${memoryRoot}/memory`,
    skill: scene.skill ? `skills/${scene.skill}/SKILL.md` : '',
  };
}
