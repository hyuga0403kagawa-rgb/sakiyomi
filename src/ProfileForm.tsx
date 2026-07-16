import { useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import type { Settings } from './types'
import { supabase } from './supabase'
import AvatarIcon, { AVATAR_IDS } from './AvatarIcon'
import AvatarCropper from './AvatarCropper'
import { UNIVERSITIES } from './universities'

/** トリミング済みのBlobを256pxでアップロードし、公開URLを返す */
async function uploadAvatarBlob(blob: Blob): Promise<string> {
  const { data: userData } = await supabase.auth.getUser()
  const uid = userData.user?.id
  if (!uid) throw new Error('ログインしていません')
  const path = `${uid}.jpg`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw new Error('アップロードに失敗しました')
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return `${data.publicUrl}?t=${Date.now()}`
}

const GRADES = ['1年', '2年', '3年', '4年', '5年', '6年', '大学院', 'その他']

/** プロフィール編集フォーム(初回設定と「その他」タブの編集で共用) */
export default function ProfileForm(props: {
  settings: Settings
  onSave: (s: Settings) => Promise<void> | void
  onFlash: (text: string) => void
  submitLabel?: string
}) {
  const { settings, onSave, onFlash, submitLabel = '保存' } = props
  const [nickname, setNickname] = useState(settings.nickname ?? '')
  const [university, setUniversity] = useState(settings.university ?? '')
  const [faculty, setFaculty] = useState(settings.faculty ?? '')
  const [department, setDepartment] = useState(settings.department ?? '')
  const [grade, setGrade] = useState(settings.grade ?? '')
  const [avatar, setAvatar] = useState(settings.avatar ?? 'icon:1')
  const [avatarUrl, setAvatarUrl] = useState(settings.avatarUrl)
  const [busy, setBusy] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const universityNames = UNIVERSITIES.filter((u) => u.url !== 'custom').map((u) => u.name)

  const onCropped = async (blob: Blob) => {
    setCropFile(null)
    setBusy(true)
    try {
      const url = await uploadAvatarBlob(blob)
      setAvatarUrl(url)
      setAvatar('photo')
      onFlash('写真を設定しました')
    } catch (e) {
      onFlash(e instanceof Error ? e.message : '写真の設定に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!nickname.trim()) {
      onFlash('ニックネームを入力してください')
      return
    }
    setBusy(true)
    try {
      await onSave({
        ...settings,
        nickname: nickname.trim(),
        university: university.trim() || undefined,
        faculty: faculty.trim() || undefined,
        department: department.trim() || undefined,
        grade: grade || undefined,
        avatar,
        avatarUrl,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {cropFile && (
        <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onCropped={onCropped} />
      )}
      <div>
        <span className="text-sm font-medium text-gray-700">アイコン</span>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {AVATAR_IDS.map((id) => (
            <button
              key={id}
              onClick={() => setAvatar(id)}
              className={`rounded-full p-0.5 ${
                avatar === id ? 'ring-2 ring-primary' : 'ring-1 ring-gray-200'
              }`}
              aria-label={`アイコン${id}`}
            >
              <AvatarIcon avatar={id} size={44} />
            </button>
          ))}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className={`rounded-full p-0.5 ${
              avatar === 'photo' ? 'ring-2 ring-primary' : 'ring-1 ring-gray-200'
            }`}
            aria-label="写真を選ぶ"
          >
            {avatar === 'photo' && avatarUrl ? (
              <AvatarIcon avatar="photo" avatarUrl={avatarUrl} size={44} />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100">
                <Camera className="h-5 w-5 text-gray-500" />
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setCropFile(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">
          ニックネーム <span className="text-red-500">*</span>
        </span>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="例: 山田太郎"
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">大学名</span>
        <input
          value={university}
          onChange={(e) => setUniversity(e.target.value)}
          list="profile-universities"
          placeholder="例: ○○大学"
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <datalist id="profile-universities">
          {universityNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">学部</span>
          <input
            value={faculty}
            onChange={(e) => setFaculty(e.target.value)}
            placeholder="例: ○○学部"
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">学科・コース</span>
          <input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="例: ○○学科 / ○○コース"
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">学年</span>
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
        >
          <option value="">選択してください</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={save}
        disabled={busy}
        className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? '保存中…' : submitLabel}
      </button>
    </div>
  )
}
