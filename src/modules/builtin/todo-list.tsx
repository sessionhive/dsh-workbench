import { useMemo, useState } from 'react';
import { Icon } from '../../components/icons';
import { useModuleState } from '../state';
import type { ModuleDefinition } from '../types';

type TodoStatus = 'pending' | 'active' | 'done' | 'trash';
type OpenTodoStatus = Exclude<TodoStatus, 'trash'>;

interface TodoTask {
  id: string;
  text: string;
  status: TodoStatus;
  createdAt: number;
  updatedAt: number;
  /** 回收站里记录删除前的状态，恢复时回到原位。 */
  previousStatus?: OpenTodoStatus;
}

const STATUS_LABEL: Record<TodoStatus, string> = {
  pending: '待定',
  active: '进行中',
  done: '已完成',
  trash: '回收',
};

const OPEN_STATUSES: OpenTodoStatus[] = ['pending', 'active', 'done'];
const NEXT_STATUS: Record<OpenTodoStatus, OpenTodoStatus> = {
  pending: 'active',
  active: 'done',
  done: 'pending',
};

/** 旧存档只有 done 布尔值，这里一次性迁移成四状态。 */
function normalizeTasks(value: unknown): TodoTask[] {
  if (!Array.isArray(value)) return [];
  const tasks: TodoTask[] = [];
  value.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as Partial<TodoTask> & { done?: boolean };
    const status: TodoStatus =
      item.status === 'pending' ||
      item.status === 'active' ||
      item.status === 'done' ||
      item.status === 'trash'
        ? item.status
        : item.done
          ? 'done'
          : 'pending';
    const text = String(item.text ?? '').trim();
    if (!text) return;
    const createdAt = Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now() + index;
    tasks.push({
      id: String(item.id || `todo-${createdAt.toString(36)}-${index}`),
      text,
      status,
      createdAt,
      updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : createdAt,
      previousStatus:
        item.previousStatus === 'pending' ||
        item.previousStatus === 'active' ||
        item.previousStatus === 'done'
          ? item.previousStatus
          : status === 'trash'
            ? 'pending'
            : undefined,
    });
  });
  return tasks;
}

