// The Pippy mascot — the real artwork, not an approximation.
//
// This used to render public/pippy-mark.svg, a hand-drawn SVG that stood in for
// the mascot before the artwork existed. The source image carries its own brand
// tile and its corners are baked in as white (it is a JPEG, so it has no alpha),
// which is why the rounding below is not decoration: it clips those corners off.
const SIZES = {
  sm: 'w-8 h-8 rounded-xl',
  md: 'w-9 h-9 rounded-xl',
  lg: 'w-12 h-12 rounded-2xl',
  xl: 'w-14 h-14 rounded-2xl',
  hero: 'w-24 h-24 rounded-[28px]',
}

export default function PippyLogo({ size = 'lg', className = '' }) {
  return (
    <img
      src="/pippy-mascot.png"
      alt=""
      aria-hidden="true"
      width="356"
      height="356"
      className={`${SIZES[size] || SIZES.lg} flex-shrink-0 object-cover ${className}`}
    />
  )
}
