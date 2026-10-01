import { object } from './rpc.js';

/** Hermes's own dial, rather than a guessed provider-specific capability matrix. */
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

export function modelId(provider: string, model: string): string {
  return JSON.stringify([provider, model]);
}

/** Hermes's model flag parser splits on whitespace and does not interpret quoting. */
export function isModelToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@+,%=~-]{0,511}$/.test(value);
}

export function isReasoningEffort(value: unknown): value is string {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

/** Only bounded PNG/JPEG/WebP assets cross into UI metadata; protected URLs and SVG do not. */
export function avatarData(value: unknown): string | undefined {
  const asset = object(value);
  if (asset.found !== true || typeof asset.data !== 'string' || asset.data.length > 2_667_000) return undefined;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(asset.data);
  if (!match || asset.mime !== match[1] || match[2]!.length % 4 !== 0) return undefined;
  const bytes = Buffer.from(match[2]!, 'base64');
  if (!bytes.length || bytes.length > 2_000_000 || asset.size !== bytes.length || bytes.toString('base64') !== match[2]) return undefined;
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!(match[1] === 'image/png' && png || match[1] === 'image/jpeg' && jpeg || match[1] === 'image/webp' && webp)) return undefined;
  return asset.data;
}
