import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPwaCsp, publicReadAllowed, publicQaTarget, pwaAssetPaths } from '../scripts/qa-public-personal.mjs';

const origin = 'https://www.zeno.ryan-wong.cn';
test('public QA preserves the default and separates explicitly selected release evidence', () => {
  const previous = publicQaTarget();
  const next = publicQaTarget([], { ZENO_PUBLIC_QA_VERSION: '1.1.1' });
  assert.equal(previous.version, '1.1.0');
  assert.ok(previous.output.endsWith('/docs/evidence/zeno-1.1.0/public-site-pwa'));
  assert.equal(next.version, '1.1.1');
  assert.ok(next.output.endsWith('/docs/evidence/zeno-1.1.1/public-site-pwa'));
  assert.notEqual(previous.output, next.output, 'New-version evidence must not overwrite the earlier release.');
  assert.deepEqual(publicQaTarget(['--version', '1.1.1'], { ZENO_PUBLIC_QA_VERSION: '1.1.0' }), next);
});

test('public QA rejects unsafe versions and unrelated overrides before any network or file writes', () => {
  for (const version of ['', 'v1.1.1', '1.1', '01.1.1', '1.1.1-beta', '../outside', '1.1.1/../../outside', '1.1.1\n', 'https://outside.invalid']) {
    assert.throws(() => publicQaTarget(['--version', version]));
    assert.throws(() => publicQaTarget([], { ZENO_PUBLIC_QA_VERSION: version }));
  }
  for (const args of [['--version'], ['--origin', origin], ['--profile', 'fixture'], ['--version', '1.1.1', '--output', '../outside']]) assert.throws(() => publicQaTarget(args));
});

test('public QA allows only same-origin reads and never installer, account mutation or model routes', () => {
  for (const path of ['/', '/app/', '/app/calendar', '/app/assets/main-a123.js', '/api/releases/latest.json', '/api/zeno/v1/me']) assert.equal(publicReadAllowed(origin + path, 'GET'), true);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(publicReadAllowed(origin + '/api/zeno/v1/me', method), false);
  for (const path of ['/downloads/1.1.0/zeno-win-x64-1.1.0.exe', '/updates/linux/x64/latest-linux.yml', '/%64ownloads/installer.exe', '/api/zeno/v1/admin/users', '/api/zeno/v1/devices/authorization', '/api/zeno/v1/records/event/private', '/api/v1/responses', '/v1/responses', '/v1/responses#private']) assert.equal(publicReadAllowed(origin + path, 'GET'), false);
  for (const url of ['https://outside.invalid/app/', 'http://www.zeno.ryan-wong.cn/app/', 'https://user:pass@www.zeno.ryan-wong.cn/app/', 'data:text/html,fixture']) assert.equal(publicReadAllowed(url, 'GET'), false);
});

test('public PWA requires self-only script/connect policy and frame protection', () => {
  const good = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'";
  assertPwaCsp(good);
  for (const bad of [null, '', good.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"), good.replace("connect-src 'self'", 'connect-src *'), good.replace("frame-ancestors 'none'", "frame-ancestors 'self'")]) assert.throws(() => assertPwaCsp(bad));
});

test('production asset parser refuses development, path traversal and foreign entry URLs', () => {
  assert.deepEqual(pwaAssetPaths('<script src="/app/assets/main-a1.js"></script><link href="/app/assets/main-a1.css">'), ['/app/assets/main-a1.js', '/app/assets/main-a1.css']);
  assert.throws(() => pwaAssetPaths('<script src="/src/personal.tsx"></script>'));
  assert.throws(() => pwaAssetPaths('<script src="/app/assets/../outside.js"></script><link href="/app/assets/main.css">'));
});
