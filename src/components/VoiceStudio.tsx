import { useEffect, useState } from 'react';
import type { LocalTtsStatus } from '../global';
import type { VoiceSettings } from '../settings';
import { previewVoice, useVoiceState } from '../voice';
import { Icon } from './icons';

interface VoiceStudioProps {
  voice: VoiceSettings;
  onChange: (next: VoiceSettings) => void;
}

interface VoiceOption {
  id: VoiceSettings['voiceId'];
  name: string;
  trait: string;
  note: string;
}

const VOICE_GROUPS: Array<{ label: string; items: VoiceOption[] }> = [
  {
    label: '普通话',
    items: [
      { id: 'xiaoxiao', name: '晓晓', trait: '女声 · 自然', note: '日常播报，语气平稳' },
      { id: 'xiaoyi', name: '晓伊', trait: '女声 · 轻柔', note: '偏轻，适合长文' },
      { id: 'yunxi', name: '云希', trait: '男声 · 年轻', note: '语速轻快，偏少年感' },
      { id: 'yunjian', name: '云健', trait: '男声 · 沉稳', note: '低沉，适合简报' },
      { id: 'yunyang', name: '云扬', trait: '男声 · 播音', note: '新闻播报腔，正式感强' },
      { id: 'yunxia', name: '云夏', trait: '男声 · 少年', note: '偏年轻，适合轻松内容' },
    ],
  },
  {
    label: '方言',
    items: [
      { id: 'xiaobei', name: '晓北', trait: '女声 · 东北话', note: '东北官话，口语感强' },
      { id: 'xiaoni', name: '晓妮', trait: '女声 · 陕西话', note: '中原官话，陕西口音' },
    ],
  },
  {
    label: '台湾',
    items: [
      { id: 'hsiaochen', name: '晓臻', trait: '女声 · 台湾', note: '台湾普通话，语气柔和' },
      { id: 'hsiaoyu', name: '晓雨', trait: '女声 · 台湾', note: '更轻，适合长文' },
      { id: 'yunjhe', name: '云哲', trait: '男声 · 台湾', note: '台湾普通话男声' },
    ],
  },
  {
    label: '粤语',
    items: [
      { id: 'hiugaai', name: '晓佳', trait: '女声 · 粤语', note: '粤语播报' },
      { id: 'hiumaan', name: '晓曼', trait: '女声 · 粤语', note: '粤语，语气更柔' },
      { id: 'wanlung', name: '云龙', trait: '男声 · 粤语', note: '粤语男声' },
    ],
  },
  {
    label: '多语种',
    items: [
      { id: 'ava', name: 'Ava', trait: '女声 · 多语种', note: '多语种女声，读中文略带口音' },
      { id: 'andrew', name: 'Andrew', trait: '男声 · 多语种', note: '多语种男声，读中文略带口音' },
    ],
  },
];

const BUILT_IN_VOICES = VOICE_GROUPS.flatMap((group) => group.items);

const STATUS_LABEL: Record<LocalTtsStatus['state'], string> = {
  stopped: '未启动',
  starting: '启动中',
  ready: '已就绪',
  error: '异常',
};

