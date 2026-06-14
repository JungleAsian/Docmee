import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCMEE_FOUNDATION, getHealth } from '../src/index.js';

test('foundation metadata is defined', () => {
  assert.equal(DOCMEE_FOUNDATION.name, 'Docmee');
  assert.equal(DOCMEE_FOUNDATION.status, 'foundation');
});

test('health check is ok', () => {
  assert.deepEqual(getHealth(), {
    ok: true,
    service: 'Docmee',
    status: 'foundation'
  });
});
