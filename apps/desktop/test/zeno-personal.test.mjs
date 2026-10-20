import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { createZenoPersonalService, atomicPrivateJson } from '../electron/zeno-personal.mjs';

const ORIGIN = 'https://fixture.zeno.invalid';
const NOW = 1800000000000;
const session = { user: { id: 'user-a', email: 'fixture@example.invalid', name: 'Fixture', role: 'user' }, deviceId: 'device-a', expiresAt: NOW + 86400000 };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function encryptedStorage() {
  const key = randomBytes(32);
  return { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'keychain-fixture',
    encryptString(value) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    decryptString(value) { const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8'); },
  };
}
async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'zeno-personal-test-'));
  const storage = encryptedStorage(); const calls = []; const opened = [];
  const options = { root, origin: ORIGIN, safeStorage: storage, now: () => NOW, isWindowOpen: () => true, name: 'Fixture device', platform: 'darwin',
    openExternal: async url => { opened.push(url); }, fetchImpl: async (url, init) => { calls.push({ url, init }); return json({ code: 'fixture-not-configured' }, 404); }, ...overrides };
  const service = createZenoPersonalService(options);
  t.after(async () => { service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, storage, calls, opened, options, service };
}
async function seed(value, overrides = {}) {
  const credential = { origin: ORIGIN, deviceId: 'device-a', accessToken: 'synthetic-device-token-a', expiresAt: NOW + 86400000, userId: 'user-a', ...overrides };
  await fs.writeFile(path.join(value.root, 'device.bin'), value.storage.encryptString(JSON.stringify(credential)), { mode: 0o600 });
  return credential;
}
async function gateRead(t, file) {
  const entered = deferred(), release = deferred(); const original = fs.readFile;
  fs.readFile = async (target, ...args) => { const bytes = await original(target, ...args); if (String(target) === file) { entered.resolve(); await release.promise; } return bytes; };
  syncBuiltinESMExports();
  t.after(() => { release.resolve(); fs.readFile = original; syncBuiltinESMExports(); });
  return { entered: entered.promise, release: release.resolve };
}
async function bounded(promise, ms = 4000) {
  let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('fixture deadline')), ms); })]); } finally { clearTimeout(timer); }
}

