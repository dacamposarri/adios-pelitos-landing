import { aspectSize, clipDuration, type Project, type TextLayer } from '../types'

function waitEvent(el: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      cleanup()
      resolve()
    }
    const onErr = () => {
      cleanup()
      reject(new Error('Error de reproducción'))
    }
    const cleanup = () => {
      el.removeEventListener(event, onOk)
      el.removeEventListener('error', onErr)
    }
    el.addEventListener(event, onOk, { once: true })
    el.addEventListener('error', onErr, { once: true })
  })
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number,
) {
  const vw = video.videoWidth || w
  const vh = video.videoHeight || h
  const scale = Math.max(w / vw, h / vh)
  const dw = vw * scale
  const dh = vh * scale
  const dx = (w - dw) / 2
  const dy = (h - dh) / 2
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(video, dx, dy, dw, dh)
}

function drawTexts(
  ctx: CanvasRenderingContext2D,
  texts: TextLayer[],
  time: number,
  w: number,
  h: number,
) {
  for (const t of texts) {
    if (time < t.start || time > t.end) continue
    ctx.save()
    ctx.font = `700 ${t.fontSize}px Syne, sans-serif`
    ctx.fillStyle = t.color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,0.65)'
    ctx.shadowBlur = 12
    ctx.fillText(t.text, (t.x / 100) * w, (t.y / 100) * h)
    ctx.restore()
  }
}

export type ExportProgress = (ratio: number) => void

export async function exportProject(
  project: Project,
  onProgress?: ExportProgress,
): Promise<Blob> {
  const { clips, texts, aspect } = project
  if (clips.length === 0) throw new Error('Agrega al menos un clip')

  const { w, h } = aspectSize(aspect)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas no disponible')

  const stream = canvas.captureStream(30)
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm'
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 6_000_000,
  })
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
  })
  recorder.start(100)

  const total = clips.reduce((s, c) => s + clipDuration(c), 0)
  let timeline = 0

  for (const clip of clips) {
    const video = document.createElement('video')
    video.src = clip.url
    video.muted = true
    video.playsInline = true
    await waitEvent(video, 'loadeddata')
    video.currentTime = clip.trimStart
    await waitEvent(video, 'seeked')
    await video.play()

    const end = clip.trimEnd
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (video.currentTime >= end - 0.04 || video.ended || video.paused) {
          video.pause()
          resolve()
          return
        }
        drawCover(ctx, video, w, h)
        const local = timeline + (video.currentTime - clip.trimStart)
        drawTexts(ctx, texts, local, w, h)
        onProgress?.(Math.min(0.99, local / total))
        requestAnimationFrame(tick)
      }
      video.onerror = () => reject(new Error(`Falló ${clip.name}`))
      tick()
    })

    timeline += clipDuration(clip)
    video.removeAttribute('src')
    video.load()
  }

  // Hold last frame briefly so encoder flushes
  await new Promise((r) => setTimeout(r, 200))
  recorder.stop()
  onProgress?.(1)
  return done
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
