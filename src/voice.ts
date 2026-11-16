import { useSyncExternalStore } from 'react';
import { defaultSettings, type VoiceSettings } from './settings';

/**
 * 引擎回复的语音播报。
 * 文本来自 EngineSurface 对官方页面「本轮回复」节点的读取，这里只负责：
 * 判定哪条回复是新完成的、清洗成口语文本、分句排队、调用主进程合成并播放。
 */

export interface EngineReply {
  sessionId: string;
  turn: string;
  /** 是否已经出现本轮收尾节点（turn-tail），用来判断回复说完了。 */
  done: boolean;
  text: string;
}

export interface VoiceLastReply {
  sessionId: string;
  turn: string;
  text: string;
  at: number;
}

export type VoicePhase = 'idle' | 'loading' | 'playing' | 'paused';

export interface VoiceState {
  enabled: boolean;
  phase: VoicePhase;
  /** 本地模型需要先整段合成，再开始播放。 */
  local: boolean;
  index: number;
  total: number;
  error: string;
  lastReply: VoiceLastReply | null;
}

const initialVoiceState: VoiceState = {
  enabled: defaultSettings.voice.enabled,
  phase: 'idle',
  local: false,
  index: 0,
  total: 0,
  error: '',
  lastReply: null,
};

let state: VoiceState = initialVoiceState;
let settings: VoiceSettings = { ...defaultSettings.voice };
const listeners = new Set<() => void>();

/** 只朗读「看见它开始、又看见它结束」的回复；启动前就有的旧回复不念。 */
let baselineReady = false;
const incompleteTurns = new Set<string>();
const spokenTurns = new Set<string>();

/** 一次朗读的会话令牌：停下或换一条时自增，旧队列自然失效。 */
let session = 0;
let queue: string[] = [];
let chunkPromises = new Map<number, Promise<string>>();
let chunkUrls = new Map<number, string>();
let activeOptions: VoiceSettings = { ...defaultSettings.voice };
let paused = false;
let pauseWaiters: Array<() => void> = [];
let audio: HTMLAudioElement | null = null;
let currentUrl = '';

const MAX_SPEECH_CHARS = 12_000;
const MAX_MARKS = 400;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): VoiceState {
  return state;
}

function patchState(patch: Partial<VoiceState>) {
  const next = { ...state, ...patch };
  if (
    next.phase === state.phase &&
    next.index === state.index &&
    next.total === state.total &&
    next.error === state.error &&
    next.enabled === state.enabled &&
    next.local === state.local &&
    next.lastReply === state.lastReply
  ) {
    return;
  }
  state = next;
  listeners.forEach((listener) => listener());
}

export function useVoiceState(): VoiceState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 设置变化时同步给播报器；关闭开关会立即停下。 */
export function configureVoice(next: VoiceSettings): void {
  settings = { ...next };
  patchState({ enabled: next.enabled });
  if (!next.enabled) stopVoice();
}

function trimSet(set: Set<string>) {
  while (set.size > MAX_MARKS) {
    const first = set.values().next().value;
    if (first === undefined) break;
    set.delete(first);
  }
}

