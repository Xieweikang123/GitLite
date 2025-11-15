import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import { ProxyConfig } from '../types/git'
import { invoke } from '@tauri-apps/api/tauri'
import { CheckCircle, XCircle, AlertCircle, RefreshCw } from 'lucide-react'

interface GitConfigItem {
  origin: string
  key: string
  value: string
}

interface ProxyConfigModalProps {
  isOpen: boolean
  onClose: () => void
}

export function ProxyConfigModal({ isOpen, onClose }: ProxyConfigModalProps) {
  const [config, setConfig] = useState<ProxyConfig>({
    enabled: false,
    host: '127.0.0.1',
    port: 7890,
    username: '',
    password: '',
    protocol: 'http'
  })
  
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  
  const [isFromGitConfig, setIsFromGitConfig] = useState(false)
  const [gitConfigInfo, setGitConfigInfo] = useState<GitConfigItem[]>([])
  const [loadingConfigInfo, setLoadingConfigInfo] = useState(false)

  // 加载配置
  useEffect(() => {
    if (isOpen) {
      loadConfig()
      loadGitConfigInfo()
    }
  }, [isOpen])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const [proxyConfig, isFromGit] = await invoke<[ProxyConfig, boolean]>('get_proxy_config')
      setConfig(proxyConfig)
      setIsFromGitConfig(isFromGit)
    } catch (error) {
      console.error('Failed to load proxy config:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadGitConfigInfo = async () => {
    setLoadingConfigInfo(true)
    try {
      const configItems = await invoke<GitConfigItem[]>('get_git_config_info')
      setGitConfigInfo(configItems)
    } catch (error) {
      console.error('Failed to load git config info:', error)
      setGitConfigInfo([])
    } finally {
      setLoadingConfigInfo(false)
    }
  }

  const saveConfig = async () => {
    setSaving(true)
    try {
      await invoke('save_proxy_config', { config })
      setTestResult({
        success: true,
        message: '代理配置已保存'
      })
    } catch (error) {
      console.error('Failed to save proxy config:', error)
      setTestResult({
        success: false,
        message: `保存失败: ${error}`
      })
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTestResult(null)
    
    if (!config.enabled) {
      setTestResult({
        success: false,
        message: '请先启用代理'
      })
      return
    }
    
    try {
      // 这里可以添加实际的代理测试逻辑
      // 比如尝试通过代理访问一个测试URL
      setTestResult({
        success: true,
        message: `代理配置已设置: ${config.protocol}://${config.host}:${config.port}`
      })
    } catch (error) {
      setTestResult({
        success: false,
        message: `测试失败: ${error}`
      })
    }
  }

  const handleInputChange = (field: keyof ProxyConfig, value: any) => {
    setConfig(prev => ({
      ...prev,
      [field]: value
    }))
    setTestResult(null)
  }

  const handlePortChange = (value: string) => {
    const port = parseInt(value)
    if (!isNaN(port) && port > 0 && port <= 65535) {
      handleInputChange('port', port)
    }
  }

  // 格式化配置信息为文本
  const formatConfigText = () => {
    if (gitConfigInfo.length === 0) {
      return '未找到与代理、SSL 相关的 Git 配置'
    }
    return gitConfigInfo.map(item => `${item.origin}\t${item.key}=${item.value}`).join('\n')
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>代理配置</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Git配置状态提示 */}
          {isFromGitConfig && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm text-blue-700 dark:text-blue-300">
                  已自动读取Git全局代理配置
                </span>
              </div>
            </div>
          )}
          
          {/* 启用开关 */}
          <div className="flex items-center space-x-2">
            <Switch
              id="proxy-enabled"
              checked={config.enabled}
              onCheckedChange={(checked: boolean) => handleInputChange('enabled', checked)}
            />
            <Label htmlFor="proxy-enabled" className="text-sm font-medium">
              启用代理
            </Label>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">代理设置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {config.enabled && (
                <>
                  {/* 协议选择 */}
                  <div className="space-y-2">
                    <Label htmlFor="protocol">协议</Label>
                    <Select
                      value={config.protocol}
                      onValueChange={(value) => handleInputChange('protocol', value)}
                    >
                      <SelectTrigger>
                        {config.protocol === 'http' && 'HTTP'}
                        {config.protocol === 'socks5' && 'SOCKS5'}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="http">HTTP</SelectItem>
                        <SelectItem value="socks5">SOCKS5</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* 主机和端口 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="host">主机地址</Label>
                      <Input
                        id="host"
                        value={config.host}
                        onChange={(e) => handleInputChange('host', e.target.value)}
                        placeholder="127.0.0.1"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="port">端口</Label>
                      <Input
                        id="port"
                        type="number"
                        value={config.port}
                        onChange={(e) => handlePortChange(e.target.value)}
                        placeholder="7890"
                        min="1"
                        max="65535"
                      />
                    </div>
                  </div>

                  {/* 认证信息 */}
                  <div className="space-y-4">
                    <div className="text-sm font-medium text-muted-foreground">
                      认证信息（可选）
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="username">用户名</Label>
                        <Input
                          id="username"
                          value={config.username || ''}
                          onChange={(e) => handleInputChange('username', e.target.value || undefined)}
                          placeholder="用户名"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password">密码</Label>
                        <Input
                          id="password"
                          type="password"
                          value={config.password || ''}
                          onChange={(e) => handleInputChange('password', e.target.value || undefined)}
                          placeholder="密码"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {!config.enabled && (
                <div className="text-center py-8 text-muted-foreground">
                  <p>代理已禁用</p>
                  <p className="text-sm mt-1">启用代理后可以配置详细的代理设置</p>
                </div>
              )}

              {/* 测试结果 */}
              {testResult && (
                <div className={`flex items-center space-x-2 p-3 rounded-md ${
                  testResult.success 
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800' 
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}>
                  {testResult.success ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <span className="text-sm">{testResult.message}</span>
                </div>
              )}

              {/* 操作按钮 - 始终可见 */}
              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={testConnection}
                  disabled={!config.enabled || loading}
                >
                  测试连接
                </Button>
                <Button
                  onClick={saveConfig}
                  disabled={saving || loading}
                >
                  {saving ? '保存中...' : '保存配置'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 当前 Git 配置信息 */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">当前 Git 配置信息</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadGitConfigInfo}
                  disabled={loadingConfigInfo}
                  className="h-8"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${loadingConfigInfo ? 'animate-spin' : ''}`} />
                  刷新
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingConfigInfo ? (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  加载中...
                </div>
              ) : (
                <pre className="bg-gray-900 text-gray-100 p-4 rounded-md overflow-x-auto text-xs font-mono whitespace-pre-wrap break-all">
                  {formatConfigText()}
                </pre>
              )}
            </CardContent>
          </Card>

          {/* 说明信息 */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-4">
            <div className="flex items-start space-x-2">
              <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5" />
              <div className="text-sm text-blue-700 dark:text-blue-300">
                <p className="font-medium mb-1">使用说明：</p>
                <ul className="space-y-1 text-xs">
                  <li>• 自动读取Git全局代理配置（git config --global http.proxy）</li>
                  <li>• GitLite 使用系统 Git 配置中的代理设置</li>
                  <li>• 支持HTTP和SOCKS5协议（不支持HTTPS协议）</li>
                  <li>• 如果不需要认证，用户名和密码可以留空</li>
                  <li>• 代理配置不会写入 git config，不影响其他Git工具</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
