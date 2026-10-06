interface Props {
  title: string
  phase?: number
}

export default function Placeholder({ title, phase }: Props): React.JSX.Element {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-zinc-400">Esta tela será construída na Fase {phase}.</p>
    </div>
  )
}
