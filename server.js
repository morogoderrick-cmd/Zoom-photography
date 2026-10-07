'use strict';
/**
 * ZOOM Photography & Videography - backend API
 * Public:  POST /api/contact, GET /api/galleries, GET /api/team, GET /api/health
 * Admin:   POST /api/admin/login, then Bearer-token routes under /api/admin/*
 */
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const env = process.env;
const PORT = env.PORT || 3000;
const JWT_SECRET = env.JWT_SECRET || '';
if (JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters long.');
}
const ALLOWED = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);

/* ------------------------------ helpers ------------------------------ */
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const line = (v, max = 200) => str(v, max).replace(/[\r\n]+/g, ' ');
const num = v => Math.max(0, Number(v) || 0);
const isId = id => mongoose.isValidObjectId(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const eat = () => new Date(Date.now() + 3 * 3600e3); // Kenya time (UTC+3)
const eatMD = () => eat().toISOString().slice(5, 10);
const eatYear = () => eat().getUTCFullYear();
const URL_RE = /^https?:\/\/\S+\.\S+$/i;

/* ------------------------------ models ------------------------------- */
const T = { timestamps: true };
const oid = mongoose.Schema.Types.ObjectId;

const Admin = mongoose.model('Admin', new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  passwordChangedAt: Date
}, T));

const ENQ_STATUS = ['new', 'contacted', 'quoted', 'booked', 'closed'];
const Enquiry = mongoose.model('Enquiry', new mongoose.Schema({
  firstName: String, lastName: String, email: String, phone: String,
  service: String, message: String,
  status: { type: String, enum: ENQ_STATUS, default: 'new' },
  notes: { type: String, default: '' },
  ip: String
}, T));

const Gallery = mongoose.model('Gallery', new mongoose.Schema({
  name: { type: String, required: true }, link: { type: String, required: true },
  note: { type: String, default: '' }, order: { type: Number, default: 0 }
}, T));

const TeamMember = mongoose.model('TeamMember', new mongoose.Schema({
  name: { type: String, required: true }, role: String, phone: String,
  whatsapp: String, email: String, note: String,
  isPublic: { type: Boolean, default: false }
}, T));

const Setting = mongoose.model('Setting', new mongoose.Schema({
  key: { type: String, unique: true }, value: mongoose.Schema.Types.Mixed
}));
const PRICE_KEYS = ['wedding-photography', 'wedding-films', 'landscape', 'portrait', 'brand', 'travel', 'drone', 'workshops', 'classic', 'signature', 'royal'];

const DELIVERY = ['not started', 'shot', 'editing', 'gallery sent', 'album printed', 'delivered'];
const BOOK_STATUS = ['pending', 'confirmed', 'completed', 'cancelled'];
const bookingSchema = new mongoose.Schema({
  clientName: { type: String, required: true }, clientPhone: String, clientEmail: String,
  service: String, eventDate: Date, location: String,
  price: { type: Number, default: 0, min: 0 }, deposit: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: BOOK_STATUS, default: 'pending' },
  team: [{ type: oid, ref: 'TeamMember' }],
  payments: [{
    amount: { type: Number, min: 0 }, method: String, ref: String, note: String,
    date: { type: Date, default: Date.now }
  }],
  delivery: { type: String, enum: ['not started', 'shot', 'editing', 'gallery sent', 'album printed', 'delivered'], default: 'not started' },
  checklist: String,
  notes: String,
  enquiry: { type: oid, ref: 'Enquiry' }
}, T);
bookingSchema.virtual('paid').get(function () { return (this.deposit || 0) + (this.payments || []).reduce((s, p) => s + p.amount, 0); });
bookingSchema.virtual('balance').get(function () { return Math.max(0, this.price - this.paid); });
bookingSchema.set('toJSON', { virtuals: true });
const Booking = mongoose.model('Booking', bookingSchema);

const Client = mongoose.model('Client', new mongoose.Schema({
  name: { type: String, required: true }, email: String, phone: String,
  birthday: { type: String, default: '' },          // "MM-DD"
  marketingOk: { type: Boolean, default: false },   // client agreed to receive emails
  lastBirthdayYear: Number, note: String
}, T));

