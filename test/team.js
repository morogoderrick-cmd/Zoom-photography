// Checks team photos, groups, the public list and the picture route. No real database is used.
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
const jwt = require('jsonwebtoken'), mongoose = require('mongoose'), http = require('node:http');
const app = require('../server');
const TM = mongoose.models.TeamMember;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const id1 = new mongoose.Types.ObjectId(), id2 = new mongoose.Types.ObjectId();
const rows = [
  { _id: id1, name: 'Amina', role: 'Photographer', group: 'photography', photo: PNG, updatedAt: new Date(1700000000000), isPublic: true },
  { _id: id2, name: 'Brian', role: 'Video editor', group: 'videography', photo: '', updatedAt: new Date(1700000001000), isPublic: true }
];
TM.find = () => { const q = { sort() { return q; }, select() { return q; }, lean: async () => rows, then(r) { return r(rows); } }; return q; };
TM.findOne = (f) => ({ select() { return { lean: async () => rows.find(r => String(r._id) === String(f._id)) || null }; } });
let created = null, updated = null;
TM.create = async d => { created = d; return d; };
TM.findByIdAndUpdate = async (id, d) => { updated = d; return { _id: id, ...d }; };
mongoose.models.Admin.findById = async () => ({ _id: 'a1', passwordChangedAt: null });
const token = jwt.sign({ sub: 'a1' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const call = (port, method, path, body, auth) => new Promise(res => {
  const data = body ? JSON.stringify(body) : '';
  const r = http.request({ host: '127.0.0.1', port, path, method, headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, auth ? { authorization: 'Bearer ' + token } : {}) }, resp => {
    const chunks = []; resp.on('data', c => chunks.push(c)); resp.on('end', () => { const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString()); } catch (e) { /* image */ } res({ code: resp.statusCode, json, buf, headers: resp.headers }); });
  });
  r.write(data); r.end();
});
const server = app.listen(0, async () => {
  const port = server.address().port, out = [];
  const pub = await call(port, 'GET', '/api/team');
  out.push(['public list has name, role, group', pub.json[0].name === 'Amina' && pub.json[0].group === 'photography' && pub.json[1].group === 'videography']);
  out.push(['photo link only when there is a photo', /^\/api\/team\/[0-9a-f]{24}\/photo\?v=\d+$/.test(pub.json[0].photoUrl) && pub.json[1].photoUrl === '']);
  out.push(['public list leaks no phone or email', !('phone' in pub.json[0]) && !('email' in pub.json[0]) && !('photo' in pub.json[0])]);
  const ph = await call(port, 'GET', pub.json[0].photoUrl);
  out.push(['picture route returns the image bytes', ph.code === 200 && ph.headers['content-type'] === 'image/png' && ph.buf.length > 20]);
  out.push(['picture can be shown on another site', ph.headers['cross-origin-resource-policy'] === 'cross-origin']);
  const none = await call(port, 'GET', '/api/team/' + id2 + '/photo');
  out.push(['no picture gives 404', none.code === 404]);
  const add = await call(port, 'POST', '/api/admin/team', { name: 'Zawadi', role: 'Assistant', group: 'videography', isPublic: true, photo: PNG }, true);
  out.push(['admin can add a member with a photo and group', add.code === 201 && created.group === 'videography' && created.photo === PNG && created.isPublic === true]);
  const edit = await call(port, 'PUT', '/api/admin/team/' + id1, { name: 'Amina', role: 'Lead', group: 'photography' }, true);
  out.push(['editing without a photo keeps the old one', edit.code === 200 && !('photo' in updated)]);
  const rm = await call(port, 'PUT', '/api/admin/team/' + id1, { name: 'Amina', photo: '' }, true);
  out.push(['sending an empty photo removes it', rm.code === 200 && updated.photo === '']);
  const bad1 = await call(port, 'POST', '/api/admin/team', { name: 'X', photo: 'data:text/html;base64,PGI+' }, true);
  out.push(['rejects a non-image', bad1.code === 400]);
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(260000);
  const bad2 = await call(port, 'POST', '/api/admin/team', { name: 'X', photo: big }, true);
  out.push(['rejects a picture that is too big', bad2.code === 400]);
  const huge = await call(port, 'POST', '/api/admin/team', { name: 'X', photo: 'data:image/jpeg;base64,' + 'A'.repeat(500000) }, true);
  out.push(['rejects a huge upload', huge.code === 413 || huge.code === 400 || huge.code === 500]);
  const noauth = await call(port, 'POST', '/api/admin/team', { name: 'X' }, false);
  out.push(['adding needs login', noauth.code === 401]);
  out.forEach(r => console.log((r[1] ? 'PASS ' : 'FAIL ') + r[0]));
  server.close(); process.exit(out.every(r => r[1]) ? 0 : 1);
});
