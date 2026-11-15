import type {
  CostSnapshot,
  DispatchFeedResult,
  EngineDocResult,
  EngineEventFeed,
  EngineProcessInfo,
  EngineSkillScan,
  EngineSnapshot,
  FileListing,
  FilePreviewResult,
  HealthReport,
  PathDefaults,
  StyleImageResult,
  StyleScanResult,
  ToolScanResult,
} from './engine/types';
import type { OpenfilmStatus } from './openfilm/types';
import type { AgentDisplayStatus } from './agent-display/types';
import type { SettingsInput } from './settings';
import type {
  TerminalCwdEvent,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalShellOption,
  TerminalStartOptions,
  TerminalStartResult,
} from './terminal/types';

export {};

declare global {
  interface Window {
    desktop?: {
      minimize: () => void;
      close: () => void;
      setCloseToTray: (enabled: boolean) => Promise<boolean>;
      onCloseToTrayChange: (callback: (enabled: boolean) => void) => () => void;
      toggleMaximize: () => Promise<boolean>;
      isMaximized: () => Promise<boolean>;
      onMaximizedChange: (callback: (value: boolean) => void) => () => void;
      getSystemStats: () => Promise<{ cpu: number; mem: number }>;
      loadState: () => Promise<{ ok: boolean; state: unknown; path: string; error?: string }>;
      saveState: (state: unknown) => Promise<{ ok: boolean; path?: string; error?: string }>;
      scanEngine: (root: string) => Promise<EngineSnapshot>;
      engineEvents: (root: string) => Promise<EngineEventFeed>;
      dispatchFeed: (days: string[]) => Promise<DispatchFeedResult>;
      costSnapshot: (root: string) => Promise<CostSnapshot>;
      engineStatus: () => Promise<EngineProcessInfo>;
      engineStart: () => Promise<EngineProcessInfo>;
      engineRestart: () => Promise<EngineProcessInfo>;
      onEngineStatus: (callback: (snapshot: EngineProcessInfo) => void) => () => void;
      openfilmStatus: () => Promise<OpenfilmStatus>;
      openfilmEnsure: () => Promise<OpenfilmStatus>;
      openfilmOpenProject: (folder?: string) => Promise<OpenfilmStatus>;
      openfilmChooseProject: () => Promise<{ canceled: boolean; path?: string }>;
      openfilmOpenExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
      onOpenfilmStatus: (callback: (snapshot: OpenfilmStatus) => void) => () => void;
      onWebviewZoom: (
        callback: (payload: { id: number; direction: 'in' | 'out' }) => void,
      ) => () => void;
      onWebviewNewTab: (
        callback: (payload: { id: number; url: string }) => void,
      ) => () => void;
      onWebviewEscape: (
        callback: (payload: { id: number }) => void,
      ) => () => void;
      agentDisplayStatus: () => Promise<AgentDisplayStatus>;
      agentDisplayEnsure: () => Promise<AgentDisplayStatus>;
      agentDisplayReinstall: () => Promise<AgentDisplayStatus>;
      agentDisplayImport: () => Promise<AgentDisplayStatus>;
      agentDisplayOpenExternal: () => Promise<{ ok: boolean; error?: string }>;
      defaultPaths: () => Promise<PathDefaults>;
      pickEngineRoot: (defaultPath?: string) => Promise<string | null>;
      pickWorkspaceRoot: (defaultPath?: string) => Promise<string | null>;
      pickDirectory: (title: string, defaultPath: string) => Promise<string | null>;
      listDirectory: (root: string, relative: string) => Promise<FileListing>;
      resolvePath: (
        root: string,
        target: string,
      ) => Promise<{ ok: boolean; root?: string; relative?: string; error?: string }>;
      previewFile: (root: string, relative: string) => Promise<FilePreviewResult>;
      readImage: (root: string, relative: string) => Promise<StyleImageResult>;
      scanStyles: (root?: string) => Promise<StyleScanResult>;
      healthCheck: (engineSettings: SettingsInput['engine']) => Promise<HealthReport>;
      writeFile: (
        root: string,
        relative: string,
        text: string,
      ) => Promise<{ ok: boolean; size?: number; path?: string; error?: string }>;
      createDirectory: (
        root: string,
        relative: string,
        name: string,
      ) => Promise<{ ok: boolean; relative?: string; error?: string }>;
      createFile: (
        root: string,
        relative: string,
        name: string,
      ) => Promise<{ ok: boolean; relative?: string; size?: number; error?: string }>;
      removePath: (
        root: string,
        relative: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      readEngineDoc: (root: string, relative: string) => Promise<EngineDocResult>;
      writeEngineDoc: (
        root: string,
        relative: string,
        text: string,
      ) => Promise<{ ok: boolean; size?: number; relative?: string; error?: string }>;
      scanSkills: (root: string) => Promise<EngineSkillScan>;
      readSkillDoc: (root: string, id: string) => Promise<EngineDocResult>;
      scanTools: (root: string) => Promise<ToolScanResult>;
      readEngineOrder: (
        root: string,
        day: string,
        orderId: string,
        agent: string,
      ) => Promise<EngineDocResult>;
      copyText: (text: string) => Promise<{ ok: boolean; error?: string }>;
      terminalShells: () => Promise<TerminalShellOption[]>;
      terminalStart: (options: TerminalStartOptions) => Promise<TerminalStartResult>;
      terminalExec: (
        id: string,
        command: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      terminalKill: (id: string) => Promise<{ ok: boolean }>;
      onTerminalData: (callback: (payload: TerminalDataEvent) => void) => () => void;
      onTerminalCwd: (callback: (payload: TerminalCwdEvent) => void) => () => void;
      onTerminalExit: (callback: (payload: TerminalExitEvent) => void) => () => void;
      openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
      openPath: (target: string) => Promise<{ ok: boolean; error?: string }>;
      openEnginePath: (
        root: string,
        relative: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      platform: string;
    };
  }
}
