// Quick checks that need no database. Run: npm test
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-123';
process.env.ALLOWED_ORIGINS = 'https://good.example';
const app = require('../server');

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
  };
  const eq = (a, b) => { if (a !== b) throw new Error(`expected ${b}, got ${a}`); };
  const post = (path, body, headers = {}) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body)
  });

  await check('health ok', async () => { const r = await fetch(base + '/api/health'); eq(r.status, 200); eq((await r.json()).ok, true); });
  await check('contact rejects missing fields', async () => { const r = await post('/api/contact', { firstName: 'A' }); eq(r.status, 400); eq((await r.json()).success, false); });
  await check('contact rejects bad email', async () => { const r = await post('/api/contact', { firstName: 'A', lastName: 'B', email: 'nope', message: 'hi' }); eq(r.status, 400); });
  await check('contact honeypot returns success without saving', async () => { const r = await post('/api/contact', { website: 'spam' }); eq(r.status, 200); });
  await check('bad JSON returns 400', async () => { const r = await post('/api/contact', '{oops'); eq(r.status, 400); });
  await check('blocked origin gets 403', async () => { const r = await fetch(base + '/api/health', { headers: { Origin: 'https://evil.example' } }); eq(r.status, 403); });
  await check('allowed origin passes', async () => { const r = await fetch(base + '/api/health', { headers: { Origin: 'https://good.example' } }); eq(r.status, 200); eq(r.headers.get('access-control-allow-origin'), 'https://good.example'); });
  await check('admin route needs token', async () => { const r = await fetch(base + '/api/admin/stats'); eq(r.status, 401); });
  await check('admin route rejects garbage token', async () => { const r = await fetch(base + '/api/admin/stats', { headers: { Authorization: 'Bearer abc.def.ghi' } }); eq(r.status, 401); });
  await check('unknown api route is 404 json', async () => { const r = await fetch(base + '/api/nothing'); eq(r.status, 404); });

  await check('cron rejects missing key', async () => { const r = await post('/api/cron/birthdays', {}); eq(r.status, 403); });
  await check('cron rejects wrong key', async () => { const r = await post('/api/cron/birthdays', {}, { 'X-Cron-Key': 'wrong' }); eq(r.status, 403); });
  await check('client routes need login', async () => { const r = await fetch(base + '/api/admin/clients'); eq(r.status, 401); });
  await check('report needs login', async () => { const r = await fetch(base + '/api/admin/report'); eq(r.status, 401); });

  const rv = (o) => post('/api/reviews', Object.assign({ name: 'Mercy W.', service: 'Wedding', rating: 5, text: 'Lovely team, calm and professional all day.', consent: true }, o));
  await check('review: needs a name', async () => { const r = await rv({ name: '' }); eq(r.status, 400); });
  await check('review: rating must be 1-5', async () => { const r = await rv({ rating: 9 }); eq(r.status, 400); });
  await check('review: rating missing', async () => { const r = await rv({ rating: undefined }); eq(r.status, 400); });
  await check('review: too short', async () => { const r = await rv({ text: 'nice' }); eq(r.status, 400); });
  await check('review: web links rejected', async () => { const r = await rv({ text: 'Great, visit http://spam.example now please' }); eq(r.status, 400); });
  await check('review: consent required', async () => { const r = await rv({ consent: false }); eq(r.status, 400); });
  await check('review: honeypot accepted silently', async () => { const r = await rv({ website: 'bot' }); eq(r.status, 200); });
  await check('review: only accepted reviews count toward the hourly limit (4th is blocked)', async () => {
    const seen = [];
    for (let i = 0; i < 5; i++) seen.push((await rv({ website: 'bot' })).status);
    if (seen[0] !== 200 || !seen.includes(429)) throw new Error('expected 200s then a 429, got ' + seen.join(','));
  });
  await check('admin header needs login', async () => { const r = await fetch(base + '/api/admin/header'); eq(r.status, 401); });
  await check('admin header save needs login', async () => { const r = await fetch(base + '/api/admin/header', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' }); eq(r.status, 401); });
  const H = app.locals.headerHelpers;
  await check('header: cleans messages (trim, drop blanks, keep on/off, max 12)', async () => {
    const out = H.cleanMessages([{ text: '  Now booking  ', on: true }, { text: '   ' }, { text: 'Hidden one', on: false }, { text: 'No flag' }, null]);
    eq(out.length, 3); eq(out[0].text, 'Now booking'); eq(out[1].on, false); eq(out[2].on, true);
    eq(H.cleanMessages(Array.from({ length: 30 }, (_, i) => ({ text: 'm' + i }))).length, 12);
    eq(H.cleanMessages('nope').length, 0);
  });
  await check('header: only switched-on messages go to the website', async () => {
    const out = H.publicHeader({ messages: [{ text: 'A', on: true }, { text: 'B', on: false }, { text: 'C', on: true }] });
    eq(out.messages.join(','), 'A,C');
  });
  await check('header: nothing saved keeps the built-in message; all off hides it', async () => {
    eq(JSON.stringify(H.publicHeader(undefined)), '{}');
    eq(H.publicHeader({ messages: [{ text: 'A', on: false }] }).messages.length, 0);
  });
  await check('header: old single availability text still works', async () => {
    eq(H.publicHeader({ availability: 'Old text' }).messages[0], 'Old text');
    eq(H.publicHeader({ availability: '  ' }).messages.length, 0);
    eq(H.adminMessages({ availability: 'Old text' })[0].on, true);
  });
  await check('admin reviews need login', async () => { const r = await fetch(base + '/api/admin/reviews'); eq(r.status, 401); });

  server.close();
  console.log(failed ? `\n${failed} test(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
});
