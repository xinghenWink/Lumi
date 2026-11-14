import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { cn } from '../../lib/utils'
export function Panel({
  title,
  description,
  className = '',
  children,
}: {
  title?: string
  description?: string
  className?: string
  children: ReactNode
}) {
  return (
    <Card
      as="section"
      className={cn(
        'min-w-0 gap-0 rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6',
        className,
      )}
    >
      {title || description ? (
        <CardHeader className="mb-5 gap-0 p-0">
          {title ? (
            <CardTitle as="h2" className="text-[15px] font-semibold tracking-tight">
              {title}
            </CardTitle>
          ) : null}
          {description ? (
            <CardDescription className="mt-1.5 text-xs leading-5">{description}</CardDescription>
          ) : null}
        </CardHeader>
      ) : null}
      <CardContent className="min-w-0 p-0">{children}</CardContent>
    </Card>
  )
}
