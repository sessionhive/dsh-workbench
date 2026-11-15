/** 外部大屏资源（cyberdaddyleo/agent-display）在本机的安装状态。 */
export interface AgentDisplayStatus {
  ok: boolean;
  /** 本地 index.html 的绝对路径。 */
  path?: string;
  /** file:// 地址，直接交给 webview / 系统浏览器。 */
  url?: string;
  size?: number;
  updatedAt?: number;
  error?: string;
  canceled?: boolean;
}