const REVIEW_STATUS = ['pending', 'approved', 'hidden'];
const Review = mongoose.model('Review', new mongoose.Schema({
  name: { type: String, required: true }, service: String,
  rating: { type: Number, min: 1, max: 5, required: true }, text: { type: String, required: true },
  status: { type: String, enum: REVIEW_STATUS, default: 'pending' }, ip: String
}, T));

const EXPENSE_CATS = ['Transport', 'Gear / equipment', 'Software', 'Marketing', 'Other'];
const Expense = mongoose.model('Expense', new mongoose.Schema({
  name: { type: String, required: true }, category: { type: String, enum: EXPENSE_CATS, default: 'Other' },
  amount: { type: Number, min: 0, default: 0 }, date: { type: Date, default: Date.now }
}, T));

/* ------------------------------- email ------------------------------- */
// Render's free plan blocks the SMTP ports (25, 465, 587), so Gmail/SMTP cannot connect from there.
// Recommended: Brevo's web API (HTTPS, free plan). Set BREVO_API_KEY and MAIL_FROM (an address verified in Brevo).
// SMTP still works on a paid Render plan or on your own computer.
const parseFrom = f => {
  const m = String(f || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: String(f || '').trim() };
};
const BREVO_FROM = env.MAIL_FROM || env.NOTIFY_EMAIL || '';
const brevoMailer = env.BREVO_API_KEY && BREVO_FROM ? {
  async sendMail(o) {
    const sender = parseFrom(o.from || BREVO_FROM);
    if (!sender.name) sender.name = 'ZOOM Photography & Videography';
    const body = { sender, to: [{ email: String(o.to).trim() }], subject: o.subject };
    if (o.text) body.textContent = o.text;
    if (o.html) body.htmlContent = o.html;
    if (o.replyTo) body.replyTo = { email: o.replyTo };
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      let m = '';
      try { m = (await r.json()).message || ''; } catch (e) { /* ignore */ }
      throw new Error(`Email service refused the message (${r.status}${m ? ': ' + m : ''}).`);
    }
    return r.json().catch(() => ({}));
  }
} : null;
const smtpMailer = env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS
  ? nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 465),
    secure: Number(env.SMTP_PORT || 465) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
  })
  : null;
const mailer = brevoMailer || smtpMailer;

async function notifyOwner(e) {
  if (!mailer || !env.NOTIFY_EMAIL) return;
  const name = `${e.firstName} ${e.lastName}`;
  await mailer.sendMail({
    from: env.MAIL_FROM || env.SMTP_USER,
    to: env.NOTIFY_EMAIL,
    replyTo: e.email,
    subject: `New enquiry: ${name} (${e.service || 'General'})`,
    text: `Name: ${name}\nEmail: ${e.email}\nPhone: ${e.phone || '-'}\nService: ${e.service || '-'}\n\n${e.message}`,
    html: `<h2>New enquiry</h2><p><b>Name:</b> ${esc(name)}<br><b>Email:</b> ${esc(e.email)}<br>` +
      `<b>Phone:</b> ${esc(e.phone || '-')}<br><b>Service:</b> ${esc(e.service || '-')}</p>` +
      `<p style="white-space:pre-wrap">${esc(e.message)}</p>`
  });
}

/* -------------------------------- app -------------------------------- */
const app = express();
app.locals.mailer = mailer;
app.set('trust proxy', 1); // Render sits behind a proxy
app.use(helmet());
app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '20kb' }));

const limiter = (windowMs, max, message, skipFailed) => rateLimit({
  windowMs, max, standardHeaders: 'draft-7', legacyHeaders: false, skipFailedRequests: !!skipFailed,
  message: { success: false, message }
});
app.use('/api', limiter(15 * 60 * 1000, 300, 'Too many requests. Please slow down.'));

