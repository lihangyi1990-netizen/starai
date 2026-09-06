import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL || "https://www.tunafishai.com";

/**
 * Catch-all proxy for /api/* routes.
 * Overrides Origin/Referer headers to match the production server,
 * bypassing CORS/CSRF checks that reject localhost origins.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  return proxyRequest(request, await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  return proxyRequest(request, await params);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  return proxyRequest(request, await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  return proxyRequest(request, await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  return proxyRequest(request, await params);
}

async function proxyRequest(request: NextRequest, params: { slug: string[] }) {
  const { slug } = await params;
  const path = slug.join("/");
  const targetURL = `${API_URL}/api/${path}${request.nextUrl.search}`;

  const headers = new Headers(request.headers);
  // Override origin/referer to match the production server
  headers.set("Origin", API_URL);
  headers.set("Referer", `${API_URL}/`);
  headers.delete("host");
  headers.delete("connection");

  try {
    const response = await fetch(targetURL, {
      method: request.method,
      headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? await request.text() : undefined,
      redirect: "manual",
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("transfer-encoding");

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return NextResponse.json({ error: "Proxy error" }, { status: 502 });
  }
}
