'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

type JzelState = 'idle' | 'thinking' | 'talking' | 'happy'
type JzelTheme = 'light' | 'dark' | 'auto'

type JzelAvatarProps = {
  state?: JzelState
  message?: string
  name?: string
  size?: number
  idleAfterMs?: number
  showBubble?: boolean
  theme?: JzelTheme
}

const VALID_STATES: JzelState[] = ['idle', 'thinking', 'talking', 'happy']
// All 12 designed poses (docmee-pet-01..12.png), cycled while idle so J.zel feels alive.
const DOCMEE_POSES = Array.from(
  { length: 12 },
  (_, i) => `/pets/docmee-pet-${String(i + 1).padStart(2, '0')}.png`,
)
const DOCMEE_AVATAR_HAPPY_SRC = '/pets/docmee-pet-02.png' // waving
const DOCMEE_AVATAR_THINKING_SRC = '/pets/docmee-pet-03.png' // reading tablet
const STATE_POSE: Record<JzelState, 'idle' | 'happy' | 'thinking'> = {
  idle: 'idle',
  happy: 'happy',
  thinking: 'thinking',
  talking: 'idle',
}
const STATE_ANIM: Record<JzelState, string> = {
  idle: 'jz-anim-idle',
  happy: 'jz-anim-happy',
  thinking: 'jz-anim-thinking',
  talking: 'jz-anim-talking',
}

function Typing() {
  return (
    <span className="jz-typing" aria-label="working">
      <i />
      <i />
      <i />
    </span>
  )
}

function defaultBubble(state: JzelState, name: string) {
  switch (state) {
    case 'thinking':
      return { label: 'Working', node: <Typing /> }
    case 'talking':
      return { label: name, node: 'On it - pulling that together.' }
    case 'happy':
      return { label: 'Done', node: 'All set' }
    default:
      return null
  }
}

function useResolvedTheme(pref: JzelTheme) {
  const read = useCallback((): 'light' | 'dark' => {
    if (pref === 'light' || pref === 'dark') return pref
    if (typeof document === 'undefined') return 'light'
    try {
      const stored = window.localStorage?.getItem('docmee-theme')
      if (stored === 'light' || stored === 'dark') return stored
    } catch {
      return 'light'
    }

    const root = document.documentElement
    const attr = root.getAttribute('data-theme')
    if (attr === 'light' || attr === 'dark') return attr
    if (root.classList.contains('dark')) return 'dark'
    return 'light'
  }, [pref])

  const [theme, setTheme] = useState<'light' | 'dark'>(read)

  useEffect(() => {
    setTheme(read())
    if (pref === 'light' || pref === 'dark' || typeof document === 'undefined') return

    const update = () => setTheme(read())
    window.addEventListener('storage', update)
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })

    return () => {
      window.removeEventListener('storage', update)
      observer.disconnect()
    }
  }, [pref, read])

  return theme
}

function buildBubble(state: JzelState, message: string | undefined, name: string) {
  if (state === 'idle') return null
  const fallback = defaultBubble(state, name) ?? { label: name, node: '' }
  return { label: fallback.label, node: message ?? fallback.node }
}

function Pose({
  id,
  poseKey,
  state,
  src,
  alt,
  width,
  imgRef,
}: {
  id: 'idle' | 'happy' | 'thinking'
  poseKey: 'idle' | 'happy' | 'thinking'
  state: JzelState
  src: string
  alt: string
  width: number
  imgRef?: RefObject<HTMLImageElement | null>
}) {
  const show = id === poseKey
  const animClass = show ? STATE_ANIM[state] : ''

  return (
    <div className={`jz-pose jz-${id}${show ? ` jz-show ${animClass}` : ''}`}>
      <img ref={imgRef} src={src} alt={alt} style={{ width }} draggable={false} />
    </div>
  )
}

export function JzelAvatar({
  state = 'idle',
  message,
  name = 'J.zel',
  size = 180,
  idleAfterMs = 60000,
  showBubble = true,
  theme = 'auto',
}: JzelAvatarProps) {
  const resolvedTheme = useResolvedTheme(theme)
  const safeState = VALID_STATES.includes(state) ? state : 'idle'
  const [cycleIdx, setCycleIdx] = useState(0)
  const lastActivityRef = useRef(Date.now())
  const [ambientState, setAmbientState] = useState<JzelState | null>(null)

  const effective = ambientState ?? safeState
  const poseKey = STATE_POSE[effective]

  useEffect(() => {
    lastActivityRef.current = Date.now()
    setAmbientState(null)
  }, [state, message])

  // Preload every pose once so swaps don't flash.
  useEffect(() => {
    DOCMEE_POSES.forEach((src) => {
      const im = new window.Image()
      im.src = src
    })
  }, [])

  // While idle, change pose every 120s (float + sway keeps running via CSS).
  useEffect(() => {
    if (STATE_POSE[effective] !== 'idle') return
    const id = setInterval(() => {
      setCycleIdx((i) => (i + 1) % DOCMEE_POSES.length)
    }, 120000)
    return () => clearInterval(id)
  }, [effective])

  useEffect(() => {
    if (!idleAfterMs) return
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= idleAfterMs) {
        setAmbientState('happy')
        setTimeout(() => {
          if (Date.now() - lastActivityRef.current >= idleAfterMs) setAmbientState(null)
        }, 2200)
      }
    }, idleAfterMs)
    return () => clearInterval(id)
  }, [idleAfterMs])

  const bubble = showBubble ? buildBubble(effective, message, name) : null

  return (
    <div
      className={`jz-stage jz-theme-${resolvedTheme}`}
      style={{ '--jz-size': `${size}px` } as CSSProperties}
      role="img"
      aria-label={`${name} assistant, ${effective}`}
    >
      {bubble && (
        <div className="jz-bubble jz-show">
          <span className="jz-label">{bubble.label}</span>
          <span className="jz-text">{bubble.node}</span>
        </div>
      )}

      <div className="jz-avatar">
        <Pose id="idle" poseKey={poseKey} state={effective} src={DOCMEE_POSES[cycleIdx]} alt={name} width={size} />
        <Pose id="happy" poseKey={poseKey} state={effective} src={DOCMEE_AVATAR_HAPPY_SRC} alt={`${name} happy`} width={size} />
        <Pose
          id="thinking"
          poseKey={poseKey}
          state={effective}
          src={DOCMEE_AVATAR_THINKING_SRC}
          alt={`${name} thinking`}
          width={size}
        />

        <div className={`jz-sparks${effective === 'happy' ? ' jz-on' : ''}`}>
          <div className="jz-spark jz-sp1" />
          <div className="jz-spark jz-sp2" />
          <div className="jz-spark jz-sp3" />
          <div className="jz-spark jz-sp4" />
        </div>
        <div className={`jz-wave${effective === 'talking' ? ' jz-on' : ''}`}>
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="jz-gloss" />
      </div>
    </div>
  )
}
