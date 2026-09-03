import { NextRequest, NextResponse } from 'next/server'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PICTURES_DIR = '/home/z/my-project/user-files/Pictures'

export async function GET() {
  try {
    if (!readdirSync(PICTURES_DIR).length) {
      return NextResponse.json({ screenshots: [] })
    }
    const entries = readdirSync(PICTURES_DIR)
    const screenshots = entries
      .filter(f => /\.(png|jpeg|jpg|webp)$/i.test(f))
      .map(f => {
        const fp = path.join(PICTURES_DIR, f)
        const stat = statSync(fp)
        return {
          name: f,
          path: `/Pictures/${f}`,
          size: stat.size,
          modified: stat.mtimeMs,
        }
      })
      .sort((a, b) => b.modified - a.modified)

    return NextResponse.json({ screenshots, total: screenshots.length })
  } catch {
    return NextResponse.json({ screenshots: [], total: 0 })
  }
}
