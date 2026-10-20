import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PERSONAL_DESTINATIONS = Object.freeze([
  { section: 'calendar', label: '日历' },
  { section: 'fitness', label: '健身' },
  { section: 'tasks', label: '任务' },
  { section: 'account', label: '账号' },
]);
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));

export function assertNavigationHostedRunner(env, platform, arch) {
  assert.ok(platform === 'darwin' && ['x64', 'arm64'].includes(arch)
    || ['win32', 'linux'].includes(platform) && arch === 'x64', 'Unsupported hosted navigation lane.');
  assert.equal(env.CI, 'true', 'Packaged navigation is CI-only.');
  assert.equal(env.GITHUB_ACTIONS, 'true', 'GitHub Actions is required.');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted', 'Refusing developer and self-hosted machines.');
  assert.equal(env.GITHUB_REF, 'refs/heads/personal', 'The validation must run from personal.');
  assert.match(env.GITHUB_RUN_ID ?? '', /^[1-9]\d*$/);
  assert.equal(env.RUNNER_OS, { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[platform]);
}

export function assertNavigationProbeTarget(location, resources, platform = process.platform) {
  try {
    const url = new URL(location);
    const paths = platform === 'win32' ? win32 : posix;
    assert.ok(paths.isAbsolute(resources));
    assert.ok(url.protocol === 'file:' && !url.host && !url.username && !url.password && !url.search);
    assert.ok(paths.resolve(fileURLToPath(url, { windows: platform === 'win32' })) === paths.join(resources, 'app-dist', 'index.html'));
  } catch {
    // Assertion diffs and URL conversion errors must not publish runner paths.
    throw new Error('Navigation requires the exact owned packaged main renderer.');
  }
}

// No workspace/session identifiers or body text leave the ephemeral renderer.
export function navigationSnapshot(section, label) {
  return `(()=>{
    const visible=element=>Boolean(element&&element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden'&&!element.closest('[hidden],[inert],[aria-hidden="true"]'));
    const buttons=[...document.querySelectorAll('[data-sidebar="sidebar"] button')].filter(visible);
    const selected=buttons.find(button=>button.getAttribute('aria-label')===${JSON.stringify(label)});
    const heads=[...document.querySelectorAll('h1')].filter(visible);
    const connect=heads.some(heading=>heading.textContent.trim()==='连接你的账号')
      &&[...document.querySelectorAll('button')].some(button=>visible(button)&&button.textContent.trim()==='连接账号');
    const hash=location.hash,expected=${JSON.stringify('#/personal/' + section)};
    const route=hash===expected?${JSON.stringify('/personal/' + section)}:hash.startsWith('#/personal/')?'other-personal':hash.includes('/session')||hash.includes('/workspace')?'workspace-or-chat':'other';
    return {route,active:selected?.getAttribute('aria-current')==='page',connectGate:connect,
      chatVisible:[...document.querySelectorAll('[data-pending-conversation],[data-empty-composer-dock],[data-zeno-composer],[data-composer-panel]')].some(visible),
      errorVisible:heads.some(heading=>/遇到意外错误|hit an unexpected error/.test(heading.textContent)),
      intact:Boolean(window.__OPENWORK_ELECTRON__?.zenoPersonal&&document.getElementById('root')?.isConnected)};
  })()`;
}

export function navigationSnapshotPassed(value, section) {
  return value?.route === '/personal/' + section && value.active === true && value.connectGate === true
    && value.chatVisible === false && value.errorVisible === false && value.intact === true;
}

export function workspaceSessionIdentitySnapshot(value) {
  assert.ok(Array.isArray(value), 'The native workspace session list was not an array.');
  const ids = value.map(session => {
    assert.ok(session && typeof session.id === 'string' && session.id.length > 0, 'The native session identity is missing.');
    return session.id;
  });
  assert.equal(new Set(ids).size, ids.length, 'Duplicate native session identities.');
  return ids.sort();
}

export function assertWorkspaceSessionsUnchanged(current, previous) {
  assert.ok(current.length === previous.length && current.every((id, index) => id === previous[index]),
    'Sidebar navigation changed the workspace session set.');
}

export function navigationClickPoint(label) {
  return `(()=>{
    const visible=element=>Boolean(element&&element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden'&&!element.closest('[hidden],[inert],[aria-hidden="true"]'));
    const button=[...document.querySelectorAll('[data-sidebar="sidebar"] button')].find(element=>visible(element)&&element.getAttribute('aria-label')===${JSON.stringify(label)});
    if(!button||button.disabled)return null;
    button.scrollIntoView({block:'nearest',inline:'nearest'});
    const rect=button.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
    return Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&button.contains(document.elementFromPoint(x,y))?{x,y}:null;
  })()`;
}

/** Runs only after the updater authenticated the installed process/profile. */
export async function verifyPackagedNavigation({ client, resources }) {
  assertNavigationHostedRunner(process.env, process.platform, process.arch);
  assertNavigationProbeTarget(await client.evaluate('location.href'), resources);
  const key = '__zenoNavigationProbe' + randomBytes(16).toString('hex');
  const report = { passed: false, scope: 'Actual installed AppSidebar clicks in the original upgraded, unpaired profile; account connection gate only, not authenticated personal forms',
    input: 'CDP mouse press/release on visible sidebar buttons; no direct route mutation', noAccountPairing: true, noModelCalls: true, destinations: [] };
  let section = 'initialization';
  let initialized = false;
  try {
    await client.send('Page.bringToFront');
    await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    initialized = await client.evaluate(`(()=>{const bridge=window.__OPENWORK_ELECTRON__,root=document.getElementById('root');if(!bridge?.zenoPersonal||!root?.isConnected)return false;window[${JSON.stringify(key)}]={bridge,root,marker:localStorage.getItem('zeno.update.smoke')};return true})()`);
    assert.equal(initialized, true);
    for (const destination of PERSONAL_DESTINATIONS) {
      section = destination.section;
      const point = await client.evaluate(navigationClickPoint(destination.label));
      assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.y), 'Sidebar destination was not clickable.');
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      const deadline = Date.now() + 30_000;
      let stableSince = null;
      let snapshot;
      while (Date.now() < deadline) {
        assertNavigationProbeTarget(await client.evaluate('location.href'), resources);
        snapshot = await client.evaluate(navigationSnapshot(section, destination.label));
        if (navigationSnapshotPassed(snapshot, section)) {
          stableSince ??= Date.now();
          if (Date.now() - stableSince >= 1_200) break;
        } else stableSince = null;
        await delay(100);
      }
      const passed = stableSince !== null && Date.now() - stableSince >= 1_200;
      report.destinations.push({ section, ...snapshot, stableForMs: passed ? 1_200 : 0, passed });
      assert.ok(passed, 'The actual sidebar route did not retain its account gate.');
    }
    report.passed = true;
    await client.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
    return { report, screenshot: Buffer.from(screenshot.data, 'base64') };
  } catch {
    report.passed = false;
    report.failedSection = section;
    const failure = new Error('Installed personal sidebar navigation failed: ' + section);
    failure.navigationReport = report;
    throw failure;
  } finally {
    if (initialized) {
      let intact = false;
      try {
        intact = await client.evaluate(`(()=>{const state=window[${JSON.stringify(key)}];if(!state)return false;delete window[${JSON.stringify(key)}];return window.__OPENWORK_ELECTRON__===state.bridge&&document.getElementById('root')===state.root&&state.root.isConnected&&localStorage.getItem('zeno.update.smoke')===state.marker})()`);
      } catch { /* A lost renderer is a failed probe; never expose its raw error. */ }
      report.hostBridgeRootAndProfileMarkerRetained = intact === true;
      if (!intact) {
        report.passed = false;
        report.failedSection ??= 'host-state';
        const failure = new Error('Installed personal sidebar navigation changed host state.');
        failure.navigationReport = report;
        throw failure;
      }
    }
  }
}
