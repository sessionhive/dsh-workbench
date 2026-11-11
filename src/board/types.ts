import type { IconName } from '../types';

export type TileDensity = 'compact' | 'regular' | 'wide';

export type TileKind = 'module' | 'info';

/** 场景桌面的盒子模型：位置与尺寸都以网格为单位。 */
export interface BoardTile {
  id: string;
  kind: TileKind;
  moduleId: string;
  title: string;
  subtitle?: string;
  icon: IconName;
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  minH: number;
  accent?: string;
  /** 用户在当前场景里手动隐藏；模块被会话停用时也会从桌面消失，但不改这里。 */
  hidden?: boolean;
}

export interface SceneBoardState {
  tiles: BoardTile[];
  savedAt: string;
}