export function VoiceStudio({ voice, onChange }: VoiceStudioProps) {
  const [defaultRoot, setDefaultRoot] = useState('');
  const [status, setStatus] = useState<LocalTtsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const voiceState = useVoiceState();
  const update = (patch: Partial<VoiceSettings>) => onChange({ ...voice, ...patch });
  const updateLocal = (patch: Partial<VoiceSettings['local']>) =>
    update({ local: { ...voice.local, ...patch } });
  const selected = BUILT_IN_VOICES.find((item) => item.id === voice.voiceId) ?? BUILT_IN_VOICES[0];
  const localRoot = voice.local.root || defaultRoot;
  const local = voice.provider === 'local';

  useEffect(() => {
    let alive = true;
    window.desktop
      ?.defaultPaths()
      .then((paths) => {
        if (alive) setDefaultRoot(paths.localTtsRoot || '');
      })
      .catch(() => undefined);
    const tick = () => {
      window.desktop
        ?.localTtsStatus?.()
        .then((next) => {
          if (alive) setStatus(next);
        })
        .catch(() => undefined);
    };
    void tick();
    const timer = window.setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const startLocal = async () => {
    if (!window.desktop?.localTtsStart || busy) return;
    setBusy(true);
    setNotice('');
    setStatus((current) => ({
      state: 'starting',
      detail: '正在加载本地语音模型，首次约 1–2 分钟',
      port: current?.port ?? 9880,
      root: localRoot,
    }));
    try {
      const result = await window.desktop.localTtsStart(localRoot || undefined);
      setStatus({
        state: result.state,
        detail: result.detail,
        port: result.port,
        root: result.root,
        owned: result.owned,
      });
      if (!result.ok) setNotice(result.error || result.detail || '本地语音引擎启动失败');
    } catch (error) {
      setNotice(String((error as Error)?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const stopLocal = async () => {
    if (!window.desktop?.localTtsStop || busy) return;
    setBusy(true);
    try {
      const result = await window.desktop.localTtsStop();
      setStatus({
        state: result.state,
        detail: result.detail,
        port: result.port,
        root: result.root,
        owned: result.owned,
      });
    } catch (error) {
      setNotice(String((error as Error)?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const pickReference = async () => {
    const picked = await window.desktop?.pickFile(
      'audio',
      '选择参考音频',
      voice.local.referenceAudio || undefined,
    );
    if (picked?.path) {
      setNotice('');
      updateLocal({ referenceAudio: picked.path });
    }
  };

  const pickRoot = async () => {
    const picked = await window.desktop?.pickDirectory(
      '选择 GPT-SoVITS 根目录',
      voice.local.root || defaultRoot,
    );
    if (picked) updateLocal({ root: picked });
  };

  return (
    <div className="voice-studio">
      <section className="voice-block">
        <div className="voice-block-head">
          <div>
            <h5>合成方式</h5>
            <p>本地复刻用你自己的参考录音，声音稳定；Edge 是预置的在线音色。</p>
          </div>
        </div>

        <div className="voice-provider-grid">
          <button
            type="button"
            className={local ? 'on' : ''}
            onClick={() => update({ provider: 'local' })}
          >
            <strong>本地复刻音色</strong>
            <small>GPT-SoVITS v2 · 参考音频</small>
          </button>
          <button
            type="button"
            className={!local ? 'on' : ''}
            onClick={() => update({ provider: 'edge' })}
          >
            <strong>Edge 神经语音</strong>
            <small>16 套预置音色 · 在线</small>
          </button>
        </div>
      </section>

      {local && (
        <section className="voice-block">
          <div className="voice-block-head">
            <div>
              <h5>本地音色</h5>
              <p>用一段 5–15 秒的干净人声复刻音色，之后每句话都沿用同一个声音。</p>
            </div>
            <span className={`voice-status ${status?.state ?? 'stopped'}`}>
              <i />
              {STATUS_LABEL[status?.state ?? 'stopped']}
            </span>
          </div>

          <div className="voice-local-status">
            <p>{status?.detail || '首次朗读时会自动启动本地引擎。'}</p>
            <div className="voice-local-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={startLocal}
                disabled={busy || status?.state === 'starting' || status?.state === 'ready'}
              >
                <Icon name="play" size={12} />
                {status?.state === 'starting' ? '启动中' : '启动'}
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={stopLocal}
                disabled={busy || status?.state === 'stopped'}
              >
                <Icon name="stop" size={12} />
                停止
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void window.desktop?.localTtsOpenLog()}
              >
                日志
              </button>
            </div>
          </div>

          <label className="settings-field">
            <span>模型目录</span>
            <div className="field-line">
              <input
                type="text"
                value={voice.local.root}
                placeholder={defaultRoot || '选择 GPT-SoVITS 根目录'}
                spellCheck={false}
                onChange={(event) => updateLocal({ root: event.target.value })}
              />
              <button type="button" className="ghost-btn" onClick={pickRoot}>
                <Icon name="folder" size={12} />
                选择
              </button>
              {voice.local.root && (
                <button type="button" className="ghost-btn" onClick={() => updateLocal({ root: '' })}>
                  默认
                </button>
              )}
            </div>
          </label>

          <label className="settings-field">
            <span>参考音频</span>
            <div className="field-line">
              <input
                type="text"
                value={voice.local.referenceAudio}
                placeholder="选择一段 5–15 秒的人声录音"
                readOnly
              />
              <button type="button" className="ghost-btn" onClick={pickReference}>
                <Icon name="mic" size={12} />
                选择音频
              </button>
            </div>
          </label>

          <label className="settings-field">
            <span>参考音频文本</span>
            <textarea
              className="voice-textarea"
              rows={2}
              value={voice.local.referenceText}
              placeholder="把录音里说的话逐字写在这里，标点可以保留。"
              onChange={(event) => updateLocal({ referenceText: event.target.value })}
            />
          </label>

          <p className="voice-hint">
            录音尽量安静、无背景音乐，文本必须与录音逐字一致。首次朗读自动加载模型，约 1–2 分钟；
            空闲 30 分钟自动卸载，加载后占用显存约 1.5 GB。参考音频只在本机读取，不会上传。合成一段的时间约为这段播放时长的三分之二，
            会边合成边播，第一段通常在几秒内出声；单段控制在 180 字以内，长简报按段连贯读完。
          </p>
        </section>
      )}

      {!local && (
        <section className="voice-block">
          <div className="voice-block-head">
            <div>
              <h5>音色库</h5>
              <p>16 套 Edge 神经音色，按普通话、方言、台湾、粤语和多语种分组；选定后每次朗读都是同一个声音。</p>
            </div>
            <span className="settings-badge">当前 · {selected.name}</span>
          </div>

          {VOICE_GROUPS.map((group) => (
            <div className="voice-voice-group" key={group.label}>
              <span className="voice-group-label">{group.label}</span>
              <div className="voice-edge-grid">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={voice.voiceId === item.id ? 'on' : ''}
                    title={item.note}
                    onClick={() => update({ voiceId: item.id })}
                  >
                    <strong>{item.name}</strong>
                    <small>{item.trait}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="voice-hint">
            日常对话用晓晓；正式简报可以试云扬或云健；方言、台湾和粤语音色会按各自口音朗读，
            多语种音色读中文会带一点口音。
          </p>
        </section>
      )}

      <section className="voice-block voice-tuning">
        <div className="settings-row">
          <div>
            <strong>语速</strong>
            <p>1.00× 为原速；想更接近聊天可以试 0.95×。</p>
          </div>
          <div className="range-field">
            <input
              type="range"
              min={0.8}
              max={1.4}
              step={0.05}
              value={voice.rate}
              onChange={(event) => update({ rate: Number(event.target.value) })}
            />
            <span className="mono">{voice.rate.toFixed(2)}×</span>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>音量</strong>
            <p>只影响朗读音量，不改系统音量。</p>
          </div>
          <div className="range-field">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={voice.volume}
              onChange={(event) => update({ volume: Number(event.target.value) })}
            />
            <span className="mono">{voice.volume}%</span>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>试听当前音色</strong>
            <p>用当前音色、语速和音量朗读一段示例，确认后再回到日常回复。</p>
          </div>
          <button type="button" className="ghost-btn" onClick={() => previewVoice(voice)}>
            <Icon name="volume" size={12} />
            朗读示例
          </button>
        </div>
        {voiceState.error && <p className="voice-error">朗读失败：{voiceState.error}</p>}
        {notice && <p className="voice-error">{notice}</p>}
      </section>

      <p className="voice-hint voice-footnote">
        自动朗读只读当前打开的会话；简报按段落整篇读完，代码和表格自动跳过。合成结果按段缓存在本机，
        同一段文本重复朗读不再重新合成。本地音色不出网，Edge 音色需要联网。浏览器预览环境不启用语音。
      </p>
    </div>
  );
}
