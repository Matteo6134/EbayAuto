create table if not exists daily_metrics (
  id bigint generated always as identity primary key,
  listing_id bigint not null references watched_listings(id),
  metric_date date not null,
  watch_count integer not null default 0,
  quantity_sold integer not null default 0,
  revenue numeric not null default 0,
  price numeric not null default 0,
  ad_rate_percent numeric,
  created_at timestamptz not null default now(),
  unique (listing_id, metric_date)
);

create index if not exists daily_metrics_listing_id_idx on daily_metrics (listing_id);
