import { useCallback } from 'react'
import type { Message } from '../../../api/chat'
import { lastMessage } from '../../../features/chat/messages'
import { useRuntime } from '../../app/context'

/** Regenerate and edit-resend for one conversation; request shapes match the previous page logic. */
export function useChatTurnActions(id: string, model: string | undefined) {
  const chat = useRuntime().chat
  const regenerate = useCallback(() => {
    const snapshot = chat.snapshot(id)
    const last = snapshot && lastMessage(snapshot.messages, 'user')
    if (id && last && model)
      void chat.send(id, {
        request_id: crypto.randomUUID(),
        model_id: model,
        action: 'regenerate',
        content: '',
        last_message_id: last.id,
      })
  }, [chat, id, model])
  const resend = useCallback(
    (message: Message, content: string) => {
      if (!id || !model || !content.trim()) return false
      void chat.send(id, {
        request_id: crypto.randomUUID(),
        model_id: model,
        action: 'edit',
        content,
        last_message_id: message.id,
      })
      return true
    },
    [chat, id, model],
  )
  return { regenerate, resend }
}
