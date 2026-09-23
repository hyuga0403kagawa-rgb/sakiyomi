// 協賛企業(有料掲載)の表示ルールと、表示回数・タップ数の記録。
//
// 決めごと(意思決定ログ 2026-09-23):
// - アプリを開いた最初に、協賛企業を1社だけ出す。協賛が複数なら日替わり
// - 通知から開いたときは出さない / 1日1回まで / 3年生以上にだけ / すぐ閉じられる / PR表記
// - 集計は企業ごと・日ごとの合計だけ。誰が見たか・タップしたかは記録しない
//   (DB側の sponsor_stats と record_sponsor_event。定義は supabase/sql/)
import { supabase } from './supabase'
import { isDemo } from './demo'
import type { Company } from './types'

export type SponsorPlacement = 'open' | 'job_tab'
type SponsorEventKind = 'impression' | 'tap'

/** 協賛の表示対象にする学年。就活が関係するのは3年生以上と大学院生 */
const UPPER_GRADES = ['3年', '4年', '5年', '6年', '大学院']

export function isUpperGrade(grade: string | undefined): boolean {
  return !!grade && UPPER_GRADES.includes(grade)
}

/** 日本時間の今日を YYYY-MM-DD で返す(集計の日付もDB側で日本時間に揃えている) */
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 今日出す協賛企業を1社選ぶ。IDの順に並べ、日付で回すので、
 * 同じ日なら誰が開いても同じ会社になり、各社がほぼ同じ日数ずつ出る。
 */
export function pickTodaysSponsor(companies: Company[], today: string = todayJst()): Company | null {
  const sponsors = companies.filter((c) => c.isSponsored).sort((a, b) => a.id.localeCompare(b.id))
  if (sponsors.length === 0) return null
  const dayNumber = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000)
  return sponsors[dayNumber % sponsors.length]
}

// ---- 通知から開いたかどうか ----

/**
 * 通知をタップして開いたときは Service Worker が URL に from=push を付ける。
 * それを読み取ったらURLから消す(再読み込みで引きずらないように)。
 */
export function consumeFromPushFlag(): boolean {
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('from') !== 'push') return false
    url.searchParams.delete('from')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    return true
  } catch {
    return false
  }
}

// ---- 端末内の「今日はもう出した/数えた」記録 ----
// 失敗しても表示や動作は止めない(プライベートブラウズ等で読み書きできないことがある)

function readDay(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeDay(key: string, day: string): void {
  try {
    localStorage.setItem(key, day)
  } catch {
    // 保存できなくても続行
  }
}

const OPEN_SHOWN_KEY = 'uniport.sponsor.openShownDate'

export function openSponsorShownToday(today: string = todayJst()): boolean {
  return readDay(OPEN_SHOWN_KEY) === today
}

export function markOpenSponsorShown(today: string = todayJst()): void {
  writeDay(OPEN_SHOWN_KEY, today)
}

// ---- 表示回数・タップ数の記録 ----

/**
 * 協賛企業の表示・タップを1回記録する。同じ端末・同じ会社・同じ置き場所・同じ種類は
 * 1日1回までしか送らない(開き直しや連打で数字が膨らまないように)。
 * 数字は「その日に見た/タップした人の延べ数」に近いものになる。
 * 失敗しても画面の動作には影響させない。
 */
export function recordSponsorEvent(
  companyId: string,
  placement: SponsorPlacement,
  kind: SponsorEventKind,
): void {
  if (isDemo()) return
  const today = todayJst()
  const key = `uniport.sponsor.${placement}.${kind}.${companyId}`
  if (readDay(key) === today) return
  writeDay(key, today)
  void supabase
    .rpc('record_sponsor_event', { p_company_id: companyId, p_placement: placement, p_kind: kind })
    .then(({ error }) => {
      if (error) console.warn('協賛の記録に失敗しました', error.message)
    })
}
