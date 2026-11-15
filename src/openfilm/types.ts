/** 主进程托管的 OpenFilm Studio 状态；editorUrl 带 launch key，只留在内存里。 */
export type OpenfilmPhase = 'idle' | 'starting' | 'ready' | 'error';

export interface OpenfilmProject {
  id: string;
  name: string;
  path: string;
}

export interface OpenfilmStatus {
  status: OpenfilmPhase;
  error: string;
  /** true 表示附着在本机已有 Studio 上，退出工作台时不会关闭它。 */
  attached: boolean;
  origin: string;
  editorUrl: string;
  project: OpenfilmProject | null;
  /** open-project 返回的项目地址（带 key），可直接交给 webview。 */
  url?: string;
}
