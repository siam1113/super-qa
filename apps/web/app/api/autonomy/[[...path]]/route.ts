import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function forward(request: NextRequest, context: { params: { path?: string[] } }) {
  const path = '/' + (context.params.path || []).join('/');
  const allowed = /^\/(?:settings|pause|keys(?:\/[a-f0-9-]+\/revoke)?|suites(?:\/[a-f0-9-]+\/approve)?|runs(?:\/[a-f0-9-]+(?:\/cancel)?)?|benchmarks(?:\/[a-f0-9-]+(?:\/(?:approve|resume|pause|advance))?)?)?$/i;
  const headers = { 'Cache-Control': 'no-store, private', Vary: 'Authorization' };
  if (!allowed.test(path) || request.nextUrl.search) return NextResponse.json({ message: 'Unsupported control-plane route' }, { status: 404, headers });
  const authorization = request.headers.get('authorization') || '';
  const session = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => /^qa_session=qs_[a-f0-9]{64}$/.test(value));
  if (!/^Bearer sq_[a-f0-9]{64}$/.test(authorization) && !session) return NextResponse.json({ message: 'App credential or login required' }, { status: 401, headers });
  try {
    const base = new URL(process.env.AUTONOMY_API_URL || 'http://localhost:4000/api');
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) || base.username || base.password || base.search || base.hash || !/^\/api\/?$/.test(base.pathname)) throw new Error('Invalid control plane configuration');
    let body: string | undefined;
    if (request.method === 'POST') {
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader) while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > 65536) { await reader.cancel(); return NextResponse.json({ message: 'Request too large' }, { status: 413, headers }); }
        chunks.push(chunk.value);
      }
      body = Buffer.concat(chunks).toString('utf8');
    }
    const response = await fetch(`${base.origin}/api/autonomy${path === '/' ? '' : path}`, {
      method: request.method, headers: { ...(authorization ? { Authorization: authorization } : {}), ...(session ? { Cookie: session } : {}), 'Content-Type': 'application/json' }, body,
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    return new NextResponse(await response.text(), { status: response.status, headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch {
    return NextResponse.json({ message: 'Scoped control plane unavailable' }, { status: 502, headers });
  }
}

export const GET = forward;
export const POST = forward;
