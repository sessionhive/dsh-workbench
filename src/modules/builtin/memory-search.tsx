import { useEffect, useMemo, useState } from 'react';
import { Markdown } from '../../components/Markdown';
import { Icon } from '../../components/icons';
import { agentPathsOf, resolveSessionScene } from '../../engine/scene';
import type { EngineScene } from '../../engine/types';
import { useEngineDoc } from '../../hooks/useEngineDoc';
import type { ModuleDefinition } from '../types';

interface MemoryFile {
  sceneId: string;
  sceneName: string;
  file: string;
  name: string;
  dir: string;
  path: string;
}

interface MemoryDirectory {
  dir: string;
  files: MemoryFile[];
}

interface MemorySceneGroup {
  id: string;
  name: string;
  current: boolean;
  count: number;
  dirs: MemoryDirectory[];
}

const MEMORY_FILE = /\.(md|markdown|txt)$/i;

function memoryFilesOf(scene: EngineScene): MemoryFile[] {
  const paths = agentPathsOf(scene);
  return scene.memoryFiles
    .filter((file) => MEMORY_FILE.test(file))
    .map((file) => {
      const parts = file.split('/');
      const rawName = parts[parts.length - 1];
      return {
        sceneId: scene.id,
        sceneName: scene.name,
        file,
        name: rawName.replace(MEMORY_FILE, ''),
        dir: parts.slice(0, -1).join('/'),
        path: `${paths.memoryRoot}/${file}`,
      };
    });
}

