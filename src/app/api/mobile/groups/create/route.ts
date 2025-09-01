import { getMobileUser } from '@/lib/mobileAuth'
import { db } from '@/lib/db'
import { fetchRedis } from '@/helpers/redis'
import { sanitizeGroupName, sanitizeDescription, validateGroupMembers } from '@/lib/validation'
import { pusherServer } from '@/lib/pusher'
import { toPusherKey } from '@/lib/utils'
import { nanoid } from 'nanoid'

type CreateBody = {
  name: string
  description?: string
  members: string[] // user ids (excluding creator)
}

export async function POST(req: Request) {
  try {
    const user = await getMobileUser(req)
    if (!user) return new Response('Unauthorized', { status: 401 })

    const { name, description, members }: CreateBody = await req.json()

    if (!name || !Array.isArray(members)) {
      return new Response('Invalid payload', { status: 400 })
    }

    const cleanName = sanitizeGroupName(name)
    const cleanDesc = description ? sanitizeDescription(description) : ''
    const validMembers = validateGroupMembers(members)

    // Require at least one other member so group has at least 2 people including creator
    if (validMembers.length < 1) {
      return new Response('At least one member is required', { status: 400 })
    }

    // Deduplicate and include creator
    const allMembers = Array.from(new Set([user.id, ...validMembers]))

    // Optional: verify that all provided member IDs exist
    const existingFlags = await Promise.all(
      allMembers.map(async (id) => {
        const raw = (await fetchRedis('get', `user:${id}`)) as string | null
        return !!raw
      })
    )
    const allExist = existingFlags.every(Boolean)
    if (!allExist) {
      return new Response('One or more member IDs are invalid', { status: 400 })
    }

    const groupId = nanoid()
    const group = {
      id: groupId,
      name: cleanName,
      description: cleanDesc,
      members: allMembers,
      admins: [user.id],
      createdAt: Date.now(),
      createdBy: user.id,
    }

    // Persist group under both key shapes used across the codebase for compatibility
    await db.set(`groups:${groupId}`, JSON.stringify(group))
    await db.set(`group:${groupId}`, JSON.stringify(group))

    // Maintain a members set for quick membership checks
    await Promise.all(allMembers.map((memberId) => db.sadd(`group:${groupId}:members`, memberId)))

    // Add group to each user's set
    await Promise.all(allMembers.map((memberId) => db.sadd(`user:${memberId}:groups`, groupId)))

    // Notify members' group channels
    await Promise.all(
      allMembers.map((memberId) =>
        pusherServer.trigger(toPusherKey(`user:${memberId}:groups`), 'group_created', group)
      )
    )

    return new Response(JSON.stringify(group), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(err?.message ?? 'Internal Error', { status: 500 })
  }
}