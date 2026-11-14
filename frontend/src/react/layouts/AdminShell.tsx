import { PageStatus } from '../components/shared/PageStatus'
import { useRouteCopy } from '../i18n/route-copy'
import { ShellLayout } from './WorkspaceShell'

export function AdminShell() {
  const copy = useRouteCopy('admin')
  return copy.ready ? <ShellLayout admin /> : <PageStatus error={copy.error} retry={copy.retry} />
}
