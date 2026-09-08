import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'

type Options = {
  fallback?: string
  maxStack?: number
}

type StackState = {
  stack: string[]
  index: number
}

const NAV_STACK_KEY = 'docmee-platform-nav-stack'
const NAV_STACK_INDEX_KEY = 'docmee-platform-nav-index'
const DEFAULT_MAX_STACK = 25

function clampToStack(stack: string[], maxStack: number): string[] {
  return stack.filter(Boolean).slice(-maxStack)
}

function fallbackRoute(route: string | undefined): string {
  return route && route.trim() ? route : '/'
}

function safeParseStack(raw: string | null, maxStack: number): StackState | null {
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      const stack = clampToStack(parsed, maxStack)
      return {
        stack,
        index: stack.length ? stack.length - 1 : 0,
      }
    }
  } catch {
    return null
  }
  return null
}

function readStackState(maxStack: number): StackState | null {
  const raw = sessionStorage.getItem(NAV_STACK_KEY)
  const rawIndex = sessionStorage.getItem(NAV_STACK_INDEX_KEY)

  const parsed = safeParseStack(raw, maxStack)
  if (!parsed) return null

  const index = Number.parseInt(rawIndex ?? '', 10)
  if (!Number.isFinite(index) || index < 0 || index >= parsed.stack.length) {
    return null
  }

  return {
    ...parsed,
    index,
  }
}

function writeStackState(stack: string[], index: number) {
  sessionStorage.setItem(NAV_STACK_KEY, JSON.stringify(stack))
  sessionStorage.setItem(NAV_STACK_INDEX_KEY, String(index))
}

export function usePlatformBack({ fallback, maxStack = DEFAULT_MAX_STACK }: Options = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const stackRef = useRef<string[]>([])
  const indexRef = useRef<number>(-1)

  const currentPath = `${pathname}${searchParams.toString() ? `?${searchParams}` : ''}`
  const safeFallback = fallbackRoute(fallback)

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const saved = readStackState(maxStack)
      const normalized = currentPath || '/'

      if (!saved || saved.stack.length === 0) {
        const initial = [normalized]
        stackRef.current = initial
        indexRef.current = 0
        writeStackState(initial, 0)
        return
      }

      const stack = [...saved.stack]
      let index = saved.index

      if (normalized === stack[index]) {
        stackRef.current = stack
        indexRef.current = index
        return
      }

      if (index < stack.length - 1 && stack[index + 1] === normalized) {
        index += 1
      } else if (index > 0 && stack[index - 1] === normalized) {
        index -= 1
      } else {
        stack.splice(index + 1)
        stack.push(normalized)
        if (stack.length > maxStack) stack.shift()
        index = stack.length - 1
      }

      stackRef.current = stack
      indexRef.current = index
      writeStackState(stack, index)
    } catch {
      const initial = ['/']
      stackRef.current = initial
      indexRef.current = 0
      writeStackState(initial, 0)
    }
  }, [currentPath, maxStack])

  const goBack = useCallback(
    (overrideFallback?: string, forceFallback = false) => {
      if (typeof window === 'undefined') {
        router.push(overrideFallback ?? safeFallback)
        return
      }

      const stack = [...stackRef.current]
      const index = indexRef.current
      const forcedDestination = overrideFallback ? fallbackRoute(overrideFallback) : safeFallback
      const canGoBack = index > 0 && stack.length > 1
      const destination = forceFallback || !canGoBack ? forcedDestination : stack[index - 1]

      if (!forceFallback && canGoBack) {
        const nextIndex = index - 1
        stackRef.current = stack
        indexRef.current = nextIndex
        writeStackState(stack, nextIndex)
      } else {
        stackRef.current = [destination]
        indexRef.current = 0
        writeStackState([destination], 0)
      }

      router.push(destination)
    },
    [safeFallback, router],
  )

  return { goBack }
}
