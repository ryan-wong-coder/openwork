import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPwaCsp, publicReadAllowed, pwaAssetPaths } from '../scripts/qa-public-personal.mjs';

const origin = 'https://www.zeno.ryan-wong.cn';
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
