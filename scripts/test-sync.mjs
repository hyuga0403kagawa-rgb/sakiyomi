// moodle-sync の取得ロジック(ページ送り・HTML除去・タイトル整形)の回帰テスト。
// 実ソースから関数を切り出してモックの fetch で動かす。実行: npm run test:sync
import fs from 'node:fs'
import ts from 'typescript'

const src = fs.readFileSync('supabase/functions/moodle-sync/index.ts', 'utf8')
const start = src.indexOf('function cleanTitle(name: string) {')
const end = src.indexOf('/** 同期の失敗を記録する')
const js = ts.transpileModule(src.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText

let calls = []
const makeFetch = (total) => async (url) => {
  const u = new URL(url)
  const after = u.searchParams.get('aftereventid')
  const limit = Number(u.searchParams.get('limitnum'))
  calls.push(after)
  const all = Array.from({ length: total }, (_, i) => ({ id: 1000 + i }))
  const from = after ? all.findIndex((e) => e.id === Number(after)) + 1 : 0
  return { ok: true, json: async () => ({ events: all.slice(from, from + limit) }) }
}

const run = new Function('fetch', js + '\nreturn { cleanTitle, htmlToText, fetchAllEvents }')
const results = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  results.push(ok)
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `\n   got : ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`))
}

// --- タイトル ---
{
  const { cleanTitle } = run(makeFetch(0))
  check('title: Moodleの定型句を外す', cleanTitle('「レポート3 過渡応答の測定」の提出期限'), 'レポート3 過渡応答の測定')
  check('title: 空白は1つにそろえる(消さない)', cleanTitle('Report  3   Final'), 'Report 3 Final')
  check('title: 小テスト', cleanTitle('「第5回小テスト」の受験終了日時'), '第5回小テスト')
}

// --- HTML → テキスト ---
{
  const { htmlToText } = run(makeFetch(0))
  check('html: 段落と改行', htmlToText('<p>A4で3〜5ページ</p><p>PDFで提出<br>期限厳守</p>'), 'A4で3〜5ページ\nPDFで提出\n期限厳守')
  check('html: 箇条書き', htmlToText('<ul><li>ソースコード</li><li>考察</li></ul>'), '・ソースコード\n・考察')
  check('html: 実体参照', htmlToText('a&nbsp;&amp;&nbsp;b &lt;c&gt;'), 'a & b <c>')
  check('html: 空は null', htmlToText('<p></p>'), null)
  check('html: null は null', htmlToText(null), null)
  check('html: scriptタグは中身ごと文字として無害化される', htmlToText('<script>alert(1)</script>x').includes('<'), false)
  check('html: 2000字で切る', htmlToText('あ'.repeat(3000)).length, 2000)
}

// --- ページ送り ---
for (const [total, wantCount, wantTrunc, wantCalls] of [
  [0, 0, false, 1],
  [49, 49, false, 1],
  [50, 50, false, 2], // ちょうど50件: 次ページを見に行き、空なので終わる
  [51, 51, false, 2],
  [120, 120, false, 3],
  [300, 300, true, 6], // 上限ページに達した = まだ続きがあるかもしれない
  [500, 300, true, 6],
]) {
  calls = []
  const { fetchAllEvents } = run(makeFetch(total))
  const r = await fetchAllEvents({ moodle_token: 't', moodle_url: 'https://example.test' }, 0)
  check(`paging: 予定${total}件 → ${wantCount}件取得`, [r.events.length, r.truncated, calls.length], [wantCount, wantTrunc, wantCalls])
  check(`paging: 予定${total}件 → 重複なし`, new Set(r.events.map((e) => e.id)).size, r.events.length)
}

// --- エラー応答 ---
{
  const { fetchAllEvents } = run(async () => ({ ok: true, json: async () => ({ errorcode: 'invalidtoken' }) }))
  check('error: トークン失効を error として返す', await fetchAllEvents({ moodle_token: 't', moodle_url: 'https://example.test' }, 0), { error: 'invalidtoken' })
  const f2 = run(async () => ({ ok: false, status: 503 })).fetchAllEvents
  check('error: HTTPエラー', await f2({ moodle_token: 't', moodle_url: 'https://example.test' }, 0), { error: 'moodle http 503' })
}

