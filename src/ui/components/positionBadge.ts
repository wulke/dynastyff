const base = 'inline-block rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide';

export function getPositionBadgeClass(position: string): string {
  if (position === 'QB') return `${base} border-pos-qb/30 bg-pos-qb/10 text-pos-qb`;
  if (position === 'RB') return `${base} border-pos-rb/30 bg-pos-rb/10 text-pos-rb`;
  if (position === 'WR') return `${base} border-pos-wr/30 bg-pos-wr/10 text-pos-wr`;
  if (position === 'TE') return `${base} border-pos-te/30 bg-pos-te/10 text-pos-te`;
  if (position === 'PICK' || position === 'RDP') return `${base} border-pos-pick/30 bg-pos-pick/10 text-pos-pick`;
  return `${base} border-default bg-surface text-muted`;
}
