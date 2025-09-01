import { getMobileUser } from '@/lib/mobileAuth'
import { pusherServer } from '@/lib/pusher'
import { toPusherKey } from '@/lib/utils'

export async function POST(req: Request) {
  try {
    const user = await getMobileUser(req)
    if (!user) return new Response('Unauthorized', { status: 401 })

    const { chatId, isTyping } = (await req.json()) as { chatId?: string; isTyping?: boolean }
    if (!chatId || typeof isTyping !== 'boolean') {
      return new Response('Invalid payload', { status: 400 })
    }

    await pusherServer.trigger(
      toPusherKey(`chat:${chatId}:typing`),
      'typing',
      {
        userId: user.id,
        isTyping,
      }
    )

    return new Response('OK')
  } catch (err: any) {
    return new Response(err?.message ?? 'Internal Error', { status: 500 })
  }
}