import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { downloadBlob, exportProject } from './lib/exportVideo'
import { createClip, formatTime } from './lib/media'
import {
  clipDuration,
  totalDuration,
  type Clip,
  type Project,
  type TextLayer,
} from './types'

const ASPECTS: Project['aspect'][] = ['9:16', '16:9', '1:1']

function newText(end: number): TextLayer {
  return {
    id: crypto.randomUUID(),
    text: 'Tu texto aquí',
    start: 0,
    end: Math.max(1, end || 3),
    x: 50,
    y: 78,
    fontSize: 64,
    color: '#f2f0eb',
  }
}

export default function App() {
  const [clips, setClips] = useState<Clip[]>([])
  const [texts, setTexts] = useState<TextLayer[]>([])
  const [aspect, setAspect] = useState<Project['aspect']>('9:16')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<{ tone: 'ok' | 'err' | ''; msg: string }>({
    tone: '',
    msg: '',
  })
  const [dropActive, setDropActive] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef(0)
  const playOriginRef = useRef({ timeline: 0, wall: 0 })

  const duration = useMemo(() => totalDuration(clips), [clips])
  const activeText = texts[0] ?? null

  const findClipAt = useCallback(
    (t: number) => {
      let acc = 0
      for (const clip of clips) {
        const d = clipDuration(clip)
        if (t < acc + d) {
          return { clip, local: clip.trimStart + (t - acc), offset: acc }
        }
        acc += d
      }
      const last = clips[clips.length - 1]
      if (!last) return null
      return {
        clip: last,
        local: last.trimEnd,
        offset: duration - clipDuration(last),
      }
    },
    [clips, duration],
  )

  const syncVideoToPlayhead = useCallback(
    (t: number) => {
      const hit = findClipAt(t)
      const video = videoRef.current
      if (!hit || !video) return
      const absoluteUrl = hit.clip.url
      if (!video.src.endsWith(absoluteUrl) && video.src !== absoluteUrl) {
        video.src = absoluteUrl
        video.currentTime = hit.local
        if (playing) void video.play().catch(() => undefined)
      } else if (Math.abs(video.currentTime - hit.local) > 0.15) {
        video.currentTime = hit.local
      }
      setSelectedId(hit.clip.id)
    },
    [findClipAt, playing],
  )

  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current)
      videoRef.current?.pause()
      return
    }
    playOriginRef.current = { timeline: playhead, wall: performance.now() }
    const video = videoRef.current
    if (video) void video.play().catch(() => undefined)

    const loop = (now: number) => {
      const elapsed = (now - playOriginRef.current.wall) / 1000
      let next = playOriginRef.current.timeline + elapsed
      if (next >= duration) {
        setPlayhead(duration)
        setPlaying(false)
        return
      }
      setPlayhead(next)
      syncVideoToPlayhead(next)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
    // playhead is sampled once when playback starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration, syncVideoToPlayhead])

  useEffect(() => {
    if (!playing) syncVideoToPlayhead(playhead)
  }, [playhead, playing, syncVideoToPlayhead, clips])

  useEffect(() => {
    return () => {
      clips.forEach((c) => URL.revokeObjectURL(c.url))
    }
    // revoke object URLs only on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith('video/'))
    if (list.length === 0) {
      setStatus({ tone: 'err', msg: 'Elige archivos de video (mp4, webm, mov…).' })
      return
    }
    try {
      const created = await Promise.all(list.map(createClip))
      setClips((prev) => {
        const next = [...prev, ...created]
        if (!selectedId) setSelectedId(created[0]?.id ?? null)
        return next
      })
      setStatus({ tone: 'ok', msg: `${created.length} clip(s) agregados.` })
    } catch {
      setStatus({ tone: 'err', msg: 'No se pudieron leer algunos videos.' })
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDropActive(false)
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files)
  }

  function updateClip(id: string, patch: Partial<Clip>) {
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c
        const next = { ...c, ...patch }
        next.trimStart = Math.max(0, Math.min(next.trimStart, next.duration - 0.1))
        next.trimEnd = Math.max(next.trimStart + 0.1, Math.min(next.trimEnd, next.duration))
        return next
      }),
    )
  }

  function moveClip(id: string, dir: -1 | 1) {
    setClips((prev) => {
      const i = prev.findIndex((c) => c.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const copy = [...prev]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
  }

  function removeClip(id: string) {
    setClips((prev) => {
      const target = prev.find((c) => c.id === id)
      if (target) URL.revokeObjectURL(target.url)
      const next = prev.filter((c) => c.id !== id)
      if (selectedId === id) setSelectedId(next[0]?.id ?? null)
      return next
    })
  }

  function updateText(patch: Partial<TextLayer>) {
    setTexts((prev) => {
      if (prev.length === 0) return [{ ...newText(duration), ...patch }]
      return prev.map((t, i) => (i === 0 ? { ...t, ...patch } : t))
    })
  }

  async function handleExport() {
    if (clips.length === 0 || exporting) return
    setExporting(true)
    setPlaying(false)
    setProgress(0)
    setStatus({ tone: '', msg: 'Exportando… sin marca de agua.' })
    try {
      const blob = await exportProject({ clips, texts, aspect }, setProgress)
      downloadBlob(blob, `corte-${Date.now()}.webm`)
      setStatus({ tone: 'ok', msg: 'Listo. Video descargado sin marca de agua.' })
    } catch (err) {
      setStatus({
        tone: 'err',
        msg: err instanceof Error ? err.message : 'Falló la exportación',
      })
    } finally {
      setExporting(false)
    }
  }

  const visibleTexts = texts.filter((t) => playhead >= t.start && playhead <= t.end)

  if (clips.length === 0) {
    return (
      <div
        className={`app hero${dropActive ? ' drop-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDropActive(true)
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={onDrop}
      >
        <div className="hero-inner">
          <p className="brand">CORTE</p>
          <h1 className="tagline">Edita y exporta sin marca de agua</h1>
          <p className="sub">
            Sube tus clips, ordénalos en la timeline, agrega texto y descarga el resultado limpio.
          </p>
          <div className="cta-row">
            <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>
              Subir videos
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => document.getElementById('how')?.scrollIntoView()}
            >
              Cómo funciona
            </button>
          </div>
          <p className="hint" id="how">
            Arrastra archivos aquí · Solo videos que tú poseas · Exportación local en el navegador
          </p>
        </div>
        <input
          ref={fileRef}
          className="sr-only"
          type="file"
          accept="video/*"
          multiple
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={`app workspace${dropActive ? ' drop-active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDropActive(true)
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="topbar-brand">
          COR<span>TE</span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            + Clips
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? 'Exportando…' : 'Descargar sin marca'}
          </button>
        </div>
      </header>

      <div className="stage">
        <section className="preview-shell">
          <div className="preview-frame">
            <div className="preview-aspect" data-aspect={aspect}>
              <video ref={videoRef} playsInline muted />
              {visibleTexts.map((t) => (
                <div
                  key={t.id}
                  className="overlay-text"
                  style={{
                    top: `${t.y}%`,
                    fontSize: `clamp(14px, ${t.fontSize / 18}px, 48px)`,
                    color: t.color,
                  }}
                >
                  {t.text}
                </div>
              ))}
            </div>
          </div>
          <div className="preview-controls">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (playhead >= duration) setPlayhead(0)
                setPlaying((p) => !p)
              }}
            >
              {playing ? 'Pausa' : 'Play'}
            </button>
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.05}
              value={Math.min(playhead, duration)}
              onChange={(e) => {
                setPlaying(false)
                setPlayhead(Number(e.target.value))
              }}
              style={{ flex: 1 }}
              aria-label="Posición"
            />
            <span className="time-label">
              {formatTime(playhead)} / {formatTime(duration)}
            </span>
          </div>
          {exporting && (
            <div className="progress-bar" style={{ margin: '0 1rem 0.75rem' }}>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </section>

        <aside className="side">
          <h2>Ajustes</h2>
          <div className="field">
            <label>Formato</label>
            <div className="chip-row">
              {ASPECTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className="chip"
                  data-active={aspect === a}
                  onClick={() => setAspect(a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <h2>Texto</h2>
          {!activeText ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setTexts([newText(duration)])}
            >
              Agregar texto
            </button>
          ) : (
            <>
              <div className="field">
                <label>Contenido</label>
                <textarea
                  value={activeText.text}
                  onChange={(e) => updateText({ text: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Color</label>
                <input
                  type="color"
                  value={activeText.color}
                  onChange={(e) => updateText({ color: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Inicio / fin (s)</label>
                <div className="trim-row">
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={activeText.start}
                    onChange={(e) => updateText({ start: Number(e.target.value) })}
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={activeText.end}
                    onChange={(e) => updateText({ end: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="field">
                <label>Posición vertical %</label>
                <input
                  type="range"
                  min={10}
                  max={90}
                  value={activeText.y}
                  onChange={(e) => updateText({ y: Number(e.target.value) })}
                />
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setTexts([])}>
                Quitar texto
              </button>
            </>
          )}

          {status.msg && (
            <p className="status" data-tone={status.tone}>
              {status.msg}
            </p>
          )}
        </aside>
      </div>

      <section className="timeline">
        <div className="timeline-head">
          <h2>Timeline</h2>
          <span className="status">{clips.length} clips · {formatTime(duration)}</span>
        </div>
        <div className="timeline-track">
          {clips.map((clip, index) => (
            <article
              key={clip.id}
              className="clip-card"
              data-active={clip.id === selectedId}
              onClick={() => {
                setSelectedId(clip.id)
                let acc = 0
                for (let i = 0; i < index; i++) acc += clipDuration(clips[i])
                setPlaying(false)
                setPlayhead(acc)
              }}
            >
              <div className="clip-name">{clip.name}</div>
              <div className="clip-meta">
                {formatTime(clipDuration(clip))} · orig {formatTime(clip.duration)}
              </div>
              <div className="trim-row">
                <input
                  type="number"
                  title="Inicio"
                  min={0}
                  max={clip.duration}
                  step={0.1}
                  value={Number(clip.trimStart.toFixed(1))}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateClip(clip.id, { trimStart: Number(e.target.value) })}
                />
                <input
                  type="number"
                  title="Fin"
                  min={0}
                  max={clip.duration}
                  step={0.1}
                  value={Number(clip.trimEnd.toFixed(1))}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateClip(clip.id, { trimEnd: Number(e.target.value) })}
                />
              </div>
              <div className="clip-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    moveClip(clip.id, -1)
                  }}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    moveClip(clip.id, 1)
                  }}
                >
                  →
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeClip(clip.id)
                  }}
                >
                  Borrar
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept="video/*"
        multiple
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
