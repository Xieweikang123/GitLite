import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import { AiConfig, AiProviderPreset } from '../types/git'
import { invoke } from '@tauri-apps/api/tauri'
import { Sparkles, RefreshCw } from 'lucide-react'

/** 与智谱开放平台 OpenAPI 一致：基址 + /chat/completions，Bearer 鉴权。参见 GLM-4.6V 文档示例。 */
const ZHIPU_DOC_VLM = 'https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v'
const ZHIPU_DOC_MODELS = 'https://docs.bigmodel.cn/cn/guide/start/model-overview'

const PROVIDER_PRESETS: Record<
  Exclude<AiProviderPreset, 'custom'>,
  { label: string; base_url: string; model: string }
> = {
  ollama: {
    label: 'Ollama（本地）',
    base_url: 'http://127.0.0.1:11434/v1',
    model: 'llama3.2',
  },
  zhipu: {
    label: '智谱 GLM（开放平台 v4）',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    // 与官方 cURL 示例一致；GLM-4.6V-FlashX（9B 轻量高速）等请以控制台 / 模型概览中的 model 编码为准
    model: 'glm-4.6v',
  },
  openai_compatible: {
    label: 'OpenAI 兼容',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
}

interface AiConfigModalProps {
  isOpen: boolean
  onClose: () => void
}

function providerLabel(p: string): string {
  if (p === 'custom') return '自定义'
  const preset = PROVIDER_PRESETS[p as Exclude<AiProviderPreset, 'custom'>]
  return preset?.label ?? p
}

export function AiConfigModal({ isOpen, onClose }: AiConfigModalProps) {
  const [config, setConfig] = useState<AiConfig>({
    enabled: false,
    provider: 'ollama',
    base_url: PROVIDER_PRESETS.ollama.base_url,
    api_key: '',
    model: PROVIDER_PRESETS.ollama.model,
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (isOpen) {
      void loadConfig()
    }
  }, [isOpen])

  const loadConfig = async () => {
    setLoading(true)
    setMessage(null)
    setTestResult(null)
    try {
      const c = await invoke<AiConfig>('get_ai_config')
      setConfig({
        ...c,
        api_key: c.api_key ?? '',
      })
    } catch (e) {
      console.error('加载 AI 配置失败:', e)
      setMessage({ ok: false, text: String(e) })
    } finally {
      setLoading(false)
    }
  }

  const applyProviderPreset = (p: string) => {
    setConfig((prev) => {
      if (p === 'custom') {
        return { ...prev, provider: 'custom' }
      }
      const preset = PROVIDER_PRESETS[p as Exclude<AiProviderPreset, 'custom'>]
      if (!preset) return { ...prev, provider: p }
      return {
        ...prev,
        provider: p,
        base_url: preset.base_url,
        model: preset.model,
      }
    })
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const apiKey = typeof config.api_key === 'string' ? config.api_key.trim() : ''
      await invoke('save_ai_config', {
        config: {
          ...config,
          api_key: apiKey.length > 0 ? apiKey : null,
        },
      })
      setMessage({ ok: true, text: 'AI 配置已保存' })
    } catch (e) {
      setMessage({ ok: false, text: String(e) })
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    setMessage(null)
    try {
      const apiKey = typeof config.api_key === 'string' ? config.api_key.trim() : ''
      const summary = await invoke<string>('test_ai_connection', {
        config: {
          ...config,
          api_key: apiKey.length > 0 ? apiKey : null,
        },
      })
      setTestResult({ ok: true, text: summary })
    } catch (e) {
      setTestResult({ ok: false, text: String(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI 与服务配置
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-4">加载中…</p>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base">总开关</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4 pt-0">
                <p className="text-sm text-muted-foreground">
                  开启后，后续功能（如提交说明生成等）将使用此处配置调用模型。
                </p>
                <Switch
                  checked={config.enabled}
                  onCheckedChange={(enabled) => setConfig((c) => ({ ...c, enabled }))}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base">服务商</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                {config.provider === 'zhipu' && (
                  <p className="text-xs text-muted-foreground leading-relaxed rounded-md border border-border bg-muted/30 px-3 py-2">
                    对接方式与智谱文档一致：请求{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                      POST …/v4/chat/completions
                    </code>
                    ，请求头为{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                      Authorization: Bearer
                    </code>{' '}
                    加上开放平台发放的 API Key
                    。多模态示例见{' '}
                    <a
                      href={ZHIPU_DOC_VLM}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      GLM-4.6V
                    </a>
                    ；系列内另有轻量高速版 <strong>GLM-4.6V-FlashX</strong>（9B）等，请在{' '}
                    <a
                      href={ZHIPU_DOC_MODELS}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      模型概览
                    </a>
                    或开放平台核对准确的 <code className="text-[11px]">model</code> 字段。
                  </p>
                )}

                <div className="grid gap-2">
                  <Label>预设</Label>
                  <Select value={config.provider} onValueChange={applyProviderPreset}>
                    <SelectTrigger className="text-left">
                      <span className="truncate">{providerLabel(config.provider)}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ollama">{PROVIDER_PRESETS.ollama.label}</SelectItem>
                      <SelectItem value="zhipu">{PROVIDER_PRESETS.zhipu.label}</SelectItem>
                      <SelectItem value="openai_compatible">
                        {PROVIDER_PRESETS.openai_compatible.label}
                      </SelectItem>
                      <SelectItem value="custom">自定义</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="ai-base-url">
                    API 基址（应用会在末尾自动拼接 <code className="text-xs">/chat/completions</code> 用于测试）
                  </Label>
                  <Input
                    id="ai-base-url"
                    className="font-mono text-xs"
                    spellCheck={false}
                    value={config.base_url}
                    onChange={(e) => setConfig((c) => ({ ...c, base_url: e.target.value }))}
                    placeholder={
                      config.provider === 'zhipu'
                        ? 'https://open.bigmodel.cn/api/paas/v4'
                        : 'https://...'
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="ai-api-key">API Key（Ollama 本地可留空）</Label>
                  <Input
                    id="ai-api-key"
                    type="password"
                    autoComplete="off"
                    className="font-mono text-xs"
                    spellCheck={false}
                    value={config.api_key ?? ''}
                    onChange={(e) => setConfig((c) => ({ ...c, api_key: e.target.value }))}
                    placeholder="sk-… 或 智谱 API Key"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="ai-model">模型 ID</Label>
                  <Input
                    id="ai-model"
                    className="font-mono text-xs"
                    spellCheck={false}
                    value={config.model}
                    onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
                    placeholder={
                      config.provider === 'zhipu'
                        ? 'glm-4.6v（文档示例）；FlashX 等以控制台为准'
                        : '例如 llama3.2、gpt-4o-mini'
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {testResult && (
              <p
                className={`text-sm ${testResult.ok ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}
              >
                {testResult.text}
              </p>
            )}

            {message && (
              <p
                className={`text-sm ${message.ok ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}
              >
                {message.text}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void testConnection()}
                disabled={testing || saving}
              >
                <RefreshCw className={`h-4 w-4 mr-1.5 ${testing ? 'animate-spin' : ''}`} />
                {testing ? '测试中…' : '测试连接'}
              </Button>
              <Button variant="outline" onClick={onClose}>
                关闭
              </Button>
              <Button onClick={() => void save()} disabled={saving || testing}>
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
