/**
 * Cloudflare Pages / Workers Function
 * Handles routing and caching for Memorizer
 */

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Cache strategy
  const cacheKey = new Request(url.toString(), request);
  const cache = caches.default;

  // Try to get from cache
  let response = await cache.match(cacheKey);
  if (response) {
    return response;
  }

  // Serve index.html for SPA routing
  if (path === '/' || !path.includes('.')) {
    const indexResponse = await context.env.ASSETS.fetch(
      new Request(new URL('/index.html', url).toString(), request)
    );

    if (indexResponse.status === 200) {
      // Cache HTML for 1 hour
      const headers = new Headers(indexResponse.headers);
      headers.set('Cache-Control', 'public, max-age=3600');
      headers.set('Content-Type', 'text/html; charset=utf-8');

      const cachedResponse = new Response(indexResponse.body, {
        status: indexResponse.status,
        statusText: indexResponse.statusText,
        headers
      });

      await cache.put(cacheKey, cachedResponse.clone());
      return cachedResponse;
    }
  }

  // Serve static assets
  let response = await context.env.ASSETS.fetch(request);

  // Cache static assets
  if (response.status === 200) {
    const headers = new Headers(response.headers);
    const cacheControl = getCacheControl(path);
    headers.set('Cache-Control', cacheControl);

    // Add security headers
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'SAMEORIGIN');
    headers.set('X-XSS-Protection', '1; mode=block');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

    const cachedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });

    await cache.put(cacheKey, cachedResponse.clone());
    return cachedResponse;
  }

  return response;
}

/**
 * Determine cache control header based on file type
 */
function getCacheControl(path) {
  if (path.endsWith('.html')) {
    return 'public, max-age=3600'; // 1 hour for HTML
  }
  if (path.match(/\.(js|css|svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|eot)$/i)) {
    return 'public, max-age=31536000, immutable'; // 1 year for static assets
  }
  if (path.endsWith('.json') || path.endsWith('.webmanifest')) {
    return 'public, max-age=3600'; // 1 hour for manifest
  }
  return 'public, max-age=3600'; // Default 1 hour
}
