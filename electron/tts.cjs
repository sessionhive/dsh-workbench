const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

/**
 * 语音合成。
 * - Edge：内置 16 套神经音色（普通话 / 方言 / 台湾 / 粤语 / 多语种），不依赖本机系统语音，也不会随机回退；
 * - 本地：GPT-SoVITS v2 用参考音频复刻音色，声音与参考录音一致；
 * - 合成结果按「音色 / 参考音频 / 语速 / 音量 / 文本」缓存在本机，重复朗读不再合成。
 */
const VOICES = {
  xiaoxiao: 'zh-CN-XiaoxiaoNeural',
  xiaoyi: 'zh-CN-XiaoyiNeural',
  yunxi: 'zh-CN-YunxiNeural',
  yunjian: 'zh-CN-YunjianNeural',
  yunyang: 'zh-CN-YunyangNeural',
  yunxia: 'zh-CN-YunxiaNeural',
  xiaobei: 'zh-CN-liaoning-XiaobeiNeural',
  xiaoni: 'zh-CN-shaanxi-XiaoniNeural',
  hsiaochen: 'zh-TW-HsiaoChenNeural',
  hsiaoyu: 'zh-TW-HsiaoYuNeural',
  yunjhe: 'zh-TW-YunJheNeural',
  hiugaai: 'zh-HK-HiuGaaiNeural',
  hiumaan: 'zh-HK-HiuMaanNeural',
  wanlung: 'zh-HK-WanLungNeural',
  ava: 'en-US-AvaMultilingualNeural',
  andrew: 'en-US-AndrewMultilingualNeural',
};

