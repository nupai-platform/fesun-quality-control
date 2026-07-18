/** Static supply-chain and fail-closed checks for workflow YAML. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { globSync } from 'glob';
import { parse } from 'yaml';
import type { GateResult } from './lib.ts';

export function validateWorkflows(files = globSync([
  '.github/workflows/*.yml',
  'templates/**/*.yml',
], { nodir: true })): GateResult {
  const reasons: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    let document: unknown;
    try { document = parse(text); }
    catch (error) { reasons.push(`${file}: YAML 无法解析: ${(error as Error).message}`); continue; }
    if (/secrets:\s*inherit/.test(text)) reasons.push(`${file}: 禁止 secrets: inherit`);
    if (/\|\|\s*true/.test(text)) reasons.push(`${file}: 禁止 || true 隐藏失败`);
    if (/qc_ref|@(?:main|master|v\d)/.test(text)) reasons.push(`${file}: 禁止动态 ref、branch 或 tag pin`);

    const walk = (value: unknown, path = ''): void => {
      if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}/${index}`));
      else if (value && typeof value === 'object') for (const [key, nested] of Object.entries(value)) {
        const nestedPath = `${path}/${key}`;
        if (key === 'uses' && typeof nested === 'string' && !nested.startsWith('./')) {
          const immutable = /@[0-9a-f]{40}$/.test(nested);
          const templatePlaceholder = file.startsWith('templates/') && nested.endsWith('@__QC_COMMIT_SHA__');
          if (!immutable && !templatePlaceholder) reasons.push(`${file}${nestedPath}: uses 未锁完整 SHA: ${nested}`);
        }
        walk(nested, nestedPath);
      }
    };
    walk(document);
  }
  return { ok: reasons.length === 0, reasons };
}

function main(): void {
  const result = validateWorkflows();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
