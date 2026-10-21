import { join } from 'node:path';
import asar from '@electron/asar';

function markers(source, expected, label) {
  if (!source || expected.some(value => !source.includes(value))) throw new Error(`Packaged personal ${label} is missing or incomplete.`);
}

/** Presence only; the native verifier separately executes its synthetic runtime fixture. */
export function verifyPersonalPackaging({ archive }) {
  const archived = name => asar.extractFile(archive, join(...name.split('/'))).toString('utf8');
  for (const [name, expected] of [
    ['zeno-personal', ['createZenoPersonalService', 'expectedUserId', 'basic_text', 'X-Zeno-Account', 'account_changed', '执行回执仅由本机执行器产生']],
    ['zeno-personal-tools', ['createZenoPersonalToolsService', 'proposal_required', 'account_changed', 'internalRequest']],
    ['zeno-scheduler', ['createZenoScheduler', 'admission', 'await adapter.send', 'scheduler-', 'windowOpen']],
  ]) markers(archived(`electron/${name}.mjs`), expected, name);
  const main = archived('electron/main.mjs');
  markers(main, ["ipcMain.handle('zeno:personal'", 'event.sender !== mainWindow.webContents', 'event.senderFrame !== mainWindow.webContents.mainFrame', 'NATIVE_ZENO_IDENTITY', 'zenoPersonal.request(...args)', 'createZenoScheduler', "powerMonitor.on('suspend'"], 'main IPC boundary');
  markers(archived('electron/preload.mjs'), ['process.isMainFrame', 'expectedUserId', "ipcRenderer.invoke('zeno:personal'"], 'preload account boundary');
  const manifest = JSON.parse(archived('node_modules/@zeno/core/package.json'));
  for (const key of ['.', './schema', './calendar', './client', './media']) {
    const definition = manifest.exports?.[key];
    const selected = typeof definition === 'string' ? definition : definition?.node ?? definition?.import ?? definition?.default;
    if (typeof selected !== 'string' || !/^\.\/dist\/[A-Za-z0-9_.-]+\.js$/.test(selected)) throw new Error('Packaged personal core must resolve compiled JavaScript, never runtime TypeScript.');
    const source = archived('node_modules/@zeno/core/' + selected.slice(2));
    if (!source.trim() || /(?:from\s*|import\s*\()["'][^"']+\.tsx?["']/.test(source)) throw new Error('Packaged personal core contains a missing or TypeScript runtime entry.');
  }
  const fitness = JSON.parse(archived('node_modules/@zeno/fitness/package.json'));
  for (const key of ['./catalogue', './agent-catalogue']) {
    const definition = fitness.exports?.[key], selected = typeof definition === 'string' ? definition : definition?.node ?? definition?.import ?? definition?.default;
    if (typeof selected !== 'string' || !/^\.\/dist\/[A-Za-z0-9_.-]+\.js$/.test(selected)) throw new Error('Packaged personal fitness must resolve compiled JavaScript, never runtime TypeScript.');
    const source = archived('node_modules/@zeno/fitness/' + selected.slice(2));
    if (!source.trim() || /(?:from\s*|import\s*\()["'][^"']+\.tsx?["']/.test(source)) throw new Error('Packaged personal fitness contains a missing or TypeScript runtime entry.');
    markers(source, key === './catalogue' ? ['findExercise', 'fitnessExercises', '0025'] : ['findAgentExercise', 'searchAgentExercises', 'bench-press', '0025'], 'fitness catalogue');
  }
  markers(archived('licenses/openGym-AGPL-3.0.txt'), ['GNU AFFERO GENERAL PUBLIC LICENSE', 'Version 3'], 'AGPL license');
  markers(archived('licenses/openGym-NOTICE.md'), ['openGym', 'AGPL', 'MIT License'], 'upstream notices');
  markers(archived('licenses/OpenWork-MIT.txt'), ['MIT License', 'Permission is hereby granted'], 'OpenWork notice');
  markers(archived('licenses/Zeno-NOTICE.md'), ['openGym', 'GNU AGPL'], 'combined-work notices');
  const provenance = JSON.parse(archived('licenses/openGym-source-manifest.json'));
  if (!/^[a-f0-9]{40}$/.test(provenance.commit) || !Array.isArray(provenance.files) || !provenance.files.length || provenance.files.some(file => !/^[a-f0-9]{64}$/.test(file.localSha256))) throw new Error('Packaged personal upstream source manifest is invalid.');
  return { scope: 'packaged-presence-and-wiring', modules: true, compiledCore: true, compiledFitnessCatalogue: true, mainIpcBoundary: true, accountBinding: true, licensesAndNotices: true };
}

/** Appended to the existing packaged Electron Node smoke, after the server shuts down.
 * All account data, transport, storage and execution are synthetic. No GUI or model.
 */
export const personalRuntimeSmokeSource = String.raw`
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const root = process.env.ZENO_SMOKE_PERSONAL_ROOT;
  assert.ok(root);
  const coreEntry = require.resolve('@zeno/core');
  assert.ok(coreEntry.split(path.sep).join('/').endsWith('/node_modules/@zeno/core/dist/index.js'));
  const core = await import(pathToFileURL(coreEntry));
  const fitnessEntry = require.resolve('@zeno/fitness/agent-catalogue');
  assert.ok(fitnessEntry.split(path.sep).join('/').endsWith('/node_modules/@zeno/fitness/dist/agent-catalogue.js'));
  const fitness = await import(pathToFileURL(fitnessEntry));
  assert.equal(fitness.findAgentExercise('0025').exerciseId,'0025');
  assert.equal(fitness.findAgentExercise('0025').demo.video,'/app/zeno/fitness/bench-press.mp4');
  const {expandSchedule} = await import(pathToFileURL(archive+'/node_modules/@zeno/core/dist/calendar.js'));
  const {createZenoPersonalService} = await import(pathToFileURL(archive+'/electron/zeno-personal.mjs'));
  const {createZenoPersonalToolsService} = await import(pathToFileURL(archive+'/electron/zeno-personal-tools.mjs'));
  const {createZenoScheduler} = await import(pathToFileURL(archive+'/electron/zeno-scheduler.mjs'));
  const at=1800000000000, origin='https://fixture.zeno.invalid', userId='synthetic-user', deviceId='synthetic-device';
  let windowOpen=true, calls=0, cursor=0, creates=0, sends=0, stops=0, idle=false;
  const records=[], operations=new Map();
  const json=(value,status=200)=>Response.json(value,{status});
  const fakeFetch=async(url,init)=>{
    calls++; const target=new URL(url); assert.equal(target.origin,origin); assert.equal(init.redirect,'error');
    const route=target.pathname.slice('/api/zeno/v1'.length), data=init.body?JSON.parse(init.body):undefined;
    assert.equal(init.headers['X-Zeno-Account'],userId);
    if(route==='/me') return json({user:{id:userId,email:'fixture@example.invalid',name:'Fixture',role:'user'},deviceId});
    if(route==='/features') return json({zenoAccounts:true,personalCalendar:true,fitnessTracking:true,localScheduledTasks:true});
    if(route==='/devices'&&init.method==='GET') return json({devices:[]});
    if(route==='/sync') {const values=records.filter(value=>value.cursor>Number(target.searchParams.get('cursor')));return json({records:values,cursor:values.at(-1)?.cursor??cursor,hasMore:false});}
    if(route==='/devices/heartbeat') {core.deviceInventorySchema.parse(data.inventory);return json({deviceId,lastSeenAt:at});}
    if(route==='/devices/'+deviceId&&init.method==='DELETE') return json({revoked:true});
    if(route.startsWith('/records/')&&init.method==='PUT') {
      const mutation=core.recordMutationSchema.parse(data);
      if(operations.has(mutation.operationId)) return json({...operations.get(mutation.operationId),replayed:true});
      const previous=[...records].reverse().find(value=>value.id===mutation.id&&value.kind===mutation.kind)??null;
      if((previous?.version??0)!==mutation.baseVersion) return json({code:'conflict',current:previous,submitted:mutation},409);
      const record=core.personalRecordSchema.parse({id:mutation.id,kind:mutation.kind,data:mutation.data,userId,version:(previous?.version??0)+1,cursor:++cursor,createdAt:previous?.createdAt??at,updatedAt:at,deletedAt:mutation.deleted?at:null});
      records.push(record);const result={record,previous,replayed:false};operations.set(mutation.operationId,result);return json(result);
    }
    throw new Error('Unexpected packaged fixture route');
  };
  // Deliberately fake safeStorage, not an operating-system keychain validation.
  const safeStorage={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'synthetic-only',encryptString:value=>Buffer.from(value),decryptString:value=>value.toString('utf8')};
  await fs.mkdir(root,{recursive:true,mode:0o700});
  await fs.writeFile(path.join(root,'device.bin'),safeStorage.encryptString(JSON.stringify({origin,userId,deviceId,accessToken:'synthetic-device-credential',expiresAt:at+86400000})),{mode:0o600});
  const service=createZenoPersonalService({root,origin,safeStorage,now:()=>at,isWindowOpen:()=>windowOpen,name:'Synthetic device',platform:process.platform,fetchImpl:fakeFetch,openExternal:()=>{throw new Error('No external browser in packaged smoke');}});
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('Unexpected network in packaged personal fixture');};
  let scheduler=null;
  try {
    const identity=await service.identity(); assert.equal(identity.userId,userId);assert.equal((await service.getSession()).user.id,userId);
    const before=calls;
    assert.equal((await service.internalRequest('GET','/me',undefined,{...identity,userId:'other-synthetic-user'})).status,409);
    await assert.rejects(service.request('POST','/devices/token',{}));
    const forbidden=core.createMutation('run',core.runDataSchema.parse({deviceId,scheduledAt:at,status:'succeeded'}),{id:'forged-run',operationId:'forged-operation'});
    await assert.rejects(service.request('PUT','/records/run/forged-run',forbidden,userId));
    await assert.rejects(service.request('POST','/records/batch',{operationId:'forged-batch',mutations:[forbidden]},userId));
    assert.equal(calls,before);
    const tools=createZenoPersonalToolsService({service,isWindowOpen:()=>windowOpen,executionModeForSession:id=>id==='synthetic-scheduled'?'scheduled':'interactive'});
    const catalogue=await tools.execute({sessionId:'synthetic-interactive',input:{action:'catalogue',query:'杠铃卧推',equipment:['杠铃']}});
    assert.equal(catalogue.ok,true);assert.ok(catalogue.exercises.some(value=>value.exerciseId==='0025'));
    assert.equal((await tools.execute({sessionId:'synthetic-scheduled',input:{action:'write',kind:'membership',operationId:'blocked-write',data:{name:'Fixture',code:'1'}}})).code,'proposal_required');
    const written=await tools.execute({sessionId:'synthetic-interactive',input:{action:'write',kind:'membership',operationId:'synthetic-write',data:{name:'Fixture',code:'1'}}});
    assert.equal(written.ok,true); assert.equal(written.record.userId,userId); assert.ok(written.undo.id);
    assert.equal((await tools.execute({sessionId:'synthetic-interactive',input:{action:'read',kind:'membership'}})).records.length,1);
    const task=core.createMutation('task',core.taskDataSchema.parse({title:'Synthetic schedule',instructions:'Synthetic local-only instruction',deviceId,workspaceId:'fixture-workspace',model:{providerId:'fixture-provider',modelId:'fixture-model'},schedule:{startAt:at,timeZone:'UTC'}}),{id:'synthetic-task',operationId:'synthetic-task-op'});
    assert.deepEqual(expandSchedule(task.data.schedule,at,at+1),[at]);
    assert.equal((await service.internalRequest('PUT','/records/task/'+task.id,task,identity)).status,200);
    const adapter={
      async create(command){creates++;assert.equal(command.prompt,null);return {sessionId:'synthetic-native-session',workspaceId:command.workspaceId};},
      async send(receipt,input){
        sends++;assert.equal(receipt.sessionId,'synthetic-native-session');assert.match(input.messageId,/^msg_/);
        const directory=service.accountDirectory(userId), names=await fs.readdir(directory), name=names.find(value=>value.startsWith('scheduler-'));
        const durable=JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));assert.equal(durable.entries[0].phase,'sending');assert.equal(durable.entries[0].receipt.sessionId,receipt.sessionId);
        return {messageId:input.messageId,alreadyPresent:false};
      },
      async observe(){return {status:idle?'idle':'running',messageCount:1,observedAt:at};},
      async stop(receipt,guard){stops++;assert.match(guard.messageId,/^msg_/);idle=true;return {stopped:true,reason:null};},
    };
    const options={service,isWindowOpen:()=>windowOpen,now:()=>at,adapter,getInventory:async()=>({workspaces:[{id:'fixture-workspace',name:'Fixture'}],models:[{providerId:'fixture-provider',modelId:'fixture-model'}]}),getLocalRuntime:async()=>{throw new Error('No real AI runtime in packaged fixture');}};
    scheduler=createZenoScheduler(options);await scheduler.tick();assert.equal(creates,1);assert.equal(sends,1);assert.equal(scheduler.executionModeForSession('synthetic-native-session'),'scheduled');
    windowOpen=false;await scheduler.tick();assert.equal(stops,1);assert.equal([...records].reverse().find(value=>value.kind==='run').data.status,'cancelled');
    await scheduler.dispose();scheduler=createZenoScheduler(options);windowOpen=true;await scheduler.tick();assert.equal(creates,1);assert.equal(sends,1);
    assert.equal(scheduler.executionModeForSession('synthetic-native-session'),'scheduled');
    console.log(JSON.stringify({packagedPersonal:true,compiledCore:true,compiledFitnessCatalogue:true,nativeRequestGuard:true,syntheticTools:true,syntheticScheduler:true,durableReceipt:true,restartNoReplay:true,safeStorageScope:'synthetic-only-not-os-validation'}));
  } finally {await scheduler?.dispose();service.dispose();globalThis.fetch=previousFetch;}
}
`;
