import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function upstreamBase() {
  const base = process.env.AUTONOMY_API_URL || `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api`;
  const url = new URL(base);
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || !/^\/api\/?$/.test(url.pathname)) throw new Error('Invalid API configuration');
  return url;
}

async function forward(request: NextRequest, context: { params: { path?: string[] } }) {
  const path = '/' + (context.params.path || []).join('/');
  const headers = { 'Cache-Control': 'no-store, private', Vary: 'Origin' };
  const sourceId = '[a-f0-9-]{36}';
  const allowed = new RegExp(`^(?:/|/oauth/config/status|/oauth/(?:github|jira|confluence)/authorize|/${sourceId}(?:/test|/sync|/files)?)$`, 'i');
  const allowedMethod = path === '/' ? ['GET', 'POST'].includes(request.method)
    : path === '/oauth/config/status' ? request.method === 'GET'
      : /^\/oauth\/(github|jira|confluence)\/authorize$/i.test(path) ? request.method === 'POST'
        : new RegExp(`^/${sourceId}$`, 'i').test(path) ? ['GET', 'PATCH', 'DELETE'].includes(request.method)
          : new RegExp(`^/${sourceId}/(?:test|sync|files)$`, 'i').test(path) && request.method === 'POST';
  if (!allowed.test(path) || !allowedMethod || request.nextUrl.search) return NextResponse.json({ message: 'Unsupported integration route' }, { status: 404, headers });

  // File uploads carry raw multipart bytes (with a boundary in Content-Type) and can run much
  // larger than any JSON request this proxy otherwise handles, so they take a separate,
  // binary-safe path instead of being decoded as UTF-8 text like every other body here.
  const isFileUpload = new RegExp(`^/${sourceId}/files$`, 'i').test(path);
  const maxBytes = isFileUpload ? 30 * 1024 * 1024 : 65536;

  try {
    const base = upstreamBase();
    let body: string | Blob | undefined;
    let contentType = 'application/json';
    if (['POST', 'PATCH'].includes(request.method)) {
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader) while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > maxBytes) { await reader.cancel(); return NextResponse.json({ message: isFileUpload ? 'Upload is too large' : 'Integration request is too large' }, { status: 413, headers }); }
        chunks.push(chunk.value);
      }
      if (isFileUpload) { body = new Blob([Buffer.concat(chunks)]); contentType = request.headers.get('content-type') || 'application/octet-stream'; }
      else body = Buffer.concat(chunks).toString('utf8');
    }
    const response = await fetch(`${base.origin}/api/sources${path === '/' ? '' : path}`, {
      method: request.method,
      headers: { 'Content-Type': contentType },
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(isFileUpload ? 60000 : 20000),
    });
    const responseContentType = response.headers.get('content-type') || 'application/json';
    return new NextResponse(await response.text(), { status: response.status, headers: { ...headers, 'Content-Type': responseContentType } });
  } catch {
    return NextResponse.json({ message: 'Integration service is unreachable. Check the API service and try again.' }, { status: 502, headers });
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
