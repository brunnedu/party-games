import { s } from './strings.de'

/** A sentence with its gap drawn as a black bar, like on the original cards. */
export function Sentence({ text }: { text: string }) {
  const [before, after] = text.split('WALTER')
  return (
    <span>
      {before}
      <span className="walter-gap">{s.gap}</span>
      {after}
    </span>
  )
}

export function SentenceCard({ text }: { text: string }) {
  return (
    <section className="card sentence-card">
      <p className="sentence">
        <Sentence text={text} />
      </p>
    </section>
  )
}
