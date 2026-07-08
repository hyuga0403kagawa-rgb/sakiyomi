/**
 * 対応大学リスト。
 * 全URLについて /login/token.php がモバイルWebサービスの応答を返すことを
 * 確認済み(2026-07-09)。ただし大学側の認証方式(SSO限定など)によっては
 * ID/パスワードでの連携ができない場合がある。
 *
 * ⚠ メンテナンス注意: 山梨・高知・島根・大阪教育はURLに年度が入っており、
 * 毎年4月頃に更新が必要(例: /2026 → /2027)。
 */
export interface University {
  name: string
  url: string
}

export const UNIVERSITIES: University[] = [
  { name: '香川大学', url: 'https://kadai-moodle.kagawa-u.ac.jp' },
  { name: '岡山大学', url: 'https://moodle.el.okayama-u.ac.jp' },
  { name: '大阪教育大学', url: 'https://moodle5.osaka-kyoiku.ac.jp/2026' },
  { name: '京都工芸繊維大学', url: 'https://moodle.cis.kit.ac.jp' },
  { name: '京都産業大学', url: 'https://cclms.kyoto-su.ac.jp' },
  { name: '九州工業大学', url: 'https://ict-i.el.kyutech.ac.jp' },
  { name: '高知大学', url: 'https://moodle.kochi-u.ac.jp/2026' },
  { name: '島根大学', url: 'https://moodle.cerd.shimane-u.ac.jp/moodle_2026' },
  { name: '千葉大学', url: 'https://moodle.gs.chiba-u.jp/moodle' },
  { name: '名古屋工業大学', url: 'https://cms7.ict.nitech.ac.jp/moodle40a' },
  { name: '弘前大学', url: 'https://moodle.hirosaki-u.ac.jp' },
  { name: '北海道大学', url: 'https://moodle.elms.hokudai.ac.jp' },
  { name: '山梨大学', url: 'https://moodle.yamanashi.ac.jp/2026' },
  { name: '早稲田大学', url: 'https://wsdmoodle.waseda.jp' },
  { name: 'その他の大学(URLを入力)', url: 'custom' },
]
