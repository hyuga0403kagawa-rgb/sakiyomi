// カレンダーURL方式の取り込み(知プラe など、APIが使えないMoodle向け)。
//
// 背景: 知プラe(大学連携Moodle)はWebサービスが無効で、香川大Moodleのようなトークン連携が
// できない。一方でMoodle標準の「カレンダーのエクスポート」は有効なので、学生が自分で取得した
// カレンダーURL(.../calendar/export_execute.php?userid=..&authtoken=..)を貼ってもらい、
// サーバーが1時間ごとにそれを読んで課題の期限を取り込む。パスワードは一切扱わない。
//
// このファイルは通信もDBも触らない純粋な関数だけにしてある(scripts/test-sync.mjs で検証する)。

/**
 * カレンダーURL由来の課題は、moodle_event_id にこの値を足して保存する。
 * tasks の一意キーは (user_id, moodle_event_id) なので、別のMoodleサイトのイベントIDと
 * 番号が重なっても衝突しないようにするため。API同期側は、この値以上のIDを
 * 「自分の管轄外」として扱う(提出済みの自動判定の対象にしない)。
 */
export const ICAL_ID_OFFSET = 1_000_000_000

export interface IcalEvent {
  /** Moodle上のイベントID(UIDの@より前) */
  id: number
  summary: string
  description: string | null
  /** 期限(UTC) */
  start: Date
  /** 講義名(CATEGORIES) */
  course: string | null
}

/**
 * 貼り付けられたカレンダーURLを検証して、サーバーが読みに行く形に組み直す。
 * 利用者が入力したURLをサーバーが取得するので、行き先を厳しく絞る:
 *  - https のみ
 *  - IPアドレス直書き・localhost は不可
 *  - パスは Moodle のカレンダー書き出し口(/calendar/export_execute.php)に限る
 *  - userid は数字、authtoken は英数字だけ
 * 期間や対象の指定は利用者のものを使わず、こちらで「全部・直近と今後60日」に固定する。
 */
export function normalizeIcalUrl(raw: string): { url: string } | { error: string } {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return { error: 'URLの形になっていません。カレンダーURLをそのまま貼り付けてください。' }
  }
  if (u.protocol !== 'https:') return { error: 'https:// で始まるURLを貼り付けてください。' }
  const host = u.hostname.toLowerCase()
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
  if (isIp || host === 'localhost' || !host.includes('.') || host.endsWith('.local')) {
    return { error: 'このURLは使えません。' }
  }
  if (!u.pathname.endsWith('/calendar/export_execute.php')) {
    return {
      error:
        'Moodleの「カレンダーURL」ではないようです。カレンダーのエクスポート画面で取得したURLを貼り付けてください。',
    }
  }
  const userid = u.searchParams.get('userid') ?? ''
  const authtoken = u.searchParams.get('authtoken') ?? ''
  if (!/^\d{1,12}$/.test(userid) || !/^[A-Za-z0-9]{8,128}$/.test(authtoken)) {
    return { error: 'URLに必要な情報(userid・authtoken)が含まれていません。URL全体をコピーしてください。' }
  }
  const out = new URL(u.origin + u.pathname)
  out.searchParams.set('userid', userid)
  out.searchParams.set('authtoken', authtoken)
  out.searchParams.set('preset_what', 'all')
  out.searchParams.set('preset_time', 'recentupcoming')
  return { url: out.toString() }
}

/** ICSのテキスト値のエスケープを戻す */
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/** DTSTART の値を Date(UTC)にする。Moodleは UTC(末尾Z)で出す。日付だけの場合はその日の終わり(JST)とみなす */
function parseIcsDate(value: string): Date | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  if (h === undefined) {
    // 終日: 日本時間の 23:59 を期限とする
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 23 - 9, 59, 0))
  }
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  // Z が無い(ローカル時刻)場合は日本時間として扱う
  return new Date(z === 'Z' ? ms : ms - 9 * 3600 * 1000)
}

/** ICS全体から VEVENT を取り出す */
export function parseIcs(text: string): IcalEvent[] {
  // 行の折り返し(次の行が空白/タブで始まる)を戻す
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '')
  const events: IcalEvent[] = []
  const blocks = unfolded.split('BEGIN:VEVENT').slice(1)
  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0]
    const props: Record<string, string> = {}
    for (const line of body.split('\n')) {
      const i = line.indexOf(':')
      if (i <= 0) continue
      // "DTSTART;VALUE=DATE" のようなパラメータは名前から落とす
      const name = line.slice(0, i).split(';')[0].toUpperCase()
      if (!(name in props)) props[name] = line.slice(i + 1)
    }
    const idMatch = (props['UID'] ?? '').match(/^(\d+)@/)
    const start = parseIcsDate((props['DTSTART'] ?? '').trim())
    const summary = unescapeText(props['SUMMARY'] ?? '').trim()
    if (!idMatch || !start || !summary) continue
    const desc = unescapeText(props['DESCRIPTION'] ?? '').trim()
    const course = unescapeText(props['CATEGORIES'] ?? '').trim()
    events.push({
      id: Number(idMatch[1]),
      summary,
      description: desc || null,
      start,
      course: course || null,
    })
  }
  return events
}

/**
 * カレンダーのイベントのうち「締め切り」にあたるものだけを残す。
 * Moodleのカレンダーには「小テストの開始」や個人の予定も入るので、それらは課題として取り込まない。
 * 取りこぼしを避けるため、締め切りを示す語はやや広めに拾い、「開始」だけをはっきり除く。
 */
export function isDeadline(summary: string): boolean {
  if (/(の開始|開始日時|受験開始|opens|open\b)/i.test(summary)) return false
  return /(提出期限|受験終了|終了日時|の終了|期限|締切|締め切り|is due|due\b|closes|close\b)/i.test(summary)
}

/** 'quiz' | 'assign' | null。カレンダー連携のテスト/課題の切り分けに使う */
export function guessModule(summary: string): string | null {
  if (/(受験終了|小テスト|quiz)/i.test(summary)) return 'quiz'
  if (/(提出期限|is due|assignment)/i.test(summary)) return 'assign'
  return null
}
