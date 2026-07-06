create table if not exists change_log (
  id bigint generated always as identity primary key,
  listing_id bigint not null references watched_listings(id),
  proposal_id bigint references proposals(id),
  field text not null,
  previous_value text,
  new_value text not null,
  applied_at timestamptz not null default now()
);
