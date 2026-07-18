import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inferRiskFromPaths, inferRiskFromText } from '../scripts/classify-risk.ts';
import { readYAML, type BugPacket } from '../scripts/lib.ts';
import { validatePacket } from '../scripts/validate-packet.ts';

const packets = [
  'examples/store-STO-190-fast/bug-packet.yaml',
  'examples/store-STO-186/bug-packet.yaml',
  'examples/store-STO-191-cross-system/bug-packet.yaml',
];

test('all three Store sample packets validate', () => {
  for (const path of packets) assert.deepEqual(validatePacket(readYAML(path)), { ok: true, reasons: [] });
});

test('packet hashes and evidence source rules fail closed', () => {
  const packet = structuredClone(readYAML<BugPacket>(packets[1]));
  packet.bug.original_description += 'tampered';
  assert.match(validatePacket(packet).reasons.join(' '), /content_sha256/);
  const second = structuredClone(readYAML<BugPacket>(packets[1]));
  second.expected_business_result.assertions[0].min_independent_sources = 1;
  assert.match(validatePacket(second).reasons.join(' '), /assertions_sha256|两个独立证据源/);
});

test('risk inference is monotonic and detects cross-system paths', () => {
  assert.equal(inferRiskFromPaths(['src/integrations/platform/client.ts']).level, 'CROSS_SYSTEM');
  assert.equal(inferRiskFromPaths(['src/api/tasks.ts']).level, 'STANDARD');
  assert.equal(inferRiskFromText('刷新后数据没保存').level, 'STANDARD');
  assert.equal(inferRiskFromText('同步状态重复').level, 'CROSS_SYSTEM');
});
