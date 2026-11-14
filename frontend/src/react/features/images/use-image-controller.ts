import { useRuntime } from '../../app/context'

export function useImageController() {
  const controller = useRuntime().imageController
  if (!controller)
    throw new Error('The image route must initialize its controller before rendering')
  return controller
}
