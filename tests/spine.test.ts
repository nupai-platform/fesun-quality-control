import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { scanOrphanIntegrations } from '../scripts/detect-orphan-integrations.ts';
import { validateSpineMaps } from '../scripts/validate-spine-maps.ts';

const temporary = mkdtempSync(join(tmpdir(), 'fesun-spine-'));
after(() => rmSync(temporary, { recursive: true, force: true }));

test('spine maps, owners, impact map, and sample packet coverage validate', () => {
  assert.deepEqual(validateSpineMaps(), { ok: true, reasons: [] });
});

test('orphan scanner accepts mapped integration and rejects unknown event', () => {
  const sourceDir = join(temporary, 'backend/events');
  mkdirSync(sourceDir, { recursive: true });
  const source = join(sourceDir, 'task.ts');
  const map = join(temporary, 'map.yaml');
  writeFileSync(map, 'code_impact_map:\n  backend/events/task.ts:\n    contracts: [store.task.completed]\n');
  writeFileSync(source, "publishEvent('store.task.completed');");
  assert.equal(scanOrphanIntegrations(temporary, map).every((item) => item.registered), true);
  writeFileSync(source, "publishEvent('store.task.completed');\npublishEvent('unknown.event');");
  assert.equal(scanOrphanIntegrations(temporary, map).some((item) => !item.registered), true);
});