function TodoCard({ compact }: { compact: boolean }) {
  const [raw, setTasks] = useModuleState<TodoTask[]>([]);
  const [draft, setDraft] = useState('');
  const [draftStatus, setDraftStatus] = useState<OpenTodoStatus>('pending');
  const [trashOpen, setTrashOpen] = useState(false);
  const tasks = useMemo(() => normalizeTasks(raw), [raw]);

  const open = tasks.filter((task) => task.status === 'pending' || task.status === 'active');
  const done = tasks.filter((task) => task.status === 'done').length;
  const trash = tasks.filter((task) => task.status === 'trash');
  const total = open.length + done;
  const percent = total ? Math.round((done / total) * 100) : 0;

  const commit = (updater: (prev: TodoTask[]) => TodoTask[]) => {
    setTasks((prev) => updater(normalizeTasks(prev)));
  };

  const addTask = () => {
    const text = draft.trim();
    if (!text) return;
    const now = Date.now();
    commit((prev) => [
      { id: `todo-${now.toString(36)}`, text, status: draftStatus, createdAt: now, updatedAt: now },
      ...prev,
    ]);
    setDraft('');
  };

  const cycleStatus = (task: TodoTask) => {
    if (task.status === 'trash') return;
    const status = NEXT_STATUS[task.status];
    commit((prev) =>
      prev.map((item) => (item.id === task.id ? { ...item, status, updatedAt: Date.now() } : item)),
    );
  };

  const moveToTrash = (task: TodoTask) => {
    commit((prev) =>
      prev.map((item) =>
        item.id === task.id && item.status !== 'trash'
          ? {
              ...item,
              status: 'trash',
              previousStatus: item.status,
              updatedAt: Date.now(),
            }
          : item,
      ),
    );
  };

  const restore = (task: TodoTask) => {
    const status = task.previousStatus ?? 'pending';
    commit((prev) =>
      prev.map((item) =>
        item.id === task.id
          ? { ...item, status, previousStatus: undefined, updatedAt: Date.now() }
          : item,
      ),
    );
  };

  const purge = (task: TodoTask) => {
    commit((prev) => prev.filter((item) => item.id !== task.id));
  };

  const clearDone = () => {
    const now = Date.now();
    commit((prev) =>
      prev.map((item) =>
        item.status === 'done'
          ? { ...item, status: 'trash', previousStatus: 'done', updatedAt: now }
          : item,
      ),
    );
  };

  const renderItem = (task: TodoTask) => (
    <article className={`todo-item ${task.status}`} key={task.id}>
      {task.status === 'trash' ? (
        <span className="todo-status static trash">
          <Icon name="trash" size={10} />
          {STATUS_LABEL[task.status]}
        </span>
      ) : (
        <button
          type="button"
          className={`todo-status ${task.status}`}
          title="切换状态：待定 → 进行中 → 已完成"
          onClick={() => cycleStatus(task)}
        >
          <i />
          {STATUS_LABEL[task.status]}
        </button>
      )}
      <span className="todo-text">{task.text}</span>
      {task.status === 'trash' ? (
        <>
          <button
            type="button"
            className="todo-action restore"
            title="恢复到删除前的状态"
            aria-label="恢复待办"
            onClick={() => restore(task)}
          >
            <Icon name="restore" size={12} />
          </button>
          <button
            type="button"
            className="todo-action purge"
            title="彻底删除"
            aria-label="彻底删除待办"
            onClick={() => purge(task)}
          >
            <Icon name="x" size={12} />
          </button>
        </>
      ) : (
        <button
          type="button"
          className="todo-action remove"
          title="移入回收站"
          aria-label="移入回收站"
          onClick={() => moveToTrash(task)}
        >
          <Icon name="trash" size={12} />
        </button>
      )}
    </article>
  );

  const groups = OPEN_STATUSES.map((status) => ({
    status,
    label: STATUS_LABEL[status],
    items: tasks
      .filter((task) => task.status === status)
      .sort((left, right) => right.updatedAt - left.updatedAt),
  }));
  // 详情里按状态分组时只保留有内容的分组，避免空分组把面板撑长。
  const compactGroups = groups.filter((group) => group.items.length > 0);

  return (
    <div className={`todo-block${compact ? ' compact' : ' full'}`}>
      <header className="todo-head">
        <div>
          <div className="todo-eyebrow">SCENE TASKS</div>
          <h3>待办清单</h3>
        </div>
        <div className="todo-summary">
          {open.length} 条在办 · {done} 已完成
          {trash.length > 0 && <em>{trash.length} 回收</em>}
        </div>
      </header>

      <div className="todo-progress" title={`完成 ${percent}%`}>
        <i style={{ width: `${percent}%` }} />
      </div>

      <div className="todo-add">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addTask();
            }
          }}
          placeholder="添加一条待办，回车确认"
          spellCheck={false}
        />
        <div className="todo-add-status" role="group" aria-label="新待办状态">
          {OPEN_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={draftStatus === status ? 'on' : ''}
              onClick={() => setDraftStatus(status)}
            >
              {STATUS_LABEL[status]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="todo-add-btn"
          onClick={addTask}
          disabled={!draft.trim()}
          aria-label="添加待办"
        >
          <Icon name="plus" size={13} />
          <span>添加</span>
        </button>
      </div>

      {compact ? (
        <div className="todo-groups">
          {compactGroups.map((group) => (
            <section className="todo-group" key={group.status}>
              <div className="todo-group-head">
                <i className={group.status} />
                {group.label}
                <span>{group.items.length}</span>
              </div>
              {group.items.slice(0, 4).map(renderItem)}
              {group.items.length > 4 && (
                <p className="todo-more">还有 {group.items.length - 4} 条，展开待办查看全部</p>
              )}
            </section>
          ))}
          {compactGroups.length === 0 && (
            <p className="todo-empty">还没有待办，先在输入框添加一条。</p>
          )}
        </div>
      ) : (
        <div className="todo-columns">
          {groups.map((group) => (
            <section className={`todo-column ${group.status}`} key={group.status}>
              <div className="todo-column-head">
                <i className={group.status} />
                <strong>{group.label}</strong>
                <span>{group.items.length}</span>
              </div>
              <div className="todo-column-body">
                {group.items.map(renderItem)}
                {group.items.length === 0 && <p className="todo-empty">这一列还是空的。</p>}
              </div>
            </section>
          ))}
        </div>
      )}

      {done > 0 && (
        <button type="button" className="todo-clear" onClick={clearDone}>
          已完成任务移入回收站（{done}）
        </button>
      )}

      {trash.length > 0 && (
        <section className="todo-trash">
          <button
            type="button"
            className="todo-trash-toggle"
            aria-expanded={trashOpen}
            onClick={() => setTrashOpen((open) => !open)}
          >
            <Icon name={trashOpen ? 'chevronDown' : 'chevronRight'} size={12} />
            回收站
            <span>{trash.length}</span>
            <em>可恢复或彻底删除</em>
          </button>
          {trashOpen && <div className="todo-trash-list">{trash.map(renderItem)}</div>}
        </section>
      )}
    </div>
  );
}

/** 待办清单：详情里按状态紧凑分组，中心视图里按状态分三栏。 */
export const todoListModule: ModuleDefinition = {
  manifest: {
    id: 'todo.list',
    name: '待办清单',
    version: '0.2.0',
    description: '场景本地待办：待定 / 进行中 / 已完成 / 回收四态，删除进回收站，可恢复或彻底删除。',
    icon: 'check',
    kind: ['panel', 'tool'],
    slots: ['detail.block', 'center.view'],
    category: 'session',
    permissions: ['module:state', 'sessions:read'],
    persistState: true,
  },
  center: {
    tabLabel: '待办',
    title: '待办清单',
    subtitle: ({ runningCount }) => `四态待办与回收站 · ${runningCount} 个任务运行中`,
  },
  View: ({ slot }) => <TodoCard compact={slot === 'detail.block'} />,
};
