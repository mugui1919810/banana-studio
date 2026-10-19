const FORK_BLOCKED_HOSTS = ['cherry-ai.com', 'cherryai.com.cn', 'cherry.ai', 'cherryin.ai']
const FORK_BLOCKED_OWNERS = ['CherryHQ']

function matchesOwner(pathname: string): boolean {
  const normalized = pathname.toLowerCase()
  return FORK_BLOCKED_OWNERS.some((owner) => {
    const prefix = `/${owner.toLowerCase()}`
    return normalized === prefix || normalized.startsWith(`${prefix}/`)
  })
}

/** True when a URL belongs to the upstream Cherry Studio project and should be replaced by the fork notice. */
export function isForkBlockedUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol === 'mailto:') {
    return /@(?:cherry-ai\.com|cherryai\.com\.cn|cherry\.ai|cherryin\.ai)$/i.test(url.pathname)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  const hostname = url.hostname.toLowerCase()
  if (FORK_BLOCKED_HOSTS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return true

  if (
    matchesOwner(url.pathname) &&
    (hostname === 'github.com' ||
      hostname === 'gitcode.com' ||
      hostname === 'raw.githubusercontent.com' ||
      hostname === 'raw.gitcode.com')
  ) {
    return true
  }

  if (hostname === 'play.google.com') {
    return url.pathname === '/store/apps/details' && url.searchParams.get('id') === 'com.cherryai.cherrystudio_app'
  }
  if (hostname === 'apps.apple.com') return /^\/app\/id6809783714\/?$/.test(url.pathname)
  if (hostname === 'testflight.apple.com') return /^\/join\/2ryzjB66\/?$/.test(url.pathname)

  return hostname === 'dash.302.ai' && url.searchParams.get('app') === 'cherry-ai.com'
}
