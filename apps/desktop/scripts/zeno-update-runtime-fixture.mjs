import assert from 'node:assert/strict';
import { isAbsolute, resolve } from 'node:path';

// Shared installed-upgrade fixture only. No native process, OS installer or app
// shell is imported here. Both native launchers retain their own ownership gates.
const pause = ms => new Promise(done => setTimeout(done, ms));

export function portableHttpEndpoint(path, method = 'GET') {
  if (path === '/health') return 'server-health';
  if (path === '/workspaces' && method === 'GET') return 'workspace-registry-read';
  if (path === '/workspaces/local' && method === 'POST') return 'workspace-registry-create';
  if (path === '/experimental/engine-v2-preview/activity') return 'engine-activity';
  if (/^\/workspace\/[^/]+\/opencode\/session\/status$/.test(path)) return 'workspace-session-status';
  if (/^\/workspace\/[^/]+\/opencode\/session$/.test(path)) return method === 'POST' ? 'workspace-session-create' : 'workspace-session-list';
  if (/^\/workspace\/[^/]+\/opencode\/session\/[^/]+\/message$/.test(path)) return method === 'POST' ? 'workspace-message-write' : 'workspace-message-read';
  if (/^\/workspace\/[^/]+\/opencode\/session\/[^/]+$/.test(path)) return 'workspace-session-read';
  return 'unknown';
}

export function validWorkspaceSessionList(value) {
  return Array.isArray(value) && value.every(session => session !== null && typeof session === 'object'
    && !Array.isArray(session) && typeof session.id === 'string' && session.id.trim().length > 0);
}

export function portableServerWorkspace(value, workspace) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.workspaces), 'Owned server registry must contain a workspace list.');
  const matches = value.workspaces.filter(item => item && typeof item === 'object' && !Array.isArray(item)
    && typeof item.path === 'string' && resolve(item.path) === resolve(workspace));
  assert.ok(matches.length <= 1, 'Owned server registry contains an ambiguous workspace path.');
  const matched = matches[0];
  if (!matched) return null;
  assert.ok(typeof matched.id === 'string' && matched.id.trim().length > 0 && isAbsolute(matched.path)
    && matched.workspaceType === 'local', 'Owned server registry workspace identity is invalid.');
  // Keep only the identity. Registry responses can contain engine credentials;
  // neither the full response nor this private path is serialized as evidence.
  return { id: matched.id, path: matched.path };
}

export async function until(read, accept, timeout, label, diagnostics) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const value = await read(); if (accept(value)) return value; } catch (error) { diagnostics?.readError(error); } await pause(250); }
  throw new Error(`Timed out: ${label}.`);
}

export async function runtime(client, workspace, options = {}, diagnostics) {
  assert.ok(options && typeof options === 'object' && !Array.isArray(options), 'Missing native workspace preparation options.');
  assert.ok(!(options.registerWorkspace === true && options.expectedWorkspaceId !== undefined), 'Historical workspace validation cannot register a replacement.');
  diagnostics?.enter('runtime-engine-start');
  await client.invoke('engineStart', workspace, { workspacePaths: [workspace] });
  const deadline = Date.now() + 120_000;
  const remaining = () => Math.max(1, deadline - Date.now());
  const connection = await until(async () => {
    diagnostics?.enter('runtime-server-info');
    const info = await client.invoke('openworkServerInfo'); assert.equal(info.running, true);
    const url = new URL(info.baseUrl); assert.equal(url.protocol, 'http:'); assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.ok(!url.username && !url.password); const token = info.clientToken || info.ownerToken; assert.ok(token);
    const request = async (path, options = {}) => {
      const { expectedStatus = 200, host = false, ...init } = options;
      const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
      if (host || expectedStatus !== 200) {
        assert.equal(path, '/workspaces/local'); assert.equal(init.method, 'POST'); assert.equal(expectedStatus, 201); assert.equal(host, true);
        assert.ok(typeof info.hostToken === 'string' && info.hostToken.trim().length > 0, 'Owned server host credential is required.');
        headers['X-OpenWork-Host-Token'] = info.hostToken;
      }
      const endpoint = portableHttpEndpoint(path, init.method ?? 'GET'); diagnostics?.http(endpoint);
      const response = await fetch(url.href.replace(/\/$/, '') + path, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(30_000), headers });
      diagnostics?.http(endpoint, response.status);
      assert.equal(response.status, expectedStatus, 'Owned embedded runtime request failed.'); return response.json();
    };
    diagnostics?.enter('runtime-server-health');
    assert.equal((await request('/health', { signal: AbortSignal.timeout(Math.min(30_000, remaining())) })).ok, true);
    diagnostics?.enter('runtime-workspace-registry');
    const registered = portableServerWorkspace(await request('/workspaces', { signal: AbortSignal.timeout(Math.min(30_000, remaining())) }), workspace);
    return { request, registered };
  }, Boolean, remaining(), 'installed embedded server and registry', diagnostics);
  let registered = connection.registered;
  if (!registered) {
    assert.equal(options.registerWorkspace, true, 'Historical server workspace registry entry was lost.');
    assert.ok(Date.now() < deadline, 'Owned server workspace registration deadline expired.');
    diagnostics?.enter('runtime-workspace-register');
    // Exactly one real host-authorized API mutation, outside all retry loops.
    // Electron's legacy workspaceCreate/engineStart does not prove this server
    // registry contains the folder when a server was already booted by the UI.
    const created = await connection.request('/workspaces/local', { method: 'POST', expectedStatus: 201, host: true,
      signal: AbortSignal.timeout(Math.min(30_000, remaining())), body: JSON.stringify({ folderPath: workspace, name: 'Zeno update fixture', preset: 'starter' }) });
    assert.equal(created.persisted, true, 'Owned server workspace registry was not persisted.');
    registered = portableServerWorkspace(created, workspace);
    assert.ok(registered, 'Owned server registration did not return the expected workspace.');
  }
  if (options.expectedWorkspaceId !== undefined) assert.ok(registered.id === options.expectedWorkspaceId, 'Historical server workspace identity was lost.');
  const mount = `/workspace/${encodeURIComponent(registered.id)}/opencode`;
  return until(async () => {
    diagnostics?.enter('runtime-workspace-registry-identity');
    const current = portableServerWorkspace(await connection.request('/workspaces', { signal: AbortSignal.timeout(Math.min(30_000, remaining())) }), workspace);
    assert.ok(current?.id === registered.id && current.path === registered.path, 'Owned server workspace registry changed during readiness.');
    // A healthy host does not prove that this workspace's separate OpenCode
    // engine accepts requests yet. Only reads are retried, in the same
    // original 120-second window; session/message mutations remain single-shot.
    diagnostics?.enter('runtime-workspace-ready');
    assert.ok(validWorkspaceSessionList(await connection.request(mount + '/session', { signal: AbortSignal.timeout(Math.min(30_000, remaining())) })), 'Owned workspace engine session list must be an array of session identities.');
    return { request: connection.request, mount, workspace: registered };
  }, Boolean, remaining(), 'installed workspace engine', diagnostics);
}
