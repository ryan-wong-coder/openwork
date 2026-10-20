import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { accountSessionSchema, batchMutationSchema, deviceSchema, mediaSchema, recordMutationSchema, syncResultSchema, PERSONAL_VIDEO_LIMIT, validatePersonalMedia } from '@zeno/core';

const PREFIX = '/api/zeno/v1';
const credentialSchema = z.object({ origin: z.string().url(), deviceId: z.string(), accessToken: z.string(), expiresAt: z.number(), userId: z.string() }).strict();
function serviceOrigin(value) {
  const url = new URL(value ?? 'https://www.zeno.ryan-wong.cn');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('同步服务地址无效。');
  return url.origin;
}
export async function atomicPrivateJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomBytes(8).toString('hex') + '.tmp';
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, file);
}
/** Native process owns the device credential; the renderer never receives it. */
export function createZenoPersonalService(options) {
  const origin = serviceOrigin(options.origin);
  const credentialFile = path.join(options.root, 'device.bin');
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let credential = null, loaded = false, credentialLoad = null, pending = null, pollTimer = null, disposed = false;
  let generation = 0, lifecycle = 0;
  let storageSerial = Promise.resolve();
  const store = operation => { const result = storageSerial.then(operation); storageSerial = result.catch(() => {}); return result; };
  const changed = () => { generation++; options.onChanged?.(); };
  async function readCredential() {
    if (loaded) return credential;
    if (credentialLoad) return credentialLoad;
    const epoch = lifecycle;
    const task = (async () => {
      let candidate = null;
      try {
        if (options.safeStorage.isEncryptionAvailable() && options.safeStorage.getSelectedStorageBackend?.() !== 'basic_text') {
          const parsed = credentialSchema.parse(JSON.parse(options.safeStorage.decryptString(await readFile(credentialFile))));
          if (parsed.origin === origin && parsed.expiresAt > now()) candidate = parsed;
        }
      } catch {}
      if (epoch === lifecycle) { credential = candidate; loaded = true; }
      return epoch === lifecycle ? credential : null;
    })();
    credentialLoad = task;
    try { return await task; } finally { if (credentialLoad === task) credentialLoad = null; }
  }
  async function forget() { ++lifecycle; credential = null; loaded = true; changed(); await store(() => rm(credentialFile, { force: true })); }
  async function save(value, epoch) {
    if (!options.safeStorage.isEncryptionAvailable() || options.safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('系统安全储存不可用，请先启用系统钥匙串。');
    await store(async () => {
      if (epoch !== lifecycle) return;
      await mkdir(options.root, { recursive: true, mode: 0o700 });
      const temporary = credentialFile + '.tmp';
      await writeFile(temporary, options.safeStorage.encryptString(JSON.stringify(credentialSchema.parse(value))), { mode: 0o600 });
      if (epoch !== lifecycle) { await rm(temporary, { force: true }); return; }
      await rename(temporary, credentialFile);
      if (epoch !== lifecycle) { await rm(credentialFile, { force: true }); return; }
      credential = value; loaded = true; changed();
    });
  }
  async function remote(method, requestPath, body, token, extra = {}) {
    if (!requestPath.startsWith('/') || requestPath.startsWith('//') || requestPath.includes('\\') || requestPath.includes('#') || requestPath.includes('..')) throw new Error('请求路径无效。');
    const response = await fetchImpl(origin + PREFIX + requestPath, { method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...extra.headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
    return response;
  }
  /** @param {{userId: string, deviceId?: string, generation?: number} | null} expected */
  async function authorized(method, requestPath, body, expected = null) {
    const current = await readCredential(); if (!current) return { status: 401, body: { code: 'unauthorized', message: '请连接账号。' } };
    if (expected && (current.userId !== expected.userId || expected.deviceId !== undefined && current.deviceId !== expected.deviceId || expected.generation !== undefined && expected.generation !== generation)) return { status: 409, body: { code: 'account_changed', message: '账号已改变，请重新读取。' } };
    const response = await remote(method, requestPath, body, current.accessToken, { headers: { 'X-Zeno-Account': current.userId } });
    const result = { status: response.status, body: await response.json() };
    if (response.status === 401 && credential === current) await forget();
    return result;
  }
  async function request(method, requestPath, body, expectedUserId) {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !/^\/(?:me$|features$|sync\?|devices(?:\/|$)|records(?:\/|$)|media(?:\/|$))/.test(requestPath)) throw new Error('此操作不可用于设备连接。');
    if (/^\/devices\//.test(requestPath) && method !== 'DELETE') throw new Error('设备配对凭据仅限主进程。');
    if (method !== 'GET' && /^\/records\//.test(requestPath) && !expectedUserId) throw new Error('请先绑定当前账号。');
    if (requestPath === '/records/batch') {
      const parsed = batchMutationSchema.parse(body);
      if (parsed.mutations.some(value => value.kind === 'run')) throw new Error('执行回执仅由本机执行器产生。');
    }
    if (method !== 'GET' && /^\/records\/(?!batch$)/.test(requestPath)) {
      const mutation = recordMutationSchema.parse(body);
      if (mutation.kind === 'run') throw new Error('执行回执仅由本机执行器产生。');
      if (requestPath !== '/records/' + mutation.kind + '/' + encodeURIComponent(mutation.id)) throw new Error('记录地址不一致。');
    }
    return authorized(method, requestPath, body, expectedUserId ? { userId: z.string().min(1).max(200).parse(expectedUserId) } : null);
  }
  async function pollAuthorization() {
    const active = pending; if (!active || disposed) return;
    if (now() >= active.expiresAt) { pending = null; changed(); return; }
    try {
      const response = await remote('POST', '/devices/token', { deviceCode: active.deviceCode, codeVerifier: active.codeVerifier });
      if (response.status === 428) return;
      if (!response.ok) { pending = null; changed(); return; }
      const token = z.object({ deviceId: z.string(), accessToken: z.string(), expiresAt: z.number() }).parse(await response.json());
      const me = await remote('GET', '/me', undefined, token.accessToken);
      if (!me.ok || pending !== active) return;
      const session = accountSessionSchema.parse(await me.json());
      await save({ ...token, origin, userId: session.user.id }, active.epoch); if (pending === active) pending = null;
    } finally {
      if (pending && !disposed) { pollTimer = setTimeout(() => void pollAuthorization().catch(() => {}), 5000); pollTimer.unref?.(); }
    }
  }
  async function connect() {
    if (disposed) throw new Error('连接已取消。');
    if (!options.isWindowOpen()) throw new Error('请先打开泽诺窗口。');
    if (!options.safeStorage.isEncryptionAvailable() || options.safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('请先启用系统安全储存。');
    if (pollTimer) clearTimeout(pollTimer);
    const epoch = ++lifecycle;
    const codeVerifier = randomBytes(32).toString('base64url'); const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const response = await remote('POST', '/devices/authorization', { name: options.name, platform: options.platform, codeChallenge });
    if (!response.ok) throw new Error('暂时无法连接账号，请重试。');
    const data = z.object({ deviceCode: z.string(), verificationUriComplete: z.string().url(), expiresAt: z.number() }).parse(await response.json());
    const verification = new URL(data.verificationUriComplete); if (verification.origin !== origin || verification.pathname !== '/app/device') throw new Error('设备授权地址无效。');
    if (epoch !== lifecycle || disposed) throw new Error('连接已取消。');
    pending = { ...data, codeVerifier, epoch }; await options.openExternal(verification.href);
    pollTimer = setTimeout(() => void pollAuthorization().catch(() => {}), 1000); pollTimer.unref?.();
    return { verificationUri: verification.href, expiresAt: data.expiresAt };
  }
  async function disconnect() {
    pending = null; if (pollTimer) clearTimeout(pollTimer);
    const current = await readCredential();
    // Always clear this computer, even if revocation cannot reach the service.
    try { if (current) await authorized('DELETE', '/devices/' + encodeURIComponent(current.deviceId)); } finally { await forget(); }
  }
  async function getDevice() {
    const current = await readCredential(); if (!current) return null;
    const response = await authorized('GET', '/devices'); if (response.status !== 200) return null;
    return z.object({ devices: z.array(deviceSchema) }).parse(response.body).devices.find(device => device.id === current.deviceId && !device.revokedAt) ?? null;
  }
  async function uploadMedia(raw) {
    const input = z.object({ name: z.string().max(200), mime: z.string().max(200), bytes: z.instanceof(ArrayBuffer), expectedUserId: z.string().max(200).optional() }).strict().parse(raw);
    validatePersonalMedia({ type: input.mime, size: input.bytes.byteLength });
    const current = await readCredential(); if (!current) return { status: 401, body: { code: 'unauthorized' } };
    if (input.expectedUserId && input.expectedUserId !== current.userId) return { status: 409, body: { code: 'account_changed' } };
    const body = new FormData(); body.append('file', new Blob([input.bytes], { type: input.mime }), input.name);
    const response = await remote('POST', '/media', body, current.accessToken, { headers: { 'X-Zeno-Account': current.userId } }); const result = { status: response.status, body: await response.json() };
    if (response.ok) mediaSchema.parse(result.body); return result;
  }
  async function readMedia(id, expectedUserId) {
    if (!/^[\w.:-]{1,128}$/.test(id)) throw new Error('文件不存在。');
    const current = await readCredential(); if (!current) throw new Error('请连接账号。');
    if (expectedUserId && current.userId !== expectedUserId) throw new Error('账号已改变，请重新读取。');
    const response = await remote('GET', '/media/' + id, undefined, current.accessToken);
    if (!response.ok) throw new Error('文件暂时无法读取。');
    const length = Number(response.headers.get('content-length')); if (length > PERSONAL_VIDEO_LIMIT) throw new Error('文件过大。');
    const bytes = await response.arrayBuffer(); if (bytes.byteLength > PERSONAL_VIDEO_LIMIT) throw new Error('文件过大。');
    return { mime: response.headers.get('content-type') ?? 'application/octet-stream', bytes };
  }
  return { origin, connect, disconnect, request, getDevice, uploadMedia, readMedia,
    getSession: async () => { const result = await authorized('GET', '/me'); return result.status === 200 ? accountSessionSchema.parse(result.body) : null; },
    identity: async () => { const value = await readCredential(); return value ? { userId: value.userId, deviceId: value.deviceId, generation } : null; },
    accountDirectory: userId => path.join(options.root, 'accounts', createHash('sha256').update(origin + '\n' + userId).digest('hex')),
    async sync(cursor = 0) { const response = await authorized('GET', '/sync?cursor=' + cursor + '&limit=500'); if (response.status !== 200) throw new Error('请先连接账号并恢复网络。'); return syncResultSchema.parse(response.body); },
    /** @param {{userId: string, deviceId?: string, generation?: number} | null} expected */
    async internalRequest(method, requestPath, body, expected = null) { return authorized(method, requestPath, body, expected); },
    dispose() { disposed = true; ++lifecycle; pending = null; if (pollTimer) clearTimeout(pollTimer); },
  };
}
