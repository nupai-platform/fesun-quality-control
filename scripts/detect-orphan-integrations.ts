/** Detect integration calls that have neither a registered contract nor a registered source path. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { globSync } from 'glob';
import { fileExists, readYAML } from './lib.ts';

const INTEGRATION_PATTERNS: { re: RegExp; kind: string }[] = [
  { re: /\b(?:publish|emit)Event\s*\(\s*['"`]([\w.-]+)['"`]/g, kind: 'event_publish' },
  { re: /@(?:EventPattern|MessagePattern)\s*\(\s*['"`]([\w.-]+)['"`]/g, kind: 'consumer' },
  { re: /\b(?:crm|store|mos|platform)Client\.\w+\s*\(/gi, kind: 'api_client' },
  { re: /fetch\s*\(\s*[`'"]https?:\/\/[^`'"]*\/(?:api|events|sync)\//g, kind: 'cross_call' },
];

interface FoundIntegration { file: string; kind: string; token: string; registered: boolean }

export function scanOrphanIntegrations(root: string, mapPath: string): FoundIntegration[] {
  const registeredContracts = new Set<string>();
  const registeredPaths = new Set<string>();
  if (fileExists(mapPath)) {
    const map = readYAML<any>(mapPath);
    const impact = map?.code_impact_map ?? {};
    for (const [path, entry] of Object.entries<any>(impact)) {
      registeredPaths.add(path);
      for (const contract of entry?.contracts ?? []) registeredContracts.add(contract);
    }
  }
  const prefix = root === '.' ? '' : `${root.replace(/\/$/, '')}/`;
  const files = globSync(`${root}/**/*.{ts,tsx,js,jsx,py}`, {
    nodir: true,
    ignore: [
      '**/node_modules/**', '**/dist/**', '**/.qc/**', '**/testing/**', '**/tests/**',
      '**/examples/**', '**/*.spec.*', '**/*.test.*',
    ],
  });
  const found: FoundIntegration[] = [];
  for (const file of files) {
    const relative = prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file.replace(/^\.\//, '');
    const content = readFileSync(file, 'utf8');
    for (const pattern of INTEGRATION_PATTERNS) {
      pattern.re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.re.exec(content)) !== null) {
        const token = match[1] ?? match[0].replace(/\s+/g, ' ').slice(0, 80);
        found.push({
          file: relative,
          kind: pattern.kind,
          token,
          registered: pattern.kind === 'event_publish' || pattern.kind === 'consumer'
            ? registeredContracts.has(token)
            : registeredPaths.has(relative),
        });
      }
    }
  }
  return found;
}

function arg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function main(): void {
  const root = arg('--root') ?? '.';
  const mapPath = arg('--map') ?? 'spine/code-impact-map.yaml';
  const found = scanOrphanIntegrations(root, mapPath);
  const orphans = found.filter((integration) => !integration.registered);
  const output = {
    computed_by: 'detect-orphan-integrations.ts', generated_at: new Date().toISOString(),
    root, map: mapPath, found_integration_points: found.length, orphans, ok: orphans.length === 0,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/orphan-integrations.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  process.exit(output.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
