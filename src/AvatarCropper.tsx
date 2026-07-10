import { useEffect, useRef, useState } from 'react'

/** 正方形フレーム内で写真の位置と大きさ(拡大率)を合わせてトリミングするモーダル。
 *  ドラッグで位置調整、スライダーで拡大率調整。確定で256px正方形のJPEGを返す。 */
export default function AvatarCropper(props: {
  file: File
  onCancel: () => void
  onCropped: (blob: Blob) => void
}) {
  const { file, onCancel, onCropped } = props
  const VIEW = 260 // プレビュー枠の一辺(px)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const i = new Image()
    i.onload = () => {
      setImg(i)
      setZoom(1)
      setOffset({ x: 0, y: 0 })
    }
    i.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  if (!img) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 text-white">
        読み込み中…
      </div>
    )
  }

  // 枠を「覆う」最小表示倍率
  const baseScale = VIEW / Math.min(img.width, img.height)
  const scale = baseScale * zoom
  const dispW = img.width * scale
  const dispH = img.height * scale

  // 画像が常に枠を覆うようにオフセットを制限
  const clamp = (o: { x: number; y: number }) => {
    const minX = VIEW - dispW
    const minY = VIEW - dispH
    return {
      x: Math.min(0, Math.max(minX, o.x)),
      y: Math.min(0, Math.max(minY, o.y)),
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setOffset(
      clamp({
        x: drag.current.ox + (e.clientX - drag.current.x),
        y: drag.current.oy + (e.clientY - drag.current.y),
      }),
    )
  }
  const onPointerUp = () => {
    drag.current = null
  }

  const changeZoom = (z: number) => {
    // 枠の中心を基準に拡大する
    const cx = VIEW / 2
    const cy = VIEW / 2
    const newScale = baseScale * z
    const ratio = newScale / scale
    setOffset(clamp({ x: cx - (cx - offset.x) * ratio, y: cy - (cy - offset.y) * ratio }))
    setZoom(z)
  }

  const confirm = () => {
    const out = 256
    const canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')!
    // 枠の左上に対応する元画像の座標
    const sx = -offset.x / scale
    const sy = -offset.y / scale
    const sSize = VIEW / scale
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, out, out)
    canvas.toBlob(
      (b) => {
        if (b) onCropped(b)
      },
      'image/jpeg',
      0.85,
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-4">
        <h3 className="text-center text-sm font-bold text-gray-800">写真の位置とサイズを調整</h3>
        <p className="mt-1 text-center text-xs text-gray-400">ドラッグで移動・スライダーで拡大</p>

        <div
          className="relative mx-auto mt-3 touch-none overflow-hidden rounded-full bg-gray-100"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            src={img.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none select-none"
            style={{
              width: dispW,
              height: dispH,
              left: offset.x,
              top: offset.y,
            }}
          />
          {/* 正方形/円のガイド枠 */}
          <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80" />
        </div>

        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => changeZoom(Number(e.target.value))}
          className="mt-4 w-full accent-indigo-600"
        />

        <div className="mt-3 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-200 py-2 text-sm text-gray-500"
          >
            キャンセル
          </button>
          <button
            onClick={confirm}
            className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white"
          >
            この範囲で決定
          </button>
        </div>
      </div>
    </div>
  )
}
