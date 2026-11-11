import { useCallback, useEffect, useRef, useState } from 'react';

interface EngineDocState {
  text: string;
  loading: boolean;
  error: string;
}

/**
 * 只读/可写引擎文档（角色卡、技能、总结、场景记忆）。
 * 读写都走主进程白名单 IPC，未连接桌面端时保持空状态。
 */
export function useEngineDoc(root: string, relative: string | null) {
  const [state, setState] = useState<EngineDocState>({ text: '', loading: false, error: '' });
  const [saving, setSaving] = useState(false);
  /** 读取序号：切换文件时丢弃上一次迟到的结果。 */
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    if (!relative) {
      setState({ text: '', loading: false, error: '' });
      return;
    }
    if (!root || !window.desktop?.readEngineDoc) {
      setState({ text: '', loading: false, error: '仅桌面端可读取引擎文档' });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const result = await window.desktop.readEngineDoc(root, relative);
      if (seq !== seqRef.current) return;
      setState({
        text: result.ok ? result.text ?? '' : '',
        loading: false,
        error: result.ok ? '' : result.error || '读取失败',
      });
    } catch (reason) {
      if (seq !== seqRef.current) return;
      setState({
        text: '',
        loading: false,
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }, [relative, root]);

  useEffect(() => {
    void load();
    return () => {
      seqRef.current += 1;
    };
  }, [load]);

  const save = useCallback(
    async (text: string) => {
      if (!relative || !window.desktop?.writeEngineDoc) {
        return { ok: false, error: '仅桌面端可保存引擎文档' };
      }
      setSaving(true);
      try {
        const result = await window.desktop.writeEngineDoc(root, relative, text);
        if (result.ok) {
          setState({ text, loading: false, error: '' });
        }
        return result;
      } catch (reason) {
        return { ok: false, error: reason instanceof Error ? reason.message : String(reason) };
      } finally {
        setSaving(false);
      }
    },
    [relative, root],
  );

  return { ...state, saving, reload: load, save };
}
