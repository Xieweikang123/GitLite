import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import type { RemoteManagementInfo } from '../types/git'

interface RemoteManageModalProps {
  isOpen: boolean
  onClose: () => void
  repoPath?: string
  loading?: boolean
  getRemoteManagementInfo: () => Promise<RemoteManagementInfo>
  addRemote: (name: string, url: string) => Promise<boolean>
  updateRemote: (name: string, url: string) => Promise<boolean>
  removeRemote: (name: string) => Promise<boolean>
  setBranchUpstream: (branchName: string, upstreamRef?: string | null) => Promise<boolean>
}

function splitUpstream(upstream?: string | null): { remote: string; branch: string } {
  const text = (upstream ?? '').trim()
  if (!text) return { remote: '', branch: '' }
  const idx = text.indexOf('/')
  if (idx <= 0) return { remote: text, branch: '' }
  return {
    remote: text.slice(0, idx),
    branch: text.slice(idx + 1),
  }
}

export function RemoteManageModal({
  isOpen,
  onClose,
  repoPath,
  loading = false,
  getRemoteManagementInfo,
  addRemote,
  updateRemote,
  removeRemote,
  setBranchUpstream,
}: RemoteManageModalProps) {
  const [data, setData] = useState<RemoteManagementInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newRemoteName, setNewRemoteName] = useState('')
  const [newRemoteUrl, setNewRemoteUrl] = useState('')
  const [editingRemoteName, setEditingRemoteName] = useState<string | null>(null)
  const [editingRemoteUrl, setEditingRemoteUrl] = useState('')
  const [selectedBranch, setSelectedBranch] = useState('')
  const [upstreamRemote, setUpstreamRemote] = useState('')
  const [upstreamBranch, setUpstreamBranch] = useState('')

  const remoteNames = useMemo(() => data?.remotes.map((r) => r.name) ?? [], [data?.remotes])

  const reload = async () => {
    if (!repoPath) return
    setBusy(true)
    setError(null)
    try {
      const info = await getRemoteManagementInfo()
      setData(info)
      const current = info.branches.find((b) => b.is_current)?.name ?? info.current_branch
      setSelectedBranch(current)
      const up = info.branches.find((b) => b.name === current)?.upstream
      const parsed = splitUpstream(up)
      setUpstreamRemote(parsed.remote)
      setUpstreamBranch(parsed.branch)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载远程配置失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    void reload()
  }, [isOpen, repoPath])

  useEffect(() => {
    if (!data || !selectedBranch) return
    const up = data.branches.find((b) => b.name === selectedBranch)?.upstream
    const parsed = splitUpstream(up)
    setUpstreamRemote(parsed.remote)
    setUpstreamBranch(parsed.branch)
  }, [selectedBranch, data])

  const handleAddRemote = async () => {
    const name = newRemoteName.trim()
    const url = newRemoteUrl.trim()
    if (!name || !url) {
      setError('远程名称和地址都不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ok = await addRemote(name, url)
      if (!ok) return
      setNewRemoteName('')
      setNewRemoteUrl('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const handleUpdateRemote = async () => {
    const name = (editingRemoteName ?? '').trim()
    const url = editingRemoteUrl.trim()
    if (!name || !url) {
      setError('远程名称和地址都不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ok = await updateRemote(name, url)
      if (!ok) return
      setEditingRemoteName(null)
      setEditingRemoteUrl('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveRemote = async (name: string) => {
    if (!window.confirm(`确定删除远程 ${name} 吗？`)) return
    setBusy(true)
    setError(null)
    try {
      const ok = await removeRemote(name)
      if (!ok) return
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const handleSetUpstream = async () => {
    const branch = selectedBranch.trim()
    if (!branch) {
      setError('请选择本地分支')
      return
    }
    if (!upstreamRemote.trim() || !upstreamBranch.trim()) {
      setError('请填写远程和远程分支名')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ok = await setBranchUpstream(
        branch,
        `${upstreamRemote.trim()}/${upstreamBranch.trim()}`
      )
      if (!ok) return
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const handleClearUpstream = async () => {
    const branch = selectedBranch.trim()
    if (!branch) {
      setError('请选择本地分支')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ok = await setBranchUpstream(branch, null)
      if (!ok) return
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>远程管理</DialogTitle>
        </DialogHeader>

        {!repoPath ? (
          <p className="text-sm text-muted-foreground">请先打开仓库</p>
        ) : (
          <div className="grid gap-4">
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">远程列表</p>
              <div className="space-y-2">
                {(data?.remotes ?? []).map((remote) => (
                  <div
                    key={remote.name}
                    className="rounded border border-border/70 px-2 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{remote.name}</p>
                        <p
                          className="truncate text-xs text-muted-foreground"
                          title={remote.fetch_url ?? ''}
                        >
                          {remote.fetch_url ?? '未配置 URL'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || loading}
                          onClick={() => {
                            setEditingRemoteName(remote.name)
                            setEditingRemoteUrl(remote.fetch_url ?? '')
                          }}
                        >
                          编辑
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={busy || loading}
                          onClick={() => void handleRemoveRemote(remote.name)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {(data?.remotes ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">还没有配置任何 remote</p>
                )}
              </div>

              <div className="mt-3 grid gap-2 rounded-md border border-border/70 p-2">
                <p className="text-xs font-medium text-muted-foreground">新增 remote</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
                  <Input
                    value={newRemoteName}
                    onChange={(e) => setNewRemoteName(e.target.value)}
                    placeholder="origin"
                    disabled={busy || loading}
                  />
                  <Input
                    value={newRemoteUrl}
                    onChange={(e) => setNewRemoteUrl(e.target.value)}
                    placeholder="https://... 或 git@..."
                    disabled={busy || loading}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleAddRemote()}
                    disabled={busy || loading}
                  >
                    新增
                  </Button>
                </div>
              </div>

              {editingRemoteName && (
                <div className="mt-3 grid gap-2 rounded-md border border-border/70 p-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    编辑 remote: {editingRemoteName}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <Input
                      value={editingRemoteUrl}
                      onChange={(e) => setEditingRemoteUrl(e.target.value)}
                      placeholder="新的 URL"
                      disabled={busy || loading}
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleUpdateRemote()}
                      disabled={busy || loading}
                    >
                      保存
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingRemoteName(null)
                        setEditingRemoteUrl('')
                      }}
                      disabled={busy || loading}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">上游分支</p>
              <div className="grid gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="upstream-branch">本地分支</Label>
                  <select
                    id="upstream-branch"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    disabled={busy || loading}
                  >
                    {(data?.branches ?? []).map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                        {b.is_current ? ' (当前)' : ''}
                        {b.upstream ? ` -> ${b.upstream}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="upstream-remote">远程</Label>
                    <select
                      id="upstream-remote"
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={upstreamRemote}
                      onChange={(e) => setUpstreamRemote(e.target.value)}
                      disabled={busy || loading}
                    >
                      <option value="">请选择</option>
                      {remoteNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="upstream-remote-branch">远程分支名</Label>
                    <Input
                      id="upstream-remote-branch"
                      value={upstreamBranch}
                      onChange={(e) => setUpstreamBranch(e.target.value)}
                      placeholder="例如 main"
                      disabled={busy || loading}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleClearUpstream()}
                    disabled={busy || loading || !selectedBranch}
                  >
                    清除上游
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSetUpstream()}
                    disabled={busy || loading || !selectedBranch}
                  >
                    设置上游
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={busy}
              >
                关闭
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
