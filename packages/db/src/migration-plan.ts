// Pure helpers for the pre-deploy migration check (scripts/pending-migrations.ts).
// No I/O here so the comparison and the "is this migration safe to ship before
// the code that needs it?" heuristics are unit-testable.

export type MigrationRiskSeverity = 'destructive' | 'caution'

export interface MigrationRisk {
  severity: MigrationRiskSeverity
  rule: string
  /** First ~90 characters of the offending statement, whitespace-collapsed. */
  statement: string
}

export interface MigrationPlan {
  /** Files in the target revision that the database has not recorded, in apply order. */
  pending: string[]
  /** Count of target-revision files the database has already applied. */
  alreadyApplied: number
  /**
   * Names recorded as applied in the database that the target revision does not
   * contain. Deploying that revision would run OLDER code against a NEWER schema.
   */
  unknownToTarget: string[]
}

export function planMigrations(targetFiles: readonly string[], applied: Iterable<string>): MigrationPlan {
  const appliedSet = new Set(applied)
  const files = targetFiles.filter((file) => file.endsWith('.sql')).sort()
  const fileSet = new Set(files)
  return {
    pending: files.filter((file) => !appliedSet.has(file)),
    alreadyApplied: files.filter((file) => appliedSet.has(file)).length,
    unknownToTarget: [...appliedSet].filter((name) => !fileSet.has(name)).sort(),
  }
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

const RULES: Array<{ severity: MigrationRiskSeverity; rule: string; test: (statement: string) => boolean }> = [
  { severity: 'destructive', rule: 'drops a table, column, schema or type', test: (s) => /\bdrop\s+(table|column|schema|type)\b/.test(s) },
  { severity: 'destructive', rule: 'truncates a table', test: (s) => /\btruncate\b/.test(s) },
  { severity: 'destructive', rule: 'deletes rows', test: (s) => /\bdelete\s+from\b/.test(s) },
  { severity: 'destructive', rule: 'renames a table or column', test: (s) => /\balter\s+(table|\w+)[^;]*\brename\b/.test(s) },
  { severity: 'destructive', rule: 'changes a column type', test: (s) => /\balter\s+column\b[^;]*\btype\b/.test(s) },
  {
    severity: 'caution',
    rule: 'adds a NOT NULL column without a default (older code cannot insert)',
    test: (s) => /\badd\s+column\b[^;]*\bnot\s+null\b/.test(s) && !/\bdefault\b/.test(s),
  },
  { severity: 'caution', rule: 'makes an existing column NOT NULL', test: (s) => /\balter\s+column\b[^;]*\bset\s+not\s+null\b/.test(s) },
  {
    severity: 'caution',
    rule: 'drops an index, constraint, policy, trigger, function or view',
    test: (s) => /\bdrop\s+(index|constraint|policy|trigger|function|view)\b/.test(s),
  },
]

/**
 * Heuristic scan of one migration's SQL. A migration with no `destructive`
 * findings only adds things, so it can be applied before the new code ships and
 * the previous release keeps working if the deploy is rolled back. This is a
 * screening aid, not a proof: it splits on `;`, so semicolons inside dollar-quoted
 * function bodies can produce extra fragments (an over-report, never an under-report).
 */
export function classifyMigrationSql(sql: string): MigrationRisk[] {
  const risks: MigrationRisk[] = []
  for (const raw of stripComments(sql).split(';')) {
    const statement = raw.replace(/\s+/g, ' ').trim()
    if (!statement) continue
    const lower = statement.toLowerCase()
    for (const rule of RULES) {
      if (rule.test(lower)) risks.push({ severity: rule.severity, rule: rule.rule, statement: statement.slice(0, 90) })
    }
  }
  return risks
}

export function hasDestructive(risks: readonly MigrationRisk[]): boolean {
  return risks.some((risk) => risk.severity === 'destructive')
}
