'use client'

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { useVpsStore } from '@/lib/vps-store'

export function ProcessesTable() {
  const stats = useVpsStore((s) => s.stats)
  const rows = (stats?.processes ?? []).slice(0, 10)

  return (
    <Card className="col-span-1 lg:col-span-3 gap-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium">Top Processes</CardTitle>
            <CardDescription className="text-xs">Sorted by CPU usage · top 10</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="max-h-80 overflow-y-auto rounded-md border border-border/40">
          <Table>
            <TableHeader className="sticky top-0 bg-card/95 backdrop-blur z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-16">PID</TableHead>
                <TableHead>Command</TableHead>
                <TableHead className="w-24 hidden sm:table-cell">User</TableHead>
                <TableHead className="w-20 text-right">CPU %</TableHead>
                <TableHead className="w-24 text-right">Memory</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-8">
                    Waiting for stats…
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((p) => (
                  <TableRow key={p.pid} className="text-xs">
                    <TableCell className="font-mono tabular-nums text-muted-foreground">{p.pid}</TableCell>
                    <TableCell className="max-w-[40vw] truncate">
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-muted-foreground truncate hidden md:inline">{p.command}</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">{p.user}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span
                        className={
                          p.cpu > 50
                            ? 'text-rose-500 font-medium'
                            : p.cpu > 20
                            ? 'text-amber-500 font-medium'
                            : 'text-foreground'
                        }
                      >
                        {p.cpu.toFixed(1)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {p.mem >= 1024 ? `${(p.mem / 1024).toFixed(2)} GB` : `${p.mem.toFixed(0)} MB`}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
