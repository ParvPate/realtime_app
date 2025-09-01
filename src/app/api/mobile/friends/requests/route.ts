import { getMobileUser } from '@/lib/mobileAuth'
import { fetchRedis } from '@/helpers/redis'

type Friend = {
  id: string
  name: string
  email: string
  image?: string
}

export async function GET(req: Request) {
  try {
    const user = await getMobileUser(req)
    if (!user) return new Response('Unauthorized', { status: 401 })

    const ids = (await fetchRedis('smembers', `user:${user.id}:incoming_friend_requests`)) as string[] | null
    const incoming: Friend[] = await Promise.all(
      (ids ?? []).map(async (fid) => {
        const raw = (await fetchRedis('get', `user:${fid}`)) as string | null
        return raw ? (JSON.parse(raw) as Friend) : { id: fid, name: 'Unknown', email: '' }
      })
    )

    return new Response(JSON.stringify({ incoming }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(err?.message ?? 'Internal Error', { status: 500 })
  }
}