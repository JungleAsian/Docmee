import { describe, expect, it } from 'vitest'
import { classifyMigrationSql, hasDestructive, planMigrations } from '../migration-plan.js'

describe('planMigrations', () => {
  it('lists unapplied files in apply order and ignores non-SQL files', () => {
    const plan = planMigrations(['0003_c.sql', '0001_a.sql', 'README.md', '0002_b.sql'], ['0001_a.sql'])
    expect(plan.pending).toEqual(['0002_b.sql', '0003_c.sql'])
    expect(plan.alreadyApplied).toBe(1)
    expect(plan.unknownToTarget).toEqual([])
  })

  it('reports nothing pending when the database is current', () => {
    const plan = planMigrations(['0001_a.sql', '0002_b.sql'], ['0001_a.sql', '0002_b.sql'])
    expect(plan.pending).toEqual([])
    expect(plan.alreadyApplied).toBe(2)
  })

  it('flags migrations the database has that the target revision lacks (older code, newer schema)', () => {
    const plan = planMigrations(['0001_a.sql'], ['0001_a.sql', '0002_newer.sql'])
    expect(plan.unknownToTarget).toEqual(['0002_newer.sql'])
    expect(plan.pending).toEqual([])
  })
})

describe('classifyMigrationSql', () => {
  it('treats purely additive DDL as safe to ship before the code', () => {
    const risks = classifyMigrationSql(`
      -- add contact columns
      ALTER TABLE patients ADD COLUMN email text;
      ALTER TABLE patients ADD COLUMN contact_verified boolean NOT NULL DEFAULT false;
      CREATE INDEX IF NOT EXISTS patients_email_idx ON patients (email);
    `)
    expect(risks).toEqual([])
  })

  it('marks drops, truncates, deletes, renames and type changes as destructive', () => {
    const sql = [
      'DROP TABLE old_things;',
      'ALTER TABLE a DROP COLUMN b;',
      'TRUNCATE audit_events;',
      'DELETE FROM messages WHERE id = 1;',
      'ALTER TABLE a RENAME COLUMN x TO y;',
      'ALTER TABLE a ALTER COLUMN n TYPE bigint;',
    ].join('\n')
    const risks = classifyMigrationSql(sql)
    expect(risks).toHaveLength(6)
    expect(risks.every((risk) => risk.severity === 'destructive')).toBe(true)
    expect(hasDestructive(risks)).toBe(true)
  })

  it('marks NOT NULL without a default, and policy/index drops, as caution only', () => {
    const risks = classifyMigrationSql(`
      ALTER TABLE a ADD COLUMN c text NOT NULL;
      ALTER TABLE a ALTER COLUMN d SET NOT NULL;
      DROP POLICY IF EXISTS p ON a;
      DROP INDEX IF EXISTS i;
    `)
    expect(risks.map((risk) => risk.severity)).toEqual(['caution', 'caution', 'caution', 'caution'])
    expect(hasDestructive(risks)).toBe(false)
  })

  it('ignores risky keywords that only appear inside comments', () => {
    expect(classifyMigrationSql('-- DROP TABLE x;\n/* TRUNCATE y; */ SELECT 1;')).toEqual([])
  })
})
