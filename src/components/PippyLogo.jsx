// The Pippy mark. The SVG carries its own brand tile and rounded corners, so
// it drops in wherever the old yellow-square-plus-paw lockup was used.
const SIZES = {
  sm: 'w-8 h-8 rounded-xl',
  md: 'w-9 h-9 rounded-xl',
  lg: 'w-12 h-12 rounded-2xl',
  xl: 'w-14 h-14 rounded-2xl',
}

export default function PippyLogo({ size = 'lg', className = '' }) {
  return (
    <img
      src="/pippy-mark.svg"
      alt=""
      aria-hidden="true"
      className={`${SIZES[size] || SIZES.lg} flex-shrink-0 ${className}`}
    />
  )
}
