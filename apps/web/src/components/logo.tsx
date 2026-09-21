export interface LogoProps {
  /** Rendered size in pixels. Below about 24 the marks blur together. */
  size?: number
  /** Hidden from assistive technology when a visible name sits beside it. */
  title?: string
}

/**
 * The yart mark: a caret pointing at one line among several.
 *
 * Fills are design tokens rather than literals, so the mark follows the theme
 * the same way the rest of the interface does. The standalone favicon cannot do
 * that — it carries its own colours in `public/favicon.svg`.
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
