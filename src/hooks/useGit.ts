import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { open } from '@tauri-apps/api/dialog'
import {
  RepoInfo,
  CommitInfo,
  FileChange,
  RecentRepo,
  WorkspaceStatus,
  PullOutcome,
  PullWithLogsResult,
  GitResetMode,
  AuthorCommitStat,
  TimeBucketStat,
  DiffAggregateStats,
  FileTerritoryStat,
  RecentChangedFileStat,
  BranchActivityLifecycleReport,
  RemoteManagementInfo,
  DirectoryRepoEntry,
  BranchSyncOverview,
} from '../types/git'
import { formatTauriInvokeError } from '../utils/tauriError'
import { getClientCalendarOffsetEastMinutes } from '../utils/clientCalendarOffset'

/**
 * 调用后端 `open_repository` 读取仓库信息。
 *
 * `recordRecent` 决定是否把该仓库写入「最近打开」列表：
 * - 用户主动打开仓库（对话框 / 最近列表 / 克隆 / 初始化）→ `true`
 * - 纯刷新（切分支后刷新、自动刷新、文件监听、各面板取数）→ `false`
 *
 * 早期实现不区分这两者，导致每次刷新都把当前仓库重排到列表首位，
 * 并发时还会互相覆盖造成记录丢失。
 */
async function invokeOpenRepository(
  path: string,
  recordRecent: boolean,
  origin: string = 'unknown'
): Promise<RepoInfo> {
  const startedAt = performance.now()
  // origin=unknown 说明有调用点绕过了带标签的封装（直接 invoke('open_repository')）。
  // 打一段调用栈，精确定位是谁，而不是靠猜。
  const caller =
    origin === 'unknown'
      ? ' stack=' +
        (new Error().stack ?? '')
          .split('\n')
          .slice(2, 5)
          .map((s) => s.trim().replace(/\s*\(.*?\)\s*$/, ''))
          .join(' < ')
      : ''
  diag(`open_repository → origin=${origin} recordRecent=${recordRecent}${caller}`)
  try {
    const info = await invoke<RepoInfo>('open_repository', {
      path,
      clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
      recordRecent,
    })
    diag(
      `open_repository ← origin=${origin} ok ${Math.round(performance.now() - startedAt)}ms ` +
        `branch=${info.current_branch} head=${(info.head_short_id ?? '-').slice(0, 7)} ` +
        `commits=${info.commits?.length ?? 0} ahead=${info.ahead} behind=${info.behind}`
    )
    return info
  } catch (err) {
    diag(`open_repository ← origin=${origin} FAIL ${String(err)}`)
    throw err
  }
}

const AUTO_OPEN_ENABLED_KEY = 'gitlite:autoOpenEnabled'

/**
 * 临时诊断：把「谁在刷仓库元数据」写进 logs/gitlite.log（后端 append_gitlite_log）。
 * 每条带 `origin=` 调用点标记，便于按来源统计次数而非只看总数。
 * 排查结束后把 DIAG_ENABLED 置 false 即可静默，或连同调用点一起删除。
 */
const DIAG_ENABLED = true
function diag(message: string) {
  if (!DIAG_ENABLED) return
  void invoke('append_gitlite_log', {
    level: 'INFO',
    message: `[DIAG][repoinfo] ${message}`,
  }).catch(() => {
    /* 诊断日志失败不影响主流程 */
  })
}

/**
 * `RepoInfo` 的「用户可见内容」是否等价。
 *
 * `repoInfo` 是 App 的 state，被 TopToolbar / UnifiedCommitView / WorkspaceStatus
 * 当 props 消费。纯刷新每次都返回新对象，一写就整树重渲染；而提交列表 effect
 * 又会按 `headMoved` 判定「本次无效」并跳过 —— 于是出现「渲染了但什么都没变」
 * 的空转。写入前先比关键字段，等价则保持旧引用不动。
 *
 * `commits` 只比首条 id 与长度：HEAD 移动必然改变首条 id，足以覆盖切分支/拉取/提交，
 * 又避免大仓库每次刷新多花几毫秒。
 */
