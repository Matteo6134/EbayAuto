import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/ebay/marketplace-account-deletion/route';

function makeGetRequest(challengeCode: string | null) {
  const url = new URL('http://localhost/api/ebay/marketplace-account-deletion');
  if (challengeCode !== null) {
    url.searchParams.set('challenge_code', challengeCode);
  }
  return new NextRequest(url);
}

describe('GET /api/ebay/marketplace-account-deletion', () => {
  beforeEach(() => {
    process.env.EBAY_VERIFICATION_TOKEN = 'test-verification-token';
    process.env.EBAY_MARKETPLACE_DELETION_ENDPOINT = 'https://example.com/api/ebay/marketplace-account-deletion';
  });

  it('ritorna 400 se manca challenge_code', async () => {
    const res = await GET(makeGetRequest(null));
    expect(res.status).toBe(400);
  });

  it('ritorna 500 se mancano le variabili d\'ambiente', async () => {
    delete process.env.EBAY_VERIFICATION_TOKEN;
    const res = await GET(makeGetRequest('abc123'));
    expect(res.status).toBe(500);
  });

  it('calcola correttamente il challengeResponse secondo la specifica eBay', async () => {
    const res = await GET(makeGetRequest('abc123'));
    const body = await res.json();

    const expectedHash = createHash('sha256')
      .update('abc123')
      .update('test-verification-token')
      .update('https://example.com/api/ebay/marketplace-account-deletion')
      .digest('hex');

    expect(res.status).toBe(200);
    expect(body).toEqual({ challengeResponse: expectedHash });
  });
});

describe('POST /api/ebay/marketplace-account-deletion', () => {
  it('ritorna 200 per una notifica valida', async () => {
    const req = new NextRequest('http://localhost/api/ebay/marketplace-account-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: {}, notification: {} }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('ritorna comunque 200 se il corpo non è JSON valido', async () => {
    const req = new NextRequest('http://localhost/api/ebay/marketplace-account-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'non è json',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
