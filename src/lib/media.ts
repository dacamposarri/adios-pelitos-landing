import type { Clip } from '../types'

export function loadVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const d = Number.isFinite(video.duration) ? video.duration : 0
      URL.revokeObjectURL(url)
      resolve(d)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer el video'))
    }
    video.src = url
  })
}

export async function createClip(file: File): Promise<Clip> {
  const duration = await loadVideoDuration(file)
  return {
    id: crypto.randomUUID(),
    name: file.name,
    file,
    url: URL.createObjectURL(file),
    duration,
    trimStart: 0,
    trimEnd: duration,
  }
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toFixed(1).padStart(4, '0')}`
}
