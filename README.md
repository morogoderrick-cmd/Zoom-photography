# ZOOM Photography backend

Node.js + Express + MongoDB. Your website's contact form already posts to `/api/contact`, and this backend answers in the format the site expects.

## What it does
- Saves every contact-form message and emails it to you
- Admin login (you only) with a protected API for enquiries, bookings, team contacts and client galleries
- Public endpoints your website uses: galleries and (optional) public team list
- Rate limiting, CORS allow-list, hashed password, 12-hour login tokens

## Setup (about 20 minutes)

### 1. Database (free, permanent)
1. Create an account at mongodb.com/atlas and make a free **M0** cluster.
2. **Database Access** > add a user with a strong password.
3. **Network Access** > add IP address `0.0.0.0/0` (Render's IPs change).
4. **Connect** > Drivers > copy the connection string. Put your password in it and add `/zoom` before the `?`.

### 2. Email (enquiry alerts, birthday emails)
**Important:** Render's free plan blocks the usual email ports (25, 465, 587), so Gmail/SMTP cannot work there. Use Brevo, which sends over the normal web port and has a free plan (about 300 emails a day):
1. Create a free account at brevo.com.
2. In Brevo go to **Senders, Domains & Dedicated IPs > Senders > Add a sender**. Enter your name and the email address you want mail to come from, then confirm the email Brevo sends you.
3. Go to **SMTP & API > API Keys > Generate a new API key** and copy it.
4. In Render > your service > **Environment** add:
   - `BREVO_API_KEY` = the key you copied
   - `MAIL_FROM` = the sender address you verified (for example `ZOOM Photography <you@gmail.com>`)
   - `NOTIFY_EMAIL` = where enquiries should arrive
5. Save and let Render redeploy. The log should say `Email is on via Brevo.`
6. In the admin panel open **Prices & header** and press **Send test email**.

SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) still works on a paid Render plan or on your own computer.

### 3. Deploy on Render
1. Put this folder in a GitHub repository (the `.gitignore` keeps secrets out).
2. Render > **New > Web Service** > pick the repo. Name it `zoom-photography` so your URL stays `https://zoom-photography.onrender.com` (the website already points there). Or use **New > Blueprint** and `render.yaml`.
3. Build command `npm install`, start command `npm start`.
4. Add the environment variables from `.env.example`. Generate `JWT_SECRET` with:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
5. `ALLOWED_ORIGINS` must list every address your website is served from, for example `https://zoomphotography.co.ke`.
6. Deploy. The first start creates your admin account from `ADMIN_EMAIL` and `ADMIN_PASSWORD`. After that you can remove `ADMIN_PASSWORD` from Render and change the password through the API.

### 4. Check it works
- Open `https://zoom-photography.onrender.com/api/health`. You should see `{"ok":true,...}`.
- Send a test message through your website's contact form. It should appear in your email and in the database.

### Free-plan note
Render's free plan sleeps after 15 minutes without traffic, so the first request after a break can take about 50 seconds. A free monitor (for example UptimeRobot) that pings `/api/health` every 5 minutes keeps it awake.

