create table if not exists proposals (
  id bigint generated always as identity primary key,
  listing_id bigint not null references watched_listings(id),
  proposal_date date not null,
  field text not null check (field in ('title', 'price', 'category', 'ad_rate', 'offer', 'relist', 'social_boost', 'seo_fix')),
  current_value text,
  proposed_value text not null,
  rationale text not null,
  impact text not null default 'normal' check (impact in ('normal', 'high')),
  status text not null default 'pending' check (status in ('pending', 'informational', 'approved', 'rejected', 'applied', 'failed')),
  telegram_message_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists proposals_listing_id_idx on proposals (listing_id);
