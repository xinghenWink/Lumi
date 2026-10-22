import { shallowRef, ref } from 'vue'
import { images, type ImageFile } from '../../api/images'
import { ApiError } from '../../api/transport'
import { useAuthStore } from '../../stores/auth'
export function useImageActions() {
  const error = shallowRef<unknown>(),
    copied = ref(false),
    auth = useAuthStore()
  async function download(file: ImageFile) {
    error.value = null
    const owner = auth.user?.id
    try {
      const blob = await images.blob(file)
      if (!owner || owner !== auth.user?.id) return
      const url = window.URL.createObjectURL(blob),
        anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'lumi-' + file.id + '.png'
      anchor.click()
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
    } catch (e) {
      if (owner === auth.user?.id) error.value = e
    }
  }
  async function copy(file: ImageFile) {
    error.value = null
    copied.value = false
    const owner = auth.user?.id
    try {
      if (!navigator.clipboard?.write || !window.ClipboardItem)
        throw new ApiError('IMAGE_COPY_UNAVAILABLE')
      // Start clipboard writing during the user gesture, including on WebKit.
      const blob = images.blob(file).then((value) => {
        if (!owner || owner !== auth.user?.id) throw new ApiError('UNAUTHORIZED')
        return value
      })
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
      if (owner === auth.user?.id) copied.value = true
    } catch (e) {
      if (owner === auth.user?.id) error.value = e
    }
  }
  return { error, copied, download, copy }
}
