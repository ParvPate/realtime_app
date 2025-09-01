import { getMobileUser } from '@/lib/mobileAuth'

export async function GET(req: Request) {
  try {
    const user = await getMobileUser(req)
    if (!user) return new Response('Unauthorized', { status: 401 })

    return new Response(JSON.stringify({ user }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(err?.message ?? 'Internal Error', { status: 500 })
  }
}