app.get('/', (req, res) => res.json({ name: 'ZOOM Photography API', status: 'ok' }));
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* ----------------------------- public API ---------------------------- */
app.post('/api/contact', limiter(60 * 60 * 1000, 5, '❌ Too many messages. Please try again later or WhatsApp us.'), wrap(async (req, res) => {
  const b = req.body || {};
  if (str(b.website)) return res.json({ success: true, message: '✅ Thank you!' }); // honeypot for bots
  const d = {
    firstName: line(b.firstName, 60), lastName: line(b.lastName, 60),
    email: line(b.email, 120).toLowerCase(), phone: line(b.phone, 30),
    service: line(b.service, 120), message: str(b.message, 4000)
  };
  if (!d.firstName || !d.lastName || !d.message) return bad(res, '❌ Please fill in your name and message.');
  if (!EMAIL_RE.test(d.email)) return bad(res, '❌ Please enter a valid email address.');
  const doc = await Enquiry.create({ ...d, ip: req.ip });
  notifyOwner(doc).catch(err => console.error('Email failed:', err.message)); // never block the visitor
  res.json({ success: true, message: '✅ Thank you! We received your message and will reply within 24 hours.' });
}));

app.get('/api/galleries', wrap(async (req, res) => {
  const list = await Gallery.find().sort({ order: 1, createdAt: 1 }).select('name link note -_id').lean();
  res.set('Cache-Control', 'public, max-age=60').json(list);
}));

app.get('/api/team', wrap(async (req, res) => {
  const list = await TeamMember.find({ isPublic: true }).select('name role -_id').lean();
  res.set('Cache-Control', 'public, max-age=300').json(list);
}));

app.get('/api/prices', wrap(async (req, res) => {
  const s = await Setting.findOne({ key: 'prices' }).lean();
  res.set('Cache-Control', 'public, max-age=60').json(s ? s.value : {});
}));

/* ------------------------------- reviews ------------------------------ */
// Clients send a review from the website. It stays "pending" until you approve it in the admin panel.
app.post('/api/reviews', limiter(60 * 60 * 1000, 3, 'You have sent several reviews already. Please try again later.', true), wrap(async (req, res) => {
  const b = req.body || {};
  if (str(b.website)) return res.json({ success: true, message: 'Thank you!' }); // honeypot for bots
  const d = { name: line(b.name, 60), service: line(b.service, 60), rating: Math.round(Number(b.rating)), text: str(b.text, 600) };
  if (d.name.length < 2) return bad(res, 'Please enter your name.');
  if (!(d.rating >= 1 && d.rating <= 5)) return bad(res, 'Please choose a star rating from 1 to 5.');
  if (d.text.length < 20) return bad(res, 'Please write at least 20 characters.');
  if (/https?:\/\/|www\./i.test(d.text)) return bad(res, 'Please remove web links from your review.');
  if (b.consent !== true) return bad(res, 'Please agree to let us show your review.');
  const doc = await Review.create({ ...d, ip: req.ip });
  if (mailer && env.NOTIFY_EMAIL) {
    mailer.sendMail({
      from: env.MAIL_FROM || env.SMTP_USER, to: env.NOTIFY_EMAIL,
      subject: `New review waiting for approval: ${'*'.repeat(doc.rating)} from ${doc.name}`,
      text: `${doc.name} (${doc.service || 'no service given'}) gave ${doc.rating}/5:\n\n${doc.text}\n\nApprove or hide it in your admin panel > Reviews.`
    }).catch(err => console.error('Review email failed:', err.message));
  }
  res.json({ success: true, message: 'Thank you! Your review will appear on our website once we approve it.' });
}));

// Messages shown in the strip above the menu. Stored as [{text, on}]; older single "availability" text is still understood.
const cleanMessages = arr => (Array.isArray(arr) ? arr : []).slice(0, 20)
  .map(m => ({ text: line(m && m.text, 80), on: !(m && m.on === false) })).filter(m => m.text);
const adminMessages = v => (v && Array.isArray(v.messages) ? v.messages
  : v && typeof v.availability === 'string' && v.availability.trim() ? [{ text: v.availability.trim(), on: true }] : []);
const publicHeader = v => {
  if (v && Array.isArray(v.messages)) return { messages: v.messages.filter(m => m.on && m.text).map(m => m.text) };
  if (v && typeof v.availability === 'string') return { messages: v.availability.trim() ? [v.availability.trim()] : [] };
  return {}; // nothing saved yet: the website keeps its built-in message
};
app.locals.headerHelpers = { cleanMessages, adminMessages, publicHeader };

