import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const variants: Record<Variant, string> = {
  primary: 'bg-emerald-600 text-white hover:bg-emerald-500',
  secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700',
  danger: 'bg-red-700 text-white hover:bg-red-600',
  ghost: 'text-zinc-300 hover:bg-zinc-800'
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
  const sizing = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm'
  return (
    <button
      {...props}
      className={`rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${variants[variant]} ${className}`}
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
    <div {...rest} className={`rounded-lg border border-zinc-800 bg-zinc-900 ${className}`}>
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
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
    info: 'border-zinc-700 bg-zinc-900 text-zinc-200',
    error: 'border-red-800 bg-red-950/60 text-red-200',
    warn: 'border-amber-800 bg-amber-950/50 text-amber-200'
  }[kind]
  return <div className={`mb-4 rounded-md border px-4 py-2 text-sm ${style}`}>{children}</div>
}

export const inputClass =
  'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none'

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
      <span className="mb-1 block text-sm font-medium text-zinc-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  )
}
