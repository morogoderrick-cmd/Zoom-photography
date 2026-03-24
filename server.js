// ============================================================
//  ZOOM Photography & Videography — Backend Server
//  File: server.js
//  Run: node server.js
// ============================================================

const express    = require('express');
const mongoose   = require('mongoose');
const nodemailer = require('nodemailer');
const cors       = require('cors');
const dotenv     = require('dotenv');
const path       = require('path');
const rateLimit  = require('express-rate-limit');

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the frontend HTML file as static
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiter — max 10 contact requests per 15 mins per IP
const contactLimiter = rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 10,
  message  : { success: false, message: 'Too many requests. Please try again later.' }
});

// ─── MONGODB CONNECTION ───────────────────────────────────────
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser    : true,
  useUnifiedTopology : true,
})
.then(() => console.log('✅  MongoDB connected'))
.catch(err => console.error('❌  MongoDB error:', err));

// ─── SCHEMAS & MODELS ─────────────────────────────────────────

// 1. Contact / Booking enquiries
const contactSchema = new mongoose.Schema({
  firstName : { type: String, required: true, trim: true },
  lastName  : { type: String, required: true, trim: true },
  email     : { type: String, required: true, trim: true, lowercase: true },
  phone     : { type: String, trim: true },
  service   : { type: String },
  message   : { type: String, required: true },
  status    : { type: String, enum: ['new','read','replied'], default: 'new' },
  createdAt : { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', contactSchema);

// 2. Newsletter subscribers
const subscriberSchema = new mongoose.Schema({
  email     : { type: String, required: true, unique: true, trim: true, lowercase: true },
  createdAt : { type: Date, default: Date.now }
});
const Subscriber = mongoose.model('Subscriber', subscriberSchema);

// 3. Booking requests
const bookingSchema = new mongoose.Schema({
  name      : { type: String, required: true },
  email     : { type: String, required: true },
  phone     : { type: String },
  service   : { type: String, required: true },
  date      : { type: String },
  location  : { type: String },
  notes     : { type: String },
  status    : { type: String, enum: ['pending','confirmed','cancelled'], default: 'pending' },
  createdAt : { type: Date, default: Date.now }
});
const Booking = mongoose.model('Booking', bookingSchema);

// ─── EMAIL TRANSPORTER ────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service : 'gmail',
  auth    : {
    user : process.env.EMAIL_USER,  // your Gmail address
    pass : process.env.EMAIL_PASS,  // your Gmail app password
  }
});

// Helper: send confirmation email to client + notification to studio
async function sendContactEmails(data) {
  // 1. Notify studio
  await transporter.sendMail({
    from    : process.env.EMAIL_USER,
    to      : process.env.EMAIL_USER,
    subject : `📸 New Enquiry from ${data.firstName} ${data.lastName}`,
    html    : `
      <h2>New Contact Form Submission</h2>
      <p><b>Name:</b> ${data.firstName} ${data.lastName}</p>
      <p><b>Email:</b> ${data.email}</p>
      <p><b>Phone:</b> ${data.phone || 'N/A'}</p>
      <p><b>Service:</b> ${data.service || 'N/A'}</p>
      <p><b>Message:</b><br>${data.message}</p>
      <hr>
      <small>Submitted at ${new Date().toLocaleString()}</small>
    `
  });

  // 2. Auto-reply to client
  await transporter.sendMail({
    from    : `"ZOOM Photography & Videography" <${process.env.EMAIL_USER}>`,
    to      : data.email,
    subject : '✅ We received your message — ZOOM Photography',
    html    : `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:30px;background:#0f0f1a;color:#fff;border-radius:12px;">
        <img src="cid:logo" alt="ZOOM Logo" style="height:60px;margin-bottom:20px;">
        <h2 style="color:#ff4d8d;">Hi ${data.firstName}, thanks for reaching out! 🎉</h2>
        <p style="color:#ccc;line-height:1.7;">
          We've received your enquiry about <strong style="color:#ffd234;">${data.service || 'our services'}</strong> 
          and we'll get back to you within <strong>24 hours</strong>.
        </p>
        <p style="color:#ccc;">In the meantime, feel free to follow us on our socials!</p>
        <div style="margin-top:24px;padding:16px;background:rgba(255,255,255,0.05);border-radius:8px;">
          <p style="color:#aaa;font-size:13px;margin:0;"><b>Your message:</b></p>
          <p style="color:#ddd;font-size:14px;">${data.message}</p>
        </div>
        <hr style="border-color:rgba(255,255,255,0.1);margin:24px 0;">
        <p style="color:#666;font-size:12px;">ZOOM Photography & Videography | Nairobi, Kenya | hello@zoomphotography.co.ke</p>
      </div>
    `
  });
}

async function sendBookingEmails(data) {
  await transporter.sendMail({
    from    : process.env.EMAIL_USER,
    to      : process.env.EMAIL_USER,
    subject : `📅 New Booking Request — ${data.service}`,
    html    : `
      <h2>New Booking Request</h2>
      <p><b>Name:</b> ${data.name}</p>
      <p><b>Email:</b> ${data.email}</p>
      <p><b>Phone:</b> ${data.phone || 'N/A'}</p>
      <p><b>Service:</b> ${data.service}</p>
      <p><b>Date:</b> ${data.date || 'TBD'}</p>
      <p><b>Location:</b> ${data.location || 'TBD'}</p>
      <p><b>Notes:</b> ${data.notes || 'None'}</p>
    `
  });

  await transporter.sendMail({
    from    : `"ZOOM Photography & Videography" <${process.env.EMAIL_USER}>`,
    to      : data.email,
    subject : '📅 Booking Request Received — ZOOM Photography',
    html    : `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:30px;background:#0f0f1a;color:#fff;border-radius:12px;">
        <h2 style="color:#ff4d8d;">Booking Request Received! 🎬</h2>
        <p style="color:#ccc;">Hi <strong>${data.name}</strong>, we've received your booking request for <strong style="color:#ffd234;">${data.service}</strong> on <strong>${data.date || 'a date TBD'}</strong>.</p>
        <p style="color:#ccc;">Our team will confirm availability and get back to you within 24 hours.</p>
        <hr style="border-color:rgba(255,255,255,0.1);margin:24px 0;">
        <p style="color:#666;font-size:12px;">ZOOM Photography & Videography | Nairobi, Kenya</p>
      </div>
    `
  });
}

// ─── API ROUTES ───────────────────────────────────────────────

// HEALTH CHECK
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'ZOOM Backend is running 🚀', time: new Date() });
});

