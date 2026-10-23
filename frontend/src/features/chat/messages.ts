import type { Message } from '../../api/chat'
export function lastMessage(messages: Message[], role: Message['role']): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i]
    if (row?.role === role) return row
  }
  return undefined
}
