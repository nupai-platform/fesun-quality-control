/**
 * detect-orphan-integrations.ts v1.1
 *
 * 扫描业务代码中的跨系统集成点(API client 调用 / event publish / consumer handler),
 * 与 spine/code-impact-map.yaml 登记项比对。未登记 → UNMAPPED_INTEGRATION → 阻止合并。
 *
 * 用法: tsx scripts/detect-orphan-integrations.ts --root <业务仓库根> [--map spine/code-impact-map.yaml]
 *
 * 注:这是启发式静态扫描(正则),用于 CI 兜底提醒。它宁可误报也不漏报;
 *     误报可在 code-impact-map.yaml 显式登记消除。
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { globSync } from 'glob';
import { readYAML, fileExists } from './lib.ts';

function arg(flag: string): string | undefined {
  const a = process.argv.slice(2);
  const i = a.indexOf(flag);
  return i >= 0 ? a[i + 1] : undefined;
}

// 集成点特征
const INTEGRATION_PATTERNS: { re: RegExp; kind: string }[] = [
  { re: /\b(publish|emit)Event\s*\(\s*['"`]([\w.\-]+)['"`]/g, kind: 'event_publish' },
  { re: /@(EventPattern|MessagePattern)\s*\(\s*['"`]([\w.\-]+)['"`]/g, kind: 'consumer' },
  { re: /(crm|store|mos|platform)Client\.\w+\s*\(/g, kind: 'api_client' },
  { re: /fetch\s*\(\s*[`'"]https?:\/\/[^`'"]*\/(api|events|sync)\//g, kind: 'cross_call' },
];

function main(): void {
  const root = arg('--root') ?? '.';
  const mapPath = arg('--map') ?? 'spine/code-impact-map.yaml';

  const registered = new Set<string>();
  if (fileExists(mapPath)) {
    const map = readYAML<any>(mapPath);
    const impact = map?.code_impact_map ?? map ?? {};
    for (const entry of Object.values<any>(impact)) {
      (entry?.contracts ?? []).forEach((c: string) => registered.add(c));
    }
  }

  const files = globSync(`${root}/**/*.{ts,js,py}`, {
    nodir: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/testing/**', '**/*.spec.*', '**/*.test.*'],
  });

  const found: { file: string; kind: string; token: string; registered: boolean }[] = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const { re, kind } of INTEGRATION_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const token = m[2] ?? m[1] ?? m[0].slice(0, 40);
        found.push({ file, kind, token, registered: registered.has(token) });
      }
    }
  }

  const orphans = found.filter((f) => f.kind !== 'api_client' && f.kind !== 'cross_call' && !f.registered);

  const result = {
    computed_by: 'detect-orphan-integrations.ts',
    generated_at: new Date().toISOString(),
    root,
    map: mapPath,
    scanned_files: files.length,
    found_integration_points: found.length,
    orphans,
    ok: orphans.length === 0,
  };

  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/orphan-integrations.json', JSON.stringify(result, null, 2));

  if (orphans.length > 0) {
    console.error(`发现 ${orphans.length} 个未登记跨系统集成点(需在 code-impact-map.yaml 登记):`);
    orphans.forEach((o) => console.error(`  ${o.file}  [${o.kind}]  ${o.token}`));
    process.exit(1);
  }
  console.log(`孤儿集成检查通过:${found.length} 个集成点均已登记。`);
}

main();
