import { useEffect } from 'react'
import { Briefcase, ExternalLink, X } from 'lucide-react'
import type { Company } from './types'
import { recordSponsorEvent } from './sponsor'

/**
 * アプリを開いた最初に出す協賛企業(有料掲載)の案内。
 * 出すかどうかの判定は App 側(sponsor.ts のルール)。ここは表示と記録だけ。
 * 待ち時間は作らず、右上の×・下のボタン・背景のタップ・Escキーのどれでもすぐ閉じられる。
 */
export default function SponsorSplash(props: {
  company: Company
  onClose: () => void
  onOpenJobTab: () => void
}) {
  const { company: c, onClose, onOpenJobTab } = props

  useEffect(() => {
    recordSponsorEvent(c.id, 'open', 'impression')
  }, [c.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const details: [string, string | undefined][] = [
    ['募集職種', c.positions],
    ['説明会', c.seminarInfo],
    ['インターン', c.internInfo],
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`協賛企業のお知らせ: ${c.name}`}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-xs font-semibold text-gray-500">
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">PR</span>
            協賛企業
          </p>
          <button onClick={onClose} aria-label="閉じる" className="rounded-full p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <h2 className="mt-3 text-xl font-semibold text-gray-900">{c.name}</h2>
        {(c.industry || c.location) && (
          <p className="mt-0.5 text-sm text-gray-500">{[c.industry, c.location].filter(Boolean).join(' · ')}</p>
        )}

        {details.some(([, v]) => v) && (
          <dl className="mt-3 space-y-1 text-sm text-gray-700">
            {details.map(([label, value]) =>
              value ? (
                <div key={label} className="flex gap-2">
                  <dt className="shrink-0 text-gray-400">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ) : null,
            )}
          </dl>
        )}

        <div className="mt-5 space-y-2">
          {c.website && (
            <a
              href={c.website}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                recordSponsorEvent(c.id, 'open', 'tap')
                onClose()
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-sm font-semibold text-white"
            >
              公式サイトを見る
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <button
            onClick={() => {
              recordSponsorEvent(c.id, 'open', 'tap')
              onOpenJobTab()
            }}
            className={
              c.website
                ? 'flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700'
                : 'flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-sm font-semibold text-white'
            }
          >
            <Briefcase className="h-4 w-4" />
            就活タブで見る
          </button>
          <button onClick={onClose} className="w-full py-2 text-sm text-gray-500">
            閉じる
          </button>
        </div>

        <p className="mt-2 text-center text-[11px] text-gray-400">
          3年生以上の方に、1日1回だけ表示しています
        </p>
      </div>
    </div>
  )
}
