// Checks the admin "who sends the email" info route. No real database is used.
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.BREVO_API_KEY = 'key-abc';
process.env.MAIL_FROM = 'ZOOM Photography <owner@example.com>';
process.env.NOTIFY_EMAIL = 'notify@example.com';
const jwt = require('jsonwebtoken'), mongoose = require('mongoose'), http = require('node:http');
const app = require('../server');
mongoose.models.Admin.findById = async () => ({ _id: 'a1', passwordChangedAt: null });
const token = jwt.sign({ sub: 'a1' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const get = (port, auth) => new Promise(res => http.get({ host: '127.0.0.1', port, path: '/api/admin/email-info', headers: auth ? { authorization: 'Bearer ' + token } : {} }, r => { let t = ''; r.on('data', c => t += c); r.on('end', () => res({ code: r.statusCode, json: JSON.parse(t) })); }));
const server = app.listen(0, async () => {
  const p = server.address().port, out = [];
  const a = await get(p, true);
  out.push(['shows sender, reply address and that email is on', a.code === 200 && a.json.enabled === true && a.json.from.includes('owner@example.com') && a.json.replyTo === 'notify@example.com']);
  const n = await get(p, false); out.push(['needs login', n.code === 401]);
  out.forEach(r => console.log((r[1] ? 'PASS ' : 'FAIL ') + r[0]));
  server.close(); process.exit(out.every(r => r[1]) ? 0 : 1);
});
