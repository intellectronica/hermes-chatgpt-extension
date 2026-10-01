import { describe, expect, it } from 'vitest';
import { avatarData, isModelToken, isReasoningEffort, modelId } from '../src/hermes/models.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const asset = (bytes: Buffer, mime = 'image/png'): { found: boolean; mime: string; size: number; data: string } => ({
  found: true, mime, size: bytes.length, data: `data:${mime};base64,${bytes.toString('base64')}`,
});

describe('Hermes model and avatar boundaries', () => {
  it('preserves distinct provider/model identities and rejects parser flags or quoting', () => {
    expect(modelId('first', 'same-model')).not.toBe(modelId('second', 'same-model'));
    for (const value of ['openai/gpt-model', 'claude-model@2026', 'model:latest', 'vendor_model-1']) expect(isModelToken(value)).toBe(true);
    for (const value of ['--global', 'model --global', 'model\n--provider other', '"model"', 'model;command', 'model$(command)', 'x'.repeat(513)]) expect(isModelToken(value)).toBe(false);
    expect(isReasoningEffort('none')).toBe(true);
    expect(isReasoningEffort('ultra')).toBe(true);
    expect(isReasoningEffort('show')).toBe(false);
  });

  it('requires matching PNG/JPEG/WebP signatures and canonical base64', () => {
    for (const [bytes, mime] of [[png, 'image/png'], [Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'], [Buffer.from('RIFF0000WEBP'), 'image/webp']] as const) {
      const value = asset(bytes, mime);
      expect(avatarData(value)).toBe(value.data);
    }
    expect(avatarData(asset(png, 'image/jpeg'))).toBeUndefined();
    expect(avatarData(asset(Buffer.from('<svg/>'), 'image/svg+xml'))).toBeUndefined();
    expect(avatarData({ ...asset(png), mime: 'image/webp' })).toBeUndefined();
    expect(avatarData({ ...asset(png), data: 'https://private.example/avatar?token=secret' })).toBeUndefined();
    expect(avatarData({ ...asset(png), data: asset(png).data.replace('iVBOR', 'iVB OR') })).toBeUndefined();
    expect(avatarData({ ...asset(png), data: 'data:image/png;base64,iVBORw0KGgo' })).toBeUndefined();
  });

  it('checks declared byte length and bounds decoded data before display', () => {
    expect(avatarData({ ...asset(png), size: png.length + 1 })).toBeUndefined();
    expect(avatarData({ ...asset(png), found: false })).toBeUndefined();
    const boundary = Buffer.alloc(2_000_000);
    png.copy(boundary);
    expect(avatarData(asset(boundary))).toBe(asset(boundary).data);
    const oversized = Buffer.alloc(2_000_001);
    png.copy(oversized);
    expect(avatarData(asset(oversized))).toBeUndefined();
  });
});
