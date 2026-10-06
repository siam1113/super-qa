import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function forward(request: NextRequest, context: { params: { path?: string[] } }) {
  const path = '/' + (context.params.path || []).join('/');
  const headers = { 'Cache-Control': 'no-store, private', Vary: 'Cookie' };
  if (!/^\/(?:start|pulse|stop)$/.test(path) || request.method !== 'POST' || request.nextUrl.search) return NextResponse.json({ message: 'Unknown voice route' }, { status: 404, headers });
  const session = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => /^qa_session=qs_[a-f0-9]{64}$/.test(value));
  if (!session) return NextResponse.json({ message: 'Sign in to your app to use Super QA voice' }, { status: 401, headers });
  try {
    const base = new URL(process.env.AUTONOMY_API_URL || 'http://localhost:4000/api');
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) || base.username || base.password || base.search || base.hash || !/^\/api\/?$/.test(base.pathname)) throw new Error('Invalid API configuration');
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 65536) return NextResponse.json({ message: 'Request too large' }, { status: 413, headers });
    const response = await fetch(`${base.origin}/api/agents/superqa/voice${path}`, {
      method: 'POST', headers: { Cookie: session, 'Content-Type': 'application/json' }, body,
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(path === '/start' ? 45000 : 20000),
    });
    return new NextResponse(await response.text(), { status: response.status, headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch {
    return NextResponse.json({ message: 'Super QA voice is unavailable' }, { status: 502, headers });
  }
}

export const POST = forward;
