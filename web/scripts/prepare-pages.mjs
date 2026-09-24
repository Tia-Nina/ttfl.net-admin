// GH Pages SPA 回退：把 index.html 复制为 404.html（CNAME 由 public/ 自动进 dist）
import { copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
await copyFile(join(root, 'dist', 'index.html'), join(root, 'dist', '404.html'))
console.log('prepared dist/404.html for SPA fallback')
