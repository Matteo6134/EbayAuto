import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

export async function GET(req: NextRequest) {
  const challengeCode = req.nextUrl.searchParams.get('challenge_code');
  if (!challengeCode) {
    return NextResponse.json({ error: 'challenge_code mancante' }, { status: 400 });
  }

  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN;
  const endpoint = process.env.EBAY_MARKETPLACE_DELETION_ENDPOINT;
  if (!verificationToken || !endpoint) {
    return NextResponse.json(
      { error: 'EBAY_VERIFICATION_TOKEN o EBAY_MARKETPLACE_DELETION_ENDPOINT mancanti' },
      { status: 500 }
    );
  }

  const hash = createHash('sha256');
  hash.update(challengeCode);
  hash.update(verificationToken);
  hash.update(endpoint);
  const challengeResponse = hash.digest('hex');

  return NextResponse.json({ challengeResponse });
}

export async function POST(req: NextRequest) {
  await req.json().catch(() => null);
  return NextResponse.json({}, { status: 200 });
}
