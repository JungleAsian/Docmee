/* global process, URL */
/** @param {Record<string, string | undefined>} env */
export function isolatedDatabaseUrl(env = process.env) {
  if (env.DOCMEE_SCHEDULED_INTEGRATION !== 'true') {
    throw new Error('Integration checks require explicit opt-in')
  }
  const value = env.DOCMEE_SCHEDULED_TEST_DATABASE_URL
  try {
    if (typeof value !== 'string') throw new Error('missing target')
    const url = new URL(value)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !/^\/docmee_scheduled_test(?:_[a-z0-9]+)?$/.test(url.pathname)
      || url.search || url.hash) throw new Error('unsafe target')
    return value
  } catch {
    // Never include supplied connection strings or credential-bearing driver errors.
    throw new Error('A separate local test database is required')
  }
}