test('device pairing proves S256 possession and exposes only safe account metadata', async t => {
  const changed = deferred(); const calls = []; let challenge;
  const value = await fixture(t, { onChanged: () => changed.resolve(), fetchImpl: async (url, init) => {
    calls.push({ url, init }); const body = init.body ? JSON.parse(init.body) : undefined;
    if (url.endsWith('/devices/authorization')) { challenge = body.codeChallenge; assert.equal(body.codeVerifier, undefined); return json({ deviceCode: 'synthetic-device-code', verificationUriComplete: `${ORIGIN}/app/device?user_code=fixture`, expiresAt: NOW + 300000 }); }
    if (url.endsWith('/devices/token')) { assert.equal(createHash('sha256').update(body.codeVerifier).digest('base64url'), challenge); assert.equal(body.deviceCode, 'synthetic-device-code'); return json({ deviceId: 'device-a', accessToken: 'synthetic-device-token-a', expiresAt: NOW + 86400000 }); }
    if (url.endsWith('/me')) return json(session); throw new Error('unexpected fixture route');
  } });
  const connected = await value.service.connect(); assert.deepEqual(Object.keys(connected).sort(), ['expiresAt', 'verificationUri']);
  await bounded(changed.promise);
  assert.deepEqual(await value.service.identity(), { userId: 'user-a', deviceId: 'device-a', generation: 1 });
  assert.deepEqual(await value.service.getSession(), session);
  assert.equal(value.opened.length, 1); assert.equal(new URL(value.opened[0]).origin, ORIGIN);
  const file = await fs.readFile(path.join(value.root, 'device.bin'));
  assert.equal(file.includes(Buffer.from('synthetic-device-token-a')), false);
  assert.equal((await fs.stat(path.join(value.root, 'device.bin'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(value.root)).mode & 0o777, 0o700);
  assert.ok(calls.every(call => call.init.redirect === 'error'));
});

test('origin, credential backend and closed-window connection fail closed', async t => {
  for (const origin of ['http://example.invalid', `${ORIGIN}/other`, 'https://user:pass@example.invalid', `${ORIGIN}?other=1`]) assert.throws(() => createZenoPersonalService({ root: '/unused', origin }), /地址无效/);
  const closed = await fixture(t, { isWindowOpen: () => false }); await assert.rejects(closed.service.connect(), /打开泽诺窗口/); assert.equal(closed.calls.length, 0);
  for (const storage of [{ isEncryptionAvailable: () => false }, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' }]) {
    const value = await fixture(t, { safeStorage: storage }); await seed(value);
    assert.equal(await value.service.identity(), null); await assert.rejects(value.service.connect(), /安全储存/); assert.equal(value.opened.length, 0); assert.equal(value.calls.length, 0);
  }
});

test('pairing rejects a server-supplied cross-origin authorization window', async t => {
  const value = await fixture(t, { fetchImpl: async () => json({ deviceCode: 'synthetic-code', verificationUriComplete: 'https://other.invalid/app/device', expiresAt: NOW + 300000 }) });
  await assert.rejects(value.service.connect(), /授权地址无效/); assert.equal(value.opened.length, 0); assert.equal(await value.service.identity(), null);
});

test('stored credentials are isolated by origin and expiry and directories by origin plus account', async t => {
  const value = await fixture(t); await seed(value, { origin: 'https://different.invalid' }); assert.equal(await value.service.identity(), null);
  const expired = await fixture(t); await seed(expired, { expiresAt: NOW - 1 }); assert.equal(await expired.service.identity(), null);
  const other = await fixture(t, { origin: 'https://second.zeno.invalid' });
  assert.notEqual(value.service.accountDirectory('user-a'), value.service.accountDirectory('user-b'));
  assert.notEqual(path.basename(value.service.accountDirectory('user-a')), path.basename(other.service.accountDirectory('user-a')));
  assert.match(path.basename(value.service.accountDirectory('../../user-a')), /^[a-f\d]{64}$/);
});

test('401 revocation clears memory and encrypted disk; offline disconnect still forgets', async t => {
  const value = await fixture(t, { fetchImpl: async () => json({ code: 'revoked' }, 401) }); await seed(value);
  assert.equal((await value.service.request('GET', '/me')).status, 401); assert.equal(await value.service.identity(), null);
  await assert.rejects(fs.stat(path.join(value.root, 'device.bin')), { code: 'ENOENT' });
  const offline = await fixture(t, { fetchImpl: async () => { throw new Error('synthetic offline'); } }); await seed(offline);
  await assert.rejects(offline.service.disconnect(), /synthetic offline/); assert.equal(await offline.service.identity(), null); await assert.rejects(fs.stat(path.join(offline.root, 'device.bin')), { code: 'ENOENT' });
});

test('renderer request boundary cannot mint pairing credentials, submit run receipts or traverse routes', async t => {
  const value = await fixture(t); await seed(value);
  for (const route of ['/devices/token', '/devices/authorization']) await assert.rejects(value.service.request('POST', route, {}), /仅限主进程/);
  await assert.rejects(value.service.request('GET', '//other.invalid/me'), /不可用于设备连接/);
  await assert.rejects(value.service.request('GET', '/records/../me'), /请求路径无效/);
  const mutation = { kind: 'run', id: 'run-a', baseVersion: 0, operationId: 'fixture-run', data: { deviceId: 'device-a', scheduledAt: NOW, status: 'succeeded' } };
  await assert.rejects(value.service.request('PUT', '/records/run/run-a', mutation, 'user-a'), /执行回执/);
  await assert.rejects(value.service.request('POST', '/records/batch', { operationId: 'fixture-batch', mutations: [mutation] }, 'user-a'), /执行回执/);
  assert.equal(value.calls.length, 0);
});

test('native media limits reject oversized uploads and declared responses before returning bytes', async t => {
  const value = await fixture(t, { fetchImpl: async () => new Response('synthetic', { headers: { 'content-length': String(51 * 1024 * 1024), 'content-type': 'video/webm' } }) }); await seed(value);
  await assert.rejects(value.service.uploadMedia({ name: 'fixture.png', mime: 'image/png', bytes: new ArrayBuffer(10 * 1024 * 1024 + 1) }), /10 MB/);
  await assert.rejects(value.service.uploadMedia({ name: 'fixture.webm', mime: 'video/webm', bytes: new ArrayBuffer(50 * 1024 * 1024 + 1) }), /50 MB/);
  await assert.rejects(value.service.readMedia('../secret'), /文件不存在/);
  await assert.rejects(value.service.readMedia('photo-a'), /文件过大/);
});

test('renderer mutations require account binding and stale media operations fail before dispatch', async t => {
  const value = await fixture(t); await seed(value);
  await assert.rejects(value.service.request('PUT', '/records/membership/card-a', {}), /绑定当前账号/);
  const changed = await value.service.request('GET', '/me', undefined, 'user-b'); assert.equal(changed.status, 409); assert.equal(changed.body.code, 'account_changed');
  const media = await value.service.uploadMedia({ name: 'fixture.webm', mime: 'video/webm', bytes: new ArrayBuffer(1), expectedUserId: 'user-b' });
  assert.equal(media.status, 409); assert.equal(media.body.code, 'account_changed');
  await assert.rejects(value.service.readMedia('photo-a', 'user-b'), /账号已改变/); assert.equal(value.calls.length, 0);
});

test('concurrent first credential loads share the completed identity', async t => {
  const value = await fixture(t); await seed(value); const gate = await gateRead(t, path.join(value.root, 'device.bin'));
  const first = value.service.identity(); await gate.entered; const second = value.service.identity(); gate.release();
  const [a, b] = await Promise.all([first, second]); assert.equal(a?.userId, 'user-a'); assert.equal(b?.userId, 'user-a');
});

test('disconnect wins over an in-flight credential disk read and cannot resurrect the old account', async t => {
  const value = await fixture(t); await seed(value); const gate = await gateRead(t, path.join(value.root, 'device.bin'));
  const loading = value.service.identity(); await gate.entered; const disconnecting = value.service.disconnect();
  await new Promise(resolve => setImmediate(resolve)); gate.release(); await Promise.all([loading, disconnecting]);
  assert.equal(await value.service.identity(), null); await assert.rejects(fs.stat(path.join(value.root, 'device.bin')), { code: 'ENOENT' });
});

test('private JSON updates are atomic, private and leave no temporary siblings', async t => {
  const value = await fixture(t); const file = path.join(value.root, 'account', 'undo.json');
  await atomicPrivateJson(file, { version: 1 }); await atomicPrivateJson(file, { version: 2 });
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { version: 2 }); assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(path.dirname(file)), ['undo.json']);
});

test('native expected-identity binding rejects a stale account before any request', async t => {
  const value = await fixture(t); await seed(value);
  const response = await value.service.internalRequest('PUT', '/records/membership/card-a', {}, { userId: 'user-b', deviceId: 'device-b', generation: 0 });
  assert.equal(response.status, 409); assert.equal(response.body.code, 'account_changed'); assert.equal(value.calls.length, 0);
});

test('disconnect cancels an in-flight pairing token and cannot restore credentials later', async t => {
  const entered = deferred(), release = deferred(), observedMe = deferred();
  const value = await fixture(t, { fetchImpl: async url => {
    if (url.endsWith('/devices/authorization')) return json({ deviceCode: 'synthetic-code', verificationUriComplete: `${ORIGIN}/app/device?user_code=fixture`, expiresAt: NOW + 300000 });
    if (url.endsWith('/devices/token')) { entered.resolve(); await release.promise; return json({ deviceId: 'device-a', accessToken: 'synthetic-cancelled-token', expiresAt: NOW + 86400000 }); }
    if (url.endsWith('/me')) { observedMe.resolve(); return json(session); }
    throw new Error('unexpected fixture route');
  } });
  await value.service.connect(); await bounded(entered.promise); await value.service.disconnect(); release.resolve();
  await bounded(observedMe.promise); await new Promise(resolve => setImmediate(resolve));
  assert.equal(await value.service.identity(), null); await assert.rejects(fs.stat(path.join(value.root, 'device.bin')), { code: 'ENOENT' });
});

test('disposing during authorization cannot open an external browser after shutdown', async t => {
  const entered = deferred(), release = deferred();
  const value = await fixture(t, { fetchImpl: async () => { entered.resolve(); await release.promise; return json({ deviceCode: 'synthetic-code', verificationUriComplete: `${ORIGIN}/app/device?user_code=fixture`, expiresAt: NOW + 300000 }); } });
  const connecting = value.service.connect(); await entered.promise; value.service.dispose(); release.resolve();
  await assert.rejects(connecting, /取消|退出|不可用/); assert.equal(value.opened.length, 0); assert.equal(await value.service.identity(), null);
});
