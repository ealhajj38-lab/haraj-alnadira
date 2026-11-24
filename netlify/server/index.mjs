// خادم صغير لإدارة "الصورة الرئيسية" لواجهة حراج النادرة.
// الصورة تُخزَّن في Netlify Blobs، والتحقق من المدير يتم عبر حساب Supabase الموجود.
import { getStore, getDeployStore } from '@netlify/blobs'

// قيم عامة (نفس الموجودة في config.js) — يمكن تجاوزها بمتغيرات بيئة.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jtpvlxyzrwzvkfzwrfof.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_0GFNT5_c_YH3_JWUQqIMvQ_W1ljJeNY'

const KEY = 'hero'
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

function heroStore() {
  const opts = { name: 'site-images', consistency: 'strong' }
  return globalThis.Netlify?.context?.deploy?.context === 'production' ? getStore(opts) : getDeployStore(opts)
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

async function isAdmin(req) {
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return false
  const headers = { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers })
  if (!userRes.ok) return false
  const user = await userRes.json()
  if (!user?.id) return false
  const adminRes = await fetch(
    `${SUPABASE_URL}/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`,
    { headers },
  )
  if (!adminRes.ok) return false
  const rows = await adminRes.json()
  return Array.isArray(rows) && rows.some((r) => r.user_id === user.id)
}

export default async (req) => {
  const { pathname } = new URL(req.url)
  const store = heroStore()

  // معلومات الصورة الحالية (رقم النسخة لتحديث التخزين المؤقت)
  if (pathname === '/api/hero/info' && req.method === 'GET') {
    const meta = await store.getMetadata(KEY)
    return json({ version: meta?.metadata?.version || null })
  }

  if (pathname !== '/api/hero') return json({ error: 'غير موجود' }, 404)

  if (req.method === 'GET') {
    const result = await store.getWithMetadata(KEY, { type: 'arrayBuffer' })
    if (!result) return json({ error: 'لا توجد صورة' }, 404)
    return new Response(result.data, {
      headers: {
        'content-type': result.metadata?.contentType || 'image/jpeg',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    })
  }

  if (req.method === 'PUT' || req.method === 'DELETE') {
    if (!(await isAdmin(req))) return json({ error: 'غير مصرح — سجّل الدخول بحساب المدير.' }, 401)

    if (req.method === 'DELETE') {
      await store.delete(KEY)
      return json({ version: null })
    }

    const contentType = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!ALLOWED_TYPES.has(contentType)) return json({ error: 'نوع الملف غير مدعوم. استخدم JPG أو PNG أو WEBP.' }, 415)
    const body = await req.arrayBuffer()
    if (!body.byteLength) return json({ error: 'الملف فارغ.' }, 400)
    if (body.byteLength > MAX_BYTES) return json({ error: 'حجم الصورة كبير جداً (الحد 5 ميغابايت).' }, 413)

    const version = Date.now().toString(36)
    await store.set(KEY, body, { metadata: { contentType, version } })
    return json({ version })
  }

  return json({ error: 'طريقة غير مدعومة' }, 405)
}

export const config = { path: '/api/*' }
