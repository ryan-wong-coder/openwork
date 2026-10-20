import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Operator-only acceptance. Credentials and cleanup identities stay in private
// files; the public report contains check names and booleans only.
const origin = new URL(process.env.ZENO_ACCEPTANCE_ORIGIN ?? 'https://www.zeno.ryan-wong.cn').origin;
assert.equal(new URL(origin).protocol, 'https:');
assert.ok(process.env.ZENO_ACCEPTANCE_CREDENTIALS && process.env.ZENO_ACCEPTANCE_CLEANUP);
const credentials = JSON.parse(await readFile(process.env.ZENO_ACCEPTANCE_CREDENTIALS, 'utf8'));
const prefix = '/api/zeno/v1';
const checks = [];
const syntheticAccounts = [];
const remember = async () => writeFile(process.env.ZENO_ACCEPTANCE_CLEANUP, JSON.stringify(syntheticAccounts), { mode: 0o600 });
const checked = name => checks.push(name);
async function call(path, { method = 'GET', body, cookie, bearer, account, expected = 200 } = {}) {
  const headers = new Headers({ Origin: origin });
  if (cookie) headers.set('Cookie', cookie);
  if (bearer) headers.set('Authorization', 'Bearer ' + bearer);
  if (account) headers.set('X-Zeno-Account', account);
  if (body !== undefined && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const init = { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) };
  let response;
  for (let attempt = 0; attempt < 5; attempt++) {
    response = await fetch(origin + prefix + path, init);
    if (response.status !== 429) break;
    const delay = Number(response.headers.get('retry-after') ?? 10);
    assert.ok(Number.isFinite(delay) && delay >= 0 && delay <= 60, 'Unexpected rate-limit delay');
    await response.arrayBuffer();
    await new Promise(resolve => setTimeout(resolve, (delay + .1) * 1000));
  }
  assert.equal(response.status, expected, `${method} ${path.split('?')[0]} returned an unexpected status`);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  return response;
}
async function signIn(email, password) {
  const response = await call('/auth/sign-in/email', { method: 'POST', body: { email, password } });
  const values = response.headers.getSetCookie();
  const session = values.find(value => /session_token=/.test(value));
  assert.ok(session && /;\s*Secure/i.test(session) && /;\s*HttpOnly/i.test(session) && /;\s*SameSite=Lax/i.test(session), 'HTTPS session cookie lacks required protections');
  return values.map(value => value.split(';')[0]).join('; ');
}
async function createMember(admin) {
  const email = `zeno-acceptance-${randomUUID()}@example.invalid`, password = randomBytes(32).toString('base64url');
  syntheticAccounts.push({ email }); await remember();
  const invitation = await (await call('/admin/invites', { method: 'POST', cookie: admin, body: { email }, expected: 201 })).json();
  const token = new URL(invitation.url).searchParams.get('token');
  const body = { token, email, name: '部署验收', password };
  const redeemed = await (await call('/invites/redeem', { method: 'POST', body, expected: 201 })).json();
  syntheticAccounts.at(-1).id = redeemed.userId; await remember();
  await call('/invites/redeem', { method: 'POST', body, expected: 400 });
  const cookie = await signIn(email, password);
  const session = await (await call('/me', { cookie })).json();
  syntheticAccounts.at(-1).id = session.user.id; await remember();
  return { cookie, userId: session.user.id, email, password };
}

