import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND_BASE_URL = (
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'https://appsbackend-production-f360.up.railway.app'
).replace(/\/$/, '');

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

function buildTargetUrl(path: string[], search: string): string {
  const pathPart = path.join('/');
  return `${BACKEND_BASE_URL}/api/v1/${pathPart}${search}`;
}

async function forward(request: NextRequest, params: { path: string[] }): Promise<NextResponse> {
  if (!/^https?:\/\//i.test(BACKEND_BASE_URL)) {
    return NextResponse.json(
      { detail: `Invalid BACKEND_URL: ${BACKEND_BASE_URL}` },
      { status: 500 },
    );
  }

  const targetUrl = buildTargetUrl(params.path, request.nextUrl.search);

  const outboundHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      outboundHeaders.set(key, value);
    }
  });

  const method = request.method.toUpperCase();
  const body =
    method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
      ? undefined
      : await request.text();

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method,
      headers: outboundHeaders,
      body,
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown proxy fetch error';
    return NextResponse.json(
      {
        detail: `Proxy could not reach backend: ${message}`,
        backend_url: BACKEND_BASE_URL,
        target_url: targetUrl,
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  const upstreamText = await upstream.text();
  responseHeaders.set('x-proxy-target', targetUrl);
  responseHeaders.set('x-upstream-status', String(upstream.status));

  if (upstream.status >= 500) {
    return NextResponse.json(
      {
        detail: `Backend returned ${upstream.status}`,
        target_url: targetUrl,
        upstream_status: upstream.status,
        upstream_body: upstreamText.slice(0, 1000),
      },
      { status: upstream.status, headers: responseHeaders },
    );
  }

  return new NextResponse(upstreamText, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, await context.params);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return forward(request, await context.params);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, await context.params);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return forward(request, await context.params);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return forward(request, await context.params);
}

export async function OPTIONS(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return forward(request, await context.params);
}
