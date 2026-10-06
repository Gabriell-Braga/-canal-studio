import { useEffect, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { mediaUrl } from '../lib/api'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'

const variants: Record<Variant, string> = {
  primary:
    'bg-brand-300 text-ink-950 shadow-[0_0_0_1px_rgba(159,234,249,0.25),0_6px_20px_-8px_rgba(159,234,249,0.55)] hover:bg-brand-200',
  secondary: 'bg-ink-800 text-ink-100 ring-1 ring-inset ring-white/5 hover:bg-ink-700',
  outline:
    'bg-transparent text-ink-100 ring-1 ring-inset ring-ink-600 hover:bg-ink-800 hover:ring-ink-500',
  danger: 'bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30 hover:bg-red-500/25',
  ghost: 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md'
}): React.JSX.Element {
  const sizing = size === 'sm' ? 'h-7 gap-1.5 px-2.5 text-xs' : 'h-9 gap-2 px-4 text-sm'
  return (
    <button
      {...props}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg font-medium transition-all duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 ${sizing} ${variants[variant]} ${className}`}
    />
  )
}

export function Card({
  children,
  className = '',
  ...rest
}: {
  children: ReactNode
  className?: string
} & HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      {...rest}
      className={`rounded-xl border border-white/[0.06] bg-ink-900 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset] ${className}`}
    >
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-[26px] font-semibold text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Banner({
  kind = 'info',
  children
}: {
  kind?: 'info' | 'error' | 'warn'
  children: ReactNode
}): React.JSX.Element {
  const style = {
    info: 'border-brand-400/20 bg-brand-400/[0.06] text-brand-100',
    error: 'border-red-500/30 bg-red-500/10 text-red-200',
    warn: 'border-amber-400/25 bg-amber-400/[0.07] text-amber-100'
  }[kind]
  return (
    <div
      className={`mb-5 animate-fade-in rounded-xl border px-4 py-3 text-sm leading-relaxed ${style}`}
    >
      {children}
    </div>
  )
}

export const inputClass =
  'w-full rounded-lg border border-ink-700 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 transition-colors hover:border-ink-600 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/20'

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-200">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-500">{hint}</span>}
    </label>
  )
}

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'brand' | 'warn' | 'error' | 'ok'
}): React.JSX.Element {
  const style = {
    neutral: 'bg-ink-800 text-ink-300',
    brand: 'bg-brand-400/15 text-brand-200',
    warn: 'bg-amber-400/15 text-amber-200',
    error: 'bg-red-500/15 text-red-300',
    ok: 'bg-emerald-400/15 text-emerald-200'
  }[tone]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${style}`}
    >
      {children}
    </span>
  )
}

/** Colored circle with the channel's initials. */
export function ChannelAvatar({
  name,
  color,
  avatar,
  size = 32
}: {
  name: string
  color: string
  /** YouTube channel picture; falls back to colored initials */
  avatar?: string | null
  size?: number
}): React.JSX.Element {
  if (avatar) {
    return (
      <img
        src={mediaUrl(avatar)}
        alt=""
        className="shrink-0 rounded-lg object-cover ring-1 ring-white/10"
        style={{ width: size, height: size }}
      />
    )
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-semibold text-ink-950"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 65%, #15161d))`
      }}
    >
      {initials || '?'}
    </span>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg animate-pop-in rounded-2xl border border-white/[0.08] bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-white/[0.06] px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
