import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { isForkBlockedUrl } from '@shared/utils/forkExternalLink'

export function openExternalWebsite(url: string): Promise<void> {
  if (isForkBlockedUrl(url)) {
    toast.info(i18n.t('fork.external_link_unavailable'))
    return Promise.resolve()
  }
  return ipcApi.request('system.shell.open_external_website', url)
}
