export type Clip = {
  id: string
  name: string
  file: File
  url: string
  duration: number
  trimStart: number
  trimEnd: number
}

export type TextLayer = {
  id: string
  text: string
  start: number
  end: number
  x: number
  y: number
  fontSize: number
  color: string
}

export type Project = {
  clips: Clip[]
  texts: TextLayer[]
  aspect: '9:16' | '16:9' | '1:1'
}

export function clipDuration(clip: Clip): number {
  return Math.max(0.1, clip.trimEnd - clip.trimStart)
}

export function totalDuration(clips: Clip[]): number {
  return clips.reduce((sum, c) => sum + clipDuration(c), 0)
}

export function aspectSize(aspect: Project['aspect']): { w: number; h: number } {
  if (aspect === '9:16') return { w: 1080, h: 1920 }
  if (aspect === '1:1') return { w: 1080, h: 1080 }
  return { w: 1920, h: 1080 }
}
