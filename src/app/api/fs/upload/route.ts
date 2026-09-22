import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { safeResolve, SANDBOX_ROOT } from '@/lib/fs-server'
import fs from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/fs/upload?path=/Downloads
 * Upload a file directly into the WebOS file system via multipart form data.
 *
 * Usage from CLI:
 *   curl -X POST "https://YOUR-PREVIEW-URL/api/fs/upload?path=/Downloads" \
 *     -F "file=@myfile.txt"
 *
 * Or upload multiple files:
 *   curl -X POST "https://YOUR-PREVIEW-URL/api/fs/upload?path=/Downloads" \
 *     -F "files=@file1.txt" -F "files=@file2.txt"
 *
 * The `path` query param specifies which folder to upload into (default: /Downloads).
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const url = new URL(req.url)
  const targetPath = url.searchParams.get('path') || '/Downloads'
  const overwrite = url.searchParams.get('overwrite') === 'true'

  try {
    const formData = await req.formData()
    const uploadedFiles: string[] = []
    const errors: string[] = []

    // Accept both "file" (single) and "files" (multiple)
    const entries = [
      ...formData.getAll('file'),
      ...formData.getAll('files'),
    ].filter((e): e is File => e instanceof File)

    if (entries.length === 0) {
      return NextResponse.json({ error: 'no files provided — use -F "file=@path"' }, { status: 400 })
    }

    // Resolve and create the target directory
    const targetDir = safeResolve(targetPath)
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    for (const file of entries) {
      try {
        const filename = path.basename(file.name)
        // Sanitize filename — no path traversal
        const safeName = filename.replace(/[^a-zA-Z0-9._\-\s]/g, '_')
        const destPath = path.join(targetDir, safeName)

        if (fs.existsSync(destPath) && !overwrite) {
          errors.push(`${safeName} already exists (use ?overwrite=true to replace)`)
          continue
        }

        const buffer = Buffer.from(await file.arrayBuffer())
        fs.writeFileSync(destPath, buffer)
        uploadedFiles.push(safeName)
      } catch (err) {
        errors.push(`${file.name}: ${(err as Error).message}`)
      }
    }

    return NextResponse.json({
      ok: uploadedFiles.length > 0,
      uploaded: uploadedFiles,
      errors,
      targetPath,
      count: uploadedFiles.length,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

/** GET — returns upload instructions */
export async function GET(req: NextRequest) {
  return NextResponse.json({
    ok: true,
    usage: 'POST /api/fs/upload?path=/Downloads with multipart form data',
    example: 'curl -X POST "URL/api/fs/upload?path=/Downloads" -F "file=@myfile.txt"',
    params: {
      path: 'target folder (default: /Downloads)',
      overwrite: 'set to "true" to overwrite existing files',
    },
  })
}
