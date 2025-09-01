import { ensureUserFromGooglePayload, signMobileJwt, verifyGoogleIdToken } from '@/lib/mobileAuth'

export async function POST(req: Request) {
  try {
    const { idToken } = await req.json() as { idToken?: string }

    if (!idToken || typeof idToken !== 'string') {
      return new Response('Invalid payload', { status: 400 })
    }

    const payload = await verifyGoogleIdToken(idToken)
    const user = await ensureUserFromGooglePayload(payload)
    const token = signMobileJwt(user.id, '2h')

    return new Response(JSON.stringify({ token, user }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    })
  } catch (err: any) {
    const message = err?.message ?? 'Internal Error'
    const code = message.includes('Invalid Google ID token') ? 401 : 500
    return new Response(message, { status: code })
  }
}