/** 来自页面探针的回复：完成且本轮是「先看到进行中」的，才自动朗读。 */
export function ingestEngineReply(reply: EngineReply): void {
  if (!reply || !reply.sessionId || !reply.turn) return;
  const text = String(reply.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return;

  const key = `${reply.sessionId}|${reply.turn}`;
  if (reply.done && (state.lastReply?.turn !== reply.turn || state.lastReply?.sessionId !== reply.sessionId)) {
    patchState({ lastReply: { sessionId: reply.sessionId, turn: reply.turn, text, at: Date.now() } });
  }

  if (!reply.done) {
    // 页面还在生成：记下来，等它收尾。
    incompleteTurns.add(key);
    baselineReady = true;
    return;
  }

  if (!baselineReady) {
    // 启动时已经完成的旧回复：只作为手动朗读的素材。
    baselineReady = true;
    return;
  }

  if (!incompleteTurns.has(key) || spokenTurns.has(key)) return;
  spokenTurns.add(key);
  trimSet(spokenTurns);
  trimSet(incompleteTurns);

  if (!settings.enabled) return;
  speakText(text, { ...settings, enabled: true });
}

/** 手动朗读最近一条已完成回复（简报就靠它整篇读）。 */
export function speakLatestReply(): void {
  const reply = state.lastReply;
  if (!reply?.text) {
    patchState({ error: '还没有可朗读的回复' });
    return;
  }
  speakText(reply.text, { ...settings, enabled: true });
}

/** 设置页试听：不依赖自动朗读开关。 */
export function previewVoice(overrides?: Partial<VoiceSettings>): void {
  speakText(
    '你好，我是 DSH 中枢。简报会按段落完整读完，遇到代码和表格会自动跳过，重要结论会放慢一点。',
    { ...settings, ...overrides, enabled: true },
  );
}

function stopAudio() {
  if (!audio) return;
  try {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  } catch {
    // 元素被回收时忽略
  }
}

function releaseUrls() {
  for (const url of chunkUrls.values()) URL.revokeObjectURL(url);
  chunkUrls.clear();
  chunkPromises.clear();
}

function resolvePauseWaiters() {
  pauseWaiters.forEach((resolve) => resolve());
  pauseWaiters = [];
}

function waitWhilePaused(gen: number): Promise<void> {
  if (!paused || gen !== session) return Promise.resolve();
  return new Promise((resolve) => pauseWaiters.push(resolve));
}

export function stopVoice(): void {
  session += 1;
  queue = [];
  paused = false;
  chunkPromises.clear();
  releaseUrls();
  stopAudio();
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = '';
  }
  resolvePauseWaiters();
  patchState({ phase: 'idle', index: 0, total: 0, local: false });
}

export function toggleVoicePause(): void {
  if (state.phase === 'playing') {
    paused = true;
    audio?.pause();
    patchState({ phase: 'paused' });
    return;
  }
  if (state.phase === 'loading') {
    paused = true;
    patchState({ phase: 'paused' });
    return;
  }
  if (state.phase === 'paused') {
    paused = false;
    resolvePauseWaiters();
    if (audio && audio.src) {
      void audio.play().catch(() => undefined);
      patchState({ phase: 'playing' });
    } else {
      patchState({ phase: 'loading' });
    }
  }
}

/** 把 Markdown 清洗成适合朗读的口语文本。 */
export function speechTextOf(markdown: string): string {
  let text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, '。')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.、)]\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // 表格分隔行：只剩横线和冒号的整行去掉。
  text = text
    .split('\n')
    .filter((line) => !/^[\s:|-]+$/.test(line) || line.trim().length > 2)
    .join('\n');
  // 常见符号读法，避免逐字念。
  text = text
    .replace(/≈/g, '约')
    .replace(/→/g, '到')
    .replace(/×/g, '乘以')
    .replace(/¥/g, '元')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text.slice(0, MAX_SPEECH_CHARS);
}

/**
 * 按段落合并成尽量长的正文再合成。
 * 逐句合成会把一句话当成一次「播报」，句尾全是最重的降调，听起来像机器在念稿；
 * 整段合成才能让重音和停顿连起来。超长段落才退到句子边界切开。
 */
const CHUNK_TARGET = 1200;
/** 本地模型显存只有 4GB 上下，单段太长容易拖垮服务，按小段排队。 */
const LOCAL_CHUNK_TARGET = 180;

function chunkOf(text: string, target = CHUNK_TARGET): string[] {
  const chunks: string[] = [];
  let buffer = '';

  const flush = () => {
    const body = buffer.trim();
    buffer = '';
    if (!body) return;
    chunks.push(/[。！？!?；;…]$/.test(body) ? body : `${body}。`);
  };

  const push = (piece: string) => {
    const body = piece.trim();
    if (!body) return;
    if (buffer && buffer.length + body.length + 1 > target) flush();
    buffer = buffer ? `${buffer}\n${body}` : body;
    if (buffer.length >= target) flush();
  };

  for (const paragraph of text.split(/\n+/)) {
    const body = paragraph.trim();
    if (!body) continue;
    if (body.length <= target) {
      push(body);
      continue;
    }
    const sentences = body.split(/(?<=[。！？!?；;…])/);
    let sentence = '';
    for (const piece of sentences) {
      if (piece.length > target) {
        if (sentence) {
          push(sentence);
          sentence = '';
        }
        for (let index = 0; index < piece.length; index += target) {
          push(piece.slice(index, index + target));
        }
        continue;
      }
      if (sentence.length + piece.length > target) {
        push(sentence);
        sentence = piece;
      } else {
        sentence += piece;
      }
    }
    if (sentence) push(sentence);
  }
  flush();
  return chunks;
}

