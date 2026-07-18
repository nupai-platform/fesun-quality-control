/** Validate spine structure, owner coverage, code-impact references, and sample Packet mappings. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import { globSync } from 'glob';
import { readJSON, readYAML, type BugPacket, type GateResult } from './lib.ts';

export function validateSpineMaps(
  spinePath = 'spine/spine-map.yaml',
  impactPath = 'spine/code-impact-map.yaml',
  ownersPath = 'spine/owners.yaml',
  packetPaths = globSync('examples/*/bug-packet.yaml'),
): GateResult {
  const reasons: string[] = [];
  const ajv = new Ajv({ allErrors: true, strict: false });
  const spine = readYAML<any>(spinePath);
  const impact = readYAML<any>(impactPath);
  const owners = readYAML<any>(ownersPath);
  const spineSchema = ajv.compile(readJSON<object>('schemas/spine-map.schema.json'));
  const impactSchema = ajv.compile(readJSON<object>('schemas/code-impact-map.schema.json'));
  if (!spineSchema(spine)) reasons.push(`spine-map schema: ${ajv.errorsText(spineSchema.errors)}`);
  if (!impactSchema(impact)) reasons.push(`code-impact-map schema: ${ajv.errorsText(impactSchema.errors)}`);
  if (reasons.length) return { ok: false, reasons };

  const spines = new Set<string>();
  const systems = new Set<string>();
  const segments = new Set<string>();
  const contracts = new Set<string>();
  for (const [spineId, spineValue] of Object.entries<any>(spine.spines)) {
    spines.add(spineId);
    for (const system of spineValue.systems) systems.add(system);
    if (!owners.spines?.[spineId]?.owner) reasons.push(`${spineId}: 缺 owner`);
    for (const [segmentId, segment] of Object.entries<any>(spineValue.segments)) {
      if (segments.has(segmentId)) reasons.push(`重复 segment ${segmentId}`);
      segments.add(segmentId);
      for (const contract of segment.contracts) contracts.add(contract);
      if (!segment.tests.length) reasons.push(`${segmentId}: MAP_UNCOVERED`);
    }
  }
  for (const system of systems) if (!owners.systems?.[system]?.owner) reasons.push(`${system}: 缺 owner`);

  for (const [file, entry] of Object.entries<any>(impact.code_impact_map)) {
    if (!(entry.contracts?.length || entry.segments?.length || entry.spines?.length)) {
      reasons.push(`${file}: 空影响映射`);
    }
    for (const contract of entry.contracts ?? []) if (!contracts.has(contract)) reasons.push(`${file}: 未知 contract ${contract}`);
    for (const segment of entry.segments ?? []) if (!segments.has(segment)) reasons.push(`${file}: 未知 segment ${segment}`);
    for (const spineId of entry.spines ?? []) if (!spines.has(spineId)) reasons.push(`${file}: 未知 spine ${spineId}`);
  }

  for (const packetPath of packetPaths) {
    const packet = readYAML<BugPacket>(packetPath);
    for (const contract of packet.business_scope?.affected_contracts ?? []) {
      if (!contracts.has(contract)) reasons.push(`${packet.bug.id}: contract ${contract} 未进入 spine-map`);
    }
    for (const segment of packet.business_scope?.affected_segments ?? []) {
      if (!segments.has(segment)) reasons.push(`${packet.bug.id}: segment ${segment} 未进入 spine-map`);
    }
    for (const spineId of packet.business_scope?.affected_spines ?? []) {
      if (!spines.has(spineId)) reasons.push(`${packet.bug.id}: spine ${spineId} 未进入 spine-map`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function main(): void {
  let result: GateResult;
  try { result = validateSpineMaps(); }
  catch (error) { result = { ok: false, reasons: [(error as Error).message] }; }
  const output = { computed_by: 'validate-spine-maps.ts', generated_at: new Date().toISOString(), ...result };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/spine-map-validation.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
