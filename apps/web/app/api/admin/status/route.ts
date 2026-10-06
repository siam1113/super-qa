import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = request.cookies.get('qa_session')?.value;
  const headers = { 'Cache-Control': 'no-store, private', Vary: 'Cookie' };
  if (!session) return NextResponse.json({ message: 'Sign in to view admin service status.' }, { status: 401, headers });

  try {
    const base = new URL(process.env.AUTONOMY_API_URL || 'http://localhost:4000/api');
    const localHttp = base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if ((!localHttp && base.protocol !== 'https:') || base.username || base.password || base.search || base.hash || !/^\/api\/?$/.test(base.pathname)) throw new Error();
    const response = await fetch(`${base.origin}/api/health/admin-services`, {
      headers: { cookie: `qa_session=${encodeURIComponent(session)}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.text();
    return new NextResponse(body, { status: response.status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
  } catch {
    return NextResponse.json({ message: 'Admin service status is temporarily unavailable.' }, { status: 502, headers });
  }
}