function byName(a: MemoryFile, b: MemoryFile) {
  return a.file.localeCompare(b.file, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

/** 记忆检索：按场景 → 目录 → 文件浏览 memory，只读渲染 Markdown。 */
export const memorySearchModule: ModuleDefinition = {
  manifest: {
    id: 'memory.search',
    name: '记忆检索',
    version: '0.3.0',
    description:
      '按场景与目录浏览 agents/<场景>/memory 下的记忆文件，Markdown 只读阅读，不写入。',
    icon: 'database',
    kind: ['panel', 'tool'],
    slots: ['detail.block', 'center.view'],
    category: 'knowledge',
    permissions: ['sessions:read', 'fs:read'],
  },
  center: {
    tabLabel: '记忆',
    title: '记忆检索',
    subtitle: ({ sessionCount }) => `场景记忆 · 只读 Markdown · ${sessionCount} 个会话来源`,
  },
  View: ({ slot, session, settings, engine, engineLoading }) => {
    const compact = slot === 'detail.block';
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<MemoryFile | null>(null);
    const [folded, setFolded] = useState<Record<string, true>>({});
    const [openedDirs, setOpenedDirs] = useState<Record<string, true>>({});
    const boundScene = useMemo(() => resolveSessionScene(session, engine), [engine, session]);

    // 绑定会话只看自己的场景；中枢调度汇总全部场景。
    const scenes = useMemo(
      () => (boundScene ? [boundScene] : engine?.scenes ?? []),
      [boundScene, engine],
    );

    const files = useMemo(() => scenes.flatMap(memoryFilesOf), [scenes]);
    const keyword = query.trim().toLowerCase();
    const visibleFiles = useMemo(
      () =>
        keyword
          ? files.filter((file) =>
              `${file.sceneName} ${file.file}`.toLowerCase().includes(keyword),
            )
          : files,
      [files, keyword],
    );

    // 切换会话时清空阅读位置，再落到新场景的第一份记忆。
    useEffect(() => {
      setSelected(null);
      setQuery('');
    }, [session.id, boundScene?.id]);

    // 目录默认折叠，加载时不替用户选中文件；只清掉已不在当前场景里的选择。
    // 搜索过滤只影响左侧列表，不打断右侧正在阅读的文件。
    useEffect(() => {
      if (selected && !files.some((file) => file.path === selected.path)) {
        setSelected(null);
      }
    }, [selected, files]);

    const doc = useEngineDoc(settings.engine.dataPath, selected?.path ?? null);

    const grouped = useMemo<MemorySceneGroup[]>(() => {
      const map = new Map<string, MemorySceneGroup & { dirMap: Map<string, MemoryFile[]> }>();
      for (const file of visibleFiles) {
        let group = map.get(file.sceneId);
        if (!group) {
          group = {
            id: file.sceneId,
            name: file.sceneName,
            current: file.sceneId === boundScene?.id,
            count: 0,
            dirs: [],
            dirMap: new Map(),
          };
          map.set(file.sceneId, group);
        }
        group.count += 1;
        const bucket = group.dirMap.get(file.dir) ?? [];
        bucket.push(file);
        group.dirMap.set(file.dir, bucket);
      }
      return Array.from(map.values()).map(({ dirMap, ...group }) => ({
        ...group,
        dirs: Array.from(dirMap.entries())
          .sort(([a], [b]) => b.localeCompare(a, 'zh-CN', { numeric: true }))
          .map(([dir, dirFiles]) => ({ dir, files: [...dirFiles].sort(byName) })),
      }));
    }, [boundScene, visibleFiles]);

    const emptySceneCount = Math.max(0, scenes.length - grouped.length);
    const toggle = (key: string) =>
      setFolded((current) => {
        const next = { ...current };
        if (next[key]) delete next[key];
        else next[key] = true;
        return next;
      });
    const toggleDir = (key: string) =>
      setOpenedDirs((current) => {
        const next = { ...current };
        if (next[key]) delete next[key];
        else next[key] = true;
        return next;
      });

    return (
      <div className={`memory-browser${compact ? ' compact' : ' full'}`}>
        <header className="memory-head">
          <div>
            <div className="memory-eyebrow">MEMORY</div>
            <h3>{boundScene ? `${boundScene.name} · 场景记忆` : '全部场景记忆'}</h3>
            <p>
              {boundScene
                ? '只显示当前会话所属场景的记忆，只读。'
                : `数据源 ${engine?.ok ? engine.scenes.length : '—'} 个场景，全部记忆只读可浏览。`}
            </p>
          </div>
          <span className="memory-readonly">
            <Icon name="key" size={11} />
            只读
          </span>
        </header>

        <div className="memory-search">
          <Icon name="search" size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="按场景或文件路径筛选…"
            spellCheck={false}
          />
          {query && (
            <button type="button" aria-label="清空" onClick={() => setQuery('')}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>

        <div className="memory-panes">
          <aside className="memory-tree">
            <div className="memory-tree-meta">
              <span>{boundScene ? '当前场景' : `${grouped.length} 个场景`}</span>
              <span>{visibleFiles.length} 份记忆</span>
            </div>

            {grouped.map((group) => {
              const sceneKey = `s:${group.id}`;
              const sceneFolded = Boolean(folded[sceneKey]);
              return (
                <section className="memory-scene" key={group.id}>
                  <button
                    type="button"
                    className={`memory-scene-head${group.current ? ' current' : ''}`}
                    onClick={() => toggle(sceneKey)}
                    aria-expanded={!sceneFolded}
                    title={group.name}
                  >
                    <Icon
                      name={sceneFolded ? 'chevronRight' : 'chevronDown'}
                      size={10}
                      className="memory-caret"
                    />
                    <Icon name="database" size={11} />
                    <span className="memory-scene-name">{group.name}</span>
                    {group.current && <b>当前</b>}
                    <em>{group.count}</em>
                  </button>

                  {!sceneFolded &&
                    group.dirs.map((directory) => {
                      const dirKey = `d:${group.id}:${directory.dir}`;
                      // 目录默认折叠，只展开到目录名称这一层。
                      const dirOpen = Boolean(openedDirs[dirKey]);
                      return (
                        <div className="memory-dir" key={dirKey}>
                          <button
                            type="button"
                            className="memory-dir-head"
                            onClick={() => toggleDir(dirKey)}
                            aria-expanded={dirOpen}
                            title={directory.dir || '根目录'}
                          >
                            <Icon
                              name={dirOpen ? 'chevronDown' : 'chevronRight'}
                              size={9}
                              className="memory-caret"
                            />
                            <Icon name="folder" size={11} />
                            <span>{directory.dir || '根目录'}</span>
                            <em>{directory.files.length}</em>
                          </button>
                          {dirOpen &&
                            directory.files.map((file) => (
                              <button
                                key={file.path}
                                type="button"
                                className={`memory-file${
                                  selected?.path === file.path ? ' on' : ''
                                }`}
                                title={file.path}
                                onClick={() => setSelected(file)}
                              >
                                <Icon name="book" size={10} />
                                <span className="memory-file-name">{file.name}</span>
                              </button>
                            ))}
                        </div>
                      );
                    })}
                </section>
              );
            })}

            {grouped.length === 0 && (
              <div className="memory-empty">
                {engineLoading
                  ? '正在读取记忆索引…'
                  : keyword
                    ? '没有匹配的记忆文件。'
                    : boundScene
                      ? '当前场景还没有记忆文件。'
                      : '还没有可浏览的记忆文件。'}
              </div>
            )}
            {grouped.length > 0 && emptySceneCount > 0 && (
              <div className="memory-tree-note">
                {keyword
                  ? `另有 ${emptySceneCount} 个场景没有匹配记忆`
                  : `另有 ${emptySceneCount} 个场景暂无记忆文件`}
              </div>
            )}
          </aside>

          <section className="memory-viewer">
            <div className="memory-viewer-head">
              <span className="memory-viewer-path" title={selected?.path}>
                {selected?.path ?? '选择左侧记忆文件'}
              </span>
              {selected && (
                <button
                  type="button"
                  className="icon-btn"
                  title="重新读取"
                  onClick={() => void doc.reload()}
                >
                  <Icon name="refresh" size={12} />
                </button>
              )}
            </div>
            {!selected && (
              <div className="memory-viewer-empty">
                <Icon name="book" size={20} />
                <p>左侧选择一份记忆，按 Markdown 只读查看。</p>
              </div>
            )}
            {selected && doc.loading && <div className="memory-viewer-state">正在读取记忆…</div>}
            {selected && !doc.loading && doc.error && (
              <div className="memory-viewer-state warn">{doc.error}</div>
            )}
            {selected && !doc.loading && !doc.error && (
              <Markdown
                key={selected.path}
                text={doc.text}
                empty="这份记忆是空的。"
                className="doc-markdown"
              />
            )}
          </section>
        </div>
      </div>
    );
  },
};
