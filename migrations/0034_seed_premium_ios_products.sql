INSERT OR IGNORE INTO products (
  platform,
  store_sku,
  product_type,
  entitlement_key,
  title,
  description,
  season,
  meta_json,
  is_active
)
VALUES
  (
    'apple',
    'glsoop_premium_monthly',
    'subscription',
    'premium:glsoop',
    '글숲 프리미엄 월간',
    '광고 없이 사진을 저장하고 프로필 사진과 작가 서명을 사용할 수 있어요.',
    NULL,
    '{"billing_period":"monthly","benefits":["photo_save_ad_free","post_image_author_signature","profile_photo_upload","profile_cosmetics_premium_slots"]}',
    1
  ),
  (
    'apple',
    'glsoop_premium_yearly',
    'subscription',
    'premium:glsoop',
    '글숲 프리미엄 연간',
    '광고 없이 사진을 저장하고 프로필 사진과 작가 서명을 사용할 수 있어요.',
    NULL,
    '{"billing_period":"yearly","benefits":["photo_save_ad_free","post_image_author_signature","profile_photo_upload","profile_cosmetics_premium_slots"]}',
    1
  );
