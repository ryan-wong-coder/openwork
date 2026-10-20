import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtime, portableServerWorkspace } from '../scripts/zeno-update-runtime-fixture.mjs';

function runtimeDiagnostics() {
  let lastHttp;
  return { enter() {}, readError() {}, http(endpoint, status) { lastHttp = { endpoint, ...(status === undefined ? {} : { status }) }; }, snapshot() { return { lastHttp }; } };
}

test('workspace readiness uses the original read-only session list, rejects malformed lists and never retries a failed POST', async () => {
  let workspaceReads = 0; let statusReads = 0; let mutations = 0; let starts = 0;
  const workspace = join(tmpdir(), 'synthetic-workspace');
  const mount = '/workspace/synthetic-owned-workspace/opencode';
  const server = createHttpServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/health') { response.end(JSON.stringify({ ok: true })); return; }
    if (request.method === 'GET' && request.url === '/workspaces') { response.end(JSON.stringify({ workspaces: [{ id: 'synthetic-owned-workspace', path: workspace, workspaceType: 'local' }] })); return; }
    if (request.method === 'GET' && request.url === mount + '/session/status') {
      statusReads++; response.statusCode = 404; response.end('{}'); return;
    }
    if (request.method === 'GET' && request.url === mount + '/session') {
      workspaceReads++; response.statusCode = workspaceReads < 3 ? 502 : 200;
      if (workspaceReads === 2) response.statusCode = 200;
      response.end(JSON.stringify(workspaceReads < 3 ? { error: 'opencode_unreachable' } : [])); return;
    }
    if (request.method === 'POST' && request.url === mount + '/session') {
      mutations++; response.statusCode = 502; response.end(JSON.stringify({ error: 'synthetic-no-retry' })); return;
    }
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const diagnostics = runtimeDiagnostics();
  const client = { async invoke(name) {
    if (name === 'engineStart') { starts++; return; }
    assert.equal(name, 'openworkServerInfo');
    return { running: true, baseUrl: 'http://127.0.0.1:' + address.port, clientToken: 'synthetic-fixture-only' };
  } };
  try {
    const owned = await runtime(client, workspace, { expectedWorkspaceId: 'synthetic-owned-workspace' }, diagnostics);
    assert.equal(owned.mount, mount);
    assert.equal(starts, 1); assert.equal(workspaceReads, 3); assert.equal(statusReads, 0); assert.equal(mutations, 0);
    assert.deepEqual(diagnostics.snapshot(new Error()).lastHttp, { endpoint: 'workspace-session-list', status: 200 });
    diagnostics.enter('baseline-session-create');
    await assert.rejects(owned.request(mount + '/session', { method: 'POST', body: '{}' }));
    assert.equal(mutations, 1); assert.equal(workspaceReads, 3);
    assert.deepEqual(diagnostics.snapshot(new Error()).lastHttp, { endpoint: 'workspace-session-create', status: 502 });
  } finally {
    server.closeAllConnections(); await new Promise(done => server.close(done));
  }
});

test('server registry matches one exact local path and never returns engine credentials', () => {
  const workspace = join(tmpdir(), 'synthetic server workspace');
  const entry = { id: 'synthetic-server-id', path: workspace, workspaceType: 'local', opencode: { password: 'fixture-only-not-returned' } };
  assert.deepEqual(portableServerWorkspace({ workspaces: [entry] }, workspace), { id: entry.id, path: workspace });
  assert.equal(portableServerWorkspace({ workspaces: [{ ...entry, path: join(workspace, 'another') }] }, workspace), null);
  for (const value of [null, [], {}, { workspaces: {} }, { workspaces: [entry, entry] },
    { workspaces: [{ ...entry, id: '' }] }, { workspaces: [{ ...entry, workspaceType: 'remote' }] }]) {
    assert.throws(() => portableServerWorkspace(value, workspace));
  }
});

