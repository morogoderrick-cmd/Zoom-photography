// ============================================================
//  ZOOM Photography & Videography
//  File: api-connector.js
//  PURPOSE: Paste this <script> block into your HTML frontend
//           OR save as api-connector.js and link it with:
//           <script src="api-connector.js"></script>
//
//  ⚙️  ONLY CHANGE THIS ONE LINE:
//      const API_URL = 'http://localhost:5000' (local dev)
//      const API_URL = 'https://your-backend.onrender.com' (live)
// ============================================================

const API_URL = 'http://localhost:5000'; // ← change to your deployed URL when live

// ─────────────────────────────────────────────
//  1. CONTACT FORM HANDLER
//     Connects to: POST /api/contact
// ─────────────────────────────────────────────
async function submitContactForm(event) {
  event.preventDefault();

  const btn     = document.getElementById('contactSubmitBtn');
  const msgBox  = document.getElementById('contactMessage');

  // Get form values
  const payload = {
    firstName : document.getElementById('cf_firstName')?.value?.trim(),
    lastName  : document.getElementById('cf_lastName')?.value?.trim(),
    email     : document.getElementById('cf_email')?.value?.trim(),
    phone     : document.getElementById('cf_phone')?.value?.trim(),
    service   : document.getElementById('cf_service')?.value,
    message   : document.getElementById('cf_message')?.value?.trim(),
  };

  // Basic validation
  if (!payload.firstName || !payload.lastName || !payload.email || !payload.message) {
    showMessage(msgBox, 'Please fill in all required fields.', 'error');
    return;
  }

  // Loading state
  btn.disabled    = true;
  btn.textContent = '⏳ Sending...';

  try {
    const response = await fetch(`${API_URL}/api/contact`, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify(payload),
    });

    const result = await response.json();

    if (result.success) {
      showMessage(msgBox, result.message, 'success');
      document.getElementById('contactForm').reset();
    } else {
      showMessage(msgBox, result.message, 'error');
    }
  } catch (err) {
    showMessage(msgBox, 'Connection error. Please check your internet and try again.', 'error');
    console.error('Contact form error:', err);
  } finally {
    btn.disabled    = false;
    btn.textContent = '🚀 Send Message';
  }
}

// ─────────────────────────────────────────────
//  2. BOOKING FORM HANDLER
//     Connects to: POST /api/booking
// ─────────────────────────────────────────────
async function submitBookingForm(event) {
  event.preventDefault();

  const btn    = document.getElementById('bookingSubmitBtn');
  const msgBox = document.getElementById('bookingMessage');

  const payload = {
    name     : document.getElementById('bk_name')?.value?.trim(),
    email    : document.getElementById('bk_email')?.value?.trim(),
    phone    : document.getElementById('bk_phone')?.value?.trim(),
    service  : document.getElementById('bk_service')?.value,
    date     : document.getElementById('bk_date')?.value,
    location : document.getElementById('bk_location')?.value?.trim(),
    notes    : document.getElementById('bk_notes')?.value?.trim(),
  };

  if (!payload.name || !payload.email || !payload.service) {
    showMessage(msgBox, 'Name, email and service are required.', 'error');
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ Submitting...';

  try {
    const response = await fetch(`${API_URL}/api/booking`, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify(payload),
    });

    const result = await response.json();

    if (result.success) {
      showMessage(msgBox, result.message, 'success');
      document.getElementById('bookingForm').reset();
    } else {
      showMessage(msgBox, result.message, 'error');
    }
  } catch (err) {
    showMessage(msgBox, 'Connection error. Please try again.', 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = '📅 Request Booking';
  }
}

// ─────────────────────────────────────────────
//  3. NEWSLETTER SUBSCRIBE HANDLER
//     Connects to: POST /api/subscribe
// ─────────────────────────────────────────────
async function subscribeNewsletter(event) {
  event.preventDefault();

  const emailInput = document.getElementById('newsletterEmail');
  const msgBox     = document.getElementById('newsletterMessage');
  const btn        = document.getElementById('newsletterBtn');

  const email = emailInput?.value?.trim();
  if (!email) { showMessage(msgBox, 'Please enter your email.', 'error'); return; }

  btn.disabled    = true;
  btn.textContent = '⏳ Subscribing...';

  try {
    const response = await fetch(`${API_URL}/api/subscribe`, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({ email }),
    });

    const result = await response.json();
    showMessage(msgBox, result.message, result.success ? 'success' : 'error');
    if (result.success) emailInput.value = '';

  } catch (err) {
    showMessage(msgBox, 'Connection error. Please try again.', 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = '✉️ Subscribe';
  }
}

// ─────────────────────────────────────────────
//  HELPER: Display success/error messages
// ─────────────────────────────────────────────
function showMessage(element, text, type) {
  if (!element) return;
  element.textContent    = text;
  element.style.display  = 'block';
  element.style.padding  = '12px 20px';
  element.style.borderRadius = '10px';
  element.style.marginTop    = '12px';
  element.style.fontWeight   = '600';
  element.style.fontSize     = '0.88rem';

  if (type === 'success') {
    element.style.background = 'rgba(0,201,167,0.15)';
    element.style.border     = '1px solid rgba(0,201,167,0.4)';
    element.style.color      = '#00c9a7';
  } else {
    element.style.background = 'rgba(255,77,141,0.15)';
    element.style.border     = '1px solid rgba(255,77,141,0.4)';
    element.style.color      = '#ff4d8d';
  }

  // Auto-hide after 8 seconds
  setTimeout(() => { if (element) element.style.display = 'none'; }, 8000);
}

// ─────────────────────────────────────────────
//  AUTO-ATTACH: Wire up forms automatically
//  when DOM is ready
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const contactForm    = document.getElementById('contactForm');
  const bookingForm    = document.getElementById('bookingForm');
  const newsletterForm = document.getElementById('newsletterForm');

  if (contactForm)    contactForm.addEventListener('submit', submitContactForm);
  if (bookingForm)    bookingForm.addEventListener('submit', submitBookingForm);
  if (newsletterForm) newsletterForm.addEventListener('submit', subscribeNewsletter);

  console.log('✅ ZOOM API connector loaded. Backend:', API_URL);
});
