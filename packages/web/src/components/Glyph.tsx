/**
 * Glyph — clean line-art SVG glyphs for chrome / control surfaces.
 *
 * The painterly PinIcon set is for *content* (rooms, items, subjects).
 * Buttons, FABs, headers and inline affordances use these flat line glyphs
 * so the chrome stays quiet and editorial.
 */

export type GlyphName =
  | 'plus'
  | 'minus'
  | 'close'
  | 'check'
  | 'camera'
  | 'image'
  | 'pencil'
  | 'sparkle'
  | 'arrow-left'
  | 'arrow-right'
  | 'more'
  | 'search'
  | 'trash'
  | 'menu';

interface Props {
  name: GlyphName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

const PATHS: Record<GlyphName, JSX.Element> = {
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2.1A1 1 0 0 1 9.94 4.5h4.12a1 1 0 0 1 .84.4L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
      <circle cx="12" cy="13" r="3.4" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20 16.5 15.2 11.3a1.4 1.4 0 0 0-2 0L3.6 21" />
    </>
  ),
  pencil: (
    <>
      <path d="M14.6 4.4 19.6 9.4l-10 10H4.6v-5l10-10Z" />
      <path d="M13.2 5.8 18.2 10.8" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" />
      <path d="M12 8.5c.6 1.5 1.5 2.4 3 3-1.5.6-2.4 1.5-3 3-.6-1.5-1.5-2.4-3-3 1.5-.6 2.4-1.5 3-3Z" fill="currentColor" stroke="none" />
    </>
  ),
  'arrow-left': (
    <>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </>
  ),
  'arrow-right': (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),
};

export function Glyph({ name, size = 18, className = '', strokeWidth = 1.6 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
