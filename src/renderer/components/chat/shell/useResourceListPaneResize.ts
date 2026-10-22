import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import { useWindowScopedPersistCache } from '@renderer/hooks/useWindowScopedPersistCache'

import {
  getResourceListPaneWidthPolicy,
  RESOURCE_LIST_PANE_CACHE_KEY,
  RESOURCE_LIST_PANE_WINDOW_CACHE_KEY,
  RESOURCE_LIST_RIGHT_PANE_CACHE_KEY,
  RESOURCE_LIST_RIGHT_PANE_WINDOW_CACHE_KEY,
  type ResourceListPaneWidthPolicy,
  type ResourceListPaneWidthPreset
} from './paneLayout'

export function clampResourceListPaneWidth(
  width: number,
  policy: ResourceListPaneWidthPolicy = getResourceListPaneWidthPolicy('assistant')
): number {
  return Math.min(policy.maxWidth, Math.max(policy.minWidth, Math.round(width)))
}

interface ResourceListPaneResizeOptions {
  onPaneCollapse?: () => void
  widthPreset?: ResourceListPaneWidthPreset
}

export function useResourceListPaneResize({
  onPaneCollapse,
  widthPreset = 'assistant'
}: ResourceListPaneResizeOptions = {}) {
  const widthPolicy = getResourceListPaneWidthPolicy(widthPreset)
  // Both pairs are subscribed unconditionally (hooks cannot be conditional); the preset selects one.
  const assistantPair = useWindowScopedPersistCache(RESOURCE_LIST_PANE_CACHE_KEY, RESOURCE_LIST_PANE_WINDOW_CACHE_KEY)
  const topicsPair = useWindowScopedPersistCache(
    RESOURCE_LIST_RIGHT_PANE_CACHE_KEY,
    RESOURCE_LIST_RIGHT_PANE_WINDOW_CACHE_KEY
  )
  const [storedWidth, setStoredWidth] = widthPreset === 'topics' ? topicsPair : assistantPair
  const paneRef = useRef<HTMLDivElement>(null)
  const pendingPaneCollapseRef = useRef(false)
  const dragStateRef = useRef({ paneLeft: 0, startClientX: 0 })
  const paneWidth = clampResourceListPaneWidth(storedWidth ?? widthPolicy.defaultWidth, widthPolicy)

  useLayoutEffect(() => {
    document.documentElement.style.setProperty(widthPolicy.cssVar, `${paneWidth}px`)
  }, [paneWidth, widthPolicy.cssVar])

  const handleMouseMove = useCallback(
    (moveEvent: MouseEvent, stop: () => void) => {
      const { paneLeft, startClientX } = dragStateRef.current
      const nextWidth = moveEvent.clientX - paneLeft
      const dragDelta = moveEvent.clientX - startClientX
      if (
        widthPolicy.collapseEnabled &&
        nextWidth < widthPolicy.minWidth &&
        dragDelta <= -widthPolicy.collapseDragThreshold
      ) {
        setStoredWidth(widthPolicy.defaultWidth)
        pendingPaneCollapseRef.current = true
        stop()
        return
      }
      setStoredWidth(clampResourceListPaneWidth(nextWidth, widthPolicy))
    },
    [setStoredWidth, widthPolicy]
  )

  const { isResizing, startResizing: startResizeDrag } = useResizeDrag({ onMove: handleMouseMove })

  useEffect(() => {
    if (isResizing || !pendingPaneCollapseRef.current) return

    pendingPaneCollapseRef.current = false
    onPaneCollapse?.()
  }, [isResizing, onPaneCollapse])

  const startResizing = useCallback(
    (event: ReactMouseEvent) => {
      dragStateRef.current = {
        paneLeft: paneRef.current?.getBoundingClientRect().left ?? 0,
        startClientX: event.clientX
      }
      startResizeDrag(event)
    },
    [startResizeDrag]
  )

  const setPaneWidth = useCallback(
    (nextWidth: number) => setStoredWidth(clampResourceListPaneWidth(nextWidth, widthPolicy)),
    [setStoredWidth, widthPolicy]
  )

  return {
    isResizing,
    paneRef,
    paneWidth,
    startResizing,
    setPaneWidth
  }
}
