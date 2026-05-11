import { ReactElement, cloneElement, isValidElement } from 'react';
import { create } from 'zustand';

interface ModalSpec {
  id: number;
  render: (close: () => void) => ReactElement;
}

interface ModalState {
  stack: ModalSpec[];
  open: (render: (close: () => void) => ReactElement) => () => void;
  close: (id: number) => void;
}

let nextId = 1;
const useModalStore = create<ModalState>((set, get) => ({
  stack: [],
  open: (render) => {
    const id = nextId++;
    set({ stack: [...get().stack, { id, render }] });
    return () => get().close(id);
  },
  close: (id) => {
    set({ stack: get().stack.filter((s) => s.id !== id) });
  },
}));

/**
 * 打开 Modal。renderFn 接收 close() 用于关闭。
 * 返回值也是 close() 函数，供外部主动关闭。
 */
export function openModal(renderFn: (close: () => void) => ReactElement) {
  return useModalStore.getState().open(renderFn);
}

export function ModalHost() {
  const stack = useModalStore((s) => s.stack);
  if (stack.length === 0) return null;
  return (
    <>
      {stack.map((item) => {
        const close = () => useModalStore.getState().close(item.id);
        const node = item.render(close);
        return (
          <div
            key={item.id}
            className="modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-content">
                {isValidElement(node) ? cloneElement(node) : node}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
