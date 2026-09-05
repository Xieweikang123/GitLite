import { useCallback, useSyncExternalStore } from 'react'

export type MinimapConfig = {
  enabled: boolean
  side: 'right' | 'left'
  scale: number // 1 | 2 | 3
  showSlider: 'always' | 'mouseover'
  renderCharacters: boolean
  maxColumn: number
  // Monaco 完整选项
  autohide: 'none' | 'mouseover' | 'scroll'
  size: 'proportional' | 'fill' | 'fit'
  showRegionSectionHeaders: boolean
  showMarkSectionHeaders: boolean
  sectionHeaderFontSize: number
  sectionHeaderLetterSpacing: number
}

export const MINIMAP_STORAGE_KEY = 'gitlite:monaco:minimap'
export const MINIMAP_STORAGE_EVENT = 'gitlite:minimap-config-changed'

export const DEFAULT_MINIMAP_CONFIG: MinimapConfig = {
  enabled: true,
  side: 'right',
  scale: 1,
  showSlider: 'always',
  renderCharacters: false,
  maxColumn: 120,
  autohide: 'none',
  size: 'proportional',
  showRegionSectionHeaders: true,
  showMarkSectionHeaders: true,
  sectionHeaderFontSize: 9,
  sectionHeaderLetterSpacing: 1,
}

function parseConfig(raw: string | null): MinimapConfig {
  if (!raw) return { ...DEFAULT_MINIMAP_CONFIG }
  try {
    const j = JSON.parse(raw) as Partial<MinimapConfig>
    return {
      enabled: typeof j.enabled === 'boolean' ? j.enabled : DEFAULT_MINIMAP_CONFIG.enabled,
      side: j.side === 'left' ? 'left' : 'right',
      scale: typeof j.scale === 'number' && [1, 2, 3].includes(j.scale) ? j.scale : DEFAULT_MINIMAP_CONFIG.scale,
      showSlider: j.showSlider === 'mouseover' ? 'mouseover' : 'always',
      renderCharacters: typeof j.renderCharacters === 'boolean' ? j.renderCharacters : DEFAULT_MINIMAP_CONFIG.renderCharacters,
      maxColumn: typeof j.maxColumn === 'number' && Number.isFinite(j.maxColumn) ? Math.max(40, Math.min(500, Math.round(j.maxColumn))) : DEFAULT_MINIMAP_CONFIG.maxColumn,
      autohide: j.autohide === 'mouseover' || j.autohide === 'scroll' ? j.autohide : 'none',
      size: j.size === 'fill' || j.size === 'fit' ? j.size : 'proportional',
      showRegionSectionHeaders: typeof j.showRegionSectionHeaders === 'boolean' ? j.showRegionSectionHeaders : DEFAULT_MINIMAP_CONFIG.showRegionSectionHeaders,
      showMarkSectionHeaders: typeof j.showMarkSectionHeaders === 'boolean' ? j.showMarkSectionHeaders : DEFAULT_MINIMAP_CONFIG.showMarkSectionHeaders,
      sectionHeaderFontSize: typeof j.sectionHeaderFontSize === 'number' && Number.isFinite(j.sectionHeaderFontSize) ? Math.max(6, Math.min(24, Math.round(j.sectionHeaderFontSize))) : DEFAULT_MINIMAP_CONFIG.sectionHeaderFontSize,
      sectionHeaderLetterSpacing: typeof j.sectionHeaderLetterSpacing === 'number' && Number.isFinite(j.sectionHeaderLetterSpacing) ? Math.max(0, Math.min(5, Math.round(j.sectionHeaderLetterSpacing))) : DEFAULT_MINIMAP_CONFIG.sectionHeaderLetterSpacing,
    }
  } catch {
    return { ...DEFAULT_MINIMAP_CONFIG }
  }
}

// cache snapshot to satisfy useSyncExternalStore requirement: same reference if raw unchanged
let cachedRaw: string | null | undefined
let cachedConfig: MinimapConfig | null = null

function getSnapshot(): MinimapConfig {
  if (typeof window === 'undefined') return DEFAULT_MINIMAP_CONFIG
  const raw = localStorage.getItem(MINIMAP_STORAGE_KEY)
  if (raw === cachedRaw && cachedConfig) return cachedConfig
  cachedRaw = raw
  cachedConfig = parseConfig(raw)
  return cachedConfig
}

function getServerSnapshot(): MinimapConfig {
  return DEFAULT_MINIMAP_CONFIG
}

function writeStored(c: MinimapConfig) {
  try {
    const raw = JSON.stringify(c)
    // update cache synchronously so next getSnapshot returns same ref
    cachedRaw = raw
    cachedConfig = { ...c }
    localStorage.setItem(MINIMAP_STORAGE_KEY, raw)
    window.dispatchEvent(new CustomEvent(MINIMAP_STORAGE_EVENT))
  } catch { /* 忽略存储失败 */ }
}

function subscribeMinimap(cb: () => void) {
  window.addEventListener(MINIMAP_STORAGE_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(MINIMAP_STORAGE_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

export function useMinimapConfig() {
  const config = useSyncExternalStore(subscribeMinimap, getSnapshot, getServerSnapshot)

  const update = useCallback((patch: Partial<MinimapConfig>) => {
    const current = getSnapshot()
    const next = { ...current, ...patch }
    if (typeof next.scale === 'number') next.scale = Math.max(1, Math.min(3, Math.round(next.scale)))
    if (typeof next.maxColumn === 'number') next.maxColumn = Math.max(40, Math.min(500, Math.round(next.maxColumn)))
    if (typeof next.sectionHeaderFontSize === 'number') next.sectionHeaderFontSize = Math.max(6, Math.min(24, Math.round(next.sectionHeaderFontSize)))
    if (typeof next.sectionHeaderLetterSpacing === 'number') next.sectionHeaderLetterSpacing = Math.max(0, Math.min(5, Math.round(next.sectionHeaderLetterSpacing)))
    writeStored(next)
  }, [])

  const set = useCallback((c: MinimapConfig) => {
    writeStored(c)
  }, [])

  const reset = useCallback(() => {
    writeStored({ ...DEFAULT_MINIMAP_CONFIG })
  }, [])

  return { config, update, set, reset }
}
