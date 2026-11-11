import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

interface LongPressSortOptions {
  ids: string[];
  onReorder: (ids: string[]) => void;
  disabled?: boolean;
  /** 按下多久后进入拖拽。 */
  delay?: number;
}

interface SortItemProps {
  'data-sort-id': string;
  onPointerDown: (event: ReactPointerEvent<Element>) => void;
  onContextMenu: (event: ReactMouseEvent<Element>) => void;
  onDragStart: (event: ReactDragEvent<Element>) => void;
}

/** 长按前允许的指针抖动；超过则视为普通点击 / 滚动。 */
const MOVE_CANCEL = 7;
/** 拖拽结束后短暂屏蔽跟随的 click，避免误触切换页签。 */
const CLICK_GUARD = 220;

interface Handlers {
  move: ((event: PointerEvent) => void) | null;
  up: ((event: PointerEvent) => void) | null;
  blur: (() => void) | null;
}

/**
 * 鼠标长按拖拽排序：按住 300ms 才进入排序态，指针移动实时换位，松手提交。
 * 不会因为单击而“进入 / 退出”拖拽；未达长按时间就松开或移动视为普通点击。
 */
export function useLongPressSort({
  ids,
  onReorder,
  disabled = false,
  delay = 300,
}: LongPressSortOptions) {
  const [order, setOrder] = useState<string[]>(ids);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const orderRef = useRef<string[]>(ids);
  const draggingRef = useRef<string | null>(null);
  const pendingRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const pointerRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastDragAt = useRef(0);
  const onReorderRef = useRef(onReorder);
  const handlersRef = useRef<Handlers>({ move: null, up: null, blur: null });
  /** 按下时把指针捕获到条目上，指针移出窗口也能收到 pointerup。 */
  const captureRef = useRef<{ element: Element; pointerId: number } | null>(null);

  useEffect(() => {
    onReorderRef.current = onReorder;
  }, [onReorder]);

  // 外部顺序变化时同步；拖拽进行中不被覆盖。逐项比较，避免新数组引用触发循环。
  useEffect(() => {
    if (draggingRef.current) return;
    const prev = orderRef.current;
    if (prev.length === ids.length && prev.every((id, index) => id === ids[index])) return;
    orderRef.current = ids;
    setOrder(ids);
  }, [ids]);

  const detach = useCallback(() => {
    const handlers = handlersRef.current;
    if (handlers.move) window.removeEventListener('pointermove', handlers.move);
    if (handlers.up) {
      window.removeEventListener('pointerup', handlers.up);
      window.removeEventListener('pointercancel', handlers.up);
    }
    if (handlers.blur) window.removeEventListener('blur', handlers.blur);
    handlersRef.current = { move: null, up: null, blur: null };
  }, []);

  const finish = useCallback(
    (commit: boolean) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = null;
      pointerRef.current = null;

      const capture = captureRef.current;
      captureRef.current = null;
      if (capture) {
        try {
          if (capture.element.hasPointerCapture?.(capture.pointerId)) {
            capture.element.releasePointerCapture(capture.pointerId);
          }
        } catch {
          /* 元素已卸载时忽略 */
        }
      }

      const dragged = draggingRef.current;
      draggingRef.current = null;
      if (!dragged) {
        detach();
        return;
      }

      document.body.classList.remove('sorting-drag');
      setDraggingId(null);
      detach();

      if (commit) {
        lastDragAt.current = Date.now();
        onReorderRef.current([...orderRef.current]);
      }
    },
    [detach],
  );

  const handleMove = useCallback(
    (event: PointerEvent) => {
      if (pointerRef.current !== null && event.pointerId !== pointerRef.current) return;

      const dragged = draggingRef.current;
      if (!dragged) {
        const pending = pendingRef.current;
        if (!pending) return;
        // 长按尚未成立：移动超过阈值就放行普通点击 / 滚动。
        if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > MOVE_CANCEL) {
          finish(false);
        }
        return;
      }

      // 指针在窗口外松开时，下一次移动会发现按键已经抬起，直接结束，避免卡在拖拽态。
      if (event.buttons === 0) {
        finish(true);
        return;
      }

      event.preventDefault();
      const hit = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-sort-id]') as HTMLElement | null;
      const target = hit?.dataset.sortId;
      if (!target || target === dragged) return;
      setOrder((prev) => {
        const from = prev.indexOf(dragged);
        const to = prev.indexOf(target);
        if (from < 0 || to < 0) return prev;
        const next = [...prev];
        next.splice(from, 1);
        next.splice(to, 0, dragged);
        orderRef.current = next;
        return next;
      });
    },
    [finish],
  );

  const handleUp = useCallback(
    (event: PointerEvent) => {
      if (pointerRef.current !== null && event.pointerId !== pointerRef.current) return;
      finish(true);
    },
    [finish],
  );

  const handleBlur = useCallback(() => {
    finish(true);
  }, [finish]);

  const activate = useCallback((id: string) => {
    pendingRef.current = null;
    timerRef.current = null;
    draggingRef.current = id;
    setDraggingId(id);
    document.body.classList.add('sorting-drag');
    window.getSelection()?.removeAllRanges();
  }, []);

  // 拖拽结束后吞掉随之而来的 click；只在这个短暂窗口内生效。
  useEffect(() => {
    const guard = (event: Event) => {
      if (!draggingRef.current && Date.now() - lastDragAt.current > CLICK_GUARD) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('click', guard, true);
    return () => window.removeEventListener('click', guard, true);
  }, []);

  useEffect(
    () => () => {
      finish(false);
      document.body.classList.remove('sorting-drag');
    },
    [finish],
  );

  const getItemProps = useCallback(
    (id: string): SortItemProps => ({
      'data-sort-id': id,
      onPointerDown: (event) => {
        if (disabled || event.button !== 0) return;
        // 上一次按下没有正常收尾时先清理，避免旧监听残留叠加。
        finish(false);

        pointerRef.current = event.pointerId;
        pendingRef.current = { id, x: event.clientX, y: event.clientY };
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          const pending = pendingRef.current;
          if (pending) activate(pending.id);
        }, delay);

        try {
          const element = event.currentTarget as Element;
          element.setPointerCapture(event.pointerId);
          captureRef.current = { element, pointerId: event.pointerId };
        } catch {
          captureRef.current = null;
        }

        const handlers: Handlers = {
          move: (moveEvent) => handleMove(moveEvent),
          up: (upEvent) => handleUp(upEvent),
          blur: () => handleBlur(),
        };
        handlersRef.current = handlers;
        window.addEventListener('pointermove', handlers.move!, { passive: false });
        window.addEventListener('pointerup', handlers.up!);
        window.addEventListener('pointercancel', handlers.up!);
        window.addEventListener('blur', handlers.blur!);
      },
      onContextMenu: (event) => {
        if (draggingRef.current || pendingRef.current) event.preventDefault();
      },
      onDragStart: (event) => {
        event.preventDefault();
      },
    }),
    [activate, delay, disabled, finish, handleBlur, handleMove, handleUp],
  );

  const wasDragging = useCallback(() => Date.now() - lastDragAt.current < 260, []);

  return { order, draggingId, getItemProps, wasDragging };
}
