import { getMobileUser } from '@/lib/mobileAuth'
import { fetchRedis } from '@/helpers/redis'
import { chatHrefConstructor } from '@/lib/utils'
import { messageValidator } from '@/lib/validations/message'

type DmSummary = {
  chatId: string
  friend: {
    id: string
    name: string
    email: string
    image?: string
  }
  lastMessage: {
    id: string
    senderId: string
    text: string
    timestamp?: number
  } | null
}

type GroupSummary = {
  id: string
  name: string
  description?: string
  members: string[]
  admins?: string[]
  createdAt?: number
  createdBy?: string
  avatar?: string
}

async function getUserById(userId: string) {
  const raw = (await fetchRedis('get', `user:${userId}`)) as string | null
  if (!raw) return null
  return JSON.parse(raw) as { id: string; name: string; email: string; image?: string }
}

async function getGroupById(groupId: string) {
  // Try both key shapes found in codebase: 'groups:<id>' and 'group:<id>'
  const rawPlural = (await fetchRedis('get', `groups:${groupId}`)) as string | null
  if (rawPlural) return JSON.parse(rawPlural) as GroupSummary

  // Fallback (some routes write 'group:<id>')
  // fetchRedis only supports certain commands; use get via fetchRedis with exact key, consistent with above.
  const rawSingular = (await fetchRedis('get', `group:${groupId}`)) as string | null
  if (rawSingular) return JSON.parse(rawSingular) as GroupSummary

  // As a minimum, synthesize object if membership set exists
  const members = (await fetchRedis('smembers', `group:${groupId}:members`)) as string[] | null
  if (members) {
    return { id: groupId, name: `Group ${groupId}`, members }
  }
  return null
}

export async function GET(req: Request) {
  try {
    const user = await getMobileUser(req)
    if (!user) return new Response('Unauthorized', { status: 401 })

    // DMs from friends list
    const friendIds = (await fetchRedis('smembers', `user:${user.id}:friends`)) as string[] | null
    const dms: DmSummary[] = await Promise.all(
      (friendIds ?? []).map(async (fid) => {
        const friend = await getUserById(fid)
        const chatId = chatHrefConstructor(user.id, fid)
        const [lastRaw] = (await fetchRedis('zrange', `chat:${chatId}:messages`, -1, -1)) as string[] | []
        const lastMessage = lastRaw ? messageValidator.parse(JSON.parse(lastRaw)) : null
        return {
          chatId,
          friend: friend ?? { id: fid, name: 'Unknown', email: '' },
          lastMessage,
        }
      })
    )

    // Groups
    const groupIds = (await fetchRedis('smembers', `user:${user.id}:groups`)) as string[] | null
    const groups: GroupSummary[] = await Promise.all(
      (groupIds ?? []).map(async (gid) => {
        const g = await getGroupById(gid)
        return (
          g ?? {
            id: gid,
            name: `Group ${gid}`,
            members: (await fetchRedis('smembers', `group:${gid}:members`)) as string[] | [],
          }
        )
      })
    )

    return new Response(JSON.stringify({ dms, groups }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(err?.message ?? 'Internal Error', { status: 500 })
  }
}