/**
 * Circular avatar display — shows either the user's avatar image or
 * a fallback circle containing the user's initials.
 *
 * Defined at module top level — never inside another component.
 * (rerender-no-inline-components)
 *
 * @param {{
 *   avatarUrl:   string|null,
 *   displayName: string,
 *   size?:       number
 * }} props
 */
export default function AvatarBubble({ avatarUrl, displayName, size = 32 }) {
  // Derive initials during render — no useState/useEffect needed.
  // Split on whitespace, take the first char of each word, uppercase, max 2.
  // (rerender-derived-state-no-effect)
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')

  const circleStyle = { width: size, height: size }

  // Ternary — not && — so a falsy-but-defined avatarUrl doesn't render
  // unexpected output. (rendering-conditional-render)
  return avatarUrl !== null ? (
    <img
      src={avatarUrl}
      alt={displayName}
      width={size}
      height={size}
      className="avatar-bubble-img"
    />
  ) : (
    <div
      className="avatar-bubble-initials"
      style={circleStyle}
      aria-label={displayName}
    >
      {initials}
    </div>
  )
}