function repoInfoEquivalent(a: RepoInfo | null, b: RepoInfo): boolean {
  if (!a) return false
  if (a.path !== b.path) return false
  if (a.current_branch !== b.current_branch) return false
  if (a.head_short_id !== b.head_short_id) return false
  if (a.ahead !== b.ahead) return false
  if (a.behind !== b.behind) return false
  if ((a.has_upstream ?? true) !== (b.has_upstream ?? true)) return false
  if ((a.has_origin_remote ?? true) !== (b.has_origin_remote ?? true)) return false
  if ((a.remote_url ?? null) !== (b.remote_url ?? null)) return false
  if ((a.incoming_commits ?? []).length !== (b.incoming_commits ?? []).length) return false

  const ac = a.commits ?? []
  const bc = b.commits ?? []
  if (ac.length !== bc.length) return false
  if (ac.length > 0 && ac[0]?.id !== bc[0]?.id) return false

  const ab = a.branches ?? []
  const bb = b.branches ?? []
  if (ab.length !== bb.length) return false
  for (let i = 0; i < ab.length; i++) {
    if (ab[i]?.name !== bb[i]?.name) return false
    if (ab[i]?.is_current !== bb[i]?.is_current) return false
  }
  return true
}

export function useGit() {
  /** 打开仓库 / 轻量刷新的世代号：仅最后一次结果写入 state，避免异步返回乱序 */
  const repoLoadGenRef = useRef(0)
  /** 嵌套 loading 计数：世代过期时也必须 endLoading，否则分支下拉会一直 disabled */
  const loadingDepthRef = useRef(0)

  const beginLoading = useCallback(() => {
    loadingDepthRef.current += 1
    setLoading(true)
  }, [])

  const endLoading = useCallback(() => {
    loadingDepthRef.current = Math.max(0, loadingDepthRef.current - 1)
    if (loadingDepthRef.current === 0) {
      setLoading(false)
    }
  }, [])

  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>([])
  const [autoOpenEnabled, setAutoOpenEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTO_OPEN_ENABLED_KEY)
      return saved === null ? true : saved === '1'
    } catch {
      return true
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_OPEN_ENABLED_KEY, autoOpenEnabled ? '1' : '0')
    } catch {
      /* ignore storage failures */
    }
  }, [autoOpenEnabled])

  const loadRecentRepos = useCallback(async () => {
    try {
      const repos: RecentRepo[] = await invoke('get_recent_repos')
      setRecentRepos(repos)
    } catch (err) {
      console.error('Failed to load recent repos:', err)
    }
  }, [])

  const openRepository = useCallback(async () => {
    const myGen = ++repoLoadGenRef.current
    try {
      beginLoading()
      setError(null)
      
      const selectedPath = await open({
        directory: true,
        title: '选择 Git 仓库',
      })
      
      if (selectedPath && typeof selectedPath === 'string') {
        const info: RepoInfo = await invokeOpenRepository(selectedPath, true)
        if (myGen !== repoLoadGenRef.current) return
        setRepoInfo(info)
        // 刷新最近仓库列表
        loadRecentRepos()
      }
    } catch (err) {
      if (myGen === repoLoadGenRef.current) {
        setError(formatTauriInvokeError(err, '打开仓库失败'))
      }
    } finally {
      endLoading()
    }
  }, [beginLoading, endLoading, loadRecentRepos])

  const openRepositoryByPath = useCallback(async (path: string) => {
    const myGen = ++repoLoadGenRef.current
    try {
      beginLoading()
      setError(null)
      
      const info: RepoInfo = await invokeOpenRepository(path, true, 'openRepositoryByPath')
      if (myGen !== repoLoadGenRef.current) {
        diag('openRepositoryByPath STALE gen (discarded)')
        return
      }
      diag(`setRepoInfo ← openRepositoryByPath branch=${info.current_branch}`)
      setRepoInfo(info)
      // 刷新最近仓库列表
      loadRecentRepos()
    } catch (err) {
      if (myGen === repoLoadGenRef.current) {
        setError(formatTauriInvokeError(err, '打开仓库失败'))
      }
    } finally {
      endLoading()
    }
  }, [beginLoading, endLoading, loadRecentRepos])

  /**
   * 纯刷新（recordRecent=false）的合流窗口。
   *
   * 切分支会同时触发多路刷新。实测一次切换曾有 6+ 个 `open_repository`
   * 挤在同一两毫秒内、目的与结果完全相同 —— 只有最后一次的 `commits` 会被
   * 提交列表 effect 采纳（其余因 `headMoved=false` 判定无效），却各自替换了
   * 一次 `repoInfo` 引用、触发整树重渲染。
   *
   * - `inFlight`：同路径已有请求在飞 → 复用其 Promise，不再发新 IPC。
   * - `settledAt`：刚完成过同路径请求 → 复用上次结果，抑制 watcher 回声连刷。
   *
   * 只作用于纯刷新路径；用户主动打开仓库走 openRepositoryByPath，不受影响。
   */
  const REFRESH_COALESCE_MS = 300
  const refreshInFlightRef = useRef<{ path: string; promise: Promise<RepoInfo> } | null>(null)
  const refreshSettledRef = useRef<{ path: string; at: number; info: RepoInfo } | null>(null)

  /**
   * 始终指向最新 `repoInfo`。写入前要用它做内容比对，而 `refreshRepoInfo` 的
   * 闭包可能捕获了旧的 `repoInfo`（例如 checkout 里乐观更新后立刻刷新），
   * 直接拿闭包值比会把「其实没变」误判成「变了」。
   */
  const repoInfoRef = useRef<RepoInfo | null>(repoInfo)
  repoInfoRef.current = repoInfo

  /** 重新拉取仓库元数据（ahead/behind 等），不触发全局 loading，供提交面板等轻量刷新 */
  const refreshRepoInfo = useCallback(
    async (options?: { force?: boolean }): Promise<RepoInfo> => {
      if (!repoInfo) throw new Error('未打开仓库')
      const path = repoInfo.path

      if (!options?.force) {
        // 1) 已有同路径请求在飞 → 复用，避免并发重复 IPC
        const inFlight = refreshInFlightRef.current
        if (inFlight && inFlight.path === path) {
          diag(`refreshRepoInfo JOIN in-flight (no new IPC)`)
          return inFlight.promise
        }
        // 2) 刚完成过同路径请求 → 复用其结果，抑制 watcher 回声造成的连刷
        const settled = refreshSettledRef.current
        if (settled && settled.path === path && Date.now() - settled.at < REFRESH_COALESCE_MS) {
          diag(`refreshRepoInfo REUSE settled (age=${Date.now() - settled.at}ms, no new IPC)`)
          return settled.info
        }
      }

      const myGen = ++repoLoadGenRef.current
      const tag = options?.force ? 'force' : 'normal'
      // 纯刷新：不重排最近列表
      const promise = invokeOpenRepository(path, false, `refreshRepoInfo/${tag}`)
        .then((info) => {
          // 世代过期说明有更新的刷新在路上，本次结果不再写入，由后者负责
          if (myGen === repoLoadGenRef.current) {
            // 内容等价则不写 state：保持旧引用，避免整树空转重渲染（见 repoInfoEquivalent）
            if (!repoInfoEquivalent(repoInfoRef.current, info)) {
              diag(`setRepoInfo ← refreshRepoInfo/${tag} branch=${info.current_branch}`)
              setRepoInfo(info)
            } else {
              diag(`setRepoInfo SKIPPED equivalent (origin=refreshRepoInfo/${tag})`)
            }
          } else {
            diag(`refreshRepoInfo/${tag} STALE gen (result discarded)`)
          }
          refreshSettledRef.current = { path, at: Date.now(), info }
          return info
        })
        .finally(() => {
          if (refreshInFlightRef.current?.promise === promise) {
            refreshInFlightRef.current = null
          }
        })

      refreshInFlightRef.current = { path, promise }
      return promise
    },
    [repoInfo]
  )

  const refreshRepoInfoRef = useRef<
    ((options?: { force?: boolean }) => Promise<RepoInfo>) | null
  >(null)
  useEffect(() => {
    refreshRepoInfoRef.current = refreshRepoInfo
  }, [refreshRepoInfo])

  /**
   * 换仓库时清掉合流缓存：旧仓库结果留着没意义，且会让 settled 长期持有
   * 整个 RepoInfo（含 commits）。不清 inFlight——在飞的请求有自己的世代校验。
   */
  useEffect(() => {
    refreshSettledRef.current = null
  }, [repoInfo?.path])

  useEffect(() => {
    const repoPath = repoInfo?.path
    if (!repoPath) return

    let cancelled = false
    let unlisten: (() => void) | null = null

    void (async () => {
      try {
        await invoke("start_workspace_watcher", { repoPath })
        const { listen } = await import("@tauri-apps/api/event")
        if (cancelled) return
        unlisten = await listen("workspace-changed", () => {
          // 监听器只负责「工作区文件变了」。仓库元数据（分支 / HEAD / 提交历史）
          // 不该由文件系统事件驱动 —— 事件推不出「这次变化是什么」，编辑器保存、
          // 构建产物、其它 git 操作都会触发它。真正改变元数据的操作
          // （checkout / pull / push / commit）都有明确返回值，应由那些调用点直接更新。
          // 工作区文件列表由 WorkspaceStatus 自己监听同一事件刷新。
          diag('workspace-changed received (metadata refresh NOT triggered by design)')
        })
      } catch (err) {
        console.warn("Workspace file watcher unavailable:", err)
      }
    })()

    return () => {
      cancelled = true
      unlisten?.()
      void invoke("stop_workspace_watcher").catch(() => {})
    }
  }, [repoInfo?.path])

  const removeRecentRepo = useCallback(
    async (path: string) => {
      try {
        await invoke('remove_recent_repo', { path })
        await loadRecentRepos()
      } catch (err) {
        setError(formatTauriInvokeError(err, '从最近列表中删除失败'))
      }
    },
    [loadRecentRepos]
  )

  const updateRecentRepoEntry = useCallback(
    async (oldPath: string, newPath: string, newName: string) => {
      try {
        await invoke('update_recent_repo_entry', {
          oldPath,
          newPath,
          newName,
        })
        await loadRecentRepos()
        if (repoInfo?.path === oldPath && oldPath !== newPath) {
          await openRepositoryByPath(newPath)
        }
      } catch (err) {
        setError(formatTauriInvokeError(err, '更新最近项失败'))
      }
    },
    [loadRecentRepos, repoInfo?.path, openRepositoryByPath]
  )

  // 组件加载时获取最近仓库列表
  useEffect(() => {
    loadRecentRepos()
  }, [loadRecentRepos])

  // 当最近仓库列表加载完成后，自动打开最新的仓库
  useEffect(() => {
    if (autoOpenEnabled && recentRepos.length > 0 && !repoInfo) {
      openRepositoryByPath(recentRepos[0].path)
    }
  }, [recentRepos, repoInfo, openRepositoryByPath, autoOpenEnabled])

  // 通知后端当前仓库路径（用于定时静默贮藏）
  useEffect(() => {
    const path = repoInfo?.path ?? null
    invoke('set_current_repo_for_snapshot', { repoPath: path }).catch(() => {})
  }, [repoInfo?.path])

  const checkoutBranch = useCallback(async (branchName: string) => {
    if (!repoInfo) return

    const target = branchName.trim()
    try {
      beginLoading()
      setError(null)

      await invoke('checkout_branch', {
        repoPath: repoInfo.path,
        branchName: target,
      })

      // 先乐观更新当前分支，立刻解除下拉禁用，避免被随后的整仓刷新拖住
      setRepoInfo((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          current_branch: target,
          branches: prev.branches.map((b) => ({
            ...b,
            is_current: !b.is_remote && b.name === target,
          })),
        }
      })
    } catch (err) {
      const message = formatTauriInvokeError(err, '切换分支失败')
      setError(message)
      throw new Error(message)
    } finally {
      endLoading()
    }

    // 整仓信息（提交列表等）后台刷新，不阻塞分支下拉可点。
    // 这是纯刷新，不是「打开仓库」，因此不写最近列表（传 false）。
    //
    // 这是**唯一**因 checkout 而刷新元数据的地方：文件监听器已不再驱动元数据刷新，
    // 所以必须由本次调用承担。force 确保拿到新分支的 HEAD 与提交列表。
    void refreshRepoInfoRef.current?.({ force: true }).catch((err) => {
      console.error('切换后刷新仓库信息失败:', err)
    })
  }, [beginLoading, endLoading, repoInfo])

  const initRepository = useCallback(
    async (path: string, initialBranch?: string): Promise<boolean> => {
      const repoPath = path.trim()
      if (!repoPath) {
        setError('仓库路径不能为空')
        return false
      }
      try {
        setLoading(true)
        setError(null)
        await invoke('init_repository', {
          path: repoPath,
          initialBranch: initialBranch?.trim() || undefined,
        })
        const info: RepoInfo = await invokeOpenRepository(repoPath, true)
        setRepoInfo(info)
        await loadRecentRepos()
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '初始化仓库失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [loadRecentRepos]
  )

  const cloneRepository = useCallback(
    async (
      remoteUrl: string,
      destinationPath: string,
      branch?: string
    ): Promise<boolean> => {
      const url = remoteUrl.trim()
      const path = destinationPath.trim()
      if (!url) {
        setError('远程地址不能为空')
        return false
      }
      if (!path) {
        setError('目标路径不能为空')
        return false
      }
      try {
        setLoading(true)
        setError(null)
        await invoke('clone_repository', {
          remoteUrl: url,
          destinationPath: path,
          branch: branch?.trim() || undefined,
        })
        const info: RepoInfo = await invokeOpenRepository(path, true)
        setRepoInfo(info)
        await loadRecentRepos()
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '克隆仓库失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [loadRecentRepos]
  )

  const createBranch = useCallback(
    async (
      branchName: string,
      checkout: boolean = true,
      startPoint?: string
    ): Promise<boolean> => {
      if (!repoInfo) return false

      try {
        setLoading(true)
        setError(null)

        await invoke('create_branch', {
          repoPath: repoInfo.path,
          branchName: branchName.trim(),
          checkout,
          startPoint: startPoint?.trim() || undefined,
        })

        const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '创建分支失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const deleteBranch = useCallback(
    async (branchName: string, force: boolean = false): Promise<boolean> => {
      if (!repoInfo) return false

      try {
        setLoading(true)
        setError(null)
        await invoke('delete_branch', {
          repoPath: repoInfo.path,
          branchName: branchName.trim(),
          force,
        })
        const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '删除分支失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const renameBranch = useCallback(
    async (oldName: string, newName: string): Promise<boolean> => {
      if (!repoInfo) return false

      try {
        setLoading(true)
        setError(null)
        await invoke('rename_branch', {
          repoPath: repoInfo.path,
          oldName: oldName.trim(),
          newName: newName.trim(),
        })
        const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '重命名分支失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const mergeBranch = useCallback(
    async (sourceBranch: string, ffOnly: boolean = true): Promise<string> => {
      if (!repoInfo) throw new Error('未打开仓库')

      try {
        setLoading(true)
        setError(null)
        const message = await invoke<string>('merge_branch', {
          repoPath: repoInfo.path,
          sourceBranch: sourceBranch.trim(),
          ffOnly,
        })
        const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
        setRepoInfo(updatedRepoInfo)
        return message || '合并完成'
      } catch (err) {
        throw new Error(formatTauriInvokeError(err, '合并分支失败'))
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const fastForwardLocalBranch = useCallback(
    async (branchName: string): Promise<string> => {
      if (!repoInfo) throw new Error('No repository open')
      const msg = await invoke<string>('fast_forward_local_branch', {
        repoPath: repoInfo.path,
        branch: branchName.trim(),
      })
      const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
      setRepoInfo(updatedRepoInfo)
      return msg
    },
    [repoInfo]
  )

  const getRemoteManagementInfo = useCallback(async (): Promise<RemoteManagementInfo> => {
    if (!repoInfo) throw new Error('No repository open')
    return await invoke<RemoteManagementInfo>('get_remote_management_info', {
      repoPath: repoInfo.path,
    })
  }, [repoInfo])

  const addRemote = useCallback(
    async (name: string, url: string): Promise<boolean> => {
      if (!repoInfo) return false
      try {
        setLoading(true)
        setError(null)
        await invoke('add_remote', {
          repoPath: repoInfo.path,
          name: name.trim(),
          url: url.trim(),
        })
        const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '新增远程失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const updateRemote = useCallback(
    async (name: string, url: string): Promise<boolean> => {
      if (!repoInfo) return false
      try {
        setLoading(true)
        setError(null)
        await invoke('update_remote', {
          repoPath: repoInfo.path,
          name: name.trim(),
          url: url.trim(),
        })
        const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '更新远程失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const removeRemote = useCallback(
    async (name: string): Promise<boolean> => {
      if (!repoInfo) return false
      try {
        setLoading(true)
        setError(null)
        await invoke('remove_remote', {
          repoPath: repoInfo.path,
          name: name.trim(),
        })
        const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '删除远程失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const setBranchUpstream = useCallback(
    async (branchName: string, upstreamRef?: string | null): Promise<boolean> => {
      if (!repoInfo) return false
      try {
        setLoading(true)
        setError(null)
        await invoke('set_branch_upstream', {
          repoPath: repoInfo.path,
          branchName: branchName.trim(),
          upstreamRef: upstreamRef?.trim() || null,
        })
        const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '关联远程分支失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const resetToCommit = useCallback(
    async (commitId: string, mode: GitResetMode) => {
      if (!repoInfo) return

      try {
        setLoading(true)
        setError(null)

        await invoke('reset_to_commit', {
          repoPath: repoInfo.path,
          commitId,
          mode,
        })

        const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
        setRepoInfo(updatedRepoInfo)
      } catch (err) {
        setError(formatTauriInvokeError(err, '重置失败'))
        throw err
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const cherryPickCommit = useCallback(
    async (commitId: string): Promise<boolean> => {
      if (!repoInfo) return false

      try {
        setLoading(true)
        setError(null)
        await invoke('cherry_pick_commit', {
          repoPath: repoInfo.path,
          commitId,
        })
        const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, 'Cherry-pick 失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const revertCommit = useCallback(
    async (commitId: string): Promise<boolean> => {
      if (!repoInfo) return false

      try {
        setLoading(true)
        setError(null)
        await invoke('revert_commit', {
          repoPath: repoInfo.path,
          commitId,
        })
        const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, 'Revert 失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const rebaseToCommit = useCallback(
    async (ontoCommitId: string): Promise<boolean> => {
      if (!repoInfo) return false

      try {
        setLoading(true)
        setError(null)
        await invoke('rebase_to_commit', {
          repoPath: repoInfo.path,
          ontoCommitId,
        })
        const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, 'Rebase 失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const getCommitFiles = useCallback(async (commitId: string): Promise<FileChange[]> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const files: FileChange[] = await invoke('get_commit_files', {
        repoPath: repoInfo.path,
        commitId,
      })
      return files
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '获取文件列表失败'))
    }
  }, [repoInfo])

  const getSingleFileDiff = useCallback(async (commitId: string, filePath: string): Promise<string> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const diff: string = await invoke('get_single_file_diff', {
        repoPath: repoInfo.path,
        commitId,
        filePath,
      })
      return diff
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '获取文件差异失败'))
    }
  }, [repoInfo])

  const getFileDiff = useCallback(async (commitId: string): Promise<string> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const diff: string = await invoke('get_file_diff', {
        repoPath: repoInfo.path,
        commitId,
      })
      return diff
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '获取差异失败'))
    }
  }, [repoInfo])

  const getCommitsPaginated = useCallback(
    async (
      limit?: number,
      offset?: number,
      scope?: 'head' | 'all',
      rev?: string | null
    ) => {
      try {
        if (!repoInfo) throw new Error('No repository selected')
        const r = rev?.trim() || null
        return await invoke<CommitInfo[]>('get_commits_paginated', {
          repoPath: repoInfo.path,
          limit,
          offset,
          scope: scope === 'all' ? 'all' : null,
          rev: r,
          clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
        })
      } catch (error) {
        console.error('Failed to get paginated commits:', error)
        throw error
      }
    },
    [repoInfo]
  )

  const searchCommits = useCallback(
    async (
      query: string,
      limit?: number,
      scope?: 'head' | 'all',
      rev?: string | null
    ) => {
      try {
        if (!repoInfo) throw new Error('No repository selected')
        const r = rev?.trim() || null
        return await invoke<CommitInfo[]>('search_commits', {
          repoPath: repoInfo.path,
          query: query.trim(),
          limit: limit ?? 500,
          scope: scope === 'all' ? 'all' : null,
          rev: r,
          clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
        })
      } catch (error) {
        console.error('Failed to search commits:', error)
        throw error
      }
    },
    [repoInfo]
  )

  const getAuthorCommitStats = useCallback(
    async (scope: 'head' | 'all', rev?: string | null) => {
      if (!repoInfo) throw new Error('No repository selected')
      const r = rev?.trim() || null
      return await invoke<AuthorCommitStat[]>('get_author_commit_stats', {
        repoPath: repoInfo.path,
        scope: scope === 'all' ? 'all' : null,
        rev: r,
      })
    },
    [repoInfo]
  )

  const getCommitActivityStats = useCallback(
    async (
      granularity: 'day' | 'week' | 'month',
      scope: 'head' | 'all',
      rev?: string | null
    ) => {
      if (!repoInfo) throw new Error('No repository selected')
      const r = rev?.trim() || null
      return await invoke<TimeBucketStat[]>('get_commit_activity_stats', {
        repoPath: repoInfo.path,
        scope: scope === 'all' ? 'all' : null,
        rev: r,
        granularity,
        clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
      })
    },
    [repoInfo]
  )

  const getCommitsForActivityBucket = useCallback(
    async (
      granularity: 'day' | 'week' | 'month',
      bucketKey: string,
      scope: 'head' | 'all',
      rev?: string | null,
      limit?: number
    ) => {
      if (!repoInfo) throw new Error('No repository selected')
      const r = rev?.trim() || null
      return await invoke<CommitInfo[]>('get_commits_for_activity_bucket', {
        repoPath: repoInfo.path,
        scope: scope === 'all' ? 'all' : null,
        rev: r,
        granularity,
        bucketKey: bucketKey.trim(),
        limit: limit ?? 500,
        clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
      })
    },
    [repoInfo]
  )

  const getDiffAggregateStats = useCallback(
    async (scope: 'head' | 'all', rev?: string | null, pathLimit?: number) => {
      if (!repoInfo) throw new Error('No repository selected')
      const r = rev?.trim() || null
      return await invoke<DiffAggregateStats>('get_diff_aggregate_stats', {
        repoPath: repoInfo.path,
        scope: scope === 'all' ? 'all' : null,
        rev: r,
        pathLimit: pathLimit ?? 40,
      })
    },
    [repoInfo]
  )

  const getFileTerritoryStats = useCallback(
    async (scope: 'head' | 'all', rev?: string | null, fileLimit?: number) => {
      if (!repoInfo) throw new Error('No repository selected')
      const r = rev?.trim() || null
      return await invoke<FileTerritoryStat[]>('get_file_territory_stats', {
        repoPath: repoInfo.path,
        scope: scope === 'all' ? 'all' : null,
        rev: r,
        fileLimit: fileLimit ?? 120,
      })
    },
    [repoInfo]
  )

  const getRecentChangedFilesStats = useCallback(
    async (scope: 'head' | 'all', rev?: string | null, limit?: number) => {
      if (!repoInfo) throw new Error('No repository selected')
      const r = rev?.trim() || null
      return await invoke<RecentChangedFileStat[]>('get_recent_changed_files_stats', {
        repoPath: repoInfo.path,
        scope: scope === 'all' ? 'all' : null,
        rev: r,
        limit: limit ?? 80,
        clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
      })
    },
    [repoInfo]
  )

  const getBranchActivityLifecycleStats = useCallback(
    async (baseBranch?: string | null) => {
      if (!repoInfo) throw new Error('No repository selected')
      const b = baseBranch?.trim() || null
      return await invoke<BranchActivityLifecycleReport>('get_branch_activity_lifecycle_stats', {
        repoPath: repoInfo.path,
        baseBranch: b,
        clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
      })
    },
    [repoInfo]
  )

  const getWorkspaceStatus = useCallback(async (): Promise<WorkspaceStatus> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const status: WorkspaceStatus = await invoke('get_workspace_status', {
        repoPath: repoInfo.path,
      })
      return status
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '获取工作区状态失败'))
    }
  }, [repoInfo])

  const stageFile = useCallback(async (filePath: string) => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      await invoke('stage_file', {
        repoPath: repoInfo.path,
        filePath,
      })
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '暂存文件失败'))
    }
  }, [repoInfo])

  const unstageFile = useCallback(async (filePath: string) => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      await invoke('unstage_file', {
        repoPath: repoInfo.path,
        filePath,
      })
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '取消暂存文件失败'))
    }
  }, [repoInfo])

  const commitChanges = useCallback(async (message: string) => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      await invoke('commit_changes', {
        repoPath: repoInfo.path,
        message,
      })
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '提交失败'))
    }
  }, [repoInfo])

  const pushChanges = useCallback(async () => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      await invoke('push_changes', {
        repoPath: repoInfo.path,
      })
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '推送失败'))
    }
  }, [repoInfo])

  const pullChanges = useCallback(async (): Promise<PullOutcome> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const outcome: PullOutcome = await invoke('pull_changes', {
        repoPath: repoInfo.path,
      })
      
      const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
      setRepoInfo(updatedRepoInfo)
      return outcome
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '拉取失败'))
    }
  }, [repoInfo])

  const fetchChanges = useCallback(async () => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const result = await invoke('fetch_changes', {
        repoPath: repoInfo.path,
      })
      
      // 获取成功后，重新获取仓库信息以更新状态
      const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
      setRepoInfo(updatedRepoInfo)
      
      return result
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '获取失败'))
    }
  }, [repoInfo])

  const fetchChangesWithLogs = useCallback(async () => {
    if (!repoInfo) throw new Error('No repository open')

    try {
      const logs: Array<[string, string, string]> = await invoke('fetch_changes_with_logs', {
        repoPath: repoInfo.path,
      })

      // 获取成功后，重新获取仓库信息以更新状态
      const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
      setRepoInfo(updatedRepoInfo)

      return logs
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '获取失败'))
    }
  }, [repoInfo])

  /** fetch origin 后返回各本地分支相对上游的 ahead/behind（供分支面板一键检查远端更新） */
  const fetchOriginAndSyncOverview = useCallback(async (): Promise<BranchSyncOverview[]> => {
    if (!repoInfo) throw new Error('No repository open')

    try {
      const overview = await invoke<BranchSyncOverview[]>('fetch_origin_and_branch_sync_overview', {
        repoPath: repoInfo.path,
      })
      const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
      setRepoInfo(updatedRepoInfo)
      return overview
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '获取远端状态失败'))
    }
  }, [repoInfo])

  const pushChangesWithLogs = useCallback(async () => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const logs: Array<[string, string, string]> = await invoke('push_changes_with_logs', {
        repoPath: repoInfo.path,
      })
      
      // 推送成功后，重新获取仓库信息以更新状态
      const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
      setRepoInfo(updatedRepoInfo)
      
      return logs
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '推送失败'))
    }
  }, [repoInfo])

  const pushChangesWithRealtimeLogs = useCallback(async () => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      await invoke('push_changes_with_realtime_logs', {
        repoPath: repoInfo.path,
      })
      
      // 推送成功后，重新获取仓库信息以更新状态
      const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
      setRepoInfo(updatedRepoInfo)
      
      return []
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '推送失败'))
    }
  }, [repoInfo])

  const pullChangesWithLogs = useCallback(async (): Promise<PullWithLogsResult> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const beforeHead = repoInfo.commits?.[0]?.id?.slice(0,7) ?? '?'
      const beforeBehind = repoInfo.behind ?? '?'
      void invoke('append_gitlite_log', { level: 'INFO', message: `[DIAG][pull][useGit] before path=${repoInfo.path} head=${beforeHead} behind=${beforeBehind}` }).catch(()=>{})
      const result: PullWithLogsResult = await invoke('pull_changes_with_logs', {
        repoPath: repoInfo.path,
      })
      void invoke('append_gitlite_log', { level: 'INFO', message: `[DIAG][pull][useGit] pull outcome kind=${result?.outcome?.kind} msg=${result?.outcome?.message}` }).catch(()=>{})
      
      const updatedRepoInfo: RepoInfo = await invokeOpenRepository(repoInfo.path, false)
      void invoke('append_gitlite_log', { level: 'INFO', message: `[DIAG][pull][useGit] after head=${updatedRepoInfo.commits?.[0]?.id?.slice(0,7)} behind=${updatedRepoInfo.behind} incoming=${updatedRepoInfo.incoming_commits?.length} ahead=${updatedRepoInfo.ahead}` }).catch(()=>{})
      setRepoInfo(updatedRepoInfo)
      
      return result
    } catch (err) {
      void invoke('append_gitlite_log', { level: 'ERROR', message: `[DIAG][pull][useGit] error ${String(err)}` }).catch(()=>{})
      throw new Error(formatTauriInvokeError(err, '拉取失败'))
    }
  }, [repoInfo])

  const scanDirectoryRepos = useCallback(async (dirPath: string, recursive?: boolean, maxDepth?: number): Promise<DirectoryRepoEntry[]> => {
    const path = dirPath.trim()
    if (!path) throw new Error('目录路径不能为空')
    return await invoke<DirectoryRepoEntry[]>('scan_directory_repos', {
      dirPath: path,
      recursive: recursive ?? false,
      maxDepth: maxDepth ?? null,
    })
  }, [])

  const openDirectoryDialogAndScan = useCallback(async (recursive?: boolean): Promise<DirectoryRepoEntry[] | null> => {
    const selected = await open({
      directory: true,
      title: '选择要扫描的目录',
    })
    if (!selected || typeof selected !== 'string') return null
    return await invoke<DirectoryRepoEntry[]>('scan_directory_repos', {
      dirPath: selected,
      recursive: recursive ?? false,
      maxDepth: null,
    })
  }, [])

  return {
    repoInfo,
    loading,
    error,
    recentRepos,
    autoOpenEnabled,
    setAutoOpenEnabled,
    openRepository,
    openRepositoryByPath,
    initRepository,
    cloneRepository,
    removeRecentRepo,
    updateRecentRepoEntry,
    checkoutBranch,
    createBranch,
    deleteBranch,
    renameBranch,
    mergeBranch,
    fastForwardLocalBranch,
    getRemoteManagementInfo,
    addRemote,
    updateRemote,
    removeRemote,
    setBranchUpstream,
    resetToCommit,
    cherryPickCommit,
    revertCommit,
    rebaseToCommit,
    getFileDiff,
    getCommitFiles,
    getSingleFileDiff,
    getCommitsPaginated,
    searchCommits,
    getAuthorCommitStats,
    getCommitActivityStats,
    getCommitsForActivityBucket,
    getDiffAggregateStats,
    getFileTerritoryStats,
    getRecentChangedFilesStats,
    getBranchActivityLifecycleStats,
    getWorkspaceStatus,
    stageFile,
    unstageFile,
    commitChanges,
    pushChanges,
    pullChanges,
    refreshRepoInfo,
    fetchChanges,
    fetchChangesWithLogs,
    fetchOriginAndSyncOverview,
    pushChangesWithLogs,
    pushChangesWithRealtimeLogs,
    pullChangesWithLogs,
    scanDirectoryRepos,
    openDirectoryDialogAndScan,
  }
}
