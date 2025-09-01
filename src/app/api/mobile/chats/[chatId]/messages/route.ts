import { getMobileUser } from '@/lib/mobileAuth'
import { db, isGroupChat } from '@/lib/db'
import { fetchRedis } from '@/helpers/redis'
import { toPusherKey } from '@/lib/utils'
import { pusherServer } from '@/lib/pusher'
import { messageValidator, type Message } from '@/lib/validations/message'
import { nanoid } from 'nanoid'
import { User } from '@/types/db'

type GetQuery = {
  limit?: string
  cursor?: string // timestamp (ms) to paginate before
}

function parsePagination(searchParams: URLSearchParams) {
  const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit') ?? 30)))
  const cursorRaw = searchParams.get('cursor')
  const cursor = cursorRaw ? Number(cursorRaw) : undefined
  return { limit, cursor }
}

async function assertDmAccess(myId: string, chatId: string) {
  // chatId format: userIdA--userIdB (sorted)
  const [id1, id2] = chatId.split('--')
  if (myId !== id1 && myId !== id2) return false
  const friendId = myId === id1 ? id2 : id1
  const friends = (await fetchRedis('smembers', `user:${myId}:friends`)) as string[]
  return friends.includes(friendId)
}

async function assertGroupAccess(myId: string, groupId: string) {
  const members = (await fetchRedis('smembers', `group:${groupId}:members`)) as string[] | null
  if (!members) return false
  return members.includes(myId)
}

export async function GET(req: Request, { params }: { params: { chatId: string } }) {
  try {
    const user = await getMobileUser(req)
    if (!user) return new Response('Unauthorized', { status: 401 })

    const { chatId } = params
    const url = new URL(req.url)
    const { limit, cursor } = parsePagination(url.searchParams)

    let key: string
    if (isGroupChat(chatId)) {
      // chatId = group:<groupId>
      const groupId = chatId.replace('group:', '')
      const hasAccess = await assertGroupAccess(user.id, groupId)
      if (!hasAccess) return new Response('Forbidden', { status: 403 })
      key = `group:${groupId}:messages`
    } else {
      const hasAccess = await assertDmAccess(user.id, chatId)
      if (!hasAccess) return new Response('Forbidden', { status: 403 })
      key = `chat:${chatId}:messages`
    }

    // Fetch all and paginate in memory (compatible with existing Redis usage).
    // You can optimize later with score-based range if needed.
    const rawAll = (await fetchRedis('zrange', key, 0, -1)) as string[] | null
    const all: Message[] = (rawAll ?? []).map((m) =>
      messageValidator.parse(JSON.parse(m))
    )

    // Ensure ascending order by timestamp (zrange returns by increasing score).
    all.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))

    // Cursor is an exclusive timestamp. Filter older than cursor if provided.
    const filtered = cursor !== undefined
      ? all.filter((m) => (m.timestamp ?? 0) < cursor)
      : all

    // Take the last N items (most recent among the filtered set), keep ascending order.
    const messages: Message[] = filtered.slice(-limit)

    // nextCursor is the oldest timestamp in the current page (for fetching earlier messages next).
    const nextCursor = messages.length > 0 ? (messages[0].timestamp as number) : null

    return new Response(JSON.stringify({ messages, nextCursor }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(err?.message ?? 'Internal Error', { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: { chatId: string } }) {
  try {
    const user = await getMobileUser(req)
    if (!user) return new Response('Unauthorized', { status: 401 })

    const { chatId } = params
    const { text } = (await req.json()) as { text?: string }
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return new Response('Invalid text', { status: 400 })
    }

    let key: string

    if (isGroupChat(chatId)) {
      const groupId = chatId.replace('group:', '')
      const hasAccess = await assertGroupAccess(user.id, groupId)
      if (!hasAccess) return new Response('Forbidden', { status: 403 })
      key = `group:${groupId}:messages`

      const message: Message = {
        id: nanoid(),
        senderId: user.id,
        text: text.trim(),
        timestamp: Date.now(),
      }

      await db.zadd(key, {
        score: message.timestamp!,
        member: JSON.stringify(message),
      })

      // Real-time notify group channel
      await pusherServer.trigger(toPusherKey(`group:${groupId}`), 'incoming_message', message)

      return new Response(JSON.stringify({ ok: true, message }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    } else {
      // DM flow
      // Validate access and derive friendId
      const [id1, id2] = chatId.split('--')
      if (user.id !== id1 && user.id !== id2) {
        return new Response('Forbidden', { status: 403 })
      }
      const friendId = user.id === id1 ? id2 : id1
      const friends = (await fetchRedis('smembers', `user:${user.id}:friends`)) as string[]
      if (!friends.includes(friendId)) {
        return new Response('Forbidden', { status: 403 })
      }
      key = `chat:${chatId}:messages`

      const message: Message = {
        id: nanoid(),
        senderId: user.id,
        text: text.trim(),
        timestamp: Date.now(),
      }

      await db.zadd(key, {
        score: message.timestamp!,
        member: JSON.stringify(message),
      })

      // Real-time notify both participants
      await pusherServer.trigger(toPusherKey(`chat:${chatId}`), 'incoming-message', message)
      // Also notify friend chat list item with sender info if needed by web
      const rawSender = (await fetchRedis('get', `user:${user.id}`)) as string
      const sender = JSON.parse(rawSender) as User
      await pusherServer.trigger(toPusherKey(`user:${friendId}:chats`), 'new_message', {
        ...message,
        senderImg: sender?.image,
        senderName: sender?.name,
      })

      return new Response(JSON.stringify({ ok: true, message }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
  } catch (err: any) {
    return new Response(err?.message ?? 'Internal Error', { status: 500 })
  }
}