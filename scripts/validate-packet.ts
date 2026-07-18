/** Validate Bug Packet structure and immutable fact/oracle hashes. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  assertionsSha256,
  readJSON,
  readYAML,
  sha256,
  sha256File,
  type BugPacket,
  type GateResult,
} from './lib.ts';

const DEFAULT_SCHEMA = fileURLToPath(new URL('../schemas/bug-packet.schema.json', import.meta.url));

export function validatePacket(packet: unknown, schemaPath = DEFAULT_SCHEMA): GateResult {
  const reasons: string[] = [];
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(readJSON<object>(schemaPath));
  if (!validate(packet)) {
    reasons.push(`Bug Packet schema 不合法: ${ajv.errorsText(validate.errors)}`);
    return { ok: false, reasons };
  }

  const typed = packet as BugPacket;
  const descriptionHash = sha256(typed.bug.original_description.trim());
  if (descriptionHash !== typed.bug.source.content_sha256) {
    reasons.push('bug.source.content_sha256 与 original_description 不匹配');
  }

  const assertionHash = assertionsSha256(typed.expected_business_result.assertions);
  if (assertionHash !== typed.expected_business_result.assertions_sha256) {
    reasons.push('expected_business_result.assertions_sha256 与 assertions 不匹配');
  }

  const ids = new Set<string>();
  const standardOrHigher = typed.risk_claim.declared_level !== 'FAST';
  for (const assertion of typed.expected_business_result.assertions) {
    if (ids.has(assertion.id)) reasons.push(`重复 assertion id: ${assertion.id}`);
    ids.add(assertion.id);
    if (assertion.min_independent_sources > assertion.required_collectors.length) {
      reasons.push(`${assertion.id}: min_independent_sources 超过 required_collectors 数量`);
    }
    if (standardOrHigher && assertion.min_independent_sources < 2) {
      reasons.push(`${assertion.id}: STANDARD+ 至少需要两个独立证据源`);
    }
    if (
      standardOrHigher &&
      !assertion.required_collectors.some(
        (collector) => collector === 'trusted_http_probe' || collector === 'contract_replay',
      )
    ) {
      reasons.push(`${assertion.id}: STANDARD+ 必须包含 trusted_http_probe 或 contract_replay`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

function arg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function main(): void {
  const packetPath = arg('--packet');
  if (!packetPath) {
    console.error('缺少 --packet <bug-packet.yaml>');
    process.exit(2);
  }
  let packet: unknown;
  let result: GateResult;
  try {
    packet = readYAML(packetPath);
    result = validatePacket(packet, arg('--schema') ?? DEFAULT_SCHEMA);
  } catch (error) {
    result = { ok: false, reasons: [`读取或校验 Packet 失败: ${(error as Error).message}`] };
  }

  const output = {
    computed_by: 'validate-packet.ts',
    generated_at: new Date().toISOString(),
    packet: packetPath,
    packet_sha256: sha256File(packetPath),
    ...result,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/packet-validation.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  process.exit(result.ok ? 0 : 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
