import { LOTUS_PATHS, type DeathMark as Mark } from '@/lib/deathMark';

/** The lotus shape, 1em square, in the text's colour. */
export function LotusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
      {LOTUS_PATHS.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

/** The mark after a deceased person's name: † or a lotus (lib/deathMark.ts). */
export default function DeathMark({ mark, label }: { mark: Mark; label?: string }) {
  return (
    <span className="death-mark" title={label} aria-label={label}>
      {mark === 'lotus' ? <LotusIcon /> : '†'}
    </span>
  );
}