test('baseline registers only a missing server workspace once, and target must preserve that same registry identity', async () => {
  const workspace = join(tmpdir(), 'synthetic registry workspace');
  const entry = { id: 'synthetic-server-registry-id', path: workspace, workspaceType: 'local' };
  let registered = false; let registrations = 0; let posted;
  const server = createHttpServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    assert.equal(request.headers.authorization, 'Bearer synthetic-client');
    if (request.method === 'GET' && request.url === '/health') { response.end('{"ok":true}'); return; }
    if (request.method === 'GET' && request.url === '/workspaces') { response.end(JSON.stringify({ workspaces: registered ? [entry] : [] })); return; }
    if (request.method === 'POST' && request.url === '/workspaces/local') {
      registrations++; assert.equal(request.headers['x-openwork-host-token'], 'synthetic-host');
      let body = ''; for await (const part of request) body += part.toString(); posted = JSON.parse(body);
      registered = true; response.statusCode = 201; response.end(JSON.stringify({ persisted: true, workspaces: [entry] })); return;
    }
    if (request.method === 'GET' && request.url === '/workspace/synthetic-server-registry-id/opencode/session') {
      assert.equal(registered, true); response.end('[]'); return;
    }
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const client = { async invoke(name) {
    if (name === 'engineStart') return;
    assert.equal(name, 'openworkServerInfo');
    return { running: true, baseUrl: 'http://127.0.0.1:' + address.port, clientToken: 'synthetic-client', hostToken: 'synthetic-host' };
  } };
  try {
    await assert.rejects(runtime(client, workspace, { registerWorkspace: true, expectedWorkspaceId: entry.id }));
    const baseline = await runtime(client, workspace, { registerWorkspace: true });
    assert.equal(registrations, 1); assert.deepEqual(posted, { folderPath: workspace, name: 'Zeno update fixture', preset: 'starter' });
    assert.equal(baseline.mount, '/workspace/synthetic-server-registry-id/opencode');
    const target = await runtime(client, workspace, { expectedWorkspaceId: baseline.workspace.id });
    assert.deepEqual(target.workspace, baseline.workspace); assert.equal(target.mount, baseline.mount); assert.equal(registrations, 1);
    await assert.rejects(runtime(client, workspace, { expectedWorkspaceId: 'different-old-id' }));
    registered = false;
    await assert.rejects(runtime(client, workspace, { expectedWorkspaceId: baseline.workspace.id }));
    assert.equal(registrations, 1, 'A target missing historical state must not be repaired by creating another workspace.');
  } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
});

test('failed or unpersisted host registration is single-shot, and a missing host credential never sends the mutation', async () => {
  for (const scenario of ['http-failure', 'unpersisted', 'no-host']) {
    const workspace = join(tmpdir(), 'synthetic failed registry'); let registrations = 0; let sessionReads = 0;
    const server = createHttpServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'GET' && request.url === '/health') { response.end('{"ok":true}'); return; }
      if (request.method === 'GET' && request.url === '/workspaces') { response.end('{"workspaces":[]}'); return; }
      if (request.method === 'POST' && request.url === '/workspaces/local') {
        registrations++; response.statusCode = scenario === 'http-failure' ? 500 : 201;
        response.end(JSON.stringify({ persisted: false, workspaces: [{ id: 'synthetic-new-id', path: workspace, workspaceType: 'local' }] })); return;
      }
      sessionReads++; response.statusCode = 404; response.end('{}');
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const client = { async invoke(name) {
      if (name === 'engineStart') return;
      return { running: true, baseUrl: 'http://127.0.0.1:' + address.port, clientToken: 'synthetic-client',
        ...(scenario === 'no-host' ? {} : { hostToken: 'synthetic-host' }) };
    } };
    try {
      await assert.rejects(runtime(client, workspace, { registerWorkspace: true }));
      assert.equal(registrations, scenario === 'no-host' ? 0 : 1); assert.equal(sessionReads, 0);
    } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  }
});
