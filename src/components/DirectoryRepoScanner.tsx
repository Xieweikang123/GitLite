import React, { useState, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { open } from '@tauri-apps/api/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { MonacoDiffEditor } from './MonacoDiffEditor'
import Editor from '@monaco-editor/react'
import { getMonacoLanguageFromPath } from '@/utils/monacoLanguage'
import { DirectoryRepoEntry, CommitInfo, WorkspaceStatus } from '../types/git'
import { useMinimapConfig } from '@/utils/minimapConfig'
import { getClientCalendarOffsetEastMinutes } from '../utils/clientCalendarOffset'
import {
  FolderOpen,
  RefreshCw,
  Search,
  GitBranch,
  Folder,
  AlertCircle,
  Clock,
  Trash2,
  Layers,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  Link2,
  Unlink,
  ExternalLink,
  LogIn,
  Filter,
  Copy,
  Info,
  Download,
  Eye,
  FileText,
} from 'lucide-react'
import { shortenPathMiddle } from '../lib/utils'
import { formatTauriInvokeError } from '../utils/tauriError'

interface DirectoryRepoScannerProps {
  onOpenRepo: (path: string) => void
}

interface ScannedDirRecord {
  path: string
  last_scanned: string
  recursive: boolean
}

const RECENT_SCANNED_KEY = 'gitlite:recentScannedDirs'
const DETAIL_TAB_CACHE_KEY = 'gitlite:dirScanner:detailTabCache'
const EXPANDED_STATE_KEY = 'gitlite:dirScanner:expandedState'

function timeAgo(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}天前`
  return d.toLocaleDateString()
}

function subscribeDarkClass(cb: () => void) {
  const obs = new MutationObserver(cb)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => obs.disconnect()
}
function getDarkClass(): boolean {
  return document.documentElement.classList.contains('dark')
}

export function DirectoryRepoScanner({ onOpenRepo }: DirectoryRepoScannerProps) {
  const [dirPath, setDirPath] = useState('')
  const [recursive, setRecursive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<DirectoryRepoEntry[] | null>(null)
  const [scannedDir, setScannedDir] = useState<string | null>(null)
  const [recentScanned, setRecentScanned] = useState<ScannedDirRecord[]>([])
  const [restored, setRestored] = useState(false)
  const [filter, setFilter] = useState('')
  const [pullingPath, setPullingPath] = useState<string | null>(null)
  const [batchPulling, setBatchPulling] = useState(false)
  const [fetchingAll, setFetchingAll] = useState(false)
  const [fetchingPath, setFetchingPath] = useState<string | null>(null)
  const [fetchingPaths, setFetchingPaths] = useState<Set<string>>(new Set())
  const [fetchDoneCount, setFetchDoneCount] = useState(0)
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [activeDetailTab, setActiveDetailTab] = useState<'incoming' | 'outgoing' | 'workspace' | 'recent'>('incoming')
  const [detailTabCache, setDetailTabCache] = useState<Record<string, 'incoming' | 'outgoing' | 'workspace' | 'recent'>>({})
  const [incomingCache, setIncomingCache] = useState<Record<string, CommitInfo[]>>({})
  const [incomingLoading, setIncomingLoading] = useState<string | null>(null)
  const [outgoingCache, setOutgoingCache] = useState<Record<string, CommitInfo[]>>({})
  const [outgoingLoading, setOutgoingLoading] = useState<string | null>(null)
  const [workspaceCache, setWorkspaceCache] = useState<Record<string, WorkspaceStatus>>({})
  const [workspaceLoading, setWorkspaceLoading] = useState<string | null>(null)
  const [recentCache, setRecentCache] = useState<Record<string, CommitInfo[]>>({})
  const [recentLoading, setRecentLoading] = useState<string | null>(null)
  const [recentError, setRecentError] = useState<Record<string, string>>({})
  const [recentContextMenu, setRecentContextMenu] = useState<{ x: number; y: number; repoPath: string; commit: CommitInfo } | null>(null)
  const [detailFileMenu, setDetailFileMenu] = useState<{ x: number; y: number; filePath: string } | null>(null)
  const [detailCommit, setDetailCommit] = useState<{ repoPath: string; commit: CommitInfo } | null>(null)
  const [detailFiles, setDetailFiles] = useState<import('../types/git').FileChange[]>([])
  const [detailFilesLoading, setDetailFilesLoading] = useState(false)
  const [detailSelectedFile, setDetailSelectedFile] = useState<string | null>(null)
  const [detailDiff, setDetailDiff] = useState<string>('')
  const [detailDiffLoading, setDetailDiffLoading] = useState(false)
  const detailFilesListRef = React.useRef<HTMLDivElement>(null)
  const [wsDetail, setWsDetail] = useState<{ repoPath: string; filePath: string; kind: 'staged' | 'unstaged' | 'untracked' } | null>(null)
  const [wsDiff, setWsDiff] = useState<string>('')
  const [wsDiffLoading, setWsDiffLoading] = useState(false)
  const isDark = useSyncExternalStore(subscribeDarkClass, getDarkClass, () => false)
  const { config: minimapConfig } = useMinimapConfig()
  const minimapOptions = useMemo(() => ({
    enabled: minimapConfig.enabled,
    side: minimapConfig.side,
    scale: minimapConfig.scale,
    showSlider: minimapConfig.showSlider,
    renderCharacters: minimapConfig.renderCharacters,
    maxColumn: minimapConfig.maxColumn,
  }), [minimapConfig])

  const loadRecentScanned = useCallback(async () => {
    try {
      const list: ScannedDirRecord[] = await invoke('get_recent_scanned_dirs')
      setRecentScanned(list)
      return list
    } catch {
      try {
        const raw = localStorage.getItem(RECENT_SCANNED_KEY)
        if (raw) {
          const list = JSON.parse(raw) as ScannedDirRecord[]
          setRecentScanned(list)
          return list
        }
      } catch {}
      return []
    }
  }, [])

  const persistRecentScannedFallback = (path: string, rec: boolean) => {
    try {
      const raw = localStorage.getItem(RECENT_SCANNED_KEY)
      let list: ScannedDirRecord[] = raw ? JSON.parse(raw) : []
      list = list.filter((r) => r.path !== path)
      list.unshift({ path, last_scanned: new Date().toISOString(), recursive: rec })
      if (list.length > 20) list.length = 20
      localStorage.setItem(RECENT_SCANNED_KEY, JSON.stringify(list))
      setRecentScanned(list)
    } catch {}
  }

  useEffect(() => {
    void (async () => {
      const list = await loadRecentScanned()
      if (!restored && list.length > 0) {
        const latest = list[0]
        setDirPath(latest.path)
        setRecursive(latest.recursive)
        setRestored(true)
        try {
          const result: DirectoryRepoEntry[] = await invoke('scan_directory_repos', {
            dirPath: latest.path,
            recursive: latest.recursive,
            maxDepth: null,
          })
          setEntries(result)
          setScannedDir(latest.path)
        } catch {}
      } else if (!restored) {
        setRestored(true)
      }
    })()
  }, [loadRecentScanned, restored])

  // 恢复上次的展开状态与 tab 记忆
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DETAIL_TAB_CACHE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, 'incoming' | 'outgoing' | 'workspace' | 'recent'>
        if (parsed && typeof parsed === 'object') setDetailTabCache(parsed)
      }
      const raw2 = localStorage.getItem(EXPANDED_STATE_KEY)
      if (raw2) {
        const obj = JSON.parse(raw2) as { path: string | null; tab: 'incoming' | 'outgoing' | 'workspace' | 'recent' }
        if (obj?.path) {
          setExpandedPath(obj.path)
          if (obj.tab) setActiveDetailTab(obj.tab)
        }
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(DETAIL_TAB_CACHE_KEY, JSON.stringify(detailTabCache))
    } catch {}
  }, [detailTabCache])

  useEffect(() => {
    try {
      if (expandedPath) {
        localStorage.setItem(EXPANDED_STATE_KEY, JSON.stringify({ path: expandedPath, tab: activeDetailTab }))
      } else {
        localStorage.removeItem(EXPANDED_STATE_KEY)
      }
    } catch {}
  }, [expandedPath, activeDetailTab])

  const pickFolder = useCallback(async () => {
    const selected = await open({ directory: true, title: '选择要扫描的目录' })
    if (typeof selected === 'string') setDirPath(selected)
  }, [])

  const doScan = useCallback(
    async (targetPath?: string, recOverride?: boolean) => {
      const path = (targetPath ?? dirPath).trim()
      const rec = recOverride ?? recursive
      if (!path) {
        setError('请选择要扫描的目录')
        return
      }
      setLoading(true)
      setError(null)
      try {
        const result: DirectoryRepoEntry[] = await invoke('scan_directory_repos', {
          dirPath: path,
          recursive: rec,
          maxDepth: null,
        })
        setEntries(result)
        setScannedDir(path)
        try {
          await invoke('save_recent_scanned_dir', { path, recursive: rec })
          await loadRecentScanned()
        } catch {
          persistRecentScannedFallback(path, rec)
        }
      } catch (err) {
        setError(formatTauriInvokeError(err, '扫描失败'))
        setEntries(null)
      } finally {
        setLoading(false)
      }
    },
    [dirPath, recursive, loadRecentScanned]
  )

  const handleRefresh = useCallback(() => {
    if (scannedDir) {
      setWorkspaceCache({})
      setIncomingCache({})
      setOutgoingCache({})
      setRecentCache({})
      void doScan(scannedDir)
    }
  }, [scannedDir, doScan])

  const handlePull = useCallback(
    async (repoPath: string) => {
      const before = entries?.find((e) => e.path === repoPath)
      void invoke('append_gitlite_log', { level: 'INFO', message: `[DIAG][pull][multi] start path=${repoPath} beforeBehind=${before?.behind ?? '?'} beforeHead=${before?.head_short_id ?? '?'}` }).catch(()=>{})
      setPullingPath(repoPath)
      setError(null)
      try {
        await invoke('pull_changes', { repoPath })
        void invoke('append_gitlite_log', { level: 'INFO', message: `[DIAG][pull][multi] pull ok path=${repoPath}` }).catch(()=>{})
        // 拉取后缓存失效，否则待拉列表仍显示已拉取的提交
        setIncomingCache((m) => { const c={...m}; delete c[repoPath]; return c })
        setOutgoingCache((m) => { const c={...m}; delete c[repoPath]; return c })
        setRecentCache((m) => { const c={...m}; delete c[repoPath]; return c })
        setWorkspaceCache((m) => { const c={...m}; delete c[repoPath]; return c })
        if (scannedDir) await doScan(scannedDir)
        const after = entries?.find((e) => e.path === repoPath)
        void invoke('append_gitlite_log', { level: 'INFO', message: `[DIAG][pull][multi] after scan path=${repoPath} entriesBehind=${after?.behind ?? '?'}` }).catch(()=>{})
      } catch (err) {
        void invoke('append_gitlite_log', { level: 'ERROR', message: `[DIAG][pull][multi] fail path=${repoPath} err=${String(err)}` }).catch(()=>{})
        setError(formatTauriInvokeError(err, `拉取失败 ${shortenPathMiddle(repoPath, 40)}`))
      } finally {
        setPullingPath(null)
      }
    },
    [scannedDir, doScan, entries]
  )

  const handleBatchPull = useCallback(async () => {
    if (!entries || !scannedDir) return
    const needPull = entries.filter((e) => e.behind > 0)
    if (needPull.length === 0) return
    setBatchPulling(true)
    for (const e of needPull) {
      // eslint-disable-next-line no-await-in-loop
      await handlePull(e.path)
    }
    setBatchPulling(false)
  }, [entries, scannedDir, handlePull])

  const handleFetchAll = useCallback(async () => {
    if (!entries || !scannedDir) return
    setFetchingAll(true)
    setFetchingPath(entries[0]?.path ?? null)
    setFetchingPaths(new Set(entries.map((e) => e.path)))
    setFetchDoneCount(0)
    setError(null)
    // 并发获取：不同仓库独立，无 git 锁冲突，IO 密集型并发更快
    // 用 Promise.allSettled 保证单仓失败不影响其他，最后统一 doScan 刷新 behind/ahead
    try {
      await Promise.allSettled(
        entries.map(async (e) => {
          try {
            await invoke('fetch_changes', { repoPath: e.path })
          } catch {}
          finally {
            // 逐个完成时更新进度与高亮
            setFetchingPaths((prev) => {
              const n = new Set(prev)
              n.delete(e.path)
              return n
            })
            setFetchDoneCount((c) => c + 1)
            setFetchingPath((cur) => {
              // 若当前高亮刚完成，切换到剩余集合中任意一个
              if (cur === e.path) {
                const remaining = entries.map((x) => x.path).filter((p) => p !== e.path)
                // 延迟由下一轮 setFetchingPaths 驱动，这里简单置 null 由渲染取剩余
                return remaining[0] ?? null
              }
              return cur
            })
          }
        })
      )
      await doScan(scannedDir)
      // 获取后 behind 可能变化，旧待拉/待推缓存失效
      setIncomingCache({})
      setOutgoingCache({})
      setRecentCache({})
      void invoke('append_gitlite_log', { level: 'INFO', message: `[DIAG][fetch][multi] all done` }).catch(()=>{})
    } catch (err) {
      setError(formatTauriInvokeError(err, '全部获取失败'))
    } finally {
      setFetchingAll(false)
      setFetchingPath(null)
      setFetchingPaths(new Set())
    }
  }, [entries, scannedDir, doScan])

  const fetchOutgoingIfNeeded = useCallback(async (repoPath: string) => {
    if (outgoingCache[repoPath] || outgoingLoading) return
    setOutgoingLoading(repoPath)
    try {
      const commits: CommitInfo[] = await invoke('get_repo_outgoing_commits', {
        repoPath,
        clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
      })
      setOutgoingCache((m) => ({ ...m, [repoPath]: commits }))
    } catch {
      setOutgoingCache((m) => ({ ...m, [repoPath]: [] }))
    } finally {
      setOutgoingLoading(null)
    }
  }, [outgoingCache, outgoingLoading])

  const fetchWorkspaceIfNeeded = useCallback(async (repoPath: string) => {
    if (workspaceCache[repoPath] || workspaceLoading) return
    setWorkspaceLoading(repoPath)
    try {
      const ws: WorkspaceStatus = await invoke('get_workspace_status', { repoPath })
      setWorkspaceCache((m) => ({ ...m, [repoPath]: ws }))
      setEntries((prev) => (prev ? prev.map((e) => (e.path === repoPath ? { ...e, staged_count: ws.staged_files.length, unstaged_count: ws.unstaged_files.length, untracked_count: ws.untracked_files.length, conflicted_count: ws.conflicted_files?.length ?? 0 } : e)) : prev))
    } catch {
      setWorkspaceCache((m) => ({ ...m, [repoPath]: { staged_files: [], unstaged_files: [], untracked_files: [], conflicted_files: [] } as WorkspaceStatus }))
    } finally {
      setWorkspaceLoading(null)
    }
  }, [workspaceCache, workspaceLoading])

  const refreshWorkspace = useCallback(async (repoPath: string) => {
    setWorkspaceCache((m) => {
      const c = { ...m }
      delete c[repoPath]
      return c
    })
    setWorkspaceLoading(repoPath)
    try {
      const ws: WorkspaceStatus = await invoke('get_workspace_status', { repoPath })
      setWorkspaceCache((m) => ({ ...m, [repoPath]: ws }))
      setEntries((prev) => (prev ? prev.map((e) => (e.path === repoPath ? { ...e, staged_count: ws.staged_files.length, unstaged_count: ws.unstaged_files.length, untracked_count: ws.untracked_files.length, conflicted_count: ws.conflicted_files?.length ?? 0 } : e)) : prev))
    } catch {
      setWorkspaceCache((m) => ({ ...m, [repoPath]: { staged_files: [], unstaged_files: [], untracked_files: [], conflicted_files: [] } as WorkspaceStatus }))
    } finally {
      setWorkspaceLoading(null)
    }
  }, [])

  const refreshRecent = useCallback(async (repoPath: string) => {
    setRecentCache((m) => {
      const c = { ...m }
      delete c[repoPath]
      return c
    })
    setRecentError((m) => {
      const c = { ...m }
      delete c[repoPath]
      return c
    })
    setRecentLoading(repoPath)
    try {
      const commits: CommitInfo[] = await invoke('get_commits_paginated', {
        repoPath,
        limit: 5,
        offset: 0,
        scope: null,
        rev: null,
        clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
      })
      setRecentCache((m) => ({ ...m, [repoPath]: commits }))
    } catch (err) {
      setRecentError((m) => ({ ...m, [repoPath]: formatTauriInvokeError(err, '加载失败') }))
    } finally {
      setRecentLoading(null)
    }
  }, [])

  const refreshIncoming = useCallback(async (repoPath: string, behind: number) => {
    if (behind <= 0) return
    setIncomingCache((m) => {
      const c = { ...m }
      delete c[repoPath]
      return c
    })
    setIncomingLoading(repoPath)
    try {
      const commits: CommitInfo[] = await invoke('get_repo_incoming_commits', {
        repoPath,
        clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
      })
      setIncomingCache((m) => ({ ...m, [repoPath]: commits }))
    } catch {
      setIncomingCache((m) => ({ ...m, [repoPath]: [] }))
    } finally {
      setIncomingLoading(null)
    }
  }, [])

  const refreshOutgoing = useCallback(async (repoPath: string) => {
    setOutgoingCache((m) => {
      const c = { ...m }
      delete c[repoPath]
      return c
    })
    setOutgoingLoading(repoPath)
    try {
      const commits: CommitInfo[] = await invoke('get_repo_outgoing_commits', {
        repoPath,
        clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
      })
      setOutgoingCache((m) => ({ ...m, [repoPath]: commits }))
    } catch {
      setOutgoingCache((m) => ({ ...m, [repoPath]: [] }))
    } finally {
      setOutgoingLoading(null)
    }
  }, [])

  const fetchRecentIfNeeded = useCallback(async (repoPath: string) => {
    if (recentCache[repoPath] || recentLoading) return
    setRecentLoading(repoPath)
    setRecentError((m) => {
      const c = { ...m }
      delete c[repoPath]
      return c
    })
    try {
      const commits: CommitInfo[] = await invoke('get_commits_paginated', {
        repoPath,
        limit: 5,
        offset: 0,
        scope: null,
        rev: null,
        clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
      })
      setRecentCache((m) => ({ ...m, [repoPath]: commits }))
    } catch (err) {
      setRecentError((m) => ({ ...m, [repoPath]: formatTauriInvokeError(err, '加载失败') }))
    } finally {
      setRecentLoading(null)
    }
  }, [recentCache, recentLoading])

  const toggleIncoming = useCallback(
    async (repoPath: string, behind: number) => {
      const isSame = expandedPath === repoPath
      if (isSame) {
        setExpandedPath(null)
        return
      }
      const cached = detailTabCache[repoPath] as 'incoming' | 'outgoing' | 'workspace' | 'recent' | undefined
      const targetTab = cached ?? 'incoming'
      setExpandedPath(repoPath)
      setActiveDetailTab(targetTab)
      if (targetTab === 'incoming' && behind > 0 && !incomingCache[repoPath]) {
        setIncomingLoading(repoPath)
        try {
          const commits: CommitInfo[] = await invoke('get_repo_incoming_commits', {
            repoPath,
            clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
          })
          setIncomingCache((m) => ({ ...m, [repoPath]: commits }))
        } catch {
          setIncomingCache((m) => ({ ...m, [repoPath]: [] }))
        } finally {
          setIncomingLoading(null)
        }
      } else if (targetTab === 'outgoing' && !outgoingCache[repoPath]) {
        void fetchOutgoingIfNeeded(repoPath)
      } else if (targetTab === 'workspace' && !workspaceCache[repoPath]) {
        void fetchWorkspaceIfNeeded(repoPath)
      } else if (targetTab === 'recent' && !recentCache[repoPath]) {
        void fetchRecentIfNeeded(repoPath)
      }
    },
    [expandedPath, incomingCache, outgoingCache, workspaceCache, recentCache, detailTabCache, fetchOutgoingIfNeeded, fetchWorkspaceIfNeeded, fetchRecentIfNeeded]
  )

  const handleDetailTab = (tab: 'incoming' | 'outgoing' | 'workspace' | 'recent', entry: DirectoryRepoEntry) => {
    setActiveDetailTab(tab)
    setDetailTabCache((m) => ({ ...m, [entry.path]: tab }))
    if (tab === 'incoming') {
      if (entry.behind > 0 && !incomingCache[entry.path] && incomingLoading !== entry.path) void refreshIncoming(entry.path, entry.behind)
      // 已清缓存但 behind>0 时强制刷新，避免“角标1但列表空”
      if (entry.behind > 0 && incomingCache[entry.path]?.length === 0) void refreshIncoming(entry.path, entry.behind)
    }
    if (tab === 'outgoing') void fetchOutgoingIfNeeded(entry.path)
    if (tab === 'workspace') void fetchWorkspaceIfNeeded(entry.path)
    if (tab === 'recent') void fetchRecentIfNeeded(entry.path)
  }

  // 持久化恢复后自动拉取对应 tab 数据
  useEffect(() => {
    if (!expandedPath || !entries) return
    const entry = entries.find((e) => e.path === expandedPath)
    if (!entry) return
    if (activeDetailTab === 'workspace' && !workspaceCache[expandedPath] && workspaceLoading !== expandedPath) {
      void fetchWorkspaceIfNeeded(expandedPath)
    } else if (activeDetailTab === 'outgoing' && !outgoingCache[expandedPath] && outgoingLoading !== expandedPath) {
      void fetchOutgoingIfNeeded(expandedPath)
    } else if (activeDetailTab === 'recent' && !recentCache[expandedPath] && recentLoading !== expandedPath && !recentError[expandedPath]) {
      void fetchRecentIfNeeded(expandedPath)
    } else if (activeDetailTab === 'incoming' && entry.behind > 0 && !incomingCache[expandedPath] && incomingLoading !== expandedPath) {
      void (async () => {
        setIncomingLoading(expandedPath)
        try {
          const commits: CommitInfo[] = await invoke('get_repo_incoming_commits', {
            repoPath: expandedPath,
            clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
          })
          setIncomingCache((m) => ({ ...m, [expandedPath]: commits }))
        } catch {
          setIncomingCache((m) => ({ ...m, [expandedPath]: [] }))
        } finally {
          setIncomingLoading(null)
        }
      })()
    }
  }, [expandedPath, activeDetailTab, entries, workspaceCache, outgoingCache, recentCache, incomingCache, workspaceLoading, outgoingLoading, recentLoading, recentError, fetchWorkspaceIfNeeded, fetchOutgoingIfNeeded, fetchRecentIfNeeded])

  // 多仓库提交历史右键回退（本地，不影响远端）
  useEffect(() => {
    if (!recentContextMenu) return
    const close = () => setRecentContextMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('contextmenu', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [recentContextMenu])

  useEffect(() => {
    if (!detailFileMenu) return
    const close = () => setDetailFileMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('contextmenu', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [detailFileMenu])

  const handleRecentResetHard = useCallback(async (repoPath: string, commit: CommitInfo) => {
    if (!confirm(`本地回退 ${repoPath}\n到 ${commit.short_id} ${commit.message.split('\n')[0]}？\n仅本地 --hard，不影响远端，之后可“拉取”拉回。`)) return
    try {
      await invoke('reset_to_commit', { repoPath, commitId: commit.id, mode: 'hard' })
      void invoke('append_gitlite_log', { level: 'INFO', message: `[DIAG][reset][multi] hard ok path=${repoPath} to=${commit.short_id}` }).catch(()=>{})
      // 回退后待拉/待推/历史均失效，全部清缓存，靠 doScan 更新 behind 后再懒加载
      setIncomingCache((m) => { const c={...m}; delete c[repoPath]; return c })
      setOutgoingCache((m) => { const c={...m}; delete c[repoPath]; return c })
      setRecentCache((m) => { const c={...m}; delete c[repoPath]; return c })
      setWorkspaceCache((m) => { const c={...m}; delete c[repoPath]; return c })
      if (scannedDir) await doScan(scannedDir)
      void fetchRecentIfNeeded(repoPath)
    } catch (e) {
      setError(formatTauriInvokeError(e, '回退失败'))
    }
  }, [scannedDir, doScan, fetchRecentIfNeeded])

  const handleViewCommit = useCallback(async (repoPath: string, commit: CommitInfo) => {
    setDetailCommit({ repoPath, commit })
    setDetailFiles([])
    setDetailSelectedFile(null)
    setDetailDiff('')
    setDetailFilesLoading(true)
    try {
      const files: import('../types/git').FileChange[] = await invoke('get_commit_files', { repoPath, commitId: commit.id })
      setDetailFiles(files)
      if (files.length > 0) {
        const first = files[0].path
        setDetailSelectedFile(first)
        setDetailDiffLoading(true)
        queueMicrotask(() => detailFilesListRef.current?.focus())
        try {
          const diff: string = await invoke('get_single_file_diff', { repoPath, commitId: commit.id, filePath: first })
          setDetailDiff(diff)
        } catch {
          setDetailDiff('无法加载差异')
        } finally {
          setDetailDiffLoading(false)
        }
      }
    } catch {
      setDetailFiles([])
    } finally {
      setDetailFilesLoading(false)
      queueMicrotask(() => detailFilesListRef.current?.focus())
    }
  }, [])

  const handleDetailFileSelect = useCallback(
    async (filePath: string) => {
      if (!detailCommit) return
      setDetailSelectedFile(filePath)
      setDetailDiffLoading(true)
      // 保持焦点在文件列表容器内，便于连续用方向键切换
      queueMicrotask(() => detailFilesListRef.current?.focus())
      try {
        const diff: string = await invoke('get_single_file_diff', {
          repoPath: detailCommit.repoPath,
          commitId: detailCommit.commit.id,
          filePath,
        })
        setDetailDiff(diff)
      } catch {
        setDetailDiff('无法加载差异')
      } finally {
        setDetailDiffLoading(false)
      }
    },
    [detailCommit]
  )

  // 键盘切换：多库详情的「变更文件」列表支持 ↑/↓/Home/End
  useEffect(() => {
    if (!detailSelectedFile || !detailFilesListRef.current) return
    let el: HTMLElement | null = null
    try {
      const escaped =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(detailSelectedFile)
          : detailSelectedFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      el = detailFilesListRef.current.querySelector(`[data-file-path="${escaped}"]`)
    } catch {
      el = detailFilesListRef.current.querySelector('[data-file-path]')
    }
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [detailSelectedFile])

  const handleDetailFilesKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (detailFiles.length === 0) return
      const t = e.target
      if (t instanceof HTMLElement) {
        const tag = t.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return
      }
      const key = e.key
      if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End' && key !== 'Enter') return
      e.preventDefault()
      let idx = detailSelectedFile ? detailFiles.findIndex((f) => f.path === detailSelectedFile) : -1
      if (key === 'ArrowDown') {
        if (idx === -1) idx = 0
        else idx = Math.min(idx + 1, detailFiles.length - 1)
        const next = detailFiles[idx]
        if (next) void handleDetailFileSelect(next.path)
      } else if (key === 'ArrowUp') {
        if (idx === -1) idx = detailFiles.length - 1
        else idx = Math.max(idx - 1, 0)
        const next = detailFiles[idx]
        if (next) void handleDetailFileSelect(next.path)
      } else if (key === 'Home') {
        const next = detailFiles[0]
        if (next) void handleDetailFileSelect(next.path)
      } else if (key === 'End') {
        const next = detailFiles[detailFiles.length - 1]
        if (next) void handleDetailFileSelect(next.path)
      } else if (key === 'Enter') {
        if (detailSelectedFile) void handleDetailFileSelect(detailSelectedFile)
      }
    },
    [detailFiles, detailSelectedFile, handleDetailFileSelect]
  )

  const handleWsFileClick = useCallback(async (repoPath: string, filePath: string, kind: 'staged' | 'unstaged' | 'untracked') => {
    console.log('[GitLite][wsDetail] handleWsFileClick', kind, filePath, 'repo', repoPath)
    void invoke('append_gitlite_log', { level: 'INFO', message: `[wsDetail] click ${kind} ${filePath} @ ${repoPath}` }).catch(() => {})
    setWsDetail({ repoPath, filePath, kind })
    setWsDiff('')
    setWsDiffLoading(true)
    try {
      let diff = ''
      if (kind === 'staged') {
        try {
          diff = await invoke<string>('get_staged_file_diff', { repoPath, filePath })
        } catch {
          diff = await invoke<string>('get_staged_file_diff', { repoPath, filePath })
        }
      } else if (kind === 'unstaged') {
        diff = await invoke<string>('get_unstaged_file_diff', { repoPath, filePath })
      } else {
        let content = ''
        try {
          content = await invoke<string>('get_file_content', { repoPath, filePath })
        } catch {
          try {
            content = await invoke<string>('get_head_or_worktree_file_text', { repoPath, filePath })
          } catch {
            // 最后降级才用 diff 格式的接口，前端再剥掉头部
            const diffText = await invoke<string>('get_untracked_file_content', { repoPath, filePath })
            // 剥掉 diff 头，取 + 行
            const lines = diffText.split('\n')
            const atIdx = lines.findIndex((l) => l.startsWith('@@'))
            if (atIdx >= 0) {
              content = lines
                .slice(atIdx + 1)
                .map((l) => (l.startsWith('+') ? l.slice(1) : l))
                .join('\n')
            } else {
              content = diffText
            }
          }
        }
        diff = content
        console.log('[GitLite][wsDetail] untracked content', filePath, 'contentLen', content.length)
        void invoke('append_gitlite_log', { level: 'INFO', message: `[wsDetail] untracked ${filePath} contentLen=${content.length}` }).catch(() => {})
      }
      setWsDiff(diff)
    } catch (e) {
      setWsDiff(`无法加载: ${formatTauriInvokeError(e, '')}`)
    } finally {
      setWsDiffLoading(false)
    }
  }, [])

  const openFolder = async (path: string) => {
    try {
      await invoke('open_folder', { path })
    } catch {}
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {}
  }

  const filteredEntries = useMemo(() => {
    if (!entries) return null
    const q = filter.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.path.toLowerCase().includes(q) ||
        e.current_branch.toLowerCase().includes(q) ||
        (e.remote_url ?? '').toLowerCase().includes(q)
    )
  }, [entries, filter])

  const stats = useMemo(() => {
    if (!entries) return null
    const total = entries.length
    const clean = entries.filter((e) => e.staged_count + e.unstaged_count + e.untracked_count + e.conflicted_count === 0 && e.ahead === 0 && e.behind === 0).length
    const dirty = total - entries.filter((e) => e.staged_count + e.unstaged_count + e.untracked_count + e.conflicted_count === 0).length
    const needSync = entries.filter((e) => e.ahead > 0 || e.behind > 0).length
    return { total, clean, dirty, needSync }
  }, [entries])

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* 控制区 - 紧凑化 */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="py-3 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="rounded-md bg-primary/10 p-1.5">
                <Layers className="h-3.5 w-3.5 text-primary" />
              </div>
              <CardTitle className="text-[13px] leading-none flex items-center gap-2 truncate">
                目录扫描 — 多仓库一览
                {stats && (
                  <Badge variant="secondary" className="font-mono text-[10px] h-5 px-1.5">
                    {stats.total}
                  </Badge>
                )}
              </CardTitle>
              <span className="hidden lg:inline text-xs text-muted-foreground truncate">
                选择父目录自动发现子仓库，支持一键打开
              </span>
            </div>
            {scannedDir && entries && (
              <Button variant="ghost" size="sm" className="h-6 text-xs shrink-0 px-2" onClick={handleRefresh} disabled={loading}>
                <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0">
          {/* 输入行 + 选项 同行 */}
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <FolderOpen className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={dirPath}
                onChange={(e) => setDirPath(e.target.value)}
                placeholder="D:\project  或  /home/user/projects"
                className="pl-8 font-mono text-xs h-8 bg-muted/20 focus:bg-background"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doScan()
                }}
              />
            </div>
            <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={pickFolder} disabled={loading}>
              浏览…
            </Button>
            <Button size="sm" className="h-8 px-4 text-xs shadow-sm" onClick={() => void doScan()} disabled={loading || !dirPath.trim()}>
              {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" /> : <Search className="h-3.5 w-3.5 mr-1" />}
              扫描
            </Button>
            <label className="hidden sm:flex items-center gap-1.5 text-xs cursor-pointer select-none group shrink-0 ml-1">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
                className="rounded border-input h-3 w-3 accent-primary"
              />
              <span className="group-hover:text-foreground">递归</span>
            </label>
            {entries && (
              <div className="relative hidden md:block">
                <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="过滤"
                  className="h-8 pl-7 w-28 text-xs"
                />
              </div>
            )}
          </div>
          {/* 移动端递归/过滤 */}
          <div className="flex sm:hidden items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} className="rounded h-3 w-3" />
              递归扫描（3层）
            </label>
            {entries && (
              <div className="relative flex-1 max-w-[140px]">
                <Filter className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="过滤" className="h-7 pl-6 text-xs" />
              </div>
            )}
          </div>

          {/* 状态条 - 单行紧凑 */}
          {error && (
            <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-2.5 py-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{error}</span>
            </div>
          )}
          {scannedDir && !error && entries && stats && (
            <div className="flex flex-wrap items-center gap-2 text-xs border-t border-border/40 pt-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="text-muted-foreground">已扫描</span>
                <span className="font-mono font-medium max-w-[260px] truncate" title={scannedDir}>
                  {shortenPathMiddle(scannedDir, 40)}
                </span>
                <Badge variant="secondary" className="h-5 text-[10px] px-1.5">
                  {stats.total} 仓库
                </Badge>
              </span>
              <span className="h-3 w-px bg-border hidden sm:inline" />
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                干净 <span className="font-medium text-emerald-600 dark:text-emerald-400">{stats.clean}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                有改动 <span className="font-medium">{stats.dirty}</span> / 待同步 <span className="font-medium">{stats.needSync}</span>
              </span>
            </div>
          )}

          {/* 最近扫描 - 紧凑单行 */}
          {recentScanned.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-xs border-t border-border/30 pt-2">
              <span className="inline-flex items-center gap-1 text-muted-foreground shrink-0">
                <Clock className="h-3 w-3" />
                最近
              </span>
              <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                {recentScanned.slice(0, 6).map((r) => (
                  <div key={r.path} className="group inline-flex items-center gap-1 rounded-full border bg-background pl-2 pr-0.5 py-0.5 text-xs hover:border-primary/30 transition-colors">
                    <button
                      type="button"
                      className="font-mono text-[11px] truncate max-w-[200px]"
                      title={`${r.path} · ${timeAgo(r.last_scanned)}`}
                      onClick={() => {
                        setDirPath(r.path)
                        setRecursive(r.recursive)
                        void doScan(r.path, r.recursive)
                      }}
                    >
                      {shortenPathMiddle(r.path, 28)}
                    </button>
                    {r.recursive && <span className="text-[9px] px-1 py-0 rounded bg-muted border">递</span>}
                    <button
                      type="button"
                      className="rounded-full p-1 opacity-40 group-hover:opacity-100 hover:text-destructive"
                      title="移除"
                      onClick={async () => {
                        try {
                          await invoke('remove_recent_scanned_dir', { path: r.path })
                          await loadRecentScanned()
                        } catch {
                          const raw = localStorage.getItem(RECENT_SCANNED_KEY)
                          let list: ScannedDirRecord[] = raw ? JSON.parse(raw) : []
                          list = list.filter((x) => x.path !== r.path)
                          localStorage.setItem(RECENT_SCANNED_KEY, JSON.stringify(list))
                          setRecentScanned(list)
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-muted-foreground" title="已持久化到 recent_scanned_dirs.json">
                <Info className="h-3 w-3" />
                已持久化
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 表格区 */}
      <div className="flex-1 min-h-0">
        {!entries ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-3">
              <div className="rounded-full bg-muted p-4">
                <Layers className="h-6 w-6 opacity-60" />
              </div>
              <div className="text-center">
                <p className="font-medium text-foreground">尚未扫描</p>
                <p className="text-xs mt-1">选择目录并点击“扫描”，将以表格展示子仓库的分支与工作区状态</p>
              </div>
            </CardContent>
          </Card>
        ) : filteredEntries && filteredEntries.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-3">
              <Folder className="h-6 w-6 opacity-40" />
              <p>{entries.length === 0 ? '该目录下未发现 Git 仓库' : `无匹配 “${filter}” 的仓库`}</p>
              <p className="text-xs text-center">
                {entries.length === 0 ? (
                  <>
                    子目录需包含 <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">.git</code> 才会被识别，可尝试开启递归
                  </>
                ) : (
                  '试试更换关键词或清空过滤'
                )}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden border shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2">
              <div className="text-xs text-muted-foreground flex items-center gap-2 min-w-0">
                <span>
                  共 <span className="font-medium text-foreground">{entries.length}</span> 个仓库
                  {filter && filteredEntries && filteredEntries.length !== entries.length && (
                    <span> · 已过滤 {filteredEntries.length} 个</span>
                  )}
                  {stats && stats.needSync > 0 && <span className="ml-2 text-amber-600 dark:text-amber-400">· {stats.needSync} 个待同步</span>}
                </span>
                {fetchingAll && (
                  <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-primary truncate max-w-[260px]" title={Array.from(fetchingPaths).join(', ')}>
                    <RefreshCw className="h-3 w-3 animate-spin shrink-0" />
                    <span className="truncate">
                      {fetchingPaths.size > 0
                        ? `并发获取中 ${fetchDoneCount}/${entries.length} · 剩余 ${fetchingPaths.size} 个`
                        : `获取中 ${fetchDoneCount}/${entries.length}`}
                    </span>
                  </span>
                )}
              </div>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void handleFetchAll()}
                  disabled={loading || batchPulling || fetchingAll}
                  title="对全部仓库执行 git fetch"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1 ${fetchingAll ? 'animate-spin' : ''}`} />
                  {fetchingAll ? `获取中 ${fetchDoneCount}/${entries.length}` : '全部获取'}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void handleBatchPull()}
                  disabled={batchPulling || loading || fetchingAll || !entries.some((e) => e.behind > 0)}
                  title={entries.some((e) => e.behind > 0) ? `拉取 ${entries.filter((e) => e.behind > 0).length} 个待拉仓库` : '暂无待拉仓库'}
                >
                  {batchPulling ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                  {batchPulling ? '拉取中…' : `全部拉取${entries.filter((e) => e.behind > 0).length > 0 ? ` (${entries.filter((e) => e.behind > 0).length})` : ''}`}
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60 border-b">
                  <tr className="text-[11px] tracking-wider text-muted-foreground">
                    <th className="text-left font-semibold px-3 py-2 w-[36%]">仓库</th>
                    <th className="text-left font-semibold px-2 py-2">分支</th>
                    <th className="text-left font-semibold px-2 py-2">同步</th>
                    <th className="text-left font-semibold px-2 py-2">工作区</th>
                    <th className="text-right font-semibold px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredEntries!.map((entry) => {
                    const hasChanges = entry.staged_count + entry.unstaged_count + entry.untracked_count + entry.conflicted_count > 0
                    const isDirty = hasChanges
                    const isExpanded = expandedPath === entry.path
                    const isFetchingThis = fetchingAll && fetchingPaths.has(entry.path)
                    return (
                      <React.Fragment key={entry.path}>
                        <tr className={`group hover:bg-muted/30 transition-colors ${isDirty ? 'bg-amber-500/[0.02]' : ''} ${isExpanded ? 'bg-muted/20' : ''} ${isFetchingThis ? 'bg-primary/[0.06] ring-1 ring-inset ring-primary/20' : ''}`}>
                        
                        <td className="px-3 py-2.5 align-top">
                          <div className="flex flex-col gap-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <button
                                onClick={() => void toggleIncoming(entry.path, entry.behind)}
                                className="font-medium text-sm text-foreground truncate hover:text-primary text-left flex items-center gap-1 min-w-0"
                                title="点击展开/折叠详情"
                              >
                                <span className="truncate">{entry.name}</span>
                                {isExpanded ? (
                                  <ChevronUp className="h-3 w-3 shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-3 w-3 shrink-0 opacity-40 group-hover:opacity-100 text-muted-foreground" />
                                )}
                              </button>
                              <button
                                onClick={() => copyText(entry.path)}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-all shrink-0"
                                title="复制路径"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                            </div>
                            <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground truncate" title={entry.path}>
                              <Folder className="h-3 w-3 shrink-0" />
                              <span className="truncate">{shortenPathMiddle(entry.path, 52)}</span>
                            </div>

                          </div>
                        </td>
                        <td className="px-2 py-2.5 align-top">
                          <div className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 shadow-sm">
                            <GitBranch className="h-3 w-3 text-primary" />
                            <span className="font-medium text-foreground">{entry.current_branch}</span>
                            {entry.head_short_id && (
                              <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded border">{entry.head_short_id}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2.5 align-top">
                          <div className="flex flex-wrap gap-1.5 items-center">
                            {isFetchingThis && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-primary whitespace-nowrap">
                                <RefreshCw className="h-3 w-3 animate-spin" /> 获取中
                              </span>
                            )}
                            {entry.ahead > 0 && (
                              <Badge variant="default" className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] px-2.5 py-0 h-6 shrink-0">
                                <ArrowUp className="h-3 w-3 shrink-0" /> <span className="whitespace-nowrap">{entry.ahead} 待推</span>
                              </Badge>
                            )}
                            {entry.behind > 0 && (
                              <button
                                type="button"
                                onClick={() => void toggleIncoming(entry.path, entry.behind)}
                                title="点击查看待拉取的提交详情"
                                className="inline-flex whitespace-nowrap"
                              >
                                <Badge
                                  variant="secondary"
                                  className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] px-2.5 py-0 h-6 cursor-pointer hover:bg-secondary/80 shrink-0"
                                >
                                  <ArrowDown className="h-3 w-3 shrink-0" />
                                  <span className="whitespace-nowrap">{entry.behind} 待拉</span>
                                  {expandedPath === entry.path ? (
                                    <ChevronUp className="h-3 w-3 shrink-0" />
                                  ) : (
                                    <ChevronDown className="h-3 w-3 shrink-0" />
                                  )}
                                </Badge>
                              </button>
                            )}
                            {entry.ahead === 0 && entry.behind === 0 && entry.has_upstream && (
                              <Badge
                                variant="outline"
                                className="inline-flex items-center gap-1 whitespace-nowrap bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 h-6 shrink-0"
                              >
                                <CheckCircle2 className="h-3 w-3 shrink-0" /> <span className="whitespace-nowrap">已同步</span>
                              </Badge>
                            )}
                            {!entry.has_upstream && entry.has_origin_remote && (
                              <Badge
                                variant="outline"
                                className="inline-flex items-center gap-1 whitespace-nowrap border-amber-500/30 text-amber-700 dark:text-amber-400 bg-amber-500/10 h-6 shrink-0"
                              >
                                <Unlink className="h-3 w-3 shrink-0" /> <span className="whitespace-nowrap">无上游</span>
                              </Badge>
                            )}
                            {!entry.has_origin_remote && (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground shrink-0">
                                <Unlink className="h-3 w-3 shrink-0" /> <span className="whitespace-nowrap">无远端</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <div className="flex items-center gap-1.5 flex-nowrap">
                            {entry.conflicted_count > 0 ? (
                              <Badge variant="destructive" className="gap-1 h-5 text-[11px] px-2 whitespace-nowrap shrink-0">
                                <AlertTriangle className="h-3 w-3 shrink-0" /> 冲突 {entry.conflicted_count}
                              </Badge>
                            ) : !hasChanges ? (
                              <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 h-5 text-[11px] px-2 whitespace-nowrap shrink-0">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" /> 干净
                              </Badge>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 h-5 text-[11px] font-medium whitespace-nowrap shrink-0"
                                title={`暂存 ${entry.staged_count} · 未暂存 ${entry.unstaged_count} · 未跟踪 ${entry.untracked_count}`}
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                                有改动
                                <span className="text-[10px] opacity-70">· {entry.staged_count + entry.unstaged_count + entry.untracked_count}</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-right">
                          <div className="flex justify-end gap-1 items-center flex-nowrap">
                            {entry.behind > 0 && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2.5 text-xs bg-blue-600 text-white hover:bg-blue-700 border-blue-600"
                                disabled={pullingPath === entry.path || batchPulling}
                                onClick={() => void handlePull(entry.path)}
                                title={`拉取 ${entry.behind} 个提交`}
                              >
                                {pullingPath === entry.path ? (
                                  <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" />
                                ) : (
                                  <Download className="h-3.5 w-3.5 mr-1" />
                                )}
                                拉取
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant={isExpanded ? 'secondary' : 'outline'}
                              className="h-7 px-2.5 text-xs shrink-0 border"
                              onClick={() => void toggleIncoming(entry.path, entry.behind)}
                              title={isExpanded ? '收起详情' : '查看待拉/待推/工作区/提交历史详情'}
                            >
                              {isExpanded ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                              {isExpanded ? '收起' : '详情'}
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 px-3 text-xs shadow-sm"
                              onClick={() => onOpenRepo(entry.path)}
                            >
                              <LogIn className="h-3.5 w-3.5 mr-1" />
                              打开
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 shrink-0"
                              onClick={() => void openFolder(entry.path)}
                              title="打开文件夹"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-muted/5">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="rounded-lg border bg-card overflow-hidden">
                              <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-2 py-1.5">
                                <button
                                  onClick={() => handleDetailTab('incoming', entry)}
                                  className={`px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 border ${activeDetailTab === 'incoming' ? 'bg-background shadow-sm border-border text-foreground' : 'border-transparent hover:bg-muted text-muted-foreground'}`}
                                >
                                  <ArrowDown className="h-3 w-3" /> 待拉 {entry.behind > 0 && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{entry.behind}</Badge>}
                                </button>
                                <button
                                  onClick={() => handleDetailTab('outgoing', entry)}
                                  className={`px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 border ${activeDetailTab === 'outgoing' ? 'bg-background shadow-sm border-border text-foreground' : 'border-transparent hover:bg-muted text-muted-foreground'}`}
                                >
                                  <ArrowUp className="h-3 w-3" /> 待推 {entry.ahead > 0 && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{entry.ahead}</Badge>}
                                </button>
                                <button
                                  onClick={() => handleDetailTab('workspace', entry)}
                                  className={`px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 border ${activeDetailTab === 'workspace' ? 'bg-background shadow-sm border-border text-foreground' : 'border-transparent hover:bg-muted text-muted-foreground'}`}
                                >
                                  <AlertTriangle className="h-3 w-3" /> 工作区
                                  {(entry.staged_count + entry.unstaged_count + entry.untracked_count) > 0 && (
                                    <Badge variant="outline" className="h-4 px-1 text-[10px] border-amber-500/30">
                                      {entry.staged_count + entry.unstaged_count + entry.untracked_count}
                                    </Badge>
                                  )}
                                </button>
                                <button
                                  onClick={() => handleDetailTab('recent', entry)}
                                  className={`px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 border ${activeDetailTab === 'recent' ? 'bg-background shadow-sm border-border text-foreground' : 'border-transparent hover:bg-muted text-muted-foreground'}`}
                                >
                                  <Clock className="h-3 w-3" /> 提交历史
                                </button>
                                <div className="ml-auto flex gap-1 items-center">
                                  {activeDetailTab === 'incoming' && entry.behind > 0 && (
                                    <Button size="sm" className="h-6 text-xs px-2" disabled={pullingPath === entry.path} onClick={() => void handlePull(entry.path)}>
                                      {pullingPath === entry.path ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Download className="h-3 w-3 mr-1" />}
                                      拉取
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 w-7 p-0"
                                    onClick={() => {
                                      if (activeDetailTab === 'incoming') {
                                        void refreshIncoming(entry.path, entry.behind)
                                      } else if (activeDetailTab === 'outgoing') {
                                        void refreshOutgoing(entry.path)
                                      } else if (activeDetailTab === 'workspace') {
                                        void refreshWorkspace(entry.path)
                                      } else if (activeDetailTab === 'recent') {
                                        void refreshRecent(entry.path)
                                      }
                                    }}
                                    title="刷新当前标签"
                                    disabled={incomingLoading === entry.path || outgoingLoading === entry.path || workspaceLoading === entry.path || recentLoading === entry.path}
                                  >
                                    <RefreshCw className={`h-3 w-3 ${incomingLoading === entry.path || outgoingLoading === entry.path || workspaceLoading === entry.path || recentLoading === entry.path ? 'animate-spin' : ''}`} />
                                  </Button>
                                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setExpandedPath(null)}>
                                    收起
                                  </Button>
                                </div>
                              </div>

                              <div className="min-h-[120px]">
                                {activeDetailTab === 'incoming' &&
                                  (incomingLoading === entry.path ? (
                                    <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground">
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                      加载待拉取提交中…
                                    </div>
                                  ) : !incomingCache[entry.path] || incomingCache[entry.path].length === 0 ? (
                                    <div className="px-3 py-8 text-xs text-muted-foreground text-center">暂无待拉取（已是最新或需先“全部获取”）</div>
                                  ) : (
                                    <div className="divide-y divide-border/60 max-h-64 overflow-auto">
                                  {incomingCache[entry.path].map((c) => (
                                    <div key={c.id} className="flex gap-3 px-3 py-2 hover:bg-muted/20 text-xs items-center">
                                      <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded border shrink-0">{c.short_id}</span>
                                      <span className="flex-1 min-w-0 truncate cursor-pointer hover:text-foreground" title={c.message} onClick={() => void handleViewCommit(entry.path, c)}>
                                        {c.message}
                                      </span>
                                      <span className="hidden sm:inline text-muted-foreground shrink-0 max-w-[100px] truncate">{c.author}</span>
                                      <span className="font-mono text-[11px] text-muted-foreground shrink-0 hidden md:inline">{c.date}</span>
                                      <button onClick={() => void handleViewCommit(entry.path, c)} className="p-1 rounded hover:bg-primary/10 text-primary shrink-0" title="查看改动">
                                        <Eye className="h-3.5 w-3.5" />
                                      </button>
                                      <button onClick={() => copyText(c.id)} className="p-1 rounded hover:bg-muted shrink-0" title="复制ID">
                                        <Copy className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ))}
                                    </div>
                                  ))}

                                {activeDetailTab === 'outgoing' &&
                                  (outgoingLoading === entry.path ? (
                                    <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground">
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                      加载待推提交中…
                                    </div>
                                  ) : !outgoingCache[entry.path] || outgoingCache[entry.path].length === 0 ? (
                                    <div className="px-3 py-8 text-xs text-muted-foreground text-center">暂无待推提交（本地已同步）</div>
                                  ) : (
                                    <div className="divide-y divide-border/60 max-h-64 overflow-auto">
                                      {outgoingCache[entry.path].map((c) => (
                                        <div key={c.id} className="flex gap-3 px-3 py-2 hover:bg-muted/20 text-xs items-center">
                                          <span className="font-mono text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20 shrink-0">{c.short_id}</span>
                                          <span className="flex-1 min-w-0 truncate cursor-pointer hover:text-foreground" title={c.message} onClick={() => void handleViewCommit(entry.path, c)}>
                                            {c.message}
                                          </span>
                                          <span className="hidden sm:inline text-muted-foreground shrink-0">{c.author}</span>
                                          <span className="font-mono text-[11px] text-muted-foreground shrink-0 hidden md:inline">{c.date}</span>
                                          <button onClick={() => void handleViewCommit(entry.path, c)} className="p-1 rounded hover:bg-primary/10 text-primary shrink-0" title="查看改动">
                                            <Eye className="h-3.5 w-3.5" />
                                          </button>
                                          <button onClick={() => copyText(c.id)} className="p-1 rounded hover:bg-muted shrink-0" title="复制ID">
                                            <Copy className="h-3 w-3" />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  ))}

                                {activeDetailTab === 'workspace' &&
                                  (workspaceLoading === entry.path ? (
                                    <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground">
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                      加载工作区中…
                                    </div>
                                  ) : !workspaceCache[entry.path] ? (
                                    <div className="px-3 py-6 text-xs text-muted-foreground text-center">点击“工作区”已触发加载</div>
                                  ) : workspaceCache[entry.path]!.staged_files.length + workspaceCache[entry.path]!.unstaged_files.length + workspaceCache[entry.path]!.untracked_files.length + (workspaceCache[entry.path]!.conflicted_files?.length ?? 0) === 0 ? (
                                    <div className="px-3 py-8 text-xs text-muted-foreground text-center flex flex-col items-center gap-1">
                                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />工作区干净
                                    </div>
                                  ) : (
                                    <div className="grid md:grid-cols-3 gap-3 p-3 max-h-64 overflow-auto">
                                      {[
                                        { title: `未暂存 ${workspaceCache[entry.path]!.unstaged_files.length}`, files: workspaceCache[entry.path]!.unstaged_files, kind: 'unstaged' as const },
                                        { title: `未跟踪 ${workspaceCache[entry.path]!.untracked_files.length}`, files: workspaceCache[entry.path]!.untracked_files.map((p: string) => ({ path: p, status: 'untracked' })) as any, kind: 'untracked' as const },
                                        { title: `暂存 ${workspaceCache[entry.path]!.staged_files.length}`, files: workspaceCache[entry.path]!.staged_files, kind: 'staged' as const },
                                      ].map((group) => (
                                        <div key={group.title} className="rounded border bg-muted/20 overflow-hidden">
                                          <div className="px-2 py-1.5 border-b text-xs font-medium bg-muted/30 flex items-center justify-between">
                                            <span>{group.title}</span>
                                            <span className="text-[10px] text-muted-foreground">点击查看</span>
                                          </div>
                                          <div className="divide-y divide-border/20 max-h-48 overflow-auto">
                                            {group.files.length === 0 ? (
                                              <div className="px-2 py-6 text-xs text-muted-foreground text-center">无</div>
                                            ) : (
                                              group.files.slice(0, 50).map((f: any) => (
                                                <button
                                                  key={f.path}
                                                  onClick={() => void handleWsFileClick(entry.path, f.path, group.kind)}
                                                  className="w-full text-left px-2 py-1.5 text-xs font-mono truncate hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 flex items-center gap-1.5 group/file border-l-2 border-l-transparent hover:border-l-primary"
                                                  title={`点击查看改动 · ${f.path}`}
                                                >
                                                  <Eye className="h-3 w-3 opacity-40 group-hover/file:opacity-100 text-primary shrink-0" />
                                                  <span className="truncate flex-1">{f.path}</span>
                                                </button>
                                              ))
                                            )}
                                            {group.files.length > 50 && <div className="px-2 py-1 text-[10px] text-muted-foreground text-center">仅显示前 50 个</div>}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ))}

                                {activeDetailTab === 'recent' &&
                                  (recentLoading === entry.path ? (
                                    <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground">
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                      加载提交历史中…
                                    </div>
                                  ) : recentError[entry.path] ? (
                                    <div className="px-3 py-6 text-xs text-destructive text-center flex flex-col items-center gap-2">
                                      <span className="break-all">{recentError[entry.path]}</span>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        onClick={() => {
                                          setRecentCache((m) => {
                                            const c = { ...m }
                                            delete c[entry.path]
                                            return c
                                          })
                                          setRecentError((m) => {
                                            const c = { ...m }
                                            delete c[entry.path]
                                            return c
                                          })
                                          void fetchRecentIfNeeded(entry.path)
                                        }}
                                      >
                                        重试
                                      </Button>
                                    </div>
                                  ) : !recentCache[entry.path] || recentCache[entry.path].length === 0 ? (
                                    <div className="px-3 py-8 text-xs text-muted-foreground text-center">暂无提交</div>
                                  ) : (
                                    <div className="divide-y divide-border/60 max-h-64 overflow-auto">
                                      {recentCache[entry.path].map((c) => (
                                        <div
                                          key={c.id}
                                          className="flex gap-3 px-3 py-2 hover:bg-muted/20 text-xs items-center"
                                          title="右键 → 回退/快速回退（仅本地，不影响远端）"
                                          onContextMenu={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            setRecentContextMenu({ x: e.clientX, y: e.clientY, repoPath: entry.path, commit: c })
                                          }}
                                        >
                                          <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded border shrink-0">{c.short_id}</span>
                                          <span className="flex-1 min-w-0 truncate cursor-pointer hover:text-foreground" title={c.message} onClick={() => void handleViewCommit(entry.path, c)}>
                                            {c.message}
                                          </span>
                                          <span className="hidden sm:inline text-muted-foreground shrink-0">{c.author}</span>
                                          <span className="font-mono text-[11px] text-muted-foreground shrink-0 hidden md:inline">{c.date}</span>
                                          <button onClick={() => void handleViewCommit(entry.path, c)} className="p-1 rounded hover:bg-primary/10 text-primary shrink-0" title="查看改动">
                                            <Eye className="h-3.5 w-3.5" />
                                          </button>
                                          <button onClick={() => copyText(c.id)} className="p-1 rounded hover:bg-muted shrink-0" title="复制ID">
                                            <Copy className="h-3 w-3" />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {filteredEntries && entries && filteredEntries.length !== entries.length && (
              <div className="border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
                已过滤 {filteredEntries.length} / {entries.length} 个仓库
              </div>
            )}
          </Card>
        )}
      </div>

      <Dialog open={!!detailCommit} onOpenChange={(o) => !o && setDetailCommit(null)}>
        <DialogContent className="max-w-5xl h-[80vh] flex flex-col p-0 gap-0 overflow-hidden border-border/40 dark:border-white/[0.06]">
          <DialogHeader className="px-4 py-3 border-b border-border/40 shrink-0 dark:border-white/[0.06]">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-primary" />
              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded border">{detailCommit?.commit.short_id}</span>
              <span className="truncate">{detailCommit?.commit.message}</span>
            </DialogTitle>
            <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
              <span>{detailCommit?.commit.author}</span>
              <span>·</span>
              <span>{detailCommit?.commit.date}</span>
              <span className="font-mono truncate" title={detailCommit?.repoPath}>
                · {detailCommit?.repoPath ? shortenPathMiddle(detailCommit.repoPath, 48) : ''}
              </span>
            </div>
          </DialogHeader>
          <div className="flex flex-1 min-h-0">
            <div className="w-64 border-r border-border/40 flex flex-col min-h-0 bg-muted/20 dark:border-white/[0.06]">
              <div className="px-3 py-2 border-b border-border/40 text-xs font-medium bg-muted/30 flex items-center justify-between dark:border-white/[0.06]">
                <span>变更文件 ({detailFiles.length})</span>
                {detailFilesLoading && <RefreshCw className="h-3 w-3 animate-spin" />}
              </div>
              <div
                ref={detailFilesListRef}
                tabIndex={0}
                role="listbox"
                aria-label="变更文件列表，↑/↓ 移动，Home/End 跳转"
                onKeyDown={handleDetailFilesKeyDown}
                className="flex-1 overflow-auto divide-y divide-border/10 outline-none"
              >
                {detailFilesLoading ? (
                  <div className="p-4 text-xs text-muted-foreground text-center">加载中…</div>
                ) : detailFiles.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground text-center">无文件</div>
                ) : (
                  detailFiles.map((f) => (
                    <button
                      key={f.path}
                      data-file-path={f.path}
                      role="option"
                      aria-selected={detailSelectedFile === f.path}
                      onClick={() => void handleDetailFileSelect(f.path)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setDetailFileMenu({ x: e.clientX, y: e.clientY, filePath: f.path })
                      }}
                      className={`w-full text-left px-3 py-2 text-xs font-mono truncate hover:bg-muted flex items-center gap-2 ${detailSelectedFile === f.path ? 'bg-muted border-l-2 border-l-primary' : 'border-l-2 border-l-transparent'}`}
                      title={`${f.path} · ${f.status} (右键更多)`}
                    >
                      <span className={`h-2 w-2 rounded-full shrink-0 ${f.status === 'added' ? 'bg-emerald-500' : f.status === 'deleted' ? 'bg-red-500' : f.status === 'renamed' ? 'bg-blue-500' : 'bg-amber-500'}`} />
                      <span className="truncate flex-1">{f.path}</span>
                      <span className="text-[10px] text-muted-foreground capitalize">{f.status}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 flex flex-col bg-background min-w-0">
              <div className="px-3 py-1.5 border-b border-border/40 bg-muted/30 text-xs font-mono truncate flex items-center gap-2 shrink-0 dark:border-white/[0.06]">
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate flex-1">{detailSelectedFile || '请选择文件'}</span>
                {detailDiff && (
                  <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-xs shrink-0" onClick={() => copyText(detailDiff)}>
                    <Copy className="h-3 w-3 mr-1" /> 复制
                  </Button>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-hidden bg-background">
                {detailDiffLoading ? (
                  <div className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    加载差异中…
                  </div>
                ) : detailDiff ? (
                  <MonacoDiffEditor diff={detailDiff} filePath={detailSelectedFile ?? undefined} />
                ) : (
                  <div className="p-8 text-center text-xs text-muted-foreground">无差异或二进制文件</div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!wsDetail} onOpenChange={(o) => !o && setWsDetail(null)}>
        <DialogContent className="max-w-5xl h-[75vh] flex flex-col p-0 gap-0 overflow-hidden border-border/40 dark:border-white/[0.06]">
          <DialogHeader className="px-4 py-3 border-b border-border/40 shrink-0 dark:border-white/[0.06]">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-primary" />
              <span className="font-mono text-xs truncate" title={wsDetail?.filePath}>
                {wsDetail?.filePath}
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] capitalize border ${wsDetail?.kind === 'staged' ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/20' : wsDetail?.kind === 'unstaged' ? 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400 dark:border-amber-500/20' : 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-400 dark:border-sky-500/20'}`}
              >
                {wsDetail?.kind === 'staged' ? '已暂存' : wsDetail?.kind === 'unstaged' ? '未暂存' : '未跟踪'}
              </Badge>
            </DialogTitle>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 truncate" title={wsDetail?.repoPath}>
              <Folder className="h-3 w-3 shrink-0" />
              <span className="truncate">{wsDetail?.repoPath ? shortenPathMiddle(wsDetail.repoPath, 56) : ''}</span>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden bg-background flex flex-col">
            <div className="px-3 py-1.5 border-b border-border/40 bg-muted/20 text-xs flex items-center justify-between dark:border-white/[0.06]">
              <span className="font-mono truncate flex items-center gap-1.5">
                <FileText className="h-3 w-3" />
                {wsDetail?.filePath}
              </span>
              {wsDiff && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => copyText(wsDiff)}>
                  <Copy className="h-3 w-3 mr-1" /> 复制
                </Button>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {wsDiffLoading ? (
                <div className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" /> 加载中…
                </div>
              ) : wsDiff ? (
                wsDetail?.kind === 'untracked' ? (
                  <Editor
                    height="100%"
                    language={getMonacoLanguageFromPath(wsDetail?.filePath ?? '')}
                    theme={isDark ? 'vs-dark' : 'vs'}
                    value={wsDiff}
                    options={{ readOnly: true, minimap: minimapOptions, scrollBeyondLastLine: false, fontSize: 13, wordWrap: 'on', automaticLayout: true }}
                  />
                ) : (
                  <MonacoDiffEditor diff={wsDiff} filePath={wsDetail?.filePath} />
                )
              ) : (
                <div className="p-8 text-center text-xs text-muted-foreground">无内容</div>
              )}
            </div>
          </div>
          </DialogContent>
      </Dialog>

      {recentContextMenu && (
        <div
          className="fixed z-[200] min-w-[14rem] rounded-lg border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg"
          style={{ left: Math.min(Math.max(6, recentContextMenu.x), window.innerWidth - 240), top: Math.min(Math.max(6, recentContextMenu.y), window.innerHeight - 120) }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-accent"
            onClick={() => { const m=recentContextMenu; setRecentContextMenu(null); if(m) void handleRecentResetHard(m.repoPath, m.commit) }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> 快速回退（--hard，测试用）
          </button>
          <div className="px-2.5 py-1 text-[11px] text-muted-foreground">仅本地，不影响远端 · 之后可拉取恢复</div>
        </div>
      )}

      {detailFileMenu && (
        <div
          className="fixed z-[200] min-w-[14rem] rounded-lg border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg"
          style={{ left: Math.min(Math.max(6, detailFileMenu.x), window.innerWidth - 220), top: Math.min(Math.max(6, detailFileMenu.y), window.innerHeight - 140) }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="max-w-[20rem] truncate px-2.5 py-1 text-[11px] text-muted-foreground" title={detailFileMenu.filePath}>{detailFileMenu.filePath}</div>
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-accent"
            onClick={() => {
              const m=detailFileMenu; if(!m || !detailCommit) return;
              const isWin = detailCommit.repoPath.includes('\\')
              const sep = isWin ? '\\' : '/'
              const base = detailCommit.repoPath.replace(/[\/\\]+$/, '')
              const rel = m.filePath.replace(/^[\/\\]+/, '').replace(/\//g, sep).replace(/\\/g, sep)
              const full = base + sep + rel
              setDetailFileMenu(null); void copyText(full)
            }}
          >
            <Copy className="h-3.5 w-3.5" /> 复制全路径
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-accent"
            onClick={() => { const p=detailFileMenu.filePath; setDetailFileMenu(null); void copyText(p) }}
          >
            <Copy className="h-3.5 w-3.5" /> 复制相对路径
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-accent"
            onClick={() => { const p=detailFileMenu.filePath.split('/').pop() || detailFileMenu.filePath.split('\\').pop() || detailFileMenu.filePath; setDetailFileMenu(null); void copyText(p) }}
          >
            <Copy className="h-3.5 w-3.5" /> 复制文件名
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-accent"
            onClick={() => {
              const m=detailFileMenu; setDetailFileMenu(null); if(!m || !detailCommit) return;
              // 保留原分隔符，拼接为文件全路径，让后端 explorer /select 高亮文件（若文件不存在则打开父目录）
              const isWin = detailCommit.repoPath.includes('\\')
              const sep = isWin ? '\\' : '/'
              const base = detailCommit.repoPath.replace(/[\/\\]+$/, '')
              const rel = m.filePath.replace(/^[\/\\]+/, '').replace(/\//g, sep).replace(/\\/g, sep)
              const full = base + sep + rel
              void openFolder(full)
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" /> 在文件管理器打开并选中
          </button>
        </div>
      )}
    </div>
  )
}
