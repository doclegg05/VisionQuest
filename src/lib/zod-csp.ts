import { z } from 'zod';

// Zod's default JIT capability probe uses new Function, which emits a CSP
// violation even when its EvalError is caught. Configure before constructing
// browser-shared task schemas; interpreted validation preserves strict CSP.
z.config({ jitless: true });

export { z };