## API reference
Admin routes need the header `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/contact` | Contact form (public, 5 per hour per visitor) |
| GET | `/api/galleries` | Client galleries for the website (public) |
| POST | `/api/reviews` | Client sends a review. It is held until you approve it (3 accepted per hour per visitor, links rejected) |
| GET | `/api/reviews` | Approved reviews for the website (public) |
| GET | `/api/header` | Header strip data: your switched-on messages and the review average (public) |
| GET | `/api/prices` | Website prices (public, set from the admin panel) |
| GET | `/api/team` | Team members marked public (name and role only) |
| POST | `/api/admin/login` | `{email, password}` returns `{token}` |
| GET | `/api/admin/me` | Check the token |
| POST | `/api/admin/change-password` | `{currentPassword, newPassword}` (10+ characters) |
| GET | `/api/admin/stats` | New enquiries, upcoming bookings, money owed |
| GET | `/api/admin/enquiries` | `?status=new&q=text&page=1` |
| PATCH | `/api/admin/enquiries/:id` | `{status, notes}` (new, contacted, quoted, booked, closed) |
| POST | `/api/admin/enquiries/:id/convert` | Turn an enquiry into a booking |
| DELETE | `/api/admin/enquiries/:id` | Delete |
| GET/POST | `/api/admin/galleries` | List / add `{name, link, note, order}` |
| PUT/DELETE | `/api/admin/galleries/:id` | Edit / remove |
| GET/POST | `/api/admin/team` | List / add `{name, role, phone, whatsapp, email, note, isPublic}` |
| PUT/DELETE | `/api/admin/team/:id` | Edit / remove |
| GET/POST | `/api/admin/bookings` | List / add `{clientName, clientPhone, clientEmail, service, eventDate, location, price, deposit, status, team[], notes}` |
| PUT/DELETE | `/api/admin/bookings/:id` | Edit / remove (`paid` and `balance` are calculated) |
| POST | `/api/admin/bookings/:id/payments` | Record a payment `{amount, method, ref, date}` |
| DELETE | `/api/admin/bookings/:id/payments/:pid` | Remove a payment |
| GET/PUT | `/api/admin/prices` | Read / save the 11 website prices |
| GET | `/api/admin/reviews` | All reviews, newest first |
| PATCH | `/api/admin/reviews/:id` | `{status}`: pending, approved or hidden |
| DELETE | `/api/admin/reviews/:id` | Delete a review |
| GET/PUT | `/api/admin/header` | Read / save the list of messages shown above the menu `{messages:[{text,on}]}` |
| GET/POST | `/api/admin/clients` | List / add `{name, email, phone, birthday, marketingOk, note}` |
| PUT/DELETE | `/api/admin/clients/:id` | Edit / remove |
| POST | `/api/admin/clients/import` | Copy new emails from enquiries and bookings into Clients |
| POST | `/api/admin/clients/:id/birthday-email` | Send the birthday email now (client must have agreed) |
| GET/PUT | `/api/admin/birthday-message` | Read / save the birthday email text |
| GET/POST | `/api/admin/expenses` | List / add `{name, category, amount, date}` |
| PUT/DELETE | `/api/admin/expenses/:id` | Edit / remove |
| GET | `/api/admin/report?year=2026` | Monthly income, expenses, profit, best sellers, who owes you |
| POST | `/api/admin/test-email` | Sends a test email to `NOTIFY_EMAIL` so you can check email is working |
| POST | `/api/cron/birthdays` | Daily automatic birthday emails (needs header `X-Cron-Key`) |

## Client reviews
1. A visitor fills in the form under "What our clients say" (name, service, stars, review, and a tick to agree it can be shown).
2. It is saved as **pending**, and you get an email if email is set up. Nothing appears on the website yet.
3. In the admin panel open **Reviews**, then **Approve**, **Hide** or **Delete**. Approved reviews show on the website within about a minute.
4. Once one real review is approved, the three sample testimonials are replaced automatically.

## Header strip
The strip above the menu shows rotating messages and, once you have enough reviews, a star rating. (The WhatsApp and Call buttons were removed from it; they live in the footer, contact section and floating button.)
- **Messages:** manage them under **Prices & header** in the admin panel. Add up to 20, switch each on or off, and reorder them. With more than one switched on they take turns every 5 seconds; with none switched on the line is hidden. Visitors who prefer reduced motion see only the first message.
- **Star rating:** appears automatically once you have **3 approved reviews**. To change that number, edit `MIN_REVIEWS` in the small script at the bottom of `index.html`.
- **Nothing saved yet:** the website shows 16 built-in messages. Saving your own list replaces them. Your typing in the admin box is kept on your device until you press Save, so a refresh will not lose it.

## Birthday emails
1. Email must be set up (step 2 above). Without it the Send buttons show an error.
2. In **Clients**, tap **Import from enquiries and bookings** to pull in everyone's email, then add each person's birthday (the year doesn't matter).
3. Tick **Client agreed to receive emails** only for people who said yes. The server refuses to email anyone without that tick, and every email ends with a line telling them they can reply to opt out. Kenya's Data Protection Act expects you to have a lawful reason, and consent, for keeping personal details and sending marketing. This is not legal advice.
4. Edit the wording under **Edit birthday message** (type `{name}` where the first name goes).
5. Send by hand from the dashboard's "Birthdays in the next 14 days" card, or automate it:
   - Set `CRON_SECRET` on Render to a random string of 16+ characters.
   - At cron-job.org (free) create a job that runs once a day at 08:00 and sends `POST https://zoom-photography.onrender.com/api/cron/birthdays` with the header `X-Cron-Key: <your secret>`.
   - Each client gets at most one birthday email per year. The call also wakes the free server.

## Run locally
```
npm install
cp .env.example .env     # then fill it in
npm run dev
npm test                 # quick checks, no database needed
```

## Quick test with curl
```
curl -X POST https://zoom-photography.onrender.com/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}'
```
