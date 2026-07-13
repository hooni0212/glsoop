UPDATE products
SET description = '광고 없이 사진을 저장하고 프로필 사진을 사용하며, 내 글 이미지에 글숲 닉네임을 자동으로 남길 수 있어요.'
WHERE platform = 'apple'
  AND store_sku IN ('glsoop_premium_monthly', 'glsoop_premium_yearly')
  AND entitlement_key = 'premium:glsoop';
