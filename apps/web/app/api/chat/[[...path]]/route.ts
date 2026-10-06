import { NextRequest, NextResponse } from 'next/server';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { chatConnectionError } from '@/lib/chat-errors';

export const dynamic = 'force-dynamic';

function forwardJson(url: URL, method: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method,
      headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body, 'utf8')), 'X-Chat-Forwarder': 'node-http-v1' },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode || 502,
        headers: { 'Content-Type': response.headers['content-type'] || 'application/json' },
      })));
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Chat API request timed out')));
    request.on('error', reject);
    request.write(Buffer.from(body, 'utf8'));
    request.end();
  });
}

async function forward(request: NextRequest, context: { params: { path?: string[] } }) {
  const path = '/' + (context.params.path || []).join('/');
  const headers = { 'Cache-Control': 'no-store, private', Vary: 'Cookie' };
  const id = '[a-f0-9-]+';
  const route = new RegExp('^/(?:events|directory|agents(?:/' + id + '(?:/runtime-chat(?:/stream)?|/settings|/model|/limits|/temperature|/voice-preview|/prompts/install|/workflow-artifacts(?:/' + id + '(?:/job)?)?|/memories(?:/' + id + '(?:/revisions|/restore|/permanent)?)?|/memories/context)?)?|prompts(?:/' + id + ')?|conversations(?:/' + id + '(?:/meetings|/policy|/messages(?:/' + id + '/task)?|/tasks/' + id + '/done)?)?|meetings(?:/(?:active|feed|' + id + '(?:/(?:join|poll|signal|leave|end|entries|activity|runs|sync)|/voice/(?:start|pulse|stop)|/runs/' + id + '/(?:publish|play))?)?)?|installations(?:/teams/connect-url|/slack/install-url|/' + id + '/(?:disconnect|conversations|secret))?)$');
  if (!route.test(path)) return NextResponse.json({ message: 'Unknown chat route' }, { status: 404, headers });
  const query = request.nextUrl.searchParams;
  const conversationPagination = /^\/conversations\/[a-f0-9-]+$/.test(path) && [...query.keys()].every(key => key === 'before') && (!query.has('before') || /^[a-f0-9-]{36}$/.test(query.get('before') || ''));
  const memoryFilter = /^\/agents\/[a-f0-9-]+\/memories$/.test(path) && [...query.keys()].every(key => key === 'includeArchived') && (!query.has('includeArchived') || /^(?:true|false)$/.test(query.get('includeArchived') || ''));
  if (query.size && !conversationPagination && !memoryFilter) return NextResponse.json({ message: 'Invalid pagination' }, { status: 400, headers });
  const session = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => /^qa_session=qs_[a-f0-9]{64}$/.test(value));
  if (!session) return NextResponse.json({ message: 'Sign in to your app to use Chat' }, { status: 401, headers });
  const origin = request.headers.get('origin');
  const expectedOrigin = process.env.AUTH_PUBLIC_URL || request.nextUrl.protocol + '//' + request.headers.get('host');
  if (['POST', 'PATCH', 'DELETE'].includes(request.method) && origin && origin !== expectedOrigin.replace(/\/$/, '')) return NextResponse.json({ message: 'Invalid origin' }, { status: 403, headers });
  try {
    const base = new URL(process.env.AUTONOMY_API_URL || 'http://localhost:4000/api');
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) || base.username || base.password || base.search || base.hash || !/^\/api\/?$/.test(base.pathname)) throw new Error('Invalid API configuration');
    let body: string | undefined;
    if (['POST', 'PATCH', 'PUT'].includes(request.method)) {
      body = await request.text();
      if (new TextEncoder().encode(body).length > 65536) return NextResponse.json({ message: 'Message too large' }, { status: 413, headers });
      if (request.method === 'POST' && path === '/conversations') {
        let payload: unknown;
        try { payload = JSON.parse(body); } catch { payload = null; }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return NextResponse.json({ message: 'Conversation details were not received. Reload Chat and try again.' }, { status: 400, headers });
        const values = payload as Record<string, unknown>;
        console.info('[chat-create-proxy]', JSON.stringify({ bytes: Buffer.byteLength(body, 'utf8'), forwarder: 'node-http-v1' }));
        if (!['direct', 'group'].includes(String(values.kind)) || typeof values.title !== 'string' || !values.title.trim() || !Array.isArray(values.memberIds) || typeof values.instructions !== 'string') return NextResponse.json({ message: 'Conversation details are incomplete. Choose a conversation type, title, members, and instructions, then try again.' }, { status: 400, headers });
      }
    }
    const events = path === '/events';
    const runtimeChatStream = /^\/agents\/[a-f0-9-]+\/runtime-chat\/stream$/.test(path);
    const streaming = events || runtimeChatStream;
    const forwardHeaders: Record<string, string> = { Cookie: session, 'Content-Type': 'application/json' };
    const apiUrl = new URL('/api/chat' + path + (query.size ? '?' + query : ''), base.origin);
    const timeoutMs = path.endsWith('/voice/start') ? 45000 : 20000;
    // Streaming responses (SSE) must come from a native fetch, whose body is a live
    // ReadableStream; forwardJson buffers the whole upstream response before resolving.
    const response = runtimeChatStream && body !== undefined
      ? await fetch(apiUrl, { method: request.method, headers: forwardHeaders, cache: 'no-store', redirect: 'error', body })
      : body === undefined
      ? await fetch(apiUrl, { method: request.method, headers: forwardHeaders, cache: 'no-store', redirect: 'error', ...(events ? {} : { signal: AbortSignal.timeout(timeoutMs) }) })
      : await forwardJson(apiUrl, request.method, forwardHeaders, body, timeoutMs);
    if (streaming) return new NextResponse(response.body, { status: response.status, headers: { ...headers, 'Content-Type': response.headers.get('content-type') || 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
    return new NextResponse(await response.text(), { status: response.status, headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch (failure) { return NextResponse.json({ message: chatConnectionError(path, failure instanceof Error && failure.name === 'TimeoutError') }, { status: 502, headers }); }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
