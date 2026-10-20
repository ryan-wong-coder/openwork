import assert from 'node:assert/strict';

export async function smoke(baseUrl) {
  const base = new URL(baseUrl);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Smoke is restricted to a private loopback deployment');
  assert(!base.username && !base.password && base.pathname === '/' && !base.search && !base.hash);
  const request = (path, init = {}) => fetch(new URL(path, base), { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
  const health = await request('/health'); assert.equal(health.status, 200);
  const healthBody = await health.json(); assert.equal(healthBody.ok, true); assert.equal(healthBody.aiExecution, 'local-only');
  const features = await request('/api/zeno/v1/features'); assert.equal(features.status, 200);
  const flags = await features.json();
  for (const key of ['zenoAccounts', 'personalCalendar', 'fitnessTracking', 'localScheduledTasks']) assert.equal(typeof flags[key], 'boolean');
  assert.equal(features.headers.get('cache-control'), 'no-store');
  assert.equal((await request('/api/zeno/v1/me')).status, 401);
  assert.equal((await request('/api/zeno/v1/sync')).status, 401);
  assert.equal((await request('/api/zeno/v1/media/00000000-0000-4000-8000-000000000000')).status, 401);
  assert.equal((await request('/api/zeno/v1/auth/sign-up/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base.origin }, body: '{}' })).status, 404);
  assert.equal((await request('/gateway/openai/chat/completions', { method: 'POST' })).status, 404);
  return { passed: true, scope: 'private-loopback-HTTP-service-only', checks: ['health', 'local-only', 'four-resolved-flags', 'no-store', 'anonymous-data-denied', 'signup-disabled', 'no-engine-route'] };
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const value = process.argv[2]; if (!value) throw new Error('Usage: node smoke.mjs http://127.0.0.1:PORT/');
  console.log(JSON.stringify(await smoke(value), null, 2));
}
