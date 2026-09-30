import { mkdir, writeFile } from 'node:fs/promises';
import { migrationFiles } from './migrate.mjs';
import { appVersion, markdownDocs, openapi } from '../src/server/api-contract.mjs';

export async function generateApiArtifacts() {
  const files = await migrationFiles(new URL('../database/migrations/', import.meta.url));
  await mkdir('docs', { recursive: true });
  await writeFile('src/server/migration-manifest.json', JSON.stringify(files.map(({ number, filename, checksum, apiVersion }) => ({ number, filename, checksum, apiVersion })), null, 2) + '\n');
  await writeFile('docs/api.md', markdownDocs());
  await writeFile('docs/openapi.json', JSON.stringify(openapi, null, 2) + '\n');
  console.log(`Generated API documentation and migration manifest for v${appVersion}.`);
}
await generateApiArtifacts();
