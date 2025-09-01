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

    const friendIds = (await fetchRedis('smembers', `user:${user.id}:friends`)) as string[] | null
    const friends: Friend[] = await Promise.all(
      (friendIds ?? []).map(async (fid) => {
        const raw = (await fetchRedis('get', `user:${fid}`)) as string | null
        return raw ? (JSON.parse(raw) as Friend) : { id: fid, name: 'Unknown', email: '' }
      })
    )

    return new Response(JSON.stringify({ friends }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(err?.message ?? 'Internal Error', { status: 500 })
  }
}