// Header strip on the website: your messages + the average of approved reviews.
app.get('/api/header', wrap(async (req, res) => {
  const [h, agg] = await Promise.all([
    Setting.findOne({ key: 'header' }).lean(),
    Review.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, count: { $sum: 1 }, avg: { $avg: '$rating' } } }])
  ]);
  const out = { reviews: { count: agg[0] ? agg[0].count : 0, average: agg[0] ? Math.round(agg[0].avg * 10) / 10 : 0 } };
  Object.assign(out, publicHeader(h && h.value));
  res.set('Cache-Control', 'public, max-age=60').json(out);
}));

app.get('/api/reviews', wrap(async (req, res) => {
  const list = await Review.find({ status: 'approved' }).sort({ createdAt: -1 }).limit(12).select('name service rating text -_id').lean();
  res.set('Cache-Control', 'public, max-age=60').json(list);
}));

/* ---------------------------- birthday emails ------------------------- */
const BDAY_DEFAULT = {
  subject: 'Happy Birthday, {name}! 🎉',
  body: 'Hi {name},\n\nAll of us at ZOOM Photography & Videography wish you a very happy birthday! May your year be full of joy and moments worth capturing.\n\nWarm regards,\nZOOM Photography & Videography'
};
const OPT_OUT = '\n\n---\nIf you would rather not receive emails from us, just reply and tell us.';
const fill = (t, c) => t.replace(/\{name\}/g, (c.name || '').split(' ')[0] || 'friend');
async function bdayTemplate() {
  const s = await Setting.findOne({ key: 'birthdayMessage' }).lean();
  return s ? s.value : BDAY_DEFAULT;
}
async function sendBirthday(c, tpl) {
  if (!mailer) throw new Error('Email is not set up on the server. Add BREVO_API_KEY and MAIL_FROM in Render (see the README), then redeploy.');
  const body = fill(tpl.body, c);
  await mailer.sendMail({
    from: env.MAIL_FROM || env.SMTP_USER, to: c.email,
    subject: fill(tpl.subject, c).replace(/[\r\n]+/g, ' '),
    text: body + OPT_OUT,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;white-space:pre-wrap">${esc(body)}</div>` +
      '<p style="color:#888;font-size:12px;margin-top:24px">If you would rather not receive emails from us, just reply and tell us.</p>'
  });
}

// Call once a day from a free cron service (see README). Sends to clients whose birthday is today.
app.post('/api/cron/birthdays', wrap(async (req, res) => {
  const key = env.CRON_SECRET || '', got = String(req.headers['x-cron-key'] || '');
  if (key.length < 16 || got.length !== key.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(key))) return bad(res, 'Not allowed', 403);
  const yr = eatYear(), mds = [eatMD()];
  if (mds[0] === '02-28' && !(yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0))) mds.push('02-29');
  const due = await Client.find({ birthday: { $in: mds }, marketingOk: true, email: { $nin: [null, ''] }, lastBirthdayYear: { $ne: yr } });
  const tpl = await bdayTemplate();
  let sent = 0, failed = 0;
  for (const c of due) {
    try { await sendBirthday(c, tpl); c.lastBirthdayYear = yr; await c.save(); sent++; }
    catch (e) { failed++; console.error('Birthday email failed:', e.message); }
  }
  res.json({ success: true, sent, failed });
}));

/* ------------------------------ admin auth --------------------------- */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const sign = a => jwt.sign({ sub: a.id }, JWT_SECRET, { expiresIn: '12h', algorithm: 'HS256' });

app.post('/api/admin/login', limiter(15 * 60 * 1000, 10, 'Too many login attempts. Try again in 15 minutes.'), wrap(async (req, res) => {
  const email = line(req.body && req.body.email, 120).toLowerCase();
  const password = typeof (req.body && req.body.password) === 'string' ? req.body.password.slice(0, 200) : '';
  const a = email ? await Admin.findOne({ email }) : null;
  const ok = await bcrypt.compare(password, a ? a.passwordHash : DUMMY_HASH); // same timing either way
  if (!a || !ok) return bad(res, 'Wrong email or password.', 401);
  res.json({ success: true, token: sign(a) });
}));

async function requireAdmin(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const p = jwt.verify(h.startsWith('Bearer ') ? h.slice(7) : '', JWT_SECRET, { algorithms: ['HS256'] });
    const a = await Admin.findById(p.sub);
    if (!a || (a.passwordChangedAt && p.iat < Math.floor(a.passwordChangedAt.getTime() / 1000))) throw new Error('stale');
    req.admin = a;
    next();
  } catch (e) {
    bad(res, 'Please log in again.', 401);
  }
}

const admin = express.Router();
app.use('/api/admin', requireAdmin, admin);

admin.get('/me', (req, res) => res.json({ success: true, email: req.admin.email }));

admin.post('/change-password', wrap(async (req, res) => {
  const cur = str(req.body.currentPassword, 200), next = str(req.body.newPassword, 200);
  if (!(await bcrypt.compare(cur, req.admin.passwordHash))) return bad(res, 'Current password is wrong.', 403);
  if (next.length < 10) return bad(res, 'New password must be at least 10 characters.');
  req.admin.passwordHash = await bcrypt.hash(next, 12);
  req.admin.passwordChangedAt = new Date(); // logs out every older session
  await req.admin.save();
  res.json({ success: true, token: sign(req.admin) });
}));

admin.get('/stats', wrap(async (req, res) => {
  const [newEnquiries, upcoming, open] = await Promise.all([
    Enquiry.countDocuments({ status: 'new' }),
    Booking.countDocuments({ eventDate: { $gte: new Date() }, status: { $in: ['pending', 'confirmed'] } }),
    Booking.find({ status: { $ne: 'cancelled' } }).select('price deposit payments')
  ]);
  res.json({ newEnquiries, upcomingBookings: upcoming, outstandingBalance: open.reduce((t, b) => t + b.balance, 0) });
}));

admin.get('/prices', wrap(async (req, res) => {
  const s = await Setting.findOne({ key: 'prices' }).lean();
  res.json(s ? s.value : {});
}));

admin.put('/prices', wrap(async (req, res) => {
  const out = {};
  for (const k of PRICE_KEYS) {
    const v = Number(req.body[k]);
    if (!Number.isFinite(v) || v < 0 || v > 10000000) return bad(res, 'Enter a valid price for ' + k + '.');
    out[k] = Math.round(v);
  }
  await Setting.findOneAndUpdate({ key: 'prices' }, { value: out }, { upsert: true });
  res.json({ success: true, prices: out });
}));

/* ----------------------------- enquiries ----------------------------- */
admin.get('/enquiries', wrap(async (req, res) => {
  const f = {};
  if (ENQ_STATUS.includes(req.query.status)) f.status = req.query.status;
  const q = str(String(req.query.q || ''), 60);
  if (q) {
    const rx = new RegExp(reEsc(q), 'i');
    f.$or = ['firstName', 'lastName', 'email', 'phone', 'service', 'message'].map(k => ({ [k]: rx }));
  }
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const [items, total] = await Promise.all([
    Enquiry.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Enquiry.countDocuments(f)
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
}));

admin.patch('/enquiries/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Invalid id');
  const u = {};
  if (req.body.status !== undefined) {
    if (!ENQ_STATUS.includes(req.body.status)) return bad(res, 'Invalid status');
    u.status = req.body.status;
  }
  if (req.body.notes !== undefined) u.notes = str(req.body.notes, 2000);
  const doc = await Enquiry.findByIdAndUpdate(req.params.id, u, { new: true });
  if (!doc) return bad(res, 'Not found', 404);
  res.json(doc);
}));

admin.delete('/enquiries/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Invalid id');
  await Enquiry.findByIdAndDelete(req.params.id);
  res.json({ success: true });
}));

admin.post('/enquiries/:id/convert', wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Invalid id');
  const e = await Enquiry.findById(req.params.id);
  if (!e) return bad(res, 'Not found', 404);
  const b = req.body || {};
  const booking = await Booking.create({
    clientName: `${e.firstName} ${e.lastName}`, clientPhone: e.phone, clientEmail: e.email,
    service: e.service, location: line(b.location, 200), price: num(b.price), deposit: num(b.deposit),
    eventDate: b.eventDate && !isNaN(new Date(b.eventDate)) ? new Date(b.eventDate) : null,
    notes: e.message, enquiry: e.id
  });
  e.status = 'booked';
  await e.save();
  res.status(201).json(booking);
}));

/* ------------------- galleries, team and bookings -------------------- */
function crud(name, Model, clean, validate, populate, sort) {
  const base = '/' + name;
  admin.get(base, wrap(async (req, res) => {
    let q = Model.find().sort(sort || { createdAt: -1 });
    if (populate) q = q.populate(populate);
    res.json(await q);
  }));
  admin.post(base, wrap(async (req, res) => {
    const d = clean(req.body || {}), err = validate(d);
    if (err) return bad(res, err);
    res.status(201).json(await Model.create(d));
  }));
  admin.put(base + '/:id', wrap(async (req, res) => {
    if (!isId(req.params.id)) return bad(res, 'Invalid id');
    const d = clean(req.body || {}), err = validate(d);
    if (err) return bad(res, err);
    const doc = await Model.findByIdAndUpdate(req.params.id, d, { new: true, runValidators: true });
    if (!doc) return bad(res, 'Not found', 404);
    res.json(doc);
  }));
  admin.delete(base + '/:id', wrap(async (req, res) => {
    if (!isId(req.params.id)) return bad(res, 'Invalid id');
    await Model.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  }));
}

crud('galleries', Gallery,
  b => ({ name: line(b.name, 120), link: str(b.link, 500), note: line(b.note, 200), order: Number(b.order) || 0 }),
  d => (!d.name ? 'Enter a name.' : !URL_RE.test(d.link) ? 'The link must start with https://' : ''),
  null, { order: 1, createdAt: 1 });

crud('team', TeamMember,
  b => ({
    name: line(b.name, 100), role: line(b.role, 100), phone: line(b.phone, 30), whatsapp: line(b.whatsapp, 30),
    email: line(b.email, 120).toLowerCase(), note: line(b.note, 300), isPublic: b.isPublic === true
  }),
  d => (!d.name ? 'Enter a name.' : d.email && !EMAIL_RE.test(d.email) ? 'That email address is not valid.' : ''),
  null, { name: 1 });

crud('bookings', Booking,
  b => ({
    clientName: line(b.clientName, 120), clientPhone: line(b.clientPhone, 30), clientEmail: line(b.clientEmail, 120).toLowerCase(),
    service: line(b.service, 120), location: line(b.location, 200),
    eventDate: b.eventDate ? new Date(b.eventDate) : null,
    price: num(b.price), deposit: num(b.deposit),
    status: BOOK_STATUS.includes(b.status) ? b.status : 'pending',
    team: Array.isArray(b.team) ? b.team.filter(isId).slice(0, 20) : [],
    delivery: DELIVERY.includes(b.delivery) ? b.delivery : 'not started',
    checklist: str(b.checklist, 3000),
    notes: str(b.notes, 2000)
  }),
  d => (!d.clientName ? 'Enter the client name.' : d.eventDate && isNaN(d.eventDate) ? 'That event date is not valid.' : d.clientEmail && !EMAIL_RE.test(d.clientEmail) ? 'That email address is not valid.' : ''),
  { path: 'team', select: 'name role phone whatsapp' }, { eventDate: 1 });

admin.post('/bookings/:id/payments', wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Invalid id');
  const amount = num(req.body.amount);
  if (!amount) return bad(res, 'Enter an amount greater than 0.');
  const b = await Booking.findById(req.params.id);
  if (!b) return bad(res, 'Not found', 404);
  const when = req.body.date && !isNaN(new Date(req.body.date)) ? new Date(req.body.date) : new Date();
  b.payments.push({ amount, method: line(req.body.method, 30) || 'M-Pesa', ref: line(req.body.ref, 40), note: line(req.body.note, 200), date: when });
  await b.save();
  res.status(201).json(b);
}));

admin.delete('/bookings/:id/payments/:pid', wrap(async (req, res) => {
  if (!isId(req.params.id) || !isId(req.params.pid)) return bad(res, 'Invalid id');
  const b = await Booking.findById(req.params.id);
  if (!b) return bad(res, 'Not found', 404);
  b.payments.pull({ _id: req.params.pid });
  await b.save();
  res.json(b);
}));

admin.post('/test-email', wrap(async (req, res) => {
  if (!mailer) return bad(res, 'Email is not set up on the server yet. Add BREVO_API_KEY and MAIL_FROM in Render, then redeploy.');
  const to = env.NOTIFY_EMAIL || env.ADMIN_EMAIL;
  if (!to) return bad(res, 'Set NOTIFY_EMAIL in Render so the server knows where to send it.');
  try {
    await mailer.sendMail({ from: env.MAIL_FROM || env.SMTP_USER, to, subject: 'ZOOM admin: test email', text: 'It works. Your website can now send you email.' });
  } catch (e) { return bad(res, 'The email could not be sent: ' + e.message); }
  res.json({ success: true, message: 'Test email sent to ' + to + '. Check your inbox and spam folder.' });
}));

admin.get('/header', wrap(async (req, res) => {
  const h = await Setting.findOne({ key: 'header' }).lean();
  res.json({ messages: adminMessages(h && h.value), saved: !!h });
}));
admin.put('/header', wrap(async (req, res) => {
  const msgs = Array.isArray(req.body.messages) ? cleanMessages(req.body.messages) : cleanMessages([{ text: req.body.availability, on: true }]);
  await Setting.findOneAndUpdate({ key: 'header' }, { value: { messages: msgs } }, { upsert: true });
  res.json({ success: true, messages: msgs });
}));

admin.get('/reviews', wrap(async (req, res) => res.json(await Review.find().sort({ createdAt: -1 }).limit(200))));
admin.patch('/reviews/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Invalid id');
  if (!REVIEW_STATUS.includes(req.body.status)) return bad(res, 'Invalid status');
  const doc = await Review.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
  if (!doc) return bad(res, 'Not found', 404);
  res.json(doc);
}));
admin.delete('/reviews/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Invalid id');
  await Review.findByIdAndDelete(req.params.id);
  res.json({ success: true });
}));

/* ----------------- clients, birthdays, expenses, reports -------------- */
crud('clients', Client,
  b => {
    const m = str(b.birthday, 10).match(/(\d{2})-(\d{2})$/);
    const ok = m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31;
    return {
      name: line(b.name, 120), email: line(b.email, 120).toLowerCase(), phone: line(b.phone, 30),
      birthday: ok ? m[1] + '-' + m[2] : (str(b.birthday) ? 'INVALID' : ''),
      marketingOk: b.marketingOk === true, note: line(b.note, 300)
    };
  },
  d => (!d.name ? 'Enter a name.' : d.birthday === 'INVALID' ? 'That birthday is not a valid date.' : d.email && !EMAIL_RE.test(d.email) ? 'That email address is not valid.' : ''),
  null, { name: 1 });

admin.post('/clients/import', wrap(async (req, res) => {
  const [enq, bk, have] = await Promise.all([
    Enquiry.find().select('firstName lastName email phone'),
    Booking.find().select('clientName clientEmail clientPhone'),
    Client.find().select('email')
  ]);
  const seen = new Set(have.map(c => c.email).filter(Boolean)), add = [];
  const push = (name, email, phone) => {
    email = (email || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || seen.has(email)) return;
    seen.add(email); add.push({ name, email, phone });
  };
  enq.forEach(e => push(`${e.firstName} ${e.lastName}`, e.email, e.phone));
  bk.forEach(b => push(b.clientName, b.clientEmail, b.clientPhone));
  if (add.length) await Client.insertMany(add);
  res.json({ success: true, added: add.length });
}));

admin.post('/clients/:id/birthday-email', wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Invalid id');
  const c = await Client.findById(req.params.id);
  if (!c) return bad(res, 'Not found', 404);
  if (!c.email) return bad(res, 'This client has no email address.');
  if (!c.marketingOk) return bad(res, 'This client has not agreed to receive emails yet. Tick that box once they agree.');
  try { await sendBirthday(c, await bdayTemplate()); } catch (e) { return bad(res, 'Could not send: ' + e.message, 502); }
  c.lastBirthdayYear = eatYear();
  await c.save();
  res.json({ success: true });
}));

