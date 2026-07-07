-- Aggiunge dati di traffico reale da eBay Analytics API a daily_metrics
alter table daily_metrics
  add column if not exists impression_count integer,
  add column if not exists click_count integer,
  add column if not exists click_through_rate numeric;

-- Tiene traccia delle offerte inviate ai watcher tramite Negotiation API
create table if not exists sent_offers (
  id bigint generated always as identity primary key,
  listing_id bigint not null references watched_listings(id),
  ebay_item_id text not null,
  offer_date date not null,
  discount_percentage numeric not null,
  expires_at timestamptz not null,
  status text not null default 'sent' check (status in ('sent', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now()
);

create index if not exists sent_offers_listing_id_idx on sent_offers (listing_id);
create unique index if not exists sent_offers_listing_date_idx on sent_offers (listing_id, offer_date);
