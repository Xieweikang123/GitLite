import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { open } from '@tauri-apps/api/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { MonacoDiffEditor } from './MonacoDiffEditor'
import { DirectoryRepoEntry, CommitInfo, WorkspaceStatus, MultiRepoAutoFetchConfig } from '../types/git'
import { MultiRepoBranchSelect } from './MultiRepoBranchSelect'
import { getClientCalendarOffsetEastMinutes } from '../utils/clientCalendarOffset'
import {
  FolderOpen,
  RefreshCw,
  Search,
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
  Unlink,
  ExternalLink,
  LogIn,
  Filter,
  Copy,
  Download,
  Upload,
  Eye,
  FileText,
  Timer,
} from 'lucide-react'
import { shortenPathMiddle } from '../lib/utils'
import { formatTauriInvokeError } from '../utils/tauriError'
import { Switch } from './ui/switch'
import { SimpleSelect } from './SimpleSelect'
import { Label } from './ui/label'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

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
/** 仅刷新当前展开的工作区，与单仓库页间隔对齐，不扫全部子仓 */
const WORKSPACE_POLL_MS = 10_000
const WORKSPACE_FOCUS_DEBOUNCE_MS = 400
const EMPTY_WORKSPACE: WorkspaceStatus = {
  staged_files: [],
  unstaged_files: [],
  untracked_files: [],
  conflicted_files: [],
}

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