try {
  const flags = await (await call('/features')).json();
  for (const key of ['zenoAccounts', 'personalCalendar', 'fitnessTracking', 'localScheduledTasks']) assert.equal(flags[key], true);
  await call('/me', { expected: 401 });
  await call('/auth/sign-up/email', { method: 'POST', body: {}, expected: 404 });
  checked('public-flags-and-invitation-only');
  const admin = await signIn(credentials.email, credentials.password);
  checked('public-https-secure-cookie');
  const a = await createMember(admin), b = await createMember(admin);
  checked('one-time-invitations-and-browser-login');
  const verifier = randomBytes(48).toString('base64url');
  const grant = await (await call('/devices/authorization', { method: 'POST', body: { name: '部署验收设备', platform: 'linux', codeChallenge: createHash('sha256').update(verifier).digest('base64url') }, expected: 201 })).json();
  const exchange = { deviceCode: grant.deviceCode, codeVerifier: verifier };
  await call('/devices/token', { method: 'POST', body: exchange, expected: 428 });
  await call('/devices/approve', { method: 'POST', body: { userCode: grant.userCode }, cookie: a.cookie, account: a.userId });
  const device = await (await call('/devices/token', { method: 'POST', body: exchange })).json();
  await call('/devices/token', { method: 'POST', body: exchange, expected: 400 });
  await call('/me', { bearer: device.accessToken, account: a.userId });
  await call('/admin/users', { bearer: device.accessToken, expected: 403 });
  checked('pkce-browser-approval-single-exchange');
  const id = randomUUID(), data = { title: '部署验收日程', startAt: Date.now() + 3600000, endAt: Date.now() + 7200000, timeZone: 'Asia/Shanghai' };
  const mutation = { kind: 'event', id, baseVersion: 0, operationId: randomUUID(), data, deleted: false };
  const first = await (await call('/records/event/' + id, { method: 'PUT', cookie: a.cookie, account: a.userId, body: mutation })).json();
  assert.equal(first.record.version, 1);
  const replay = await (await call('/records/event/' + id, { method: 'PUT', bearer: device.accessToken, account: a.userId, body: mutation })).json();
  assert.equal(replay.replayed, true);
  const conflict = await (await call('/records/event/' + id, { method: 'PUT', cookie: a.cookie, account: a.userId, body: { ...mutation, operationId: randomUUID(), data: { ...data, title: '冲突草稿' } }, expected: 409 })).json();
  assert.equal(conflict.current.version, 1);
  await call('/records/event/' + id, { cookie: b.cookie, account: b.userId, expected: 404 });
  await call('/records/event/' + id, { method: 'PUT', cookie: b.cookie, account: a.userId, body: mutation, expected: 409 });
  const sync = await (await call('/sync?cursor=0', { bearer: device.accessToken, account: a.userId })).json();
  assert.ok(sync.records.some(record => record.id === id));
  checked('account-isolation-idempotency-conflict-and-device-sync');
  const form = new FormData();
  form.set('file', new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')], 'acceptance.png', { type: 'image/png' }));
  const media = await (await call('/media', { method: 'POST', body: form, cookie: a.cookie, account: a.userId, expected: 201 })).json();
  const pixels = await call('/media/' + media.id, { bearer: device.accessToken, account: a.userId });
  assert.equal((await pixels.arrayBuffer()).byteLength, media.size);
  await call('/media/' + media.id, { cookie: b.cookie, account: b.userId, expected: 404 });
  await call('/media/' + media.id, { expected: 401 });
  checked('private-media-owner-only');
  const reset = await (await call('/admin/password-resets', { method: 'POST', cookie: admin, body: { email: b.email }, expected: 201 })).json();
  const resetBody = { token: new URL(reset.url).searchParams.get('token'), password: randomBytes(32).toString('base64url') };
  await call('/password/reset', { method: 'POST', body: resetBody });
  await call('/password/reset', { method: 'POST', body: resetBody, expected: 400 });
  await call('/me', { cookie: b.cookie, expected: 401 });
  checked('one-time-password-reset-revokes-session');
  await call('/devices/' + device.deviceId, { method: 'DELETE', cookie: a.cookie, account: a.userId });
  await call('/me', { bearer: device.accessToken, account: a.userId, expected: 401 });
  checked('device-revocation');
  const report = { passed: true, scope: 'live-public-HTTPS-synthetic-accounts', checks, noModelRequests: true, nativeKeychainValidated: false };
  if (process.env.ZENO_ACCEPTANCE_REPORT) await writeFile(process.env.ZENO_ACCEPTANCE_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (error) {
  // Assertion messages contain only method/path/status, never response bodies.
  console.error(error instanceof assert.AssertionError ? error.message : 'Public acceptance failed; inspect private operator diagnostics.');
  process.exitCode = 1;
}
