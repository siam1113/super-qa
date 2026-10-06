import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'no-store, private', Vary: 'Cookie, Authorization' };

export async function GET(request: NextRequest) {
  const cookies = request.cookies.get('qa_session')?.value;
  if (!cookies) return NextResponse.json({ message: 'Sign in to view service status.' }, { status: 401, headers: privateHeaders });

  let base: URL;
  try {
    base = new URL(process.env.AUTONOMY_API_URL || 'http://localhost:4000/api');
    const localHttp = base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if ((!localHttp && base.protocol !== 'https:') || base.username || base.password || base.search || base.hash || !/^\/api\/?$/.test(base.pathname)) throw new Error();
  } catch {
    return NextResponse.json({ message: 'Service status is unavailable.' }, { status: 503, headers: privateHeaders });
  }

  try {
    const response = await fetch(`${base.origin}/api/health/services`, {
      headers: { cookie: `qa_session=${encodeURIComponent(cookies)}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.text();
    const headers = new Headers(privateHeaders);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new NextResponse(body, { status: response.status, headers });
  } catch {
    return NextResponse.json({ message: 'Service status is temporarily unavailable.' }, { status: 502, headers: privateHeaders });
  }
}
