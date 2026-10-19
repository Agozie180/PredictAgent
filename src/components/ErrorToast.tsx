/**
 * Global error toast for failed fetches.
 * Usage: dispatch({ type: 'fetch-error', message: '…' }) anywhere.
 * Rendered once in App.tsx at root level.
 */
import { createContext, useContext, useReducer, useEffect, useCallback } from 'react'
import { AlertCircle, X } from 'lucide-react'

interface Toast { id: number; message: string }
interface ToastState { toasts: Toast[] }
type ToastAction = { type: 'add'; message: string } | { type: 'remove'; id: number }

let _nextId = 1

function toastReducer(state: ToastState, action: ToastAction): ToastState {
  if (action.type === 'add') {
    return { toasts: [...state.toasts.slice(-4), { id: _nextId++, message: action.message }] }
  }
  return { toasts: state.toasts.filter(t => t.id !== action.id) }
}

const ToastContext = createContext<(message: string) => void>(() => {})

export function useErrorToast() {
  return useContext(ToastContext)
}

export function ErrorToastProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(toastReducer, { toasts: [] })

  const addToast = useCallback((message: string) => {
    dispatch({ type: 'add', message })
  }, [])

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      {/* Toast container */}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
        style={{ maxWidth: 'min(calc(100vw - 2rem), 380px)' }}
      >
        {state.toasts.map(t => (
          <ToastItem key={t.id} toast={t} onRemove={() => dispatch({ type: 'remove', id: t.id })} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onRemove, 5000)
    return () => clearTimeout(timer)
  }, [onRemove])

  return (
    <div
      className="pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg"
      style={{
        background: 'rgba(20,30,50,0.97)',
        border: '1px solid rgba(240,112,128,0.35)',
        color: 'var(--ink)',
      }}
    >
      <AlertCircle size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
      <span className="text-xs flex-1 leading-relaxed" style={{ color: 'var(--ink-2)' }}>{toast.message}</span>
      <button
        onClick={onRemove}
        className="shrink-0 hover:opacity-70 transition-opacity"
        style={{ color: 'var(--subtle)' }}
      >
        <X size={12} />
      </button>
    </div>
  )
}
