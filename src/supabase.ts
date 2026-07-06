import { createClient } from '@supabase/supabase-js'

// publishableキーは「ブラウザに埋め込む前提の公開キー」。
// データ保護はRLS(自分の行しか読み書きできないルール)がDB側で担う。
export const supabase = createClient(
  'https://kdyffkcowdkbgtbledbc.supabase.co',
  'sb_publishable_toV1yEBga6Tvhv9mDcmxUA_SvNf1_R-',
)
