import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm>(() => Promise.resolve(false));

/** Ask a yes/no question in a proper dialog. Resolves true when confirmed. */
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const confirm = useCallback<Confirm>((options) => new Promise((resolve) => setPending({ ...options, resolve })), []);

  useEffect(() => {
    const d = dialog.current;
    if (pending && d && !d.open) d.showModal();
  }, [pending]);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    dialog.current?.close();
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialog}
        className="dialog"
        aria-labelledby="confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          close(false);
        }}
      >
        {pending && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              close(true);
            }}
          >
            <h2 id="confirm-title">{pending.title}</h2>
            {pending.message && <p>{pending.message}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => close(false)} autoFocus>
                Cancel
              </button>
              <button className={pending.danger ? 'btn btn-danger-solid' : 'btn btn-dark'}>
                {pending.confirmLabel ?? 'OK'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}
