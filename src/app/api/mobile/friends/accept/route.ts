import { getMobileUser } from '@/lib/mobileAuth'
import { fetchRedis } from '@/helpers/redis'
import { db } from '@/lib/db'
import { pusherServer } from '@/lib/pusher'
import { toPusherKey } from '@/lib/utils'
import { User } from '@/types/db'
import { z } from 'zod'

export async function POST(req: Request) {
  try {
    const user = await getMobileUser(req)
    if (!user) return new Response('Unauthorized', { status: 401 })

    const body = await req.json()
    const { id: idToAdd } = z.object({ id: z.string() }).parse(body)

    // verify both users are not already friends
    const isAlreadyFriends = await fetchRedis(
      'sismember',
      `user:${user.id}:friends`,
      idToAdd
    )

    if (isAlreadyFriends) {
      return new Response('Already friends', { status: 400 })
    }

    const hasFriendRequest = await fetchRedis(
      'sismember',
      `user:${user.id}:incoming_friend_requests`,
      idToAdd
    )

    if (!hasFriendRequest) {
      return new Response('No friend request', { status: 400 })
    }

    const [userRaw, friendRaw] = (await Promise.all([
      fetchRedis('get', `user:${user.id}`),
      fetchRedis('get', `user:${idToAdd}`),
    ])) as [string, string]

    const me = JSON.parse(userRaw) as User
    const friend = JSON.parse(friendRaw) as User

    await Promise.all([
      pusherServer.trigger(
        toPusherKey(`user:${idToAdd}:friends`),
        'new_friend',
        me
      ),
      pusherServer.trigger(
        toPusherKey(`user:${user.id}:friends`),
        'new_friend',
        friend
      ),
      db.sadd(`user:${user.id}:friends`, idToAdd),
      db.sadd(`user:${idToAdd}:friends`, user.id),
      db.srem(`user:${user.id}:incoming_friend_requests`, idToAdd),
    ])

    return new Response('OK')
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response('Invalid request payload', { status: 422 })
    }
    return new Response('Invalid request', { status: 400 })
  }
}