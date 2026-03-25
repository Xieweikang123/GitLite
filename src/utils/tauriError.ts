/**
 * Tauri 1.x 中 invoke 失败时 reject 的值常为 string，而非 Error；
 * 仅用 instanceof Error 会丢失后端返回的详细说明。
 */
export function formatTauriInvokeError(err: unknown, fallback: string): string {
  if (typeof err === 'string' && err.trim() !== '') return err
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message
    if (typeof m === 'string' && m.trim() !== '') return m
  }
  return fallback
}
