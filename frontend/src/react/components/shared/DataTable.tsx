import type { ReactNode } from 'react'
export interface Column<T> {
  key: string
  label: string
  render(row: T): ReactNode
  className?: string
}
export function DataTable<T extends { id: string }>({
  rows,
  columns,
}: {
  rows: T[]
  columns: Column<T>[]
}) {
  return (
    <div className="min-w-0 overflow-x-auto overscroll-x-contain">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="whitespace-nowrap px-4 py-3 font-medium text-muted-foreground"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={'px-4 py-3 align-top leading-6 ' + (column.className ?? '')}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
