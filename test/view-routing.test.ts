import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInitialView } from '../src/view-routing.js';

test('resolveInitialView maps known paths', () => {
  assert.equal(resolveInitialView('/'), 'team-status');
  assert.equal(resolveInitialView('/teams'), 'teams');
  assert.equal(resolveInitialView('/team-status'), 'team-status');
  assert.equal(resolveInitialView('/agents'), 'agents');
  assert.equal(resolveInitialView('/settings'), 'settings');
  assert.equal(resolveInitialView('/projects'), 'projects');
  assert.equal(resolveInitialView('/runs'), 'runs');
});

test('resolveInitialView falls back to team-status on unknown path', () => {
  assert.equal(resolveInitialView('/unknown'), 'team-status');
});
