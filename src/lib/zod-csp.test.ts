import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('browser task validation never probes dynamic Function under strict CSP', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    let attempts = 0;
    globalThis.Function = new Proxy(Function, { construct() { attempts++; throw new EvalError('CSP'); }, apply() { attempts++; throw new EvalError('CSP'); } });
    const mod = await import('./src/lib/dashboard/task-schemas.ts');
    const { createTaskSchema } = mod.default || mod;
    assert.equal(createTaskSchema.safeParse({title:'Synthetic CSP task'}).success, true);
    assert.equal(createTaskSchema.safeParse({title:'',studentId:'forged'}).success, false);
    assert.equal(attempts, 0, 'Zod must not probe or compile via Function');
  `], { cwd: process.cwd(), encoding: 'utf8', timeout: 15000, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test' } });
  assert.equal(result.status, 0, result.stderr);
});
