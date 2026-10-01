const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** One backend origin and optional reverse-proxy mount; never an individual API URL. */
export function backendBaseUrl(value: string | undefined): string {
  if (!value || /[\x00-\x20\x7f\\]/.test(value)) throw new Error('baseUrl must be an explicit HTTP(S) backend URL.');
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('baseUrl must be an explicit HTTP(S) backend URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('baseUrl must be HTTP(S), without credentials, query or fragment.');
  }
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) throw new Error('Remote HTTP connections require HTTPS or SSH.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Preserve the same proxy mount for REST and WebSocket traffic. */
export function backendRoute(base: string, path: string): URL {
  if (!path.startsWith('/api/') || /[\x00-\x20\x7f\\#]/.test(path) || path.includes('://')) throw new Error('Unsupported Hermes read route.');
  const pathname = path.split('?')[0];
  if (pathname.split('/').some(segment => {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { return true; }
    return decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\');
  })) throw new Error('Unsupported Hermes read route.');
  const url = new URL(`${base}${path}`);
  const prefix = new URL(base).pathname.replace(/\/+$/, '');
  if (url.origin !== new URL(base).origin || !url.pathname.startsWith(`${prefix}/api/`)) throw new Error('Unsupported Hermes read route.');
  return url;
}
