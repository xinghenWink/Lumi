import type { ReactNode } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
export interface Column<T> {
  key: string
  label: ReactNode
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
    <Table className="w-full text-left text-xs">
      <TableHeader>
        <TableRow className="border-b border-border bg-muted/40">
          {columns.map((column) => (
            <TableHead
              key={column.key}
              scope="col"
              className="h-auto whitespace-nowrap px-4 py-2.5 text-xs font-medium text-muted-foreground"
            >
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            className="border-b border-border transition-colors last:border-0 hover:bg-muted/35"
          >
            {columns.map((column) => (
              <TableCell
                key={column.key}
                className={
                  'whitespace-normal px-4 py-3 align-top leading-6 ' + (column.className ?? '')
                }
              >
                {column.render(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
