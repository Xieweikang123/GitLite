import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Shorten a long file path with a middle ellipsis while keeping
// the beginning and the filename. Example:
// D:/very/long/path/to/some/deeply/nested/directory/file.ts
// -> D:/very/.../directory/file.ts (when maxLength is small)
export function shortenPathMiddle(fullPath: string, maxLength: number = 48): string {
  if (!fullPath) return ''
  if (fullPath.length <= maxLength) return fullPath

  const normalized = fullPath.replace(/\\/g, '/')
  const lastSlashIndex = normalized.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    // Not a path, just shorten the string from the middle
    const head = Math.ceil((maxLength - 3) / 2)
    const tail = Math.floor((maxLength - 3) / 2)
    return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`
  }

  const dirname = normalized.slice(0, lastSlashIndex)
  const basename = normalized.slice(lastSlashIndex + 1)

  // If basename itself is too long, shorten from its middle first
  const shortenMiddle = (s: string, limit: number) => {
    if (limit <= 3) return '...'
    if (s.length <= limit) return s
    const head = Math.ceil((limit - 3) / 2)
    const tail = Math.floor((limit - 3) / 2)
    return `${s.slice(0, head)}...${s.slice(-tail)}`
  }

  const finalBasename = basename.length > maxLength - 4
    ? shortenMiddle(basename, Math.max(8, Math.floor(maxLength * 0.4)))
    : basename

  const remaining = maxLength - finalBasename.length - 1
  const finalDirname = shortenMiddle(dirname, Math.max(remaining, 8))

  return `${finalDirname}/${finalBasename}`
}