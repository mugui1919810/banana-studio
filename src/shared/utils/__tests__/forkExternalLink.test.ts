import { describe, expect, it } from 'vitest'

import { isForkBlockedUrl } from '../forkExternalLink'

describe('isForkBlockedUrl', () => {
  it.each([
    'https://cherry-ai.com',
    'https://www.cherry-ai.com/careers',
    'https://docs.cherryai.com.cn/docs/en-us',
    'https://open.cherryin.ai/console/topup',
    'https://github.com/CherryHQ/cherry-studio',
    'https://github.com/cherryhq/cherry-studio/releases',
    'https://raw.githubusercontent.com/CherryHQ/cherry-studio/main/README.md',
    'https://dash.302.ai/sso/login?app=cherry-ai.com&name=Banana%20Studio',
    'https://apps.apple.com/app/id6809783714',
    'https://testflight.apple.com/join/2ryzjB66',
    'https://play.google.com/store/apps/details?id=com.cherryai.cherrystudio_app',
    'mailto:support@cherry-ai.com'
  ])('blocks upstream link %s', (url) => {
    expect(isForkBlockedUrl(url)).toBe(true)
  })

  it.each([
    'https://example.com',
    'https://github.com/other-owner/project',
    'https://apps.apple.com/app/id1234567890',
    'https://play.google.com/store/apps/details?id=com.example.app',
    'https://dash.302.ai/charge',
    'mailto:support@example.com',
    'not a url'
  ])('allows unrelated link %s', (url) => {
    expect(isForkBlockedUrl(url)).toBe(false)
  })
})
