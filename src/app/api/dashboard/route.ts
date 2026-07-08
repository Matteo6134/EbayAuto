import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60; // 24h — reject stale/replayed initData

// Validates the Telegram initData to ensure the request comes from a real Telegram user
function validateTelegramInitData(initData: string, botToken: string): number | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (computedHash !== hash) return null;

    // Reject stale initData so a captured/leaked string can't be replayed forever.
    const authDateStr = params.get('auth_date');
    if (!authDateStr) return null;
    const authDate = parseInt(authDateStr, 10);
    if (!Number.isFinite(authDate)) return null;
    const ageSeconds = Date.now() / 1000 - authDate;
    if (ageSeconds > INIT_DATA_MAX_AGE_SECONDS || ageSeconds < 0) return null;

    const userStr = params.get('user');
    if (!userStr) return null;
    const user = JSON.parse(userStr);
    return user.id as number;
  } catch {
    return null;
  }
}

function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error('SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL mancanti');
  }
  return url;
}

export async function GET(req: NextRequest) {
  const initData = req.nextUrl.searchParams.get('initData') ?? '';
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';

  // In dev mode allow a chatId override for testing
  let chatId: number | null = null;
  if (process.env.NODE_ENV === 'development') {
    const devChatId = req.nextUrl.searchParams.get('chatId');
    if (devChatId) chatId = parseInt(devChatId, 10);
  }

  if (!chatId) {
    chatId = validateTelegramInitData(initData, botToken);
    if (!chatId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createClient(getSupabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Fetch all active listings with latest metrics and pending proposals
  const { data: listings } = await supabase
    .from('watched_listings')
    .select('id, ebay_item_id, title, category_id, status')
    .eq('chat_id', chatId)
    .eq('status', 'active');

  if (!listings || listings.length === 0) {
    return NextResponse.json({ listings: [] });
  }

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const results = await Promise.all(
    listings.map(async (listing) => {
      // Last 7 days metrics
      const { data: metrics } = await supabase
        .from('daily_metrics')
        .select('metric_date, watch_count, quantity_sold, revenue, price, ad_rate_percent, impression_count, click_count, click_through_rate')
        .eq('listing_id', listing.id)
        .gte('metric_date', sevenDaysAgo)
        .order('metric_date', { ascending: true });

      // Pending proposals
      const { data: proposals } = await supabase
        .from('proposals')
        .select('id, field, current_value, proposed_value, rationale, impact, status')
        .eq('listing_id', listing.id)
        .eq('status', 'pending')
        .order('impact', { ascending: false });

      // Sent offers
      const { data: offers } = await supabase
        .from('sent_offers')
        .select('offer_date, discount_percentage, expires_at, status')
        .eq('listing_id', listing.id)
        .order('offer_date', { ascending: false })
        .limit(1);

      const latestMetric = metrics && metrics.length > 0 ? metrics[metrics.length - 1] : null;

      return {
        id: listing.id,
        ebayItemId: listing.ebay_item_id,
        title: listing.title,
        categoryId: listing.category_id,
        latestMetric,
        metrics: metrics ?? [],
        proposals: proposals ?? [],
        latestOffer: offers?.[0] ?? null,
      };
    })
  );

  return NextResponse.json({ listings: results, generatedAt: new Date().toISOString() });
}

// Handle proposal approve/reject from Mini App
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { initData, proposalId, action } = body;
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';

  let chatId: number | null = null;
  if (process.env.NODE_ENV === 'development' && body.chatId) {
    chatId = body.chatId;
  } else {
    chatId = validateTelegramInitData(initData ?? '', botToken);
  }

  if (!chatId || !proposalId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  // Reuse the existing callbackHandler logic
  const { handleProposalCallback } = await import('@/lib/callbackHandler');
  const supabase = createClient(getSupabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const result = await handleProposalCallback(supabase, `proposal:${proposalId}:${action}`, chatId);
  if (!result) {
    return NextResponse.json({ error: 'Proposal not found or invalid action' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: result.text });
}
