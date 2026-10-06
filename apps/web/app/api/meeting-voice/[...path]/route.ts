import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest, context: { params: { path: string[] } }) {
  const path = context.params.path.join('/');
  const headers = { 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' };
  if (!/^[a-f0-9-]{36}\/(start|pulse|stop)$/.test(path)) return NextResponse.json({ message: 'Not found' }, { status: 404, headers });
  if (request.headers.get('origin') !== (process.env.AUTH_PUBLIC_URL || request.nextUrl.origin).replace(/\/$/, '') || !/^Bearer [A-Za-z0-9_-]{43}$/.test(request.headers.get('authorization') || '')) return NextResponse.json({ message: 'Unauthorized' }, { status: 403, headers });
  try {
    const base = new URL(process.env.AUTONOMY_API_URL || 'http://localhost:4000/api');
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) || base.username || base.password || base.search || base.hash || !/^\/api\/?$/.test(base.pathname)) throw new Error('Unsafe API origin');
    const reader = request.body?.getReader(); let length = 0; const chunks: Uint8Array[] = [];
    if (reader) while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length; if (length > 65536) { await reader.cancel(); return NextResponse.json({ message: 'Too large' }, { status: 413, headers }); } chunks.push(chunk.value); }
    const response = await fetch(base.origin + '/api/meeting-voice/' + path, { method: 'POST', headers: { Authorization: request.headers.get('authorization')!, 'Content-Type': 'application/json' }, body: Buffer.concat(chunks).toString('utf8'), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(40000) });
    return new NextResponse(await response.text(), { status: response.status, headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch { return NextResponse.json({ message: 'Voice service unavailable' }, { status: 502, headers }); }
}
