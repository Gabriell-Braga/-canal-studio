import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, X } from 'lucide-react'
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

export interface SelectOption<T> {
  value: T
  label: ReactNode
  /** Smaller second line, e.g. what the option does */
  hint?: ReactNode
  style?: CSSProperties
}

/**
 * The app's dropdown: a button with a floating list in the app's own look (the native one
 * opens a gray Windows menu). The list is portaled to the body so no card clips it, opens
 * upward near the bottom of the window and works with the keyboard (arrows, Enter, Esc).
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  className = '',
  disabled,
  placeholder = 'Escolha…',
  'data-testid': testId
}: {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  className?: string
  disabled?: boolean
  placeholder?: string
  'data-testid'?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<CSSProperties>({})
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const close = (e: Event): void => {
      const t = e.target as Node
      if (!button.current?.contains(t) && !list.current?.contains(t)) setOpen(false)
    }
    // The page scrolled or resized: the list follows its button.
    const follow = (e: Event): void => {
      if (!list.current?.contains(e.target as Node)) place()
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [open])

  useEffect(() => {
    // Scroll only the list, never the page behind it.
    const ul = list.current
    const li = ul?.children[active] as HTMLElement | undefined
    if (!open || !ul || !li) return
    if (li.offsetTop < ul.scrollTop) ul.scrollTop = li.offsetTop
    else if (li.offsetTop + li.offsetHeight > ul.scrollTop + ul.clientHeight)
      ul.scrollTop = li.offsetTop + li.offsetHeight - ul.clientHeight
  }, [open, active])

  function place(): void {
    const r = button.current!.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    const up = below < 240 && r.top > below
    setPos({
      left: r.left,
      minWidth: r.width,
      maxHeight: Math.min(280, (up ? r.top : below) - 12),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 })
    })
  }

  function show(): void {
    place()
    setActive(Math.max(0, options.indexOf(selected!)))
    setOpen(true)
  }

  function pick(o: SelectOption<T>): void {
    setOpen(false)
    button.current?.focus()
    if (o.value !== value) onChange(o.value)
  }

  function onKey(e: React.KeyboardEvent): void {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    const last = options.length - 1
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, active + 1),
      ArrowUp: Math.max(0, active - 1),
      Home: 0,
      End: last
    }
    if (e.key === 'Tab') return setOpen(false)
    if (e.key in moves) setActive(moves[e.key])
    else if ((e.key === 'Enter' || e.key === ' ') && options[active]) pick(options[active])
    else if (e.key === 'Escape') setOpen(false)
    else return
    // Esc closes only the list, not the modal around it.
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid={testId}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        className={`${inputClass} flex cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-default disabled:opacity-50 ${
          open ? 'border-brand-400 ring-2 ring-brand-400/20' : ''
        } ${className}`}
      >
        <span className={`truncate ${selected ? '' : 'text-ink-500'}`} style={selected?.style}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-ink-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open &&
        createPortal(
          <ul
            ref={list}
            role="listbox"
            style={pos}
            className="fixed z-[100] overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)]"
          >
            {options.map((o, i) => {
              const on = o.value === value
              return (
                <li
                  key={String(o.value)}
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm ${
                    i === active ? 'bg-ink-800 text-white' : 'text-ink-200'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate" style={o.style}>
                      {o.label}
                    </span>
                    {o.hint && <span className="block text-xs text-ink-500">{o.hint}</span>}
                  </span>
                  <Check
                    size={14}
                    className={`shrink-0 text-brand-300 ${on ? 'opacity-100' : 'opacity-0'}`}
                  />
                </li>
              )
            })}
          </ul>,
          document.body
        )}
    </>
  )
}

/**
 * Checkbox beside a Field in a two-column grid: skips the Field's label and matches the
 * input's height, so it lines up with the input instead of with the hint below it.
 */
export const inlineCheckClass =
  'flex min-h-[38px] items-center gap-2 self-start text-sm md:mt-[25.5px]'

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