function repoNeedsPush(e: DirectoryRepoEntry): boolean {
  if (!e.has_origin_remote) return false
  return e.ahead > 0 || !e.has_upstream
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'clean' | 'dirty' | 'sync'>('all')
  const [recentOpen, setRecentOpen] = useState(false)
  const [pullingPath, setPullingPath] = useState<string | null>(null)
  const [pushingPath, setPushingPath] = useState<string | null>(null)
  const [checkoutPath, setCheckoutPath] = useState<string | null>(null)
  const [batchPulling, setBatchPulling] = useState(false)
  const [batchPushing, setBatchPushing] = useState(false)
  const [fetchingAll, setFetchingAll] = useState(false)
  const [fetchingPaths, setFetchingPaths] = useState<Set<string>>(new Set())
  const [fetchDoneCount, setFetchDoneCount] = useState(0)
  const [autoFetchConfig, setAutoFetchConfig] = useState<MultiRepoAutoFetchConfig>({ enabled: false, interval_minutes: 30 })
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null)
  const [autoFetchSaving, setAutoFetchSaving] = useState(false)
  const [, setLastFetchTick] = useState(0)
  const handleFetchAllRef = useRef<(() => Promise<void>) | null>(null)
  const fetchAllInFlightRef = useRef(false)
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [activeDetailTab, setActiveDetailTab] = useState<'incoming' | 'outgoing' | 'workspace' | 'recent'>('incoming')
  const [detailTabCache, setDetailTabCache] = useState<Record<string, 'incoming' | 'outgoing' | 'workspace' | 'recent'>>({})
  const [incomingCache, setIncomingCache] = useState<Record<string, CommitInfo[]>>({})
  const [incomingLoading, setIncomingLoading] = useState<string | null>(null)
  const [outgoingCache, setOutgoingCache] = useState<Record<string, CommitInfo[]>>({})
  const [outgoingLoading, setOutgoingLoading] = useState<string | null>(null)
  const [workspaceCache, setWorkspaceCache] = useState<Record<string, WorkspaceStatus>>({})
  const [workspaceLoading, setWorkspaceLoading] = useState<Record<string, boolean>>({})
  const workspaceCacheRef = useRef<Record<string, WorkspaceStatus>>({})
  const workspaceInFlightRef = useRef<Set<string>>(new Set())
  const workspaceFetchGenRef = useRef<Record<string, number>>({})
  const lastWorkspaceFocusRefreshRef = useRef(0)
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
  workspaceCacheRef.current = workspaceCache

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
      } catch { /* 忽略读取失败 */ }
      return []
    }
  }, [])

  useEffect(() => {
    invoke<{ auto_fetch: MultiRepoAutoFetchConfig; last_fetch_at: string | null }>('get_multi_repo_fetch_state')
      .then((state) => {
        setAutoFetchConfig(state.auto_fetch)
        setLastFetchAt(state.last_fetch_at)
      })
      .catch(() => {})
  }, [])

  const saveAutoFetchConfig = useCallback(async (next: MultiRepoAutoFetchConfig) => {
    setAutoFetchSaving(true)
    try {
      await invoke('save_multi_repo_auto_fetch_config', { config: next })
      setAutoFetchConfig(next)
    } catch (err) {
      setError(formatTauriInvokeError(err, '保存定时获取设置失败'))
    } finally {
      setAutoFetchSaving(false)
    }
  }, [])

  const recordLastFetch = useCallback(async () => {
    try {
      const at = await invoke<string>('record_multi_repo_fetch')
      setLastFetchAt(at)
    } catch { /* 忽略记录失败 */ }
  }, [])

  useEffect(() => {
    if (!lastFetchAt) return
    const id = window.setInterval(() => setLastFetchTick((t) => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [lastFetchAt])

  const persistRecentScannedFallback = (path: string, rec: boolean) => {
    try {
      const raw = localStorage.getItem(RECENT_SCANNED_KEY)
      let list: ScannedDirRecord[] = raw ? JSON.parse(raw) : []
      list = list.filter((r) => r.path !== path)
      list.unshift({ path, last_scanned: new Date().toISOString(), recursive: rec })
      if (list.length > 20) list.length = 20
      localStorage.setItem(RECENT_SCANNED_KEY, JSON.stringify(list))
      setRecentScanned(list)
    } catch { /* 忽略保存失败 */ }
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
        } catch { /* 忽略恢复失败 */ }
      } else if (!restored) {
        setRestored(true)
      }
    })()
  }, [loadRecentScanned, restored])

  // 恢复上次的展开状态与 tab 记忆（StrictMode 双挂载只执行一次，避免空值覆盖）
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
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
    } catch { /* 忽略恢复失败 */ }
  }, [])

  useEffect(() => {
    if (!restoredRef.current) return
    try {
      localStorage.setItem(DETAIL_TAB_CACHE_KEY, JSON.stringify(detailTabCache))
    } catch { /* 忽略保存失败 */ }
  }, [detailTabCache])

  useEffect(() => {
    if (!restoredRef.current) return
    try {
      if (expandedPath) {
        localStorage.setItem(EXPANDED_STATE_KEY, JSON.stringify({ path: expandedPath, tab: activeDetailTab }))
      } else {
        localStorage.removeItem(EXPANDED_STATE_KEY)
      }
    } catch { /* 忽略保存失败 */ }
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
        // 扫描会更新表格计数；丢掉文件列表缓存，避免角标新、列表旧
        setWorkspaceCache({})
        try {
          await invoke('save_recent_scanned_dir', { path, recursive: rec })
          await loadRecentScanned()
        } catch {
          persistRecentScannedFallback(path, rec)
        }
      } catch (err) {
        setError(formatTauriInvokeError(err, '扫描失败'))
        setEntries(null)
        setWorkspaceCache({})
      } finally {
        setLoading(false)
      }
    },
    [dirPath, recursive, loadRecentScanned]
  )

  const patchEntry = useCallback((updated: DirectoryRepoEntry) => {
    setEntries((prev) => {
      if (!prev) return prev
      return prev.map((e) => (e.path === updated.path ? updated : e))
    })
  }, [])

  const refreshOneEntry = useCallback(
    async (repoPath: string) => {
      const updated: DirectoryRepoEntry = await invoke('get_directory_repo_entry', { repoPath })
      patchEntry(updated)
      setIncomingCache((m) => {
        const c = { ...m }
        delete c[repoPath]
        return c
      })
      setOutgoingCache((m) => {
        const c = { ...m }
        delete c[repoPath]
        return c
      })
      setRecentCache((m) => {
        const c = { ...m }
        delete c[repoPath]
        return c
      })
      setWorkspaceCache((m) => {
        const c = { ...m }
        delete c[repoPath]
        return c
      })
      return updated
    },
    [patchEntry]
  )

  const handleCheckoutBranch = useCallback(
    async (repoPath: string, branchName: string) => {
      setCheckoutPath(repoPath)
      setError(null)
      try {
        await invoke('checkout_branch', { repoPath, branchName })
        await refreshOneEntry(repoPath)
      } catch (err) {
        setError(
          formatTauriInvokeError(err, `切换分支失败 ${shortenPathMiddle(repoPath, 40)}`)
        )
      } finally {
        setCheckoutPath(null)
      }
    },
    [refreshOneEntry]
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
      await handlePull(e.path)
    }
    setBatchPulling(false)
  }, [entries, scannedDir, handlePull])

  const handlePush = useCallback(
    async (repoPath: string) => {
      const before = entries?.find((e) => e.path === repoPath)
      void invoke('append_gitlite_log', { level: 'INFO', message: `[DIAG][push][multi] start path=${repoPath} beforeAhead=${before?.ahead ?? '?'} hasUpstream=${before?.has_upstream ?? '?'}` }).catch(()=>{})
      setPushingPath(repoPath)
      setError(null)
      try {
        await invoke('push_changes', { repoPath })
        void invoke('append_gitlite_log', { level: 'INFO', message: `[DIAG][push][multi] push ok path=${repoPath}` }).catch(()=>{})
        setIncomingCache((m) => { const c={...m}; delete c[repoPath]; return c })
        setOutgoingCache((m) => { const c={...m}; delete c[repoPath]; return c })
        setRecentCache((m) => { const c={...m}; delete c[repoPath]; return c })
        setWorkspaceCache((m) => { const c={...m}; delete c[repoPath]; return c })
        if (scannedDir) await doScan(scannedDir)
      } catch (err) {
        void invoke('append_gitlite_log', { level: 'ERROR', message: `[DIAG][push][multi] fail path=${repoPath} err=${String(err)}` }).catch(()=>{})
        setError(formatTauriInvokeError(err, `推送失败 ${shortenPathMiddle(repoPath, 40)}`))
      } finally {
        setPushingPath(null)
      }
    },
    [scannedDir, doScan, entries]
  )

  const handleBatchPush = useCallback(async () => {
    if (!entries || !scannedDir) return
    const needPush = entries.filter(repoNeedsPush)
    if (needPush.length === 0) return
    setBatchPushing(true)
    for (const e of needPush) {
      await handlePush(e.path)
    }
    setBatchPushing(false)
  }, [entries, scannedDir, handlePush])

  const handleFetchAll = useCallback(async () => {
    if (!entries || !scannedDir || fetchAllInFlightRef.current) return
    fetchAllInFlightRef.current = true
    setFetchingAll(true)
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
          } catch { /* 忽略单仓获取失败 */ }
          finally {
            // 逐个完成时更新进度与高亮
            setFetchingPaths((prev) => {
              const n = new Set(prev)
              n.delete(e.path)
              return n
            })
            setFetchDoneCount((c) => c + 1)
          }
        })
      )
      await doScan(scannedDir)
      // 获取后 behind 可能变化，旧待拉/待推缓存失效
      setIncomingCache({})
      setOutgoingCache({})
      setRecentCache({})
      await recordLastFetch()
      void invoke('append_gitlite_log', { level: 'INFO', message: `[DIAG][fetch][multi] all done` }).catch(()=>{})
    } catch (err) {
      setError(formatTauriInvokeError(err, '全部获取失败'))
    } finally {
      fetchAllInFlightRef.current = false
      setFetchingAll(false)
      setFetchingPaths(new Set())
    }
  }, [entries, scannedDir, doScan, recordLastFetch])

  handleFetchAllRef.current = handleFetchAll

  useEffect(() => {
    if (!autoFetchConfig.enabled || !entries?.length) return
    const ms = autoFetchConfig.interval_minutes * 60 * 1000
    const id = window.setInterval(() => {
      void handleFetchAllRef.current?.()
    }, ms)
    return () => window.clearInterval(id)
  }, [autoFetchConfig.enabled, autoFetchConfig.interval_minutes, entries?.length])

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

  const patchEntryWorkspaceCounts = useCallback((repoPath: string, ws: WorkspaceStatus) => {
    setEntries((prev) =>
      prev
        ? prev.map((e) =>
            e.path === repoPath
              ? {
                  ...e,
                  staged_count: ws.staged_files.length,
                  unstaged_count: ws.unstaged_files.length,
                  untracked_count: ws.untracked_files.length,
                  conflicted_count: ws.conflicted_files?.length ?? 0,
                }
              : e
          )
        : prev
    )
  }, [])

  const refreshWorkspace = useCallback(
    async (repoPath: string, opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true
      if (workspaceInFlightRef.current.has(repoPath)) return
      workspaceInFlightRef.current.add(repoPath)
      const gen = (workspaceFetchGenRef.current[repoPath] ?? 0) + 1
      workspaceFetchGenRef.current[repoPath] = gen
      const hadCache = !!workspaceCacheRef.current[repoPath]
      const showLoading = !silent || !hadCache
      if (showLoading) {
        setWorkspaceLoading((prev) => (prev[repoPath] ? prev : { ...prev, [repoPath]: true }))
      }
      try {
        const ws: WorkspaceStatus = await invoke('get_workspace_status', { repoPath })
        if (workspaceFetchGenRef.current[repoPath] !== gen) return
        setWorkspaceCache((m) => ({ ...m, [repoPath]: ws }))
        patchEntryWorkspaceCounts(repoPath, ws)
      } catch {
        if (workspaceFetchGenRef.current[repoPath] !== gen) return
        if (!hadCache) {
          setWorkspaceCache((m) => ({ ...m, [repoPath]: EMPTY_WORKSPACE }))
        }
      } finally {
        workspaceInFlightRef.current.delete(repoPath)
        if (workspaceFetchGenRef.current[repoPath] === gen) {
          setWorkspaceLoading((prev) => {
            if (!prev[repoPath]) return prev
            const next = { ...prev }
            delete next[repoPath]
            return next
          })
        }
      }
    },
    [patchEntryWorkspaceCounts]
  )

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

  const toggleDetail = useCallback(
    (entry: DirectoryRepoEntry, forceTab?: 'incoming' | 'outgoing' | 'workspace' | 'recent') => {
      const repoPath = entry.path
      const isSame = expandedPath === repoPath
      if (isSame && !forceTab) {
        setDetailTabCache((m) => ({ ...m, [repoPath]: activeDetailTab }))
        setExpandedPath(null)
        return
      }
      if (isSame && forceTab) {
        if (activeDetailTab === forceTab) {
          setDetailTabCache((m) => ({ ...m, [repoPath]: activeDetailTab }))
          setExpandedPath(null)
          return
        }
        setActiveDetailTab(forceTab)
        setDetailTabCache((m) => ({ ...m, [repoPath]: forceTab }))
        if (forceTab === 'incoming' && entry.behind > 0 && (!incomingCache[repoPath] || incomingCache[repoPath].length === 0)) {
          void refreshIncoming(repoPath, entry.behind)
        } else if (forceTab === 'outgoing') {
          if (!outgoingCache[repoPath]) void fetchOutgoingIfNeeded(repoPath)
          else if (entry.ahead > 0 && outgoingCache[repoPath].length === 0) void refreshOutgoing(repoPath)
        } else if (forceTab === 'workspace') {
          void refreshWorkspace(repoPath)
        } else if (forceTab === 'recent') {
          void fetchRecentIfNeeded(repoPath)
        }
        return
      }
      const cached = detailTabCache[repoPath] as 'incoming' | 'outgoing' | 'workspace' | 'recent' | undefined
      const fallback: 'incoming' | 'outgoing' | 'workspace' | 'recent' =
        entry.behind > 0 ? 'incoming' : entry.ahead > 0 ? 'outgoing' : 'workspace'
      const targetTab = forceTab ?? cached ?? fallback
      setExpandedPath(repoPath)
      setActiveDetailTab(targetTab)
      setDetailTabCache((m) => ({ ...m, [repoPath]: targetTab }))
      if (targetTab === 'incoming' && entry.behind > 0 && !incomingCache[repoPath]) {
        void refreshIncoming(repoPath, entry.behind)
      } else if (targetTab === 'outgoing' && !outgoingCache[repoPath]) {
        void fetchOutgoingIfNeeded(repoPath)
      } else if (targetTab === 'outgoing' && entry.ahead > 0 && outgoingCache[repoPath]?.length === 0) {
        void refreshOutgoing(repoPath)
      } else if (targetTab === 'workspace') {
        void refreshWorkspace(repoPath)
      } else if (targetTab === 'recent' && !recentCache[repoPath]) {
        void fetchRecentIfNeeded(repoPath)
      }
    },
    [
      expandedPath,
      activeDetailTab,
      incomingCache,
      outgoingCache,
      recentCache,
      detailTabCache,
      fetchOutgoingIfNeeded,
      refreshWorkspace,
      fetchRecentIfNeeded,
      refreshIncoming,
      refreshOutgoing,
    ]
  )

  const handleDetailTab = (tab: 'incoming' | 'outgoing' | 'workspace' | 'recent', entry: DirectoryRepoEntry) => {
    setActiveDetailTab(tab)
    setDetailTabCache((m) => ({ ...m, [entry.path]: tab }))
    if (tab === 'incoming') {
      if (entry.behind > 0 && !incomingCache[entry.path] && incomingLoading !== entry.path) void refreshIncoming(entry.path, entry.behind)
      // 已清缓存但 behind>0 时强制刷新，避免“角标1但列表空”
      if (entry.behind > 0 && incomingCache[entry.path]?.length === 0) void refreshIncoming(entry.path, entry.behind)
    }
    if (tab === 'outgoing') {
      if (!outgoingCache[entry.path]) void fetchOutgoingIfNeeded(entry.path)
      if (entry.ahead > 0 && outgoingCache[entry.path]?.length === 0) void refreshOutgoing(entry.path)
    }
    if (tab === 'workspace') void refreshWorkspace(entry.path)
    if (tab === 'recent') void fetchRecentIfNeeded(entry.path)
  }

  // 持久化恢复 / 扫描清缓存后，补拉当前展开 tab
  useEffect(() => {
    if (!expandedPath || !entries) return
    const entry = entries.find((e) => e.path === expandedPath)
    if (!entry) return
    if (activeDetailTab === 'workspace' && !workspaceCache[expandedPath] && !workspaceLoading[expandedPath]) {
      void refreshWorkspace(expandedPath)
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
  }, [expandedPath, activeDetailTab, entries, workspaceCache, outgoingCache, recentCache, incomingCache, workspaceLoading, outgoingLoading, recentLoading, recentError, incomingLoading, refreshWorkspace, fetchOutgoingIfNeeded, fetchRecentIfNeeded])

  // 回到前台时只刷新当前展开的工作区（IDE/终端改完文件后最常见）
  useEffect(() => {
    const maybeRefresh = () => {
      if (document.visibilityState === 'hidden') return
      if (!expandedPath || activeDetailTab !== 'workspace') return
      const now = Date.now()
      if (now - lastWorkspaceFocusRefreshRef.current < WORKSPACE_FOCUS_DEBOUNCE_MS) return
      lastWorkspaceFocusRefreshRef.current = now
      void refreshWorkspace(expandedPath, { silent: true })
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') maybeRefresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', maybeRefresh)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', maybeRefresh)
    }
  }, [expandedPath, activeDetailTab, refreshWorkspace])

  // 工作区标签保持展开时静默轮询当前仓，覆盖左右分屏、窗口未失焦的情况
  useEffect(() => {
    if (!expandedPath || activeDetailTab !== 'workspace') return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void refreshWorkspace(expandedPath, { silent: true })
    }, WORKSPACE_POLL_MS)
    return () => window.clearInterval(id)
  }, [expandedPath, activeDetailTab, refreshWorkspace])

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
        diff = await invoke<string>('get_untracked_file_content', { repoPath, filePath })
        console.log('[GitLite][wsDetail] untracked diff', filePath, 'diffLen', diff.length)
        void invoke('append_gitlite_log', { level: 'INFO', message: `[wsDetail] untracked ${filePath} diffLen=${diff.length}` }).catch(() => {})
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
    } catch { /* 忽略打开失败 */ }
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch { /* 忽略剪贴板写入失败 */ }
  }

  const filteredEntries = useMemo(() => {
    if (!entries) return null
    const q = filter.trim().toLowerCase()
    return entries.filter((e) => {
      if (statusFilter === 'clean' && e.staged_count + e.unstaged_count + e.untracked_count + e.conflicted_count !== 0) return false
      if (statusFilter === 'dirty' && e.staged_count + e.unstaged_count + e.untracked_count + e.conflicted_count === 0) return false
      if (statusFilter === 'sync' && e.ahead === 0 && e.behind === 0) return false
      if (!q) return true
      return (
        e.name.toLowerCase().includes(q) ||
        e.path.toLowerCase().includes(q) ||
        e.current_branch.toLowerCase().includes(q) ||
        (e.remote_url ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, filter, statusFilter])

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
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="rounded-md bg-primary/10 p-1.5">
              <Layers className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-[13px] leading-none flex items-center gap-2 truncate">
                多仓库一览
                {stats && (
                  <Badge variant="secondary" className="font-mono text-[10px] h-5 px-1.5">
                    {stats.total}
                  </Badge>
                )}
              </CardTitle>
              <p className="mt-1 text-[11px] text-muted-foreground truncate">
                选择父目录自动发现子仓库，支持一键打开
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0">
          {/* 输入行 + 选项 同行 */}
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative flex-1">
              <FolderOpen className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={dirPath}
                onChange={(e) => setDirPath(e.target.value)}
                placeholder="D:\project  或  /home/user/projects"
                className="pl-8 font-mono text-xs h-8 border-border/50 bg-muted/20 hover:bg-muted/30 focus:border-primary/40 focus:bg-background focus-visible:ring-0 focus-visible:ring-offset-0"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doScan()
                }}
              />
            </div>
            <Button variant="outline" size="sm" className="h-8 px-3 text-xs shrink-0" onClick={pickFolder} disabled={loading}>
              浏览…
            </Button>
            <Button size="sm" className="h-8 px-4 text-xs shadow-sm shrink-0" onClick={() => void doScan()} disabled={loading || !dirPath.trim()}>
              {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" /> : <Search className="h-3.5 w-3.5 mr-1" />}
              扫描
            </Button>
            <label className="flex h-8 items-center gap-2 text-xs cursor-pointer select-none group shrink-0">
              <Switch
                checked={recursive}
                onCheckedChange={setRecursive}
                className="h-5 w-9 border-0 [&>span]:h-4 [&>span]:w-4"
              />
              <span className="leading-none text-muted-foreground group-hover:text-foreground">递归</span>
            </label>
            {entries && (
              <div className="relative min-w-0">
                <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="过滤"
                  className="h-8 pl-7 w-28 text-xs"
                />
              </div>
            )}
            {scannedDir && entries && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 shrink-0"
                onClick={handleRefresh}
                disabled={loading}
                title="刷新"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
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
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2">
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${statusFilter === 'all' ? 'border-primary/45 bg-primary/10 text-primary' : 'border-border/60 text-muted-foreground hover:border-primary/30 hover:text-foreground'}`}
                onClick={() => setStatusFilter('all')}
              >
                全部 <span className="font-mono">{stats.total}</span>
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${statusFilter === 'clean' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-border/60 text-muted-foreground hover:border-emerald-500/30 hover:text-foreground'}`}
                onClick={() => setStatusFilter(statusFilter === 'clean' ? 'all' : 'clean')}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                干净 <span className="font-mono">{stats.clean}</span>
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${statusFilter === 'dirty' ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'border-border/60 text-muted-foreground hover:border-amber-500/30 hover:text-foreground'}`}
                onClick={() => setStatusFilter(statusFilter === 'dirty' ? 'all' : 'dirty')}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                有改动 <span className="font-mono">{stats.dirty}</span>
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${statusFilter === 'sync' ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400' : 'border-border/60 text-muted-foreground hover:border-sky-500/30 hover:text-foreground'}`}
                onClick={() => setStatusFilter(statusFilter === 'sync' ? 'all' : 'sync')}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                待同步 <span className="font-mono">{stats.needSync}</span>
              </button>

              {recentScanned.length > 0 && (
                <Popover open={recentOpen} onOpenChange={setRecentOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <Clock className="h-3 w-3" />
                      最近 {recentScanned.length}
                      {recentOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[320px] max-h-72 overflow-y-auto p-1">
                    {recentScanned.map((r) => (
                      <div
                        key={r.path}
                        className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/60"
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          title={`${r.path} · ${timeAgo(r.last_scanned)}`}
                          onClick={() => {
                            setDirPath(r.path)
                            setRecursive(r.recursive)
                            void doScan(r.path, r.recursive)
                            setRecentOpen(false)
                          }}
                        >
                          <div className="truncate font-mono text-[11px]">{shortenPathMiddle(r.path, 34)}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {timeAgo(r.last_scanned)}{r.recursive ? ' · 递归' : ''}
                          </div>
                        </button>
                        <button
                          type="button"
                          className="rounded-full p-1 opacity-40 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          title="移除"
                          onClick={async () => {
                            try {
                              await invoke('remove_recent_scanned_dir', { path: r.path })
                              await loadRecentScanned()
                            } catch {
                              const raw = localStorage.getItem(RECENT_SCANNED_KEY)
                              const list: ScannedDirRecord[] = raw ? JSON.parse(raw) : []
                              const next = list.filter((x) => x.path !== r.path)
                              localStorage.setItem(RECENT_SCANNED_KEY, JSON.stringify(next))
                              setRecentScanned(next)
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 表格区 */}
      <div className="flex-1 min-h-0">
        {!entries && loading ? (
          <Card className="overflow-hidden border shadow-sm">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" />
              正在扫描 {shortenPathMiddle(dirPath, 40)}…
            </div>
            <div className="divide-y divide-border/60" aria-hidden>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4 px-3 py-3">
                  <div className="flex flex-col gap-1.5 w-[36%] min-w-0">
                    <div className="h-3.5 rounded bg-muted animate-pulse" style={{ width: `${45 + ((i * 13) % 30)}%` }} />
                    <div className="h-2.5 rounded bg-muted/70 animate-pulse" style={{ width: `${60 + ((i * 7) % 25)}%` }} />
                  </div>
                  <div className="h-5 w-20 rounded bg-muted animate-pulse" />
                  <div className="h-5 w-16 rounded bg-muted animate-pulse" />
                  <div className="h-5 w-14 rounded bg-muted animate-pulse" />
                  <div className="ml-auto flex gap-1.5">
                    <div className="h-7 w-14 rounded-md bg-muted animate-pulse" />
                    <div className="h-7 w-14 rounded-md bg-muted animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : !entries ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-3">
              <div className="rounded-full bg-muted p-4">
                <Layers className="h-6 w-6 opacity-60" />
              </div>
              <div className="text-center">
                <p className="font-medium text-foreground">尚未扫描</p>
                <p className="text-xs mt-1">选择目录并点击“扫描”，将以表格展示子仓库的分支与工作区状态，可直接切换分支</p>
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
            <div className="flex flex-col gap-2 border-b bg-muted/30 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-muted-foreground flex flex-col gap-1.5 min-w-0 sm:flex-row sm:items-center sm:gap-3">
                <span className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span>
                    共 <span className="font-medium text-foreground">{entries.length}</span> 个仓库
                    {filter && filteredEntries && filteredEntries.length !== entries.length && (
                      <span> · 已过滤 {filteredEntries.length} 个</span>
                    )}
                    {stats && stats.needSync > 0 && <span className="ml-2 text-amber-600 dark:text-amber-400">· {stats.needSync} 个待同步</span>}
                  </span>
                  {lastFetchAt && (
                    <span className="inline-flex items-center gap-1 text-[11px]" title={new Date(lastFetchAt).toLocaleString()}>
                      <Clock className="h-3 w-3 shrink-0" />
                      上次获取 {timeAgo(lastFetchAt)}
                    </span>
                  )}
                  {fetchingAll && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-primary truncate max-w-[260px]" title={Array.from(fetchingPaths).join(', ')}>
                      <RefreshCw className="h-3 w-3 animate-spin shrink-0" />
                      <span className="truncate">
                        {fetchingPaths.size > 0
                          ? `并发获取中 ${fetchDoneCount}/${entries.length} · 剩余 ${fetchingPaths.size} 个`
                          : `获取中 ${fetchDoneCount}/${entries.length}`}
                      </span>
                    </span>
                  )}
                </span>
                <span className="inline-flex items-center gap-2 shrink-0">
                  <Timer className="h-3 w-3 text-muted-foreground" aria-hidden />
                  <Label className="text-[11px] text-muted-foreground whitespace-nowrap">定时获取</Label>
                  <Switch
                    checked={autoFetchConfig.enabled}
                    disabled={autoFetchSaving || fetchingAll}
                    onCheckedChange={(checked) => {
                      void saveAutoFetchConfig({ ...autoFetchConfig, enabled: checked })
                    }}
                  />
                  {autoFetchConfig.enabled && (
                    <SimpleSelect
                      size="xs"
                      triggerClassName="h-6 px-1.5 text-[11px]"
                      value={String(autoFetchConfig.interval_minutes)}
                      disabled={autoFetchSaving}
                      onValueChange={(v) => {
                        void saveAutoFetchConfig({
                          ...autoFetchConfig,
                          interval_minutes: Number(v),
                        })
                      }}
                      options={[
                        { value: '5', label: '5 分钟' },
                        { value: '10', label: '10 分钟' },
                        { value: '15', label: '15 分钟' },
                        { value: '30', label: '30 分钟' },
                        { value: '60', label: '1 小时' },
                      ]}
                    />
                  )}
                </span>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void handleFetchAll()}
                  disabled={loading || batchPulling || batchPushing || fetchingAll}
                  title="对全部仓库执行 git fetch"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1 ${fetchingAll ? 'animate-spin' : ''}`} />
                  {fetchingAll ? `获取中 ${fetchDoneCount}/${entries.length}` : '全部获取'}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void handleBatchPull()}
                  disabled={batchPulling || batchPushing || loading || fetchingAll || !entries.some((e) => e.behind > 0)}
                  title={entries.some((e) => e.behind > 0) ? `拉取 ${entries.filter((e) => e.behind > 0).length} 个待拉仓库` : '暂无待拉仓库'}
                >
                  {batchPulling ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                  {batchPulling ? '拉取中…' : `全部拉取${entries.filter((e) => e.behind > 0).length > 0 ? ` (${entries.filter((e) => e.behind > 0).length})` : ''}`}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void handleBatchPush()}
                  disabled={batchPulling || batchPushing || loading || fetchingAll || !entries.some(repoNeedsPush)}
                  title={
                    entries.some(repoNeedsPush)
                      ? `推送 ${entries.filter(repoNeedsPush).length} 个待推仓库`
                      : '暂无待推仓库'
                  }
                >
                  {batchPushing ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                  {batchPushing ? '推送中…' : `全部推送${entries.filter(repoNeedsPush).length > 0 ? ` (${entries.filter(repoNeedsPush).length})` : ''}`}
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
                    const isPushingThis = pushingPath === entry.path
                    return (
                      <React.Fragment key={entry.path}>
                        <tr className={`group hover:bg-muted/30 transition-colors ${isDirty ? 'bg-amber-500/[0.02]' : ''} ${isExpanded ? 'bg-muted/20' : ''} ${isFetchingThis || isPushingThis ? 'bg-primary/[0.06] ring-1 ring-inset ring-primary/20' : ''}`}>
                        
                        <td className="px-3 py-2.5 align-top">
                          <div className="flex flex-col gap-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <button
                                onClick={() => toggleDetail(entry)}
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
                          <MultiRepoBranchSelect
                            currentBranch={entry.current_branch}
                            headShortId={entry.head_short_id}
                            branches={entry.branches ?? []}
                            loading={checkoutPath === entry.path}
                            disabled={batchPulling || batchPushing || fetchingAll || pullingPath === entry.path || pushingPath === entry.path}
                            onSelect={(name) => void handleCheckoutBranch(entry.path, name)}
                            onNeedBranches={() => void refreshOneEntry(entry.path)}
                          />
                        </td>
                        <td className="px-2 py-2.5 align-top">
                          <div className="flex flex-wrap gap-1.5 items-center">
                            {isFetchingThis && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-primary whitespace-nowrap">
                                <RefreshCw className="h-3 w-3 animate-spin" /> 获取中
                              </span>
                            )}
                            {isPushingThis && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-primary whitespace-nowrap">
                                <RefreshCw className="h-3 w-3 animate-spin" /> 推送中
                              </span>
                            )}
                            {entry.ahead > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleDetail(entry, 'outgoing')}
                                title="点击查看待推送的提交详情"
                                className="inline-flex whitespace-nowrap"
                              >
                                <Badge
                                  variant="default"
                                  className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] px-2.5 py-0 h-6 cursor-pointer hover:bg-primary/90 shrink-0"
                                >
                                  <ArrowUp className="h-3 w-3 shrink-0" />
                                  <span className="whitespace-nowrap">{entry.ahead} 待推</span>
                                  {expandedPath === entry.path && activeDetailTab === 'outgoing' ? (
                                    <ChevronUp className="h-3 w-3 shrink-0" />
                                  ) : (
                                    <ChevronDown className="h-3 w-3 shrink-0" />
                                  )}
                                </Badge>
                              </button>
                            )}
                            {entry.behind > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleDetail(entry, 'incoming')}
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
                                title="当前分支还没有对应的远程分支。新分支常见；首次推送即可在远程创建并关联。"
                                className="inline-flex items-center gap-1 whitespace-nowrap border-amber-500/30 text-amber-700 dark:text-amber-400 bg-amber-500/10 h-6 shrink-0"
                              >
                                <Unlink className="h-3 w-3 shrink-0" /> <span className="whitespace-nowrap">未关联远程</span>
                              </Badge>
                            )}
                            {!entry.has_origin_remote && (
                              <span
                                className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground shrink-0"
                                title="仓库还没有名为 origin 的远程地址"
                              >
                                <Unlink className="h-3 w-3 shrink-0" /> <span className="whitespace-nowrap">未配置远程</span>
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
                                disabled={pullingPath === entry.path || pushingPath === entry.path || batchPulling || batchPushing}
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
                            {repoNeedsPush(entry) && (
                              <Button
                                size="sm"
                                className="h-7 px-2.5 text-xs"
                                disabled={pullingPath === entry.path || pushingPath === entry.path || batchPulling || batchPushing || fetchingAll}
                                onClick={() => void handlePush(entry.path)}
                                title={
                                  entry.ahead > 0
                                    ? `推送 ${entry.ahead} 个提交`
                                    : '首次推送到 origin 并关联远程分支'
                                }
                              >
                                {pushingPath === entry.path ? (
                                  <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" />
                                ) : (
                                  <Upload className="h-3.5 w-3.5 mr-1" />
                                )}
                                推送
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant={isExpanded ? 'secondary' : 'outline'}
                              className="h-7 px-2.5 text-xs shrink-0 border"
                              onClick={() => toggleDetail(entry)}
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
                                    <Button size="sm" className="h-6 text-xs px-2" disabled={pullingPath === entry.path || pushingPath === entry.path || batchPulling || batchPushing} onClick={() => void handlePull(entry.path)}>
                                      {pullingPath === entry.path ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Download className="h-3 w-3 mr-1" />}
                                      拉取
                                    </Button>
                                  )}
                                  {activeDetailTab === 'outgoing' && repoNeedsPush(entry) && (
                                    <Button size="sm" className="h-6 text-xs px-2" disabled={pullingPath === entry.path || pushingPath === entry.path || batchPulling || batchPushing} onClick={() => void handlePush(entry.path)}>
                                      {pushingPath === entry.path ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
                                      推送
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
                                    disabled={incomingLoading === entry.path || outgoingLoading === entry.path || !!workspaceLoading[entry.path] || recentLoading === entry.path}
                                  >
                                    <RefreshCw className={`h-3 w-3 ${incomingLoading === entry.path || outgoingLoading === entry.path || !!workspaceLoading[entry.path] || recentLoading === entry.path ? 'animate-spin' : ''}`} />
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
                                  (workspaceLoading[entry.path] && !workspaceCache[entry.path] ? (
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
                                        { title: `未跟踪 ${workspaceCache[entry.path]!.untracked_files.length}`, files: workspaceCache[entry.path]!.untracked_files.map((p: string) => ({ path: p, status: 'untracked' as const })), kind: 'untracked' as const },
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
                                              group.files.slice(0, 50).map((f: { path: string }) => (
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
              <div className="flex-1 min-h-[280px] overflow-hidden bg-background">
                {detailDiffLoading ? (
                  <div className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    加载差异中…
                  </div>
                ) : detailDiff ? (
                  <div className="h-full min-h-[280px] w-full overflow-hidden">
                    <MonacoDiffEditor diff={detailDiff} filePath={detailSelectedFile ?? undefined} />
                  </div>
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
            <div className="flex-1 min-h-[280px] overflow-hidden">
              {wsDiffLoading ? (
                <div className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" /> 加载中…
                </div>
              ) : wsDiff ? (
                <div className="h-full min-h-[280px] w-full overflow-hidden">
                  <MonacoDiffEditor diff={wsDiff} filePath={wsDetail?.filePath} />
                </div>
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
              const base = detailCommit.repoPath.replace(/[/\\]+$/, '')
              const rel = m.filePath.replace(/^[/\\]+/, '').replace(/\//g, sep).replace(/\\/g, sep)
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
              const base = detailCommit.repoPath.replace(/[/\\]+$/, '')
              const rel = m.filePath.replace(/^[/\\]+/, '').replace(/\//g, sep).replace(/\\/g, sep)
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
