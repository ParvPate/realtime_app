import { getMobileUser } from '@/lib/mobileAuth'
import { fetchRedis } from '@/helpers/redis'
import { db } from '@/lib/db'
import { pusherServer } from '@/lib/pusher'
import { toPusherKey } from '@/lib/utils'
import { addFriendValidator } from '@/lib/validations/add-friend'
import { z } from 'zod'

export async function POST(req: Request) {
  try {
    const user = await getMobileUser(req)
    if (!user) return new Response('Unauthorized', { status: 401 })

    const body = await req.json()
    const { email } = addFriendValidator.parse(body)

    const idToAdd = (await fetchRedis('get', `user:email:${email}`)) as string | null
    if (!idToAdd) {
      return new Response('This person does not exist.', { status: 400 })
    }

    if (idToAdd === user.id) {
      return new Response('You cannot add yourself as a friend', { status: 400 })
    }

    const isAlreadyAdded = (await fetchRedis(
      'sismember',
      `user:${idToAdd}:incoming_friend_requests`,
      user.id
    )) as 0 | 1

    if (isAlreadyAdded) {
      return new Response('Already added this user', { status: 400 })
    }

    const isAlreadyFriends = (await fetchRedis(
      'sismember',
      `user:${user.id}:friends`,
      idToAdd
    )) as 0 | 1

    if (isAlreadyFriends) {
      return new Response('Already friends with this user', { status: 400 })
    }

    await pusherServer.trigger(
      toPusherKey(`user:${idToAdd}:incoming_friend_requests`),
      'incoming_friend_requests',
      {
        senderId: user.id,
        senderEmail: user.email,
      }
    )

    await db.sadd(`user:${idToAdd}:incoming_friend_requests`, user.id)

    return new Response('OK')
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return new Response('Invalid request payload', { status: 422 })
    }
    return new Response('Invalid request', { status: 400 })
  }
}