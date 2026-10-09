import { describe, expect, it } from 'vitest'
import { isolatedDatabaseUrl } from './integration-target.mjs'

describe('scheduled integration target guard', () => {
  it('requires explicit opt-in and a separately named local test database', () => {
    const url = 'postgresql://synthetic:synthetic@127.0.0.1:5432/docmee_scheduled_test'
    expect(isolatedDatabaseUrl({ DOCMEE_SCHEDULED_INTEGRATION: 'true', DOCMEE_SCHEDULED_TEST_DATABASE_URL: url })).toBe(url)
    expect(() => isolatedDatabaseUrl({ DOCMEE_SCHEDULED_TEST_DATABASE_URL: url })).toThrow('explicit opt-in')
    expect(() => isolatedDatabaseUrl({ DOCMEE_SCHEDULED_INTEGRATION: 'true', DATABASE_URL: url })).toThrow('separate local test database')
  })
  it.each([
    'postgresql://synthetic@production.example/docmee_scheduled_test',
    'postgresql://synthetic@127.0.0.1/docmee',
    'postgresql://synthetic@127.0.0.1/docmee_scheduled_test?host=production.example',
    'postgresql://synthetic@localhost/docmee_scheduled_test?options=-csearch_path=public',
    'https://localhost/docmee_scheduled_test',
  ])('rejects shared, remote or overridden targets without echoing the connection string', (url: string) => {
    expect(() => isolatedDatabaseUrl({ DOCMEE_SCHEDULED_INTEGRATION: 'true', DOCMEE_SCHEDULED_TEST_DATABASE_URL: url })).toThrow('separate local test database')
  })
})