function synthesizeChunk(text: string): Promise<string> {
  const desktop = window.desktop;
  if (!desktop?.ttsSpeak) return Promise.reject(new Error('浏览器预览环境不支持语音合成'));
  const local = activeOptions.provider === 'local';
  const payload = {
    text,
    provider: activeOptions.provider,
    voiceId: activeOptions.voiceId,
    rate: activeOptions.rate,
    volume: activeOptions.volume,
    local: local
      ? {
          root: activeOptions.local.root,
          referenceAudio: activeOptions.local.referenceAudio,
          referenceText: activeOptions.local.referenceText,
        }
      : undefined,
  };
  return desktop
    .ttsSpeak(payload)
    .then((result) => {
      if (!result.ok || !result.audio || result.audio.length === 0) {
        throw new Error(result.error || '语音合成失败');
      }
      const bytes = new Uint8Array(result.audio);
      const mime = result.mime || (local ? 'audio/wav' : 'audio/mpeg');
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    });
}

function ensureChunk(gen: number, index: number): Promise<string> {
  const existing = chunkPromises.get(index);
  if (existing) return existing;
  const promise = synthesizeChunk(queue[index]).then((url) => {
    if (gen !== session) {
      URL.revokeObjectURL(url);
      throw new Error('朗读已取消');
    }
    chunkUrls.set(index, url);
    return url;
  });
  chunkPromises.set(index, promise);
  return promise;
}

async function playUrl(gen: number, url: string): Promise<void> {
  if (gen !== session) return;
  await waitWhilePaused(gen);
  if (gen !== session) return;
  if (!audio) audio = new Audio();
  currentUrl = url;
  audio.src = url;
  // 本地合成的声音按播放端音量控制；Edge 由 SSML 控制，这里保持 1。
  audio.volume =
    activeOptions.provider === 'local'
      ? Math.min(1, Math.max(0, activeOptions.volume / 100))
      : 1;
  patchState({ phase: 'playing' });
  await new Promise<void>((resolve, reject) => {
    const element = audio!;
    const onEnd = () => {
      element.removeEventListener('ended', onEnd);
      element.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      element.removeEventListener('ended', onEnd);
      element.removeEventListener('error', onError);
      reject(new Error('音频播放失败'));
    };
    element.addEventListener('ended', onEnd, { once: true });
    element.addEventListener('error', onError, { once: true });
    element.play().catch(reject);
  });
}

async function runQueue(gen: number): Promise<void> {
  // 本地服务一次只跑一段最稳，只提前一段；Edge 是云端并发，可以提前两段。
  const local = activeOptions.provider === 'local';
  const ahead = local ? 1 : 2;
  try {
    for (let index = 0; index < queue.length; index += 1) {
      if (gen !== session) return;
      for (let step = 1; step <= ahead; step += 1) {
        if (index + step < queue.length) void ensureChunk(gen, index + step).catch(() => undefined);
      }
      const url = await ensureChunk(gen, index);
      await waitWhilePaused(gen);
      if (gen !== session) return;
      patchState({ index: index + 1, total: queue.length, phase: 'playing' });
      await playUrl(gen, url);
      URL.revokeObjectURL(url);
      chunkUrls.delete(index);
      chunkPromises.delete(index);
    }
    if (gen !== session) return;
    patchState({ phase: 'idle', index: 0, total: 0, local: false });
  } catch (error) {
    if (gen !== session) return;
    patchState({
      phase: 'idle',
      index: 0,
      total: 0,
      local: false,
      error: String((error as Error)?.message || error).slice(0, 120),
    });
  } finally {
    if (gen === session) releaseUrls();
  }
}

function speakText(raw: string, options: VoiceSettings): void {
  if (!window.desktop?.ttsSpeak) {
    patchState({ error: '浏览器预览环境不支持语音合成' });
    return;
  }
  const text = speechTextOf(raw);
  const local = options.provider === 'local';
  const chunks = chunkOf(text, local ? LOCAL_CHUNK_TARGET : CHUNK_TARGET);
  if (chunks.length === 0) {
    patchState({ error: '没有可朗读的正文' });
    return;
  }
  stopVoice();
  const gen = session;
  queue = chunks;
  activeOptions = { ...options };
  paused = false;
  patchState({ phase: 'loading', local, index: 0, total: chunks.length, error: '' });
  void runQueue(gen);
}

/** 错误提示在一次新的朗读或停止后清掉。 */
export function clearVoiceError(): void {
  if (state.error) patchState({ error: '' });
}