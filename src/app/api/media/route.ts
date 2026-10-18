import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  try {
    const res = await fetch(targetUrl, {
      headers: {
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "CloseteAdminDashboard/1.0",
      },
    });

    if (!res.ok) {
      return new NextResponse(`Failed to fetch media: ${res.statusText}`, {
        status: res.status,
      });
    }

    const contentType =
      res.headers.get("content-type") || "application/octet-stream";
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error: any) {
    return new NextResponse(`Proxy error: ${error?.message || "Unknown"}`, {
      status: 500,
    });
  }
}
