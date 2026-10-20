import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { buildOpenApi } from '../../../packages/zeno-core/scripts/generate-contract.mjs';
import { routePaths, authOperations } from '../src/routes.ts';

test('the independent contract is deterministic, covers actual route paths and resolves every schema reference', async () => {
  const spec = buildOpenApi();
  expect(JSON.stringify(spec, null, 2) + '\n').toBe(await readFile(new URL('../contract/openapi.json', import.meta.url), 'utf8'));
  for (const path of Object.values(routePaths)) expect(spec.paths[path]).toBeDefined();
  for (const route of Object.values(authOperations)) expect(spec.paths[route.path][route.method]).toBeDefined();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      expect(value.$ref.startsWith('#/components/schemas/')).toBe(true);
      let target = spec; for (const key of value.$ref.slice(2).split('/')) target = target?.[key.replaceAll('~1', '/').replaceAll('~0', '~')];
      expect(target).toBeDefined();
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(spec);
  expect(JSON.stringify(spec)).not.toMatch(/api\.openworklabs\.com|api\.modelhelm|localhost:|127\.0\.0\.1:/);
  expect(spec.servers).toEqual([{ url: '/' }]);
});

test('the generated contract includes private media, atomic conflicts, account fences and admin-only rollout', () => {
  const spec = buildOpenApi();
  const upload = spec.paths[routePaths.media].post;
  expect(upload.requestBody.content['multipart/form-data'].schema.required).toEqual(['file']);
  expect(upload.requestBody.content['multipart/form-data'].encoding.file.contentType).toContain('video/webm');
  expect(spec.paths[routePaths.mediaItem].get.responses[206]).toBeDefined();
  expect(spec.paths[routePaths.mediaItem].get.responses[401]).toBeDefined();
  expect(spec.paths[routePaths.mediaItem].head.responses[200].content).toBeUndefined();
  const batch = spec.paths[routePaths.batch].post;
  expect(batch.responses[409].content['application/json'].schema.oneOf).toContainEqual({ $ref: '#/components/schemas/Conflict' });
  for (const path of [routePaths.me, routePaths.sync, routePaths.batch, routePaths.record, routePaths.media, routePaths.adminFeatures]) {
    for (const operation of Object.values(spec.paths[path])) expect(operation.parameters).toContainEqual(expect.objectContaining({ name: 'X-Zeno-Account', in: 'header' }));
  }
  for (const operation of Object.values(spec.paths[routePaths.adminFeatures])) expect(operation.security).toEqual([{ cookieSession: [] }]);
  expect(spec.components.schemas.FeatureUpdate.additionalProperties).toBe(false);
  expect(spec.components.schemas.FeatureUpdate.properties.key.enum).toEqual(['zenoAccounts', 'personalCalendar', 'fitnessTracking', 'localScheduledTasks']);
  expect(Object.keys(spec.components.schemas.AdminInvites.properties.invites.items.properties).sort()).toEqual(['consumedAt', 'createdAt', 'email', 'expiresAt', 'id', 'revokedAt']);
});
