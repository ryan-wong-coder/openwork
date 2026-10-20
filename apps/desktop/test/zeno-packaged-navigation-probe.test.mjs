import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { assertNavigationHostedRunner, assertNavigationProbeTarget, PERSONAL_DESTINATIONS,
  navigationClickPoint, navigationSnapshot, navigationSnapshotPassed, workspaceSessionIdentitySnapshot, assertWorkspaceSessionsUnchanged } from '../scripts/zeno-packaged-navigation-probe.mjs';

const env = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_REF: 'refs/heads/personal', GITHUB_RUN_ID: '123', RUNNER_OS: 'macOS' };

test('native navigation is limited to the authenticated updater hosted lanes', () => {
  for (const arch of ['arm64', 'x64']) assertNavigationHostedRunner(env, 'darwin', arch);
  assertNavigationHostedRunner({ ...env, RUNNER_OS: 'Linux' }, 'linux', 'x64');
  assertNavigationHostedRunner({ ...env, RUNNER_OS: 'Windows' }, 'win32', 'x64');
  for (const [key, value] of [['CI', ''], ['GITHUB_ACTIONS', ''], ['RUNNER_ENVIRONMENT', 'self-hosted'],
    ['GITHUB_REF', 'refs/tags/zeno-v1.1.1'], ['GITHUB_RUN_ID', '0'], ['RUNNER_OS', 'Linux']]) {
    assert.throws(() => assertNavigationHostedRunner({ ...env, [key]: value }, 'darwin', 'arm64'));
  }
  for (const [platform, arch] of [['win32', 'arm64'], ['linux', 'arm64'], ['freebsd', 'x64'], ['darwin', 'ia32']]) {
    assert.throws(() => assertNavigationHostedRunner(env, platform, arch));
  }
});

test('owned installed renderer requires the exact file path on all native platforms', () => {
  for (const platform of ['darwin', 'linux']) {
    assertNavigationProbeTarget('file:///tmp/owned/resources/app-dist/index.html#/personal/calendar', '/tmp/owned/resources', platform);
    for (const location of ['https://example.invalid/app-dist/index.html', 'file://outside/tmp/owned/resources/app-dist/index.html',
      'file:///tmp/other/resources/app-dist/index.html', 'file:///tmp/owned/resources/app-dist/other.html',
      'file:///tmp/owned/resources/app-dist/index.html?override=1', 'file:///tmp/owned/resources/app-dist/../index.html']) {
      assert.throws(() => assertNavigationProbeTarget(location, '/tmp/owned/resources', platform));
    }
  }
  assertNavigationProbeTarget('file:///C:/runner/owned/resources/app-dist/index.html#/personal/tasks', 'C:\\runner\\owned\\resources', 'win32');
  assert.throws(() => assertNavigationProbeTarget('file:///C:/runner/other/resources/app-dist/index.html', 'C:\\runner\\owned\\resources', 'win32'));
  assert.throws(() => assertNavigationProbeTarget('file:///tmp/resources/app-dist/index.html', 'resources', 'linux'));
  assert.throws(() => assertNavigationProbeTarget('file:///tmp/private-fixture/app-dist/index.html', '/tmp/owned/resources', 'linux'), error => {
    assert.equal(error.message, 'Navigation requires the exact owned packaged main renderer.');
    assert.equal(error.message.includes('private-fixture'), false);
    return true;
  });
});

function element({ text = '', aria, visible = true, current = false, disabled = false } = {}) {
  return { textContent: text, disabled, getClientRects: () => visible ? [{}] : [], closest: () => null,
    getAttribute: name => name === 'aria-label' ? aria : name === 'aria-current' && current ? 'page' : null,
    scrollIntoView() {}, getBoundingClientRect: () => ({ left: 20, top: 40, width: 100, height: 40 }),
    contains: value => value === 'hit' };
}

function renderer(section, { hash = '#/personal/' + section, composer = false, active = true, connect = true, error = false } = {}) {
  const label = PERSONAL_DESTINATIONS.find(item => item.section === section).label;
  const destination = element({ aria: label, current: active });
  const button = element({ text: '连接账号' });
  const headings = [element({ text: connect ? '连接你的账号' : '连接 ModelHelm' }), ...(error ? [element({ text: '泽诺遇到意外错误' })] : [])];
  return { location: { hash }, window: { __OPENWORK_ELECTRON__: { zenoPersonal: {} } },
    getComputedStyle: () => ({ visibility: 'visible' }), innerWidth: 1200, innerHeight: 800,
    document: { querySelectorAll: selector => selector === '[data-sidebar="sidebar"] button' ? [element({ aria: label, visible: false }), destination]
      : selector === 'h1' ? headings : selector === 'button' ? [button] : composer ? [element()] : [],
      getElementById: () => ({ isConnected: true }), elementFromPoint: () => 'hit' } };
}

test('actual renderer snapshot accepts each stable personal gate and rejects the original chat redirect', () => {
  for (const { section, label } of PERSONAL_DESTINATIONS) {
    const snapshot = runInNewContext(navigationSnapshot(section, label), renderer(section));
    assert.equal(navigationSnapshotPassed(snapshot, section), true);
    for (const options of [{ hash: '#/workspace/fixture' }, { hash: '#/session/fixture' }, { hash: '#/personal/wrong' },
      { composer: true }, { active: false }, { connect: false }, { error: true }]) {
      const invalid = runInNewContext(navigationSnapshot(section, label), renderer(section, options));
      assert.equal(navigationSnapshotPassed(invalid, section), false);
      assert.ok(!JSON.stringify(invalid).includes('fixture'), 'Private route identifiers must not leave the renderer.');
    }
  }
});

test('click point selects the visible real button and rejects obstruction or a disabled control', () => {
  const scope = renderer('calendar');
  const point = runInNewContext(navigationClickPoint('日历'), scope);
  assert.deepEqual({ ...point }, { x: 70, y: 60 });
  scope.document.elementFromPoint = () => 'overlay';
  assert.equal(runInNewContext(navigationClickPoint('日历'), scope), null);
  assert.equal(runInNewContext(navigationClickPoint('missing'), scope), null);
  const disabled = element({ aria: '日历', disabled: true });
  scope.document.querySelectorAll = () => [disabled];
  assert.equal(runInNewContext(navigationClickPoint('日历'), scope), null);
});

test('native session-set proof detects extra conversations, removal, malformed and duplicate identities', () => {
  assert.deepEqual(workspaceSessionIdentitySnapshot([{ id: 'b' }, { id: 'a' }]), ['a', 'b']);
  const original = workspaceSessionIdentitySnapshot([{ id: 'original' }]);
  assert.notDeepEqual(workspaceSessionIdentitySnapshot([{ id: 'original' }, { id: 'unexpected' }]), original);
  assert.notDeepEqual(workspaceSessionIdentitySnapshot([]), original);
  for (const value of [{}, [null], [{ id: '' }], [{ id: 'x' }, { id: 'x' }]]) assert.throws(() => workspaceSessionIdentitySnapshot(value));
});

test('session conservation failure exposes only a fixed message, never the compared identities', () => {
  assertWorkspaceSessionsUnchanged(['private-original'], ['private-original']);
  for (const current of [[], ['private-new'], ['private-original', 'private-added']]) {
    assert.throws(() => assertWorkspaceSessionsUnchanged(current, ['private-original']), error => {
      assert.equal(error.message, 'Sidebar navigation changed the workspace session set.');
      assert.equal(JSON.stringify({ message: error.message }).includes('private-'), false);
      return true;
    });
  }
});
