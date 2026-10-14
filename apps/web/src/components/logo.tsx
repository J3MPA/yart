export interface LogoProps {
  /** The size in pixels. Below approximately 24, the marks become unclear. */
  size?: number
  /** Hidden from assistive technology when a visible name is next to it. */
  title?: string
}

/**
 * The mark of yart: a caret that points to one line of many.
 *
 * The fills are design tokens, not literal values. Thus the mark follows the
 * theme, as the rest of the interface does. The separate favicon cannot do this.
 * It has its own colors in `public/favicon.svg`.
 */
export const Logo = ({ size = 28, title }: LogoProps) => (
  <svg
    viewBox="0 0 32 32"
    width={size}
    height={size}
    role={title === undefined ? 'presentation' : 'img'}
    aria-hidden={title === undefined}
    aria-label={title}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M4 8.5 L11.5 16 L4 23.5"
      fill="none"
      stroke="var(--yart-color-accent)"
      strokeWidth="2.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <rect x="14.5" y="8.5" width="14" height="3" rx="1.5" fill="var(--yart-color-add-emphasis)" />
    <rect x="17" y="14.5" width="7" height="3" rx="1.5" fill="var(--yart-color-accent)" />
    <rect
      x="14.5"
      y="20.5"
      width="12"
      height="3"
      rx="1.5"
      fill="var(--yart-color-remove-emphasis)"
    />
  </svg>
)
