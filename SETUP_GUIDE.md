# 🚀 ZOOM Photography & Videography — Backend Setup Guide

---

## 📁 FOLDER STRUCTURE

```
zoom-photography/
│
├── zoom-backend/              ← Backend (Node.js server)
│   ├── server.js              ← Main server file
│   ├── package.json           ← Dependencies list
│   ├── .env                   ← Your secret config (create this!)
│   ├── .env.example           ← Template for .env
│   ├── api-connector.js       ← Frontend ↔ Backend bridge
│   └── public/
│       └── index.html         ← Your frontend HTML file (copy here)
│
└── zoom-photography-v3.html   ← Your original frontend (modify this)
```

---

## ✅ STEP 1 — Install Node.js

Download and install Node.js from: https://nodejs.org
(Choose the LTS version — recommended)

Verify it's installed:
```bash
node --version    # should show v18 or higher
npm --version     # should show 9 or higher
```

---

## ✅ STEP 2 — Install Backend Dependencies

Open your terminal, go to the backend folder:
```bash
cd zoom-backend
npm install
```

This installs: express, mongoose, nodemailer, cors, dotenv, express-rate-limit, nodemon

---

## ✅ STEP 3 — Set Up MongoDB (Free Database)

1. Go to https://cloud.mongodb.com
2. Click "Sign Up" → create a free account
3. Create a FREE cluster (M0 tier — no credit card needed)
4. Click "Connect" → "Connect your application"
5. Copy the connection string — it looks like:
   ```
   mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/zoom_photography
   ```
6. Save this — you'll need it in Step 4

---

## ✅ STEP 4 — Create Your .env File

In the zoom-backend folder, create a file called exactly: `.env`
(Copy from .env.example and fill in your values)

```env
PORT=5000
FRONTEND_URL=http://localhost:5000
MONGO_URI=mongodb+srv://youruser:yourpass@cluster0.xxxx.mongodb.net/zoom_photography
EMAIL_USER=yourgmail@gmail.com
EMAIL_PASS=your_app_password_16_chars
ADMIN_SECRET_KEY=zoom_super_secret_2026_change_this
```

### 📧 How to get Gmail App Password:
1. Go to https://myaccount.google.com/security
2. Enable "2-Step Verification" if not already enabled
3. Go to "App Passwords" (search for it)
4. Select app: "Mail" → Generate
5. Copy the 16-character password → paste as EMAIL_PASS

---

## ✅ STEP 5 — Link Frontend to Backend

### Option A: Quick Way (Recommended)

Open your `zoom-photography-v3.html` file and:

1. **Add these IDs to your contact form fields** (find them in the HTML):

```html
<!-- Add id="contactForm" to the <form> tag -->
<form id="contactForm">

  <!-- Add these IDs to each input -->
  <input id="cf_firstName" type="text" placeholder="First Name">
  <input id="cf_lastName"  type="text" placeholder="Last Name">
  <input id="cf_email"     type="email" placeholder="Email">
  <input id="cf_phone"     type="tel" placeholder="Phone">
  <select id="cf_service">...</select>
  <textarea id="cf_message">...</textarea>

  <!-- Change submit button to: -->
  <button id="contactSubmitBtn" type="submit">🚀 Send Message</button>

  <!-- Add this empty div below the button for messages: -->
  <div id="contactMessage" style="display:none;"></div>

</form>
```

2. **Add the API connector script** — paste this just before `</body>`:

```html
<script src="api-connector.js"></script>
```

Or paste the entire contents of api-connector.js inside a `<script>` tag.

3. **Copy your HTML file into the public folder:**
```
zoom-backend/
  public/
    index.html   ← rename your HTML file to index.html and put it here
```

---

## ✅ STEP 6 — Start the Backend Server

```bash
cd zoom-backend
npm run dev        # for development (auto-restarts on changes)
# OR
npm start          # for production
```

You should see:
```
✅  MongoDB connected
🚀  ZOOM Backend running at http://localhost:5000
📡  API available at http://localhost:5000/api
```

Now open: http://localhost:5000 → your website loads!

---

## ✅ STEP 7 — Test Your API

Open your browser or use the terminal:

```bash
# Test server is running
curl http://localhost:5000/api/health

# Expected response:
# {"success":true,"message":"ZOOM Backend is running 🚀"}
```

Fill in and submit your contact form — you should:
- Get a success message on screen
- Receive a notification email at your Gmail
- Client gets an auto-reply email
- Submission saved to MongoDB

---

## 🌍 STEP 8 — Deploy Online (Free Hosting)

### Deploy Backend to Render.com (Free):
1. Go to https://render.com → Sign up free
2. Click "New Web Service"
3. Connect your GitHub repo (push your code to GitHub first)
4. Set:
   - Build Command: `npm install`
   - Start Command: `node server.js`
5. Add all your .env variables under "Environment"
6. Click Deploy!
7. You'll get a URL like: `https://zoom-backend.onrender.com`

### Update Frontend After Deployment:
Open `api-connector.js` and change line 1:
```javascript
// BEFORE (local):
const API_URL = 'http://localhost:5000';

// AFTER (live on Render):
const API_URL = 'https://zoom-backend.onrender.com';
```

---

## 📡 API ENDPOINTS SUMMARY

| Method | Endpoint                  | What it does               | Auth needed |
|--------|---------------------------|----------------------------|-------------|
| GET    | /api/health               | Check server is running    | No          |
| POST   | /api/contact              | Submit contact form        | No          |
| POST   | /api/booking              | Submit booking request     | No          |
| POST   | /api/subscribe            | Newsletter subscribe       | No          |
| GET    | /api/admin/contacts       | View all enquiries         | Admin key   |
| GET    | /api/admin/bookings       | View all bookings          | Admin key   |
| PATCH  | /api/admin/contacts/:id   | Update contact status      | Admin key   |
| DELETE | /api/admin/contacts/:id   | Delete a contact           | Admin key   |

### Accessing Admin Routes:
Add header `x-admin-key: your_admin_secret_key` in your requests.

---

## 🛠️ TROUBLESHOOTING

| Problem                        | Solution                                              |
|-------------------------------|-------------------------------------------------------|
| MongoDB not connecting         | Check MONGO_URI in .env, whitelist your IP in MongoDB |
| Emails not sending             | Check Gmail App Password, enable 2FA first            |
| CORS error in browser          | Set FRONTEND_URL in .env to match your website URL    |
| Port already in use            | Change PORT=5000 to PORT=3000 in .env                 |
| Form not submitting            | Check all input IDs match api-connector.js            |

---

## 📞 SUPPORT

If you need help, contact:
- WhatsApp: 0787 593 983
- Email: hello@zoomphotography.co.ke