// ── 1. CONTACT FORM SUBMIT ──
app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const { firstName, lastName, email, phone, service, message } = req.body;

    if (!firstName || !lastName || !email || !message) {
      return res.status(400).json({ success: false, message: 'Please fill in all required fields.' });
    }

    // Save to database
    const contact = new Contact({ firstName, lastName, email, phone, service, message });
    await contact.save();

    // Send emails
    try { await sendContactEmails({ firstName, lastName, email, phone, service, message }); }
    catch (emailErr) { console.warn('Email send failed (non-critical):', emailErr.message); }

    res.status(201).json({ success: true, message: 'Message sent! We\'ll get back to you within 24 hours. ✅' });

  } catch (err) {
    console.error('Contact error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── 2. BOOKING REQUEST ──
app.post('/api/booking', contactLimiter, async (req, res) => {
  try {
    const { name, email, phone, service, date, location, notes } = req.body;

    if (!name || !email || !service) {
      return res.status(400).json({ success: false, message: 'Name, email and service are required.' });
    }

    const booking = new Booking({ name, email, phone, service, date, location, notes });
    await booking.save();

    try { await sendBookingEmails({ name, email, phone, service, date, location, notes }); }
    catch (emailErr) { console.warn('Email send failed:', emailErr.message); }

    res.status(201).json({ success: true, message: 'Booking request submitted! We\'ll confirm within 24 hours. 📅' });

  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── 3. NEWSLETTER SUBSCRIBE ──
app.post('/api/subscribe', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

    const existing = await Subscriber.findOne({ email });
    if (existing) return res.status(409).json({ success: false, message: 'You\'re already subscribed! 🎉' });

    const sub = new Subscriber({ email });
    await sub.save();

    res.status(201).json({ success: true, message: 'Subscribed successfully! Welcome to the ZOOM family. 🎬' });

  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── 4. ADMIN — GET ALL CONTACTS (protected) ──
app.get('/api/admin/contacts', verifyAdmin, async (req, res) => {
  try {
    const contacts = await Contact.find().sort({ createdAt: -1 });
    res.json({ success: true, data: contacts });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── 5. ADMIN — GET ALL BOOKINGS (protected) ──
app.get('/api/admin/bookings', verifyAdmin, async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ createdAt: -1 });
    res.json({ success: true, data: bookings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── 6. ADMIN — UPDATE CONTACT STATUS ──
app.patch('/api/admin/contacts/:id', verifyAdmin, async (req, res) => {
  try {
    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    res.json({ success: true, data: contact });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── 7. ADMIN — DELETE CONTACT ──
app.delete('/api/admin/contacts/:id', verifyAdmin, async (req, res) => {
  try {
    await Contact.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Contact deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── ADMIN MIDDLEWARE ─────────────────────────────────────────
function verifyAdmin(req, res, next) {
  const token = req.headers['x-admin-key'];
  if (!token || token !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorised.' });
  }
  next();
}

// ─── CATCH-ALL: serve frontend for any unknown route ─────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START SERVER ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  ZOOM Backend running at http://localhost:${PORT}`);
  console.log(`📡  API available at http://localhost:${PORT}/api\n`);
});