admin.get('/birthday-message', wrap(async (req, res) => res.json(await bdayTemplate())));
admin.put('/birthday-message', wrap(async (req, res) => {
  const v = { subject: line(req.body.subject, 150), body: str(req.body.body, 3000) };
  if (!v.subject || !v.body) return bad(res, 'Enter a subject and a message.');
  await Setting.findOneAndUpdate({ key: 'birthdayMessage' }, { value: v }, { upsert: true });
  res.json({ success: true });
}));

crud('expenses', Expense,
  b => ({
    name: line(b.name, 150), category: EXPENSE_CATS.includes(b.category) ? b.category : 'Other', amount: num(b.amount),
    date: b.date && !isNaN(new Date(b.date)) ? new Date(b.date) : new Date()
  }),
  d => (!d.name ? 'Enter what the expense was for.' : ''),
  null, { date: -1 });

admin.get('/report', wrap(async (req, res) => {
  const year = parseInt(req.query.year, 10) || eatYear();
  const [bk, ex] = await Promise.all([
    Booking.find({ status: { $ne: 'cancelled' } }),
    Expense.find({ date: { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) } })
  ]);
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, income: 0, expenses: 0, profit: 0 }));
  const inYear = d => d && d.getUTCFullYear() === year;
  bk.forEach(b => {
    b.payments.forEach(p => { if (inYear(p.date)) months[p.date.getUTCMonth()].income += p.amount; });
    if (b.deposit && inYear(b.createdAt)) months[b.createdAt.getUTCMonth()].income += b.deposit;
  });
  ex.forEach(e => { months[e.date.getUTCMonth()].expenses += e.amount; });
  months.forEach(m => { m.profit = m.income - m.expenses; });
  const svc = {};
  bk.filter(b => b.eventDate && b.eventDate.getUTCFullYear() === year).forEach(b => {
    const k = b.service || 'Other';
    svc[k] = svc[k] || { service: k, count: 0, revenue: 0 };
    svc[k].count++; svc[k].revenue += b.price;
  });
  res.json({
    year, months,
    topServices: Object.values(svc).sort((a, b) => b.revenue - a.revenue).slice(0, 6),
    owed: bk.filter(b => b.balance > 0).map(b => ({ client: b.clientName, eventDate: b.eventDate, balance: b.balance })).sort((a, b) => b.balance - a.balance).slice(0, 15)
  });
}));

/* ------------------------------- errors ------------------------------ */
app.use('/api', (req, res) => bad(res, 'Not found', 404));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.message === 'Not allowed by CORS') return bad(res, 'This website is not allowed to use this API.', 403);
  if (err.type === 'entity.parse.failed') return bad(res, 'Invalid JSON.');
  if (err.type === 'entity.too.large') return bad(res, 'Request too large.', 413);
  console.error(err);
  bad(res, '❌ Something went wrong on our side. Please try again.', 500);
});

/* ------------------------------- start ------------------------------- */
async function seedAdmin() {
  if (await Admin.countDocuments()) return;
  const email = (env.ADMIN_EMAIL || '').trim().toLowerCase(), pw = env.ADMIN_PASSWORD || '';
  if (!EMAIL_RE.test(email) || pw.length < 10) {
    throw new Error('No admin exists yet. Set ADMIN_EMAIL and an ADMIN_PASSWORD of 10+ characters, then restart.');
  }
  await Admin.create({ email, passwordHash: await bcrypt.hash(pw, 12) });
  console.log('Admin account created for', email);
}

async function start() {
  if (!env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  if (!ALLOWED.length) console.warn('Warning: ALLOWED_ORIGINS is empty, so browsers on your website will be blocked.');
  if (!mailer) console.warn('Email is off: set BREVO_API_KEY and MAIL_FROM (or SMTP settings).');
  else console.log('Email is on via ' + (brevoMailer ? 'Brevo' : 'SMTP') + '.');
  await mongoose.connect(env.MONGODB_URI);
  await seedAdmin();
  app.listen(PORT, () => console.log(`ZOOM backend listening on port ${PORT}`));
}

if (require.main === module) {
  start().catch(e => { console.error('Startup failed:', e.message); process.exit(1); });
}
module.exports = app;
