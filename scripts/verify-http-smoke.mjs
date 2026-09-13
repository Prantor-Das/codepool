import { writeFile } from 'node:fs/promises';
const results = [];
for (const [path, method, expected] of [['/', 'GET', 200], ['/login', 'GET', 200], ['/dashboard/reviews', 'GET', 307], ['/api/github/runtime-feedback', 'POST', 401], ['/api/webhook/github', 'POST', 401]]) {
  const response = await fetch((process.env.CODEPOOL_SMOKE_BASE_URL ?? 'http://localhost:3100')+path, { method, redirect: 'manual', ...(method === 'POST' ? { headers: {'Content-Type':'application/json'}, body:'{}' } : {}) });
  const pass = response.status === expected;
  results.push(`${pass ? 'PASS' : 'FAIL'}: ${method} ${path} returned ${response.status} (expected ${expected})`);
  if (!pass) process.exitCode = 1;
}
const oversized = await fetch((process.env.CODEPOOL_SMOKE_BASE_URL ?? 'http://localhost:3100') + '/api/webhook/github', { method: 'POST', body: 'x'.repeat(2 * 1024 * 1024 + 1) });
results.push(`${oversized.status === 413 ? 'PASS' : 'FAIL'}: oversized webhook body returned ${oversized.status} (expected 413)`);
if (oversized.status !== 413) process.exitCode = 1;
await writeFile('audit/smoke.log' ,results.join('\n')+'\n');
console.log(results.join('\n'));
