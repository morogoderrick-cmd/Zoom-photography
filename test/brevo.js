// Checks the Brevo adapter with a pretend network (no real email is sent).
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.BREVO_API_KEY = 'key-abc';
process.env.MAIL_FROM = 'ZOOM Photography <owner@example.com>';
let seen;
global.fetch = async (url, o) => { seen = { url, o }; return { ok: true, json: async () => ({ messageId: 'x' }) }; };
const app = require('../server');
const m = app.locals.mailer;
(async () => {
  if (!m) throw new Error('mailer not created');
  await m.sendMail({ from: process.env.MAIL_FROM, to: 'client@example.com', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>', replyTo: 'r@example.com' });
  const b = JSON.parse(seen.o.body);
  const ok = seen.url === 'https://api.brevo.com/v3/smtp/email' && seen.o.headers['api-key'] === 'key-abc'
    && b.sender.email === 'owner@example.com' && b.sender.name === 'ZOOM Photography' && b.to[0].email === 'client@example.com'
    && b.textContent === 'Hello' && b.htmlContent === '<p>Hello</p>' && b.replyTo.email === 'r@example.com';
  console.log(ok ? 'PASS brevo request shape' : 'FAIL brevo request shape ' + JSON.stringify(b));
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Key not found' }) });
  let err = ''; try { await m.sendMail({ to: 'a@b.co', subject: 's', text: 't' }); } catch (e) { err = e.message; }
  console.log(/401: Key not found/.test(err) ? 'PASS brevo error message' : 'FAIL brevo error ' + err);
  process.exit(ok && /401/.test(err) ? 0 : 1);
})();
