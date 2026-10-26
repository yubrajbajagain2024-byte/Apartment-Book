/**
 * The CampConnect mark: three people, the one in front a little larger, for a network of students. Drawn in the current
 * text colour (white on the blue brand disc), in a 64×64 box. The two behind are cut where the front one overlaps them
 * (a mask, so the cut shows whatever is behind: the Aurora disc included). `id` names that mask and must be unique on
 * the page. The same drawing makes the favicon (src/app/icon.svg) and the app's icons (apps/mobile/assets/images).
 */
export function BrandMark({ id, className }: { id: string; className?: string }) {
  const mask = `brand-mark-${id}`;
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <circle cx="32" cy="23" r="10.25" fill="#000" />
          <path d="M18.25 52 C18.25 39.6 24.4 30.25 32 30.25 S45.75 39.6 45.75 52 Z" fill="#000" />
        </mask>
      </defs>
      <g fill="currentColor" transform="translate(0 0.5)">
        <g mask={`url(#${mask})`}>
          <circle cx="16" cy="27.5" r="5.75" />
          <path d="M6 49 C6 41.2 10.4 35.5 16 35.5 S26 41.2 26 49 Z" />
          <circle cx="48" cy="27.5" r="5.75" />
          <path d="M38 49 C38 41.2 42.4 35.5 48 35.5 S58 41.2 58 49 Z" />
        </g>
        <circle cx="32" cy="23" r="7.75" />
        <path d="M20.75 49 C20.75 39.8 25.8 33 32 33 S43.25 39.8 43.25 49 Z" />
      </g>
    </svg>
  );
}
