-- Amplia il vincolo su proposals.field per i nuovi tipi di proposta
-- (offer, relist, social_boost, seo_fix) introdotti dai moduli
-- Negotiation, Lazarus, Social Booster e SEO Doctor.
-- Sostituisce le modifiche fatte in-place a 0004_proposals.sql, che non
-- si propagano a un database dove 0004 era già stata applicata.

alter table proposals drop constraint if exists proposals_field_check;
alter table proposals add constraint proposals_field_check
  check (field in ('title', 'price', 'category', 'ad_rate', 'offer', 'relist', 'social_boost', 'seo_fix'));
