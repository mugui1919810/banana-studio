import { Archive } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'

export function ArchiveSettingsButton() {
  const { t } = useTranslation()
  const label = t('settings.data.trash.title')

  return (
    <Tooltip content={label} delay={800}>
      <Button
        type="button"
        variant="ghost"
        aria-label={label}
        className="h-7 shrink-0 gap-1.5 rounded-full bg-card px-2.5 text-xs font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-foreground [-webkit-app-region:none] [&_svg]:!size-3.5"
        onClick={() => openSettingsTab('/settings/archive')}>
        <Archive />
        <span>{label}</span>
      </Button>
    </Tooltip>
  )
}
