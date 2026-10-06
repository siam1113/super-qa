import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function forward(request: NextRequest, context: { params: { path?: string[] } }) {
  const path = '/' + (context.params.path || []).join('/');
  const allowed = /^\/(?:config|login|session|logout|select-app|end-impersonation|accept-invitation|invitations(?:\/[a-f0-9-]+\/revoke)?|members(?:\/[a-f0-9-]+\/revoke)?|oidc\/(?:start|callback)|organization-admin(?:\/apps(?:\/[a-f0-9-]+\/(?:settings|invitations))?)?|super-admin\/benchmarks|super-admin\/organizations(?:\/[a-f0-9-]+\/(?:recover-owner|support-settings|invitations|members\/[a-f0-9-]+\/impersonate|apps(?:\/[a-f0-9-]+\/(?:settings|invitations))?))?)$/i;
  const methodAllowed = ['GET', 'POST'].includes(request.method) || (request.method === 'PATCH' && /^\/(?:organization-admin\/apps\/[a-f0-9-]+\/settings|super-admin\/organizations\/[a-f0-9-]+\/apps\/[a-f0-9-]+\/settings)$/i.test(path));
  const headers = { 'Cache-Control': 'no-store, private', Vary: 'Cookie, Authorization' };
  if (!allowed.test(path) || !methodAllowed) return NextResponse.json({ message: 'Unsupported auth route' }, { status: 404, headers });
  const query = request.nextUrl.searchParams;
  if (query.size && (path !== '/oidc/callback' || [...query.keys()].some(key => !['code', 'state', 'error', 'error_description'].includes(key)))) return NextResponse.json({ message: 'Unsupported auth query' }, { status: 400, headers });
  try {
    const base = new URL(process.env.AUTONOMY_API_URL || 'http://localhost:4000/api');
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) || base.username || base.password || base.search || base.hash || !/^\/api\/?$/.test(base.pathname)) throw new Error();
    let body: string | undefined;
    if (request.method === 'POST' || request.method === 'PATCH') {
      const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      if (reader) while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length; if (length > 16384) { await reader.cancel(); return NextResponse.json({ message: 'Request too large' }, { status: 413, headers }); } chunks.push(chunk.value); }
      body = Buffer.concat(chunks).toString('utf8');
    }
    const authorization = request.headers.get('authorization');
    const cookies = request.headers.get('cookie')?.split(';').map(value => value.trim()).filter(value => value.startsWith('qa_session=') || value.startsWith('qa_admin_session=') || value.startsWith('qa_oidc_state=')).join('; ');
    const response = await fetch(`${base.origin}/api/auth${path}${query.size ? '?' + query.toString() : ''}`, { method: request.method, headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}), ...(cookies ? { Cookie: cookies } : {}) }, body, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const responseHeaders = new Headers(headers);
    const setCookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
    if (setCookies?.length) for (const cookie of setCookies) responseHeaders.append('Set-Cookie', cookie);
    else { const cookie = response.headers.get('set-cookie'); if (cookie) responseHeaders.set('Set-Cookie', cookie); }
    const location = response.headers.get('location'); if (location) responseHeaders.set('Location', location);
    const contentType = response.headers.get('content-type'); if (contentType) responseHeaders.set('Content-Type', contentType);
    return new NextResponse(response.status >= 300 && response.status < 400 ? null : await response.text(), { status: response.status, headers: responseHeaders });
  } catch { return NextResponse.json({ message: 'Authentication service unavailable' }, { status: 502, headers }); }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
