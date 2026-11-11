export interface TerminalShellOption {
  id: string;
  label: string;
  path: string;
  kind: 'auto' | 'posix' | 'powershell' | 'cmd';
  available: boolean;
}

export interface TerminalStartOptions {
  id: string;
  shell: string;
  cwd: string;
}

export interface TerminalStartResult {
  ok: boolean;
  id?: string;
  shellId?: string;
  shellLabel?: string;
  shellPath?: string;
  cwd?: string;
  error?: string;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
}

export interface TerminalCwdEvent {
  id: string;
  cwd: string;
}

export interface TerminalExitEvent {
  id: string;
  code: number | null;
  signal: string | null;
}
