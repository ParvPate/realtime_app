import { OAuth2Client } from 'google-auth-library'
import jwt from 'jsonwebtoken'
import { db } from './db'
import { fetchRedis } from '@/helpers/redis'
import { nanoid } from 'nanoid'

export type MobileUser = {
  id: string
  name: string
  email: string
  image?: string
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const MOBILE_JWT_SECRET = process.env.MOBILE_JWT_SECRET

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID)

export async function verifyGoogleIdToken(idToken: string): Promise<any> {
  if (!GOOGLE_CLIENT_ID) throw new Error('Missing GOOGLE_CLIENT_ID')
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  })
  const payload = ticket.getPayload()
  if (!payload || !payload.email) {
    throw new Error('Invalid Google ID token')
  }
  return payload
}

export async function ensureUserFromGooglePayload(payload: any): Promise<MobileUser> {
  const email = payload.email as string
  const name = (payload.name as string) ?? email.split('@')[0]
  const image = (payload.picture as string) ?? undefined

  // try mapping by email
  const existingId = (await fetchRedis('get', `user:email:${email}`)) as string | null
  if (existingId) {
    const raw = await db.get<string>(`user:${existingId}`)
    if (raw) {
      const user = JSON.parse(raw) as MobileUser
      return user
    }
  }

  const id = nanoid()
  const user: MobileUser = { id, name, email, image }
  await db.set(`user:${id}`, JSON.stringify(user))
  await db.set(`user:email:${email}`, id)
  return user
}

export function signMobileJwt(userId: string, expiresIn: string = '1h'): string {
  if (!MOBILE_JWT_SECRET) throw new Error('Missing MOBILE_JWT_SECRET')
  return jwt.sign({ uid: userId }, MOBILE_JWT_SECRET, { expiresIn })
}

export function verifyMobileJwt(token: string): { uid: string } {
  if (!MOBILE_JWT_SECRET) throw new Error('Missing MOBILE_JWT_SECRET')
  const decoded = jwt.verify(token, MOBILE_JWT_SECRET) as { uid: string }
  return decoded
}

export async function getMobileUser(req: Request): Promise<MobileUser | null> {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice('Bearer '.length)
  const { uid } = verifyMobileJwt(token)
  const raw = await db.get<string>(`user:${uid}`)
  if (!raw) return null
  return JSON.parse(raw) as MobileUser
}