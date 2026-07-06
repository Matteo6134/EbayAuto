create table if not exists ebay_connection (
  chat_id bigint primary key,
  pending_state text,
  pending_state_created_at timestamptz,
  access_token text,
  refresh_token text,
  access_token_expires_at timestamptz,
  connected_at timestamptz
);
