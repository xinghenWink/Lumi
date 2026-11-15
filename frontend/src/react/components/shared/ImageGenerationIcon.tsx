import icon48 from '../../assets/brand/image-generation/lumi-image-48.png'
import icon64 from '../../assets/brand/image-generation/lumi-image-64.png'
import icon128 from '../../assets/brand/image-generation/lumi-image-128.png'
import icon256 from '../../assets/brand/image-generation/lumi-image-256.png'
import { cn } from '../../lib/utils'

const icons = { 48: icon48, 64: icon64, 128: icon128 }
const iconSrcSet = `${icon48} 48w, ${icon64} 64w, ${icon128} 128w, ${icon256} 256w`

export function ImageGenerationIcon({
  size,
  className,
}: {
  size: keyof typeof icons
  className?: string
}) {
  return (
    <img
      data-slot="image-generation-icon"
      src={icons[size]}
      srcSet={iconSrcSet}
      sizes={`${size}px`}
      alt=""
      width={size}
      height={size}
      className={cn('shrink-0', className)}
    />
  )
}