// ===== カレンダーURL方式(知プラe など) =====
{
  const icalSrc = fs.readFileSync('supabase/functions/moodle-sync/ical.ts', 'utf8')
  const icalJs = ts.transpileModule(icalSrc, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', icalJs)(mod, mod.exports)
  const { normalizeIcalUrl, parseIcs, isDeadline, guessModule, ICAL_ID_OFFSET } = mod.exports

  // --- URLの検証(利用者の入力をサーバーが読みに行くので、行き先を絞れているか) ---
  const good =
    'https://lms-sp.itc.kagawa-u.ac.jp/moodle2026/calendar/export_execute.php?userid=1234&authtoken=abcdef0123456789abcdef0123456789abcdef01&preset_what=courses&preset_time=weeknow'
  const ok = normalizeIcalUrl(good)
  check('url: 正しいURLは通る', 'url' in ok, true)
  check(
    'url: 期間と対象はこちらで固定し直す',
    ok.url,
    'https://lms-sp.itc.kagawa-u.ac.jp/moodle2026/calendar/export_execute.php?userid=1234&authtoken=abcdef0123456789abcdef0123456789abcdef01&preset_what=all&preset_time=recentupcoming',
  )
  check('url: 前後の空白は無視', 'url' in normalizeIcalUrl('  ' + good + '\n'), true)
  const bad = {
    'http(暗号化なし)': good.replace('https://', 'http://'),
    'IPアドレス直書き': 'https://192.168.0.1/calendar/export_execute.php?userid=1&authtoken=abcdef0123456789',
    'メタデータIP': 'https://169.254.169.254/calendar/export_execute.php?userid=1&authtoken=abcdef0123456789',
    'localhost': 'https://localhost/calendar/export_execute.php?userid=1&authtoken=abcdef0123456789',
    'IPv6': 'https://[::1]/calendar/export_execute.php?userid=1&authtoken=abcdef0123456789',
    '別のパス': 'https://lms-sp.itc.kagawa-u.ac.jp/moodle2026/admin/index.php?userid=1&authtoken=abcdef0123456789',
    'パスの途中に偽装': 'https://evil.example/calendar/export_execute.php/../../secret?userid=1&authtoken=abcdef0123456789',
    'useridが数字でない': good.replace('userid=1234', 'userid=1;drop'),
    'authtokenなし': 'https://lms-sp.itc.kagawa-u.ac.jp/moodle2026/calendar/export_execute.php?userid=1',
    'URLでない文字列': 'カレンダーのURL',
    '空': '',
  }
  for (const [name, url] of Object.entries(bad)) {
    check(`url: 拒否する — ${name}`, 'error' in normalizeIcalUrl(url), true)
  }

  // --- ICSの解析(Moodleが実際に出す形式にならったサンプル) ---
  const ics = [
    'BEGIN:VCALENDAR',
    'METHOD:PUBLISH',
    'PRODID:-//Moodle Pty Ltd//NONSGML Moodle Version 2024100700//EN',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:5012@lms-sp.itc.kagawa-u.ac.jp',
    'SUMMARY:「第3回レポート」の提出期限',
    'DESCRIPTION:A4で2ページ\\, PDFで提出\\n期限厳守',
    'CLASS:PUBLIC',
    'DTSTART:20260925T145900Z',
    'DTEND:20260925T145900Z',
    'CATEGORIES:四国の歴史と文化',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:5013@lms-sp.itc.kagawa-u.ac.jp',
    // 75桁を超える行は、次の行が空白で始まる形に折り返される
    'SUMMARY:「第4回確認テスト(とても長い名前のテストで行が折り返',
    ' される場合)」の受験終了日時',
    'DTSTART:20260930T150000Z',
    'CATEGORIES:四国の歴史と文化',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:5014@lms-sp.itc.kagawa-u.ac.jp',
    'SUMMARY:「第4回確認テスト」の受験開始日時',
    'DTSTART:20260923T000000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:5015@lms-sp.itc.kagawa-u.ac.jp',
    'SUMMARY:サークルの集まり',
    'DTSTART:20260926T090000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:5016@lms-sp.itc.kagawa-u.ac.jp',
    'SUMMARY:「最終課題」の提出期限',
    'DTSTART;VALUE=DATE:20261001',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:broken-no-number',
    'SUMMARY:壊れたイベント',
    'DTSTART:20260925T145900Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  const evs = parseIcs(ics)
  check('ics: 番号の取れないイベントは捨て、残りを読む', evs.map((e) => e.id), [5012, 5013, 5014, 5015, 5016])
  check('ics: 期限はUTCのまま正しく読む(=日本時間 9/25 23:59)', evs[0].start.toISOString(), '2026-09-25T14:59:00.000Z')
  check('ics: エスケープされた , と改行を戻す', evs[0].description, 'A4で2ページ, PDFで提出\n期限厳守')
  check('ics: 講義名', evs[0].course, '四国の歴史と文化')
  check('ics: 折り返された行をつなぐ', evs[1].summary, '「第4回確認テスト(とても長い名前のテストで行が折り返される場合)」の受験終了日時')
  check('ics: 日付だけの期限は、その日の日本時間23:59とみなす', evs[4].start.toISOString(), '2026-10-01T14:59:00.000Z')

  const kept = evs.filter((e) => isDeadline(e.summary)).map((e) => e.id)
  check('deadline: 締め切りだけを残す(テストの開始・個人の予定は入れない)', kept, [5012, 5013, 5016])
  check('module: 提出期限は課題', guessModule(evs[0].summary), 'assign')
  check('module: 受験終了は小テスト', guessModule(evs[1].summary), 'quiz')
  check('title: ICSの件名からも定型句を外せる', run(makeFetch(0)).cleanTitle(evs[0].summary), '第3回レポート')
  check('ics: 空のカレンダーでも落ちない', parseIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR'), [])
  check('ics: Moodleのエラー本文を渡しても落ちない', parseIcs('Invalid authentication'), [])
  check('id: API方式のIDと番号が重ならない', ICAL_ID_OFFSET + 5012 > 999_999_999, true)
}

console.log(`\n${results.filter(Boolean).length} / ${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
