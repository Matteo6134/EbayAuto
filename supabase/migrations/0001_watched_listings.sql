create table if not exists watched_listings (
  id bigint generated always as identity primary key,
  ebay_item_id text not null,
  title text not null,
  category_id text,
  chat_id bigint not null,
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  unique (chat_id, ebay_item_id)
);

create index if not exists watched_listings_chat_id_idx on watched_listings (chat_id);
