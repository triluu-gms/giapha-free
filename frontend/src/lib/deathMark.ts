// The mark after a deceased person's name: a cross (†, the default) or a lotus,
// chosen per person (Person.deathMark). The lotus is our own small shape, drawn
// the same way on the tree page (an SVG) and on the printed report (a canvas
// Path2D), rather than the 🪷 emoji, which older systems can't show.

export type DeathMark = 'cross' | 'lotus';

/** The lotus, as filled SVG paths in a 24×24 box: the middle petal, two side petals, the base. */
export const LOTUS_PATHS = [
  'M12 3c2 2.5 2.6 5 2 8-.4 2-1.2 3.4-2 4.3-.8-.9-1.6-2.3-2-4.3-.6-3 0-5.5 2-8z',
  'M4.5 8.5c2.6.3 4.6 1.8 5.6 4.3.4 1 .6 2 .6 2.9-1-.2-2.2-.6-3.3-1.4-2.1-1.5-3-3.4-2.9-5.8z',
  'M19.5 8.5c-2.6.3-4.6 1.8-5.6 4.3-.4 1-.6 2-.6 2.9 1-.2 2.2-.6 3.3-1.4 2.1-1.5 3-3.4 2.9-5.8z',
  'M3 15.5c2.2 2.3 5.3 3.5 9 3.5s6.8-1.2 9-3.5c-2.4.8-5.4 1.3-9 1.3s-6.6-.5-9-1.3z',
];

/** A person's mark: the cross unless they chose the lotus. */
export const deathMarkOf = (p: { deathMark?: DeathMark | null }): DeathMark => (p.deathMark === 'lotus' ? 'lotus' : 'cross');
