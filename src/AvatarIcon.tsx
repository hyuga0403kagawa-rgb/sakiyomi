/** UniPortの初期アバター(アプリアイコンの色違い5種)。
 *  写真が設定されていればそれを丸く表示する。 */

export const AVATAR_IDS = ['icon:1', 'icon:2', 'icon:3', 'icon:4', 'icon:5']

const PALETTES: Record<string, { arch: string; face: string; feat: string }> = {
  'icon:1': { arch: '#5B4FE6', face: '#FBCF47', feat: '#322E63' }, // 定番むらさき
  'icon:2': { arch: '#EC4899', face: '#FDE68A', feat: '#7C2250' }, // ピンク
  'icon:3': { arch: '#14B8A6', face: '#FDE047', feat: '#134E4A' }, // ミント
  'icon:4': { arch: '#F97316', face: '#FEF3C7', feat: '#7C2D12' }, // オレンジ
  'icon:5': { arch: '#3B82F6', face: '#FCD34D', feat: '#1E3A5F' }, // ブルー
}

export default function AvatarIcon(props: {
  avatar?: string
  avatarUrl?: string
  size?: number
}) {
  const { avatar, avatarUrl, size = 48 } = props

  if (avatar === 'photo' && avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt="プロフィール画像"
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }

  const p = PALETTES[avatar ?? 'icon:1'] ?? PALETTES['icon:1']
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className="rounded-full"
      role="img"
      aria-label="アバター"
    >
      <rect width="512" height="512" fill="#ffffff" />
      <path
        d="M158 378 L158 236 A98 98 0 0 1 354 236 L354 378"
        fill="none"
        stroke={p.arch}
        strokeWidth="92"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="256" cy="306" r="49" fill={p.face} />
      <circle cx="239" cy="298" r="6.5" fill={p.feat} />
      <circle cx="273" cy="298" r="6.5" fill={p.feat} />
      <path
        d="M240 312 Q256 326 272 312"
        fill="none"
        stroke={p.feat}
        strokeWidth="5.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
