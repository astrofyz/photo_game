/**
 * Cloudflare Pages Function: proxies Met Museum images to avoid CORS.
 * Mirrors server.js /api/proxy — only allows images.metmuseum.org.
 */

const MET_IMAGE_HOST = "images.metmuseum.org";

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const imageUrl = requestUrl.searchParams.get("url");

  if (!imageUrl) {
    return new Response("Missing url query", { status: 400 });
  }

  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  if (parsed.hostname !== MET_IMAGE_HOST) {
    return new Response("Proxy only allows images.metmuseum.org", { status: 403 });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: { Accept: "image/*" },
    });
    const headers = new Headers();
    headers.set(
      "Content-Type",
      upstream.headers.get("Content-Type") || "image/jpeg"
    );
    headers.set(
      "Cache-Control",
      upstream.headers.get("Cache-Control") || "public, max-age=86400"
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return new Response("Proxy error", { status: 502 });
  }
}