const MAX_TEXT = 2000;
const CACHE_LIMIT = 240;
const IDLE_CLOSE_MS = 90_000;

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createTtsService({ cacheDir, localTts }) {
  fs.mkdirSync(cacheDir, { recursive: true });

  /** 每个音色复用一条连接；空闲一段时间后主动断开，避免长期占着。 */
  const clients = new Map();

  function getClient(voice) {
    let entry = clients.get(voice);
    if (entry) {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => closeClient(voice), IDLE_CLOSE_MS);
      entry.timer.unref?.();
      return entry.promise;
    }
    const tts = new MsEdgeTTS({ connectionTimeoutMs: 12000, synthesisTimeoutMs: 30000 });
    const promise = tts
      .setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
      .then(() => tts)
      .catch((error) => {
        clients.delete(voice);
        tts.close();
        throw error;
      });
    const timer = setTimeout(() => closeClient(voice), IDLE_CLOSE_MS);
    timer.unref?.();
    clients.set(voice, { tts, promise, timer });
    return promise;
  }

  function closeClient(voice) {
    const entry = clients.get(voice);
    if (!entry) return;
    clients.delete(voice);
    clearTimeout(entry.timer);
    try {
      entry.tts.close();
    } catch {
      // 连接已经断开时忽略
    }
  }

  function cacheKey(engine, rate, volume, text) {
    return crypto
      .createHash('sha1')
      .update(`v4|${engine}|${rate}|${volume}|${text}`)
      .digest('hex');
  }

  /** 参考音频换人或换文本后，旧缓存必须失效。 */
  function referenceKey(file, text) {
    let stamp = '';
    try {
      const stat = fs.statSync(file);
      stamp = `${stat.size}|${stat.mtimeMs}`;
    } catch {
      stamp = 'missing';
    }
    return crypto
      .createHash('sha1')
      .update(`ref|${file}|${stamp}|${text}`)
      .digest('hex')
      .slice(0, 16);
  }

  function pruneCache() {
    let names = [];
    try {
      names = fs
        .readdirSync(cacheDir)
        .filter((name) => name.endsWith('.mp3') || name.endsWith('.wav'));
    } catch {
      return;
    }
    if (names.length <= CACHE_LIMIT) return;
    const files = names
      .map((name) => {
        const file = path.join(cacheDir, name);
        try {
          return { file, at: fs.statSync(file).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((left, right) => left.at - right.at);
    for (const item of files.slice(0, files.length - CACHE_LIMIT + 40)) {
      try {
        fs.unlinkSync(item.file);
      } catch {
        // 删除失败不影响朗读
      }
    }
  }

  function store(file, buffer, mime) {
    if (!buffer || buffer.length === 0) throw new Error('合成结果为空');
    try {
      fs.writeFileSync(file, buffer);
      pruneCache();
    } catch {
      // 缓存写不进去时只影响下次重读，不影响本次播放。
    }
    return { audio: buffer, cached: false, mime };
  }

  function readCache(file, mime) {
    try {
      const cached = fs.readFileSync(file);
      if (cached.length === 0) return null;
      fs.utimesSync(file, new Date(), new Date());
      return { audio: cached, cached: true, mime };
    } catch {
      return null;
    }
  }

  function synthesizeEdge(voice, text, rate, volume, file) {
    return getClient(voice).then(
      (tts) =>
        new Promise((resolve, reject) => {
          let settled = false;
          const finish = (error, buffer) => {
            if (settled) return;
            settled = true;
            if (error) {
              // 连接可能已坏掉，下次重建。
              closeClient(voice);
              reject(error);
              return;
            }
            try {
              resolve(store(file, buffer, 'audio/mpeg'));
            } catch (storeError) {
              reject(storeError);
            }
          };
          let stream;
          try {
            stream = tts.toStream(escapeXml(text), { rate, volume }).audioStream;
          } catch (error) {
            finish(error);
            return;
          }
          const parts = [];
          const timer = setTimeout(() => finish(new Error('语音合成超时')), 30_000);
          stream.on('data', (chunk) => parts.push(Buffer.from(chunk)));
          stream.on('error', (error) => {
            clearTimeout(timer);
            finish(error);
          });
          stream.on('end', () => {
            clearTimeout(timer);
            finish(null, Buffer.concat(parts));
          });
        }),
    );
  }

  function synthesize(request) {
    const raw = String(request?.text ?? '');
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!text) throw new Error('没有可朗读的文本');
    const rate = clamp(Number(request?.rate) || 1, 0.8, 1.4);

    if (request?.provider === 'local') {
      if (!localTts) throw new Error('本地语音服务不可用');
      const local = request?.local || {};
      const referenceAudio = localTts.validateReference(local.referenceAudio);
      const referenceText = String(local.referenceText || '').trim();
      if (!referenceText) {
        throw new Error('参考音频文本为空：请把录音里说的话逐字填进「参考音频文本」');
      }
      // 音量在播放端控制，合成结果不受音量影响，换音量不会重算。
      const file = path.join(
        cacheDir,
        `${cacheKey(`local|${referenceKey(referenceAudio, referenceText)}`, rate, 100, text)}.wav`,
      );
      const cached = readCache(file, 'audio/wav');
      if (cached) return Promise.resolve(cached);
      return localTts
        .synthesize({
          root: String(local.root || '').trim(),
          referenceAudio,
          referenceText,
          text,
          speed: rate,
        })
        .then((result) => store(file, result.audio, result.mime || 'audio/wav'));
    }

    const voiceId = String(request?.voiceId || 'xiaoxiao');
    const edgeVoice = VOICES[voiceId];
    if (!edgeVoice) throw new Error('未知的音色');
    const requestedVolume = Number(request?.volume);
    const volume = clamp(
      Math.round(Number.isFinite(requestedVolume) ? requestedVolume : 100),
      0,
      100,
    );
    const file = path.join(cacheDir, `${cacheKey(edgeVoice, rate, volume, text)}.mp3`);

    const cached = readCache(file, 'audio/mpeg');
    if (cached) return Promise.resolve(cached);

    return synthesizeEdge(edgeVoice, text, rate, volume, file);
  }

  return { synthesize };
}

module.exports = { createTtsService, VOICES };
