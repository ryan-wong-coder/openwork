import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';

test('every compiled core entry imports and validates without dynamic code generation', () => {
  const root = new URL('../dist/', import.meta.url);
  for (const name of ['index', 'schema', 'calendar', 'client', 'media']) {
    const code = `import assert from 'node:assert/strict';
      let attempts=0;
      globalThis.Function=new Proxy(Function,{
        apply(){attempts++;throw Error('Dynamic code forbidden');},
        construct(){attempts++;throw Error('Dynamic code forbidden');}
      });
      const entry=await import(${JSON.stringify(new URL(name + '.js', root).href)});
      if(entry.eventDataSchema) assert.equal(entry.eventDataSchema.safeParse({title:'CSP',startAt:1,endAt:2,timeZone:'UTC'}).success,true);
      if(entry.validatePersonalMedia) entry.validatePersonalMedia({type:'image/png',size:1});
      assert.equal(attempts,0);
      console.log('validated-without-eval');`;
    expect(execFileSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim()).toBe('validated-without-eval');
  }
});
