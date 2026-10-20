import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import * as core from '../src/schema.ts';
import { personalMediaMimeSchema } from '../src/media.ts';
import { routePaths, authOperations } from '../../../apps/zeno-api/src/routes.ts';
import { operatorUpdateSchema } from '../../../apps/zeno-api/src/operator.ts';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const packageDir = fileURLToPath(new URL('..', import.meta.url));
const snapshotPath = join(repo, 'apps/zeno-api/contract/openapi.json');
const generatedPath = join(packageDir, 'src/gen');
const ref = name => ({ $ref: '#/components/schemas/' + name });
const jsonContent = schema => ({ 'application/json': { schema } });
const dataResponse = (schema, description = 'Success') => ({ description, content: jsonContent(schema) });
const body = schema => ({ required: true, content: jsonContent(schema) });
const accountHeader = { name: 'X-Zeno-Account', in: 'header', required: false, description: 'Expected account ID. Bind personal clients to their account; mismatches fail with account_changed before business effects.', schema: { type: 'string', minLength: 1 } };
const authenticated = [{ cookieSession: [] }, { deviceBearer: [] }];
const browserOnly = [{ cookieSession: [] }];

/** Pure, deterministic schema projection. No database, auth instance, network, or AI. */
export function buildOpenApi() {
  const definitions = {
    AccountSession: core.accountSessionSchema, PersonalRecord: core.personalRecordSchema,
    RecordMutation: core.recordMutationSchema, MutationResult: core.mutationResultSchema,
    BatchMutation: core.batchMutationSchema, BatchMutationResult: core.batchMutationResultSchema,
    SyncResult: core.syncResultSchema, Device: core.deviceSchema, DeviceInventory: core.deviceInventorySchema,
    Features: core.personalFeaturesSchema, Media: core.mediaSchema, FeatureUpdate: operatorUpdateSchema,
    Error: z.object({ code: z.string(), message: z.string(), fields: z.array(z.string()).optional() }),
    Conflict: z.object({ code: z.literal('conflict'), current: core.personalRecordSchema.nullable(), submitted: core.recordMutationSchema }),
    InviteRedeem: z.object({ token: z.string().min(32).max(100), email: z.email().max(254), name: z.string().min(1).max(100), password: z.string().min(12).max(128) }).strict(),
    InviteResult: z.object({ userId: z.string(), email: z.email(), name: z.string() }),
    PasswordReset: z.object({ token: z.string().min(32).max(100), password: z.string().min(12).max(128) }).strict(),
    PasswordResetResult: z.object({ reset: z.literal(true), revokedSessions: z.literal(true), revokedDevices: z.literal(true) }),
    DeviceAuthorization: z.object({ name: z.string().min(1).max(100), platform: z.enum(['darwin', 'win32', 'linux']), codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(),
    DeviceAuthorizationResult: z.object({ deviceCode: z.string(), userCode: z.string(), verificationUri: z.url(), verificationUriComplete: z.url(), expiresAt: core.timestampSchema, interval: z.number() }),
    DeviceExchange: z.object({ deviceCode: z.string().min(32).max(100), codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/) }).strict(),
    DeviceToken: z.object({ deviceId: core.idSchema, accessToken: z.string(), tokenType: z.literal('Bearer'), expiresAt: core.timestampSchema }),
    DeviceApprove: z.object({ userCode: z.string().min(6).max(20) }).strict(),
    DeviceHeartbeat: z.object({ inventory: core.deviceInventorySchema }).strict(),
    DeviceHeartbeatResult: z.object({ deviceId: core.idSchema, lastSeenAt: core.timestampSchema }),
    Devices: z.object({ devices: z.array(core.deviceSchema) }),
    Revoked: z.object({ revoked: z.literal(true) }), Approved: z.object({ approved: z.literal(true) }), Deleted: z.object({ deleted: z.literal(true) }),
    AdminEmail: z.object({ email: z.email().max(254) }).strict(),
    AdminLink: z.object({ email: z.email(), expiresAt: core.timestampSchema, url: z.url() }),
    AdminInvites: z.object({ invites: z.array(z.object({ id: core.idSchema, email: z.email(), createdAt: core.timestampSchema, expiresAt: core.timestampSchema, consumedAt: core.timestampSchema.nullable(), revokedAt: core.timestampSchema.nullable() })) }),
    AdminUsers: z.object({ users: z.array(z.object({ id: z.string(), email: z.email(), name: z.string(), role: z.enum(['user', 'admin']), disabled: z.boolean(), createdAt: core.timestampSchema })) }),
    AdminDevices: z.object({ devices: z.array(z.object({ id: core.idSchema, name: z.string(), platform: z.enum(['darwin', 'win32', 'linux']), userId: z.string(), email: z.email(), createdAt: core.timestampSchema, lastSeenAt: core.timestampSchema.nullable(), revokedAt: core.timestampSchema.nullable() })) }),
    SignInEmail: z.object({ email: z.email(), password: z.string(), rememberMe: z.boolean().optional(), callbackURL: z.string().optional() }),
    SignInResult: z.object({ redirect: z.boolean(), url: z.string().optional(), user: z.object({ id: z.string(), email: z.email(), name: z.string(), emailVerified: z.boolean(), image: z.string().nullable().optional(), createdAt: z.string(), updatedAt: z.string(), role: z.enum(['user', 'admin']).optional(), disabled: z.boolean().optional() }) }),
    AuthSession: z.object({ session: z.object({ id: z.string(), userId: z.string(), expiresAt: z.string(), createdAt: z.string(), updatedAt: z.string(), ipAddress: z.string().nullable().optional(), userAgent: z.string().nullable().optional() }), user: z.object({ id: z.string(), email: z.email(), name: z.string(), emailVerified: z.boolean(), image: z.string().nullable().optional(), createdAt: z.string(), updatedAt: z.string(), role: z.enum(['user', 'admin']).optional(), disabled: z.boolean().optional() }) }),
    AuthStatus: z.object({ status: z.boolean() }),
    ChangePassword: z.object({ currentPassword: z.string(), newPassword: z.string().min(12).max(128), revokeOtherSessions: z.boolean().optional() }),
    SessionToken: z.object({ token: z.string() }),
  };
  const inputNames = new Set(['RecordMutation', 'BatchMutation', 'FeatureUpdate', 'InviteRedeem', 'PasswordReset', 'DeviceAuthorization', 'DeviceExchange', 'DeviceApprove', 'DeviceHeartbeat', 'AdminEmail', 'SignInEmail', 'ChangePassword', 'SessionToken']);
  const schemas = {};
  for (const [name, schema] of Object.entries(definitions)) {
    const projected = z.toJSONSchema(schema, { target: 'draft-2020-12', io: inputNames.has(name) ? 'input' : 'output' });
    // Hoist Zod's recursive JSON definitions into named OpenAPI components.
    // Hey API 0.97 cannot name nested $defs symbols; direct components are stable.
    const nested = Object.entries(projected.$defs ?? {});
    const names = new Map(nested.map(([key], index) => [key, name + 'Definition' + (index + 1)]));
    const scopeReferences = value => {
      if (!value || typeof value !== 'object') return;
      if (typeof value.$ref === 'string' && value.$ref.startsWith('#/$defs/')) {
        const target = names.get(value.$ref.slice('#/$defs/'.length));
        if (!target) throw new Error('Unresolved projected schema definition');
        value.$ref = '#/components/schemas/' + target;
      }
      for (const child of Object.values(value)) scopeReferences(child);
    };
    scopeReferences(projected);
    delete projected.$schema; delete projected.$defs; schemas[name] = projected;
    for (const [key, value] of nested) schemas[names.get(key)] = value;
  }
  const paths = {};
  function operation(path, method, operationId, response, options = {}) {
    const errors = Object.fromEntries(['400', '401', '403', '404', '409', '413', '415', '429', '500'].map(status => [status, dataResponse(status === '409' && options.recordConflict ? { oneOf: [ref('Error'), ref('Conflict')] } : ref('Error'), status === '401' ? 'Authentication required' : status === '409' ? 'Version/operation conflict or account_changed' : 'Request rejected')]));
    const secured = options.security !== false;
    const parameters = [...(secured ? [accountHeader] : []), ...(options.parameters ?? [])];
    const result = { operationId, tags: [options.tag ?? 'Personal'], summary: options.summary ?? operationId,
      security: options.security === false ? [] : options.browserOnly ? browserOnly : authenticated,
      ...(parameters.length ? { parameters } : {}), ...(options.body ? { requestBody: options.body } : {}),
      responses: { ...errors, [options.status ?? 200]: dataResponse(response) },
      ...(options.description ? { description: options.description } : {}),
    };
    paths[path] ??= {}; paths[path][method] = result; return result;
  }
  const parameter = (name, schema, location = 'path', required = true) => ({ name, in: location, required, schema });
  const idParameter = parameter('id', z.toJSONSchema(core.idSchema));
  const recordParameters = [parameter('kind', z.toJSONSchema(core.recordKindSchema)), idParameter];
  operation(routePaths.health, 'get', 'health', { type: 'object', properties: { ok: { const: true }, service: { const: 'zeno-data' }, aiExecution: { const: 'local-only' } }, required: ['ok', 'service', 'aiExecution'] }, { security: false, tag: 'Health' });
  operation(routePaths.features, 'get', 'getFeatures', ref('Features'), { security: false, tag: 'Features' });
  operation(routePaths.me, 'get', 'getMe', ref('AccountSession'), { tag: 'Account' });
  operation(routePaths.inviteRedeem, 'post', 'redeemInvite', ref('InviteResult'), { security: false, status: 201, body: body(ref('InviteRedeem')), tag: 'Account' });
  operation(routePaths.passwordReset, 'post', 'resetPassword', ref('PasswordResetResult'), { security: false, body: body(ref('PasswordReset')), tag: 'Account' });
  operation(routePaths.deviceAuthorization, 'post', 'beginDeviceAuthorization', ref('DeviceAuthorizationResult'), { security: false, status: 201, body: body(ref('DeviceAuthorization')), tag: 'Devices' });
  const exchange = operation(routePaths.deviceToken, 'post', 'exchangeDeviceAuthorization', ref('DeviceToken'), { security: false, body: body(ref('DeviceExchange')), tag: 'Devices' });
  exchange.responses[428] = dataResponse(ref('Error'), 'Browser approval pending');
  operation(routePaths.deviceApprove, 'post', 'approveDevice', ref('Approved'), { browserOnly: true, body: body(ref('DeviceApprove')), tag: 'Devices' });
  operation(routePaths.deviceHeartbeat, 'post', 'heartbeatDevice', ref('DeviceHeartbeatResult'), { body: body(ref('DeviceHeartbeat')), tag: 'Devices', description: 'Requires the bound native device credential. Inventory contains no credentials or local paths.' });
  operation(routePaths.devices, 'get', 'listDevices', ref('Devices'), { tag: 'Devices' });
  operation(routePaths.device, 'delete', 'revokeDevice', ref('Revoked'), { parameters: [idParameter], tag: 'Devices' });
  operation(routePaths.sync, 'get', 'syncRecords', ref('SyncResult'), { parameters: [parameter('cursor', { type: 'integer', minimum: 0, default: 0 }, 'query', false), parameter('limit', { type: 'integer', minimum: 1, maximum: 500, default: 200 }, 'query', false)], description: 'Incremental owner-only change stream including tombstones. Safe to read/export when domain features are disabled.' });
  operation(routePaths.record, 'get', 'getRecord', { type: 'object', properties: { record: ref('PersonalRecord') }, required: ['record'] }, { parameters: recordParameters });
  for (const method of ['put', 'patch']) operation(routePaths.record, method, method === 'put' ? 'putRecord' : 'patchRecord', ref('MutationResult'), { parameters: recordParameters, body: body(ref('RecordMutation')), recordConflict: true, description: 'Per-record optimistic concurrency and operationId replay. Path kind/id must match the envelope. Runs/progress require their bound device; a browser may create pending requests or request cancellation.' });
  operation(routePaths.batch, 'post', 'mutateRecordsBatch', ref('BatchMutationResult'), { body: body(ref('BatchMutation')), recordConflict: true, description: 'One atomic transaction with a replay-safe outer operationId. All mutations roll back on conflict, including proposal state changes.' });
  operation(routePaths.media, 'post', 'uploadMedia', ref('Media'), { status: 201, body: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'], additionalProperties: false }, encoding: { file: { contentType: personalMediaMimeSchema.options.join(', ') } } } } }, tag: 'Media', description: 'Private owner-authenticated file. JPEG/PNG/WebP/GIF <=10 MiB; MP4/WebM <=50 MiB. Content magic and WebM DocType are checked. Returns metadata, never a public URL.' });
  for (const method of ['get', 'head']) {
    const media = operation(routePaths.mediaItem, method, method === 'get' ? 'readMedia' : 'headMedia', { type: 'string', format: 'binary' }, { parameters: [parameter('id', { type: 'string', format: 'uuid' }), parameter('Range', { type: 'string', pattern: '^bytes=[0-9]+-[0-9]*$' }, 'header', false)], tag: 'Media', description: 'Requires the owner Cookie or device Bearer credential; private no-store, nosniff, sandbox, same-origin CORP. No public sharing.' });
    const content = Object.fromEntries(personalMediaMimeSchema.options.map(mime => [mime, { schema: { type: 'string', format: 'binary' } }]));
    const headers = { 'Content-Length': { schema: { type: 'integer' } }, 'Content-Range': { schema: { type: 'string' } }, 'Cache-Control': { schema: { const: 'private, no-store' } }, 'Accept-Ranges': { schema: { const: 'bytes' } } };
    media.responses[200] = { description: 'Private file', headers, ...(method === 'get' ? { content } : {}) };
    media.responses[206] = { description: 'Private byte range', headers, ...(method === 'get' ? { content } : {}) };
    media.responses[416] = { description: 'Unsatisfiable byte range', headers };
  }
  operation(routePaths.mediaItem, 'delete', 'deleteMedia', ref('Deleted'), { parameters: [parameter('id', { type: 'string', format: 'uuid' })], tag: 'Media' });
  operation(routePaths.adminFeatures, 'get', 'getAdminFeatures', ref('Features'), { browserOnly: true, tag: 'Admin' });
  operation(routePaths.adminFeatures, 'put', 'setAdminFeature', ref('Features'), { browserOnly: true, tag: 'Admin', body: body(ref('FeatureUpdate')), description: 'Admin Cookie only. Atomically updates the same private operator profile used by CLI; only four declared feature keys are accepted. Turning off retains history/read/export.' });
  operation(routePaths.adminUsers, 'get', 'listAdminUsers', ref('AdminUsers'), { browserOnly: true, tag: 'Admin' });
  operation(routePaths.adminDevices, 'get', 'listAdminDevices', ref('AdminDevices'), { browserOnly: true, tag: 'Admin', description: 'Account/device management metadata only; no other user business records or workspace inventory.' });
  operation(routePaths.adminDevice, 'delete', 'revokeAdminDevice', ref('Revoked'), { browserOnly: true, parameters: [idParameter], tag: 'Admin' });
  operation(routePaths.adminInvites, 'get', 'listAdminInvites', ref('AdminInvites'), { browserOnly: true, tag: 'Admin', description: 'Invitation metadata only, never plaintext tokens or hashes.' });
  operation(routePaths.adminInvite, 'delete', 'revokeAdminInvite', ref('Revoked'), { browserOnly: true, parameters: [idParameter], tag: 'Admin', description: 'Revokes an unused invitation; consumed invitations cannot be revoked.' });
  for (const [path, id] of [[routePaths.adminInvites, 'createInvite'], [routePaths.adminPasswordResets, 'createPasswordReset']]) operation(path, 'post', id, ref('AdminLink'), { browserOnly: true, tag: 'Admin', status: 201, body: body(ref('AdminEmail')) });
  for (const [id, route] of Object.entries(authOperations)) {
    const auth = { security: id !== 'signInEmail', browserOnly: true, tag: 'Auth' };
    if (id === 'signInEmail') { auth.body = body(ref('SignInEmail')); operation(route.path, route.method, id, ref('SignInResult'), auth); }
    else if (id === 'getSession') operation(route.path, route.method, id, { oneOf: [ref('AuthSession'), { type: 'null' }] }, { ...auth, security: false });
    else if (id === 'listSessions') operation(route.path, route.method, id, { type: 'array', items: schemas.AuthSession.properties.session }, auth);
    else if (id === 'changePassword') operation(route.path, route.method, id, { type: 'object', properties: { user: schemas.AuthSession.properties.user }, required: ['user'] }, { ...auth, body: body(ref('ChangePassword')) });
    else operation(route.path, route.method, id, ref('AuthStatus'), { ...auth, body: body(id === 'revokeSession' ? ref('SessionToken') : { type: 'object', additionalProperties: false }) });
  }
  return { openapi: '3.1.0', info: { title: 'Zeno personal data API', version: '1.1.0', description: 'Independent invited accounts, private owner-scoped sync and media. AI always executes on the selected local desktop; no server AI engine or model credentials.' }, servers: [{ url: '/' }], paths, components: { schemas, securitySchemes: { cookieSession: { type: 'apiKey', in: 'cookie', name: 'zeno.session_token', description: 'HttpOnly browser session; HTTPS uses __Secure-zeno.session_token. Mutations require same-origin Origin.' }, deviceBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'Opaque device credential', description: 'PKCE/browser-approved native device credential. Store only in native main, never renderer or localStorage.' } } } };
}

async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = join(prefix, entry.name); if (entry.isDirectory()) result.push(...await files(join(directory, entry.name), name)); else result.push(name);
  }
  return result.sort();
}
export async function generateContract(check = false) {
  const temporary = await mkdtemp(join(tmpdir(), 'zeno-contract-'));
  try {
    const snapshot = JSON.stringify(buildOpenApi(), null, 2) + '\n';
    const input = join(temporary, 'openapi.json'); await writeFile(input, snapshot);
    const sdkRequire = createRequire(join(repo, 'packages/sdk/package.json'));
    const generatorPackage = sdkRequire.resolve('@hey-api/openapi-ts/package.json');
    const generatorManifest = z.object({ main: z.string(), version: z.literal('0.97.3') }).parse(JSON.parse(await readFile(generatorPackage, 'utf8')));
    const { createClient } = await import(pathToFileURL(resolve(dirname(generatorPackage), generatorManifest.main)).href);
    const prettier = await import(pathToFileURL(sdkRequire.resolve('prettier')).href);
    const format = prettier.format ?? prettier.default?.format;
    if (typeof format !== 'function') throw new Error('The SDK formatter is unavailable.');
    const output = check ? join(temporary, 'gen') : generatedPath;
    await createClient({ input, output: { path: output, tsConfigPath: join(packageDir, 'tsconfig.json'), clean: true, importFileExtension: '.js' }, plugins: [
      { name: '@hey-api/typescript', exportFromIndex: false },
      { name: '@hey-api/sdk', operations: { strategy: 'single', containerName: 'ZenoClient', methods: 'instance' }, exportFromIndex: false, auth: false, paramsStructure: 'flat' },
      { name: '@hey-api/client-fetch', exportFromIndex: false, baseUrl: '' },
    ] });
    const generated = await files(output);
    for (const file of generated) { const path = join(output, file); await writeFile(path, await format(await readFile(path, 'utf8'), { parser: 'typescript', printWidth: 120 })); }
    if (check) {
      if (await readFile(snapshotPath, 'utf8') !== snapshot) throw new Error('Zeno OpenAPI is stale. Run pnpm --filter @zeno/core contract:generate.');
      const committed = await files(generatedPath);
      if (committed.join('\n') !== generated.join('\n')) throw new Error('Zeno SDK file set is stale.');
      for (const file of generated) if (!Buffer.from(await readFile(join(output, file))).equals(await readFile(join(generatedPath, file)))) throw new Error('Zeno SDK is stale: ' + file);
      console.info('Zeno OpenAPI and ZenoClient match route/core sources.');
    } else { await mkdir(join(repo, 'apps/zeno-api/contract'), { recursive: true }); await writeFile(snapshotPath, snapshot); console.info('Generated Zeno OpenAPI and ZenoClient.'); }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2); if (args.some(value => value !== '--check')) throw new Error('Only --check is supported.');
  await generateContract(args.includes('--check'));
}
