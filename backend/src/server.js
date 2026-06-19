import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as XLSX from 'xlsx';

dotenv.config();

export const app = express();
const PORT = process.env.PORT || 4000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MENU_FILE = process.env.MENU_FILE || path.join(__dirname, '..', 'data', 'menu.json');
const OUTLETS_FILE = process.env.OUTLETS_FILE || path.join(__dirname, '..', 'data', 'outlets.json');
const BRANDS_FILE = process.env.BRANDS_FILE || path.join(__dirname, '..', 'data', 'brands.json');
let petpoojaConnectionsFile = process.env.PETPOOJA_CONNECTIONS_FILE || path.join(__dirname, '..', 'data', 'petpooja-connections.json');
let sessionsFile = process.env.SESSIONS_FILE || path.join(__dirname, '..', 'data', 'sessions.json');
let ordersFile = process.env.ORDERS_FILE || path.join(__dirname, '..', 'data', 'orders.json');
let imageManifestFile = process.env.IMAGE_MANIFEST_FILE || path.join(__dirname, '..', 'data', 'uploaded-images.json');
let auditLogFile = process.env.AUDIT_LOG_FILE || path.join(__dirname, '..', 'data', 'audit-logs.json');
let paymentConnectionsFile = process.env.PAYMENT_CONNECTIONS_FILE || path.join(__dirname, '..', 'data', 'payment-connections.json');
let whatsappEventsFile = process.env.WHATSAPP_EVENTS_FILE || path.join(__dirname, '..', 'data', 'whatsapp-events.json');
let whatsappCampaignsFile = process.env.WHATSAPP_CAMPAIGNS_FILE || path.join(__dirname, '..', 'data', 'whatsapp-campaigns.json');
let whatsappConnectionsFile = process.env.WHATSAPP_CONNECTIONS_FILE || path.join(__dirname, '..', 'data', 'whatsapp-connections.json');
let adminUsersFile = process.env.ADMIN_USERS_FILE || path.join(__dirname, '..', 'data', 'admin-users.json');
let adminSessionsFile = process.env.ADMIN_SESSIONS_FILE || path.join(__dirname, '..', 'data', 'admin-sessions.json');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
const APP_ENCRYPTION_KEY = String(process.env.APP_ENCRYPTION_KEY || '').trim();
const NODE_ENV = String(process.env.NODE_ENV || '').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';
const ADMIN_AUTH_TOKEN = String(process.env.ADMIN_AUTH_TOKEN || '').trim();
const ADMIN_SESSION_SECRET = String(process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || APP_ENCRYPTION_KEY || '').trim();
const ADMIN_SEED_EMAIL = String(process.env.ADMIN_SEED_EMAIL || process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const ADMIN_SEED_PASSWORD = String(process.env.ADMIN_SEED_PASSWORD || process.env.ADMIN_PASSWORD || '').trim();
const ADMIN_SIGNUP_ENABLED = String(process.env.ADMIN_SIGNUP_ENABLED || 'true').trim().toLowerCase() !== 'false';
const ALLOW_PAYMENT_FALLBACK = String(process.env.ALLOW_PAYMENT_FALLBACK || '').trim().toLowerCase() === 'true';
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || '').trim();
const allowedCorsOrigins = CORS_ORIGIN
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = String(origin).trim().replace(/\/+$/, '');
    if (!allowedCorsOrigins.length && !IS_PRODUCTION) {
      callback(null, true);
      return;
    }

    callback(null, allowedCorsOrigins.includes(normalizedOrigin));
  }
}));
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buffer) => {
    req.rawBody = buffer;
  }
}));
app.use('/uploads', express.static(UPLOAD_DIR));

function timingSafeStringEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ''));
  const right = Buffer.from(String(rightValue || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseCookies(req) {
  return String(req.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex < 0) return cookies;
      const key = decodeURIComponent(part.slice(0, separatorIndex).trim());
      const value = decodeURIComponent(part.slice(separatorIndex + 1).trim());
      return { ...cookies, [key]: value };
    }, {});
}

function getAdminSessionToken(req) {
  return parseCookies(req).pikquik_admin_session || '';
}

function getAdminUserForRequest(req) {
  const bearerToken = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const headerToken = String(req.get('x-admin-token') || '').trim();
  if (ADMIN_AUTH_TOKEN && (
    timingSafeStringEqual(bearerToken, ADMIN_AUTH_TOKEN) ||
    timingSafeStringEqual(headerToken, ADMIN_AUTH_TOKEN)
  )) {
    return getPlatformSystemAdmin();
  }

  const token = getAdminSessionToken(req);
  if (!token) return null;

  const session = adminSessions.get(token);
  if (!session || String(session.expiresAt || '').localeCompare(new Date().toISOString()) <= 0) {
    if (session) {
      adminSessions.delete(token);
      persistAdminSessions();
    }
    return null;
  }

  const user = getAdminUser(session.userId);
  if (!user || user.status !== 'ACTIVE') return null;
  return user;
}

function requireAdminAuth(req, res, next) {
  const authConfigured = Boolean(adminUsers.length || ADMIN_AUTH_TOKEN);
  if (!authConfigured && !IS_PRODUCTION) {
    next();
    return;
  }

  if (!authConfigured) {
    if (ADMIN_SIGNUP_ENABLED && !req.path.startsWith('/api/admin')) {
      res.redirect('/admin/signup');
      return;
    }
    res.status(503).json({ error: 'Admin authentication is not configured. Create the first brand workspace at /admin/signup.' });
    return;
  }

  const user = getAdminUserForRequest(req);
  if (!user) {
    if (req.path.startsWith('/api/admin')) {
      res.status(401).json({ error: 'Admin login required' });
      return;
    }
    res.redirect('/admin/login');
    return;
  }

  req.adminUser = user;
  next();
}

function requirePlatformAdmin(req, res, next) {
  if (!isPlatformAdmin(req.adminUser)) {
    res.status(403).json({ error: 'Platform admin access required' });
    return;
  }
  next();
}

function requireOutletAccess(req, res, outletId) {
  if (!canAccessOutlet(req.adminUser, outletId)) {
    res.status(403).json({ error: 'Outlet access denied' });
    return false;
  }
  return true;
}

function requireBrandAccess(req, res, brandId) {
  if (!canAccessBrand(req.adminUser, brandId)) {
    res.status(403).json({ error: 'Brand access denied' });
    return false;
  }
  return true;
}

function setAdminSessionCookie(res, token, expiresAt) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader('Set-Cookie', `pikquik_admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=${new Date(expiresAt).toUTCString()}`);
}

function clearAdminSessionCookie(res) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader('Set-Cookie', `pikquik_admin_session=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`);
}

function slugifyId(value, fallback = 'brand') {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
  let candidate = base;
  let counter = 2;
  while (brands.some((brand) => brand.id === candidate) || outlets.some((outlet) => outlet.id === candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }
  return candidate;
}

function renderAdminLoginPage(message = '') {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PikQuik Admin Login</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: "Avenir Next", "Aptos", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4efe6; color: #171411; }
      form { width: min(420px, calc(100vw - 32px)); background: #fffdf8; border: 1px solid #ddd1bf; border-radius: 22px; box-shadow: 0 20px 50px rgba(28, 21, 12, 0.08); padding: 28px; box-sizing: border-box; }
      h1 { margin: 0 0 8px; font-family: Georgia, serif; font-size: 34px; line-height: 1; }
      p { margin: 0 0 22px; color: #6f675d; line-height: 1.5; }
      label { display: block; margin: 14px 0 8px; font-weight: 700; font-size: 14px; }
      input { width: 100%; box-sizing: border-box; border: 1px solid #ddd1bf; border-radius: 14px; padding: 13px 14px; font: inherit; }
      button { width: 100%; margin-top: 20px; min-height: 46px; border: 0; border-radius: 999px; background: #0a6f5c; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
      a { color: #0a6f5c; font-weight: 700; text-decoration: none; }
      .alt { margin: 18px 0 0; text-align: center; font-size: 14px; }
      .error { background: #fff0ef; color: #b1261d; border: 1px solid rgba(177, 38, 29, 0.18); border-radius: 14px; padding: 12px 14px; margin-bottom: 16px; }
    </style>
  </head>
  <body>
    <form method="post" action="/admin/login">
      <h1>Admin Login</h1>
      <p>Sign in with your platform or brand admin account.</p>
      ${message ? `<div class="error">${escapeHtml(message)}</div>` : ''}
      <label for="email">Email</label>
      <input id="email" name="email" type="text" autocomplete="username" required />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Sign in</button>
      ${ADMIN_SIGNUP_ENABLED ? '<p class="alt">New brand? <a href="/admin/signup">Create brand workspace</a></p>' : ''}
    </form>
  </body>
</html>`;
}

function renderAdminSignupPage(message = '') {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Create Brand Workspace</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: "Avenir Next", "Aptos", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4efe6; color: #171411; }
      form { width: min(480px, calc(100vw - 32px)); background: #fffdf8; border: 1px solid #ddd1bf; border-radius: 22px; box-shadow: 0 20px 50px rgba(28, 21, 12, 0.08); padding: 28px; box-sizing: border-box; }
      h1 { margin: 0 0 8px; font-family: Georgia, serif; font-size: 34px; line-height: 1; }
      p { margin: 0 0 22px; color: #6f675d; line-height: 1.5; }
      label { display: block; margin: 14px 0 8px; font-weight: 700; font-size: 14px; }
      input { width: 100%; box-sizing: border-box; border: 1px solid #ddd1bf; border-radius: 14px; padding: 13px 14px; font: inherit; }
      button { width: 100%; margin-top: 20px; min-height: 46px; border: 0; border-radius: 999px; background: #0a6f5c; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
      a { color: #0a6f5c; font-weight: 700; text-decoration: none; }
      .alt { margin: 18px 0 0; text-align: center; font-size: 14px; }
      .error { background: #fff0ef; color: #b1261d; border: 1px solid rgba(177, 38, 29, 0.18); border-radius: 14px; padding: 12px 14px; margin-bottom: 16px; }
    </style>
  </head>
  <body>
    <form method="post" action="/admin/signup">
      <h1>Create Workspace</h1>
      <p>Create a brand workspace and first brand admin account.</p>
      ${message ? `<div class="error">${escapeHtml(message)}</div>` : ''}
      <label for="brandName">Brand name</label>
      <input id="brandName" name="brandName" type="text" autocomplete="organization" required />
      <label for="tagLine">Tag line</label>
      <input id="tagLine" name="tagLine" type="text" placeholder="Order ahead. Pay online. Pick up fast." required />
      <label for="appUrl">Customer app URL</label>
      <input id="appUrl" name="appUrl" type="url" placeholder="https://brand.pikquik.com" required />
      <label for="name">Your name</label>
      <input id="name" name="name" type="text" autocomplete="name" required />
      <label for="email">Admin email</label>
      <input id="email" name="email" type="email" autocomplete="username" required />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="new-password" minlength="10" required />
      <button type="submit">Create brand workspace</button>
      <p class="alt">Already have an account? <a href="/admin/login">Sign in</a></p>
    </form>
    <script>
      const brandNameInput = document.getElementById('brandName');
      const appUrlInput = document.getElementById('appUrl');

      function slugifySubdomain(value) {
        return String(value || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }

      function suggestedAppUrl(value) {
        const subdomain = slugifySubdomain(value);
        return subdomain ? 'https://' + subdomain + '.pikquik.com' : '';
      }

      function isAutoSuggestedUrl(value) {
        return /^https:\\/\\/[a-z0-9-]+\\.pikquik\\.com$/i.test(String(value || '').trim());
      }

      brandNameInput.addEventListener('input', () => {
        const nextUrl = suggestedAppUrl(brandNameInput.value);
        if (nextUrl && (!appUrlInput.value.trim() || isAutoSuggestedUrl(appUrlInput.value))) {
          appUrlInput.value = nextUrl;
        }
      });
    </script>
  </body>
</html>`;
}

function createBrandWorkspace({ brandName, tagLine, appUrl, adminName, email, password }) {
  const normalizedBrandName = String(brandName || '').trim();
  const normalizedTagLine = String(tagLine || '').trim();
  const normalizedAppUrl = String(appUrl || '').trim().replace(/\/+$/, '');
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = String(password || '').trim();
  if (!normalizedBrandName) throw new Error('Brand name is required');
  if (!normalizedTagLine) throw new Error('Tag line is required');
  if (!normalizedAppUrl) throw new Error('Customer app URL is required');
  try {
    const parsedAppUrl = new URL(normalizedAppUrl);
    if (!['http:', 'https:'].includes(parsedAppUrl.protocol)) {
      throw new Error('invalid protocol');
    }
  } catch (error) {
    throw new Error('Customer app URL must be a valid http or https URL');
  }
  if (!normalizedEmail) throw new Error('Admin email is required');
  if (normalizedPassword.length < 10) throw new Error('Password must be at least 10 characters');
  if (adminUsers.some((user) => user.email === normalizedEmail)) throw new Error('An admin account already exists for this email');

  const brandId = slugifyId(normalizedBrandName, 'brand');
  const now = new Date().toISOString();
  const brand = normalizeBrands([{
    id: brandId,
    name: normalizedBrandName,
    customerAppBaseUrl: normalizedAppUrl,
    petpoojaConnectionId: '',
    paymentConnectionId: '',
    whatsappConnectionId: '',
    heroEyebrow: normalizedBrandName,
    heroTitle: normalizedTagLine,
    heroSubtitle: 'Place your order, pay online, and collect it with your pickup code.',
    logoText: normalizedBrandName,
    logoUrl: '',
    primaryColor: '#007a63',
    accentColor: '#ffd84d',
    accentTextColor: '#202020',
    backgroundColor: '#fffaf0',
    surfaceColor: '#ffffff'
  }])[0];
  const user = normalizeAdminUser({
    id: `admin_${nanoid(10)}`,
    email: normalizedEmail,
    name: String(adminName || normalizedEmail).trim(),
    role: ADMIN_ROLES.BRAND_ADMIN,
    status: 'ACTIVE',
    brandIds: [brandId],
    outletIds: [],
    passwordHash: hashAdminPassword(normalizedPassword),
    createdAt: now,
    updatedAt: now
  }, adminUsers.length);

  brands = [...brands, brand];
  adminUsers = [...adminUsers, user];
  persistBrands(brands);
  persistAdminUsers(adminUsers);
  return { brand, user };
}

app.use(express.urlencoded({ extended: false }));

app.get('/admin/login', (req, res) => {
  if (!adminUsers.length && !ADMIN_AUTH_TOKEN && ADMIN_SIGNUP_ENABLED) {
    res.redirect('/admin/signup');
    return;
  }
  if (getAdminUserForRequest(req)) {
    res.redirect('/admin/menu');
    return;
  }
  res.type('html').send(renderAdminLoginPage());
});

app.post('/admin/login', (req, res) => {
  try {
    const user = verifyAdminLogin(req.body?.email, req.body?.password);
    if (!user) {
      res.status(401).type('html').send(renderAdminLoginPage('Invalid email or password'));
      return;
    }
    const session = createAdminSession(user.id);
    setAdminSessionCookie(res, session.token, session.expiresAt);
    res.redirect('/admin/menu');
  } catch (error) {
    res.status(401).json({ error: 'Admin authentication required' });
  }
});

app.get('/admin/signup', (req, res) => {
  if (!ADMIN_SIGNUP_ENABLED) {
    res.status(404).send('Signup is not enabled');
    return;
  }
  if (getAdminUserForRequest(req)) {
    res.redirect('/admin/menu');
    return;
  }
  res.type('html').send(renderAdminSignupPage());
});

app.post('/admin/signup', (req, res) => {
  if (!ADMIN_SIGNUP_ENABLED) {
    res.status(404).send('Signup is not enabled');
    return;
  }
  try {
    const { user } = createBrandWorkspace({
      brandName: req.body?.brandName,
      tagLine: req.body?.tagLine,
      appUrl: req.body?.appUrl,
      adminName: req.body?.name,
      email: req.body?.email,
      password: req.body?.password
    });
    const session = createAdminSession(user.id);
    setAdminSessionCookie(res, session.token, session.expiresAt);
    res.redirect('/admin/menu');
  } catch (error) {
    res.status(400).type('html').send(renderAdminSignupPage(error.message));
  }
});

app.post('/admin/logout', (req, res) => {
  const token = getAdminSessionToken(req);
  if (token) {
    adminSessions.delete(token);
    persistAdminSessions();
  }
  clearAdminSessionCookie(res);
  res.redirect('/admin/login');
});

app.use(['/admin', '/api/admin'], requireAdminAuth);

const sessions = new Map();
const orders = new Map();

const defaultBrands = [
  {
    id: 'showcase',
    name: 'PikQuik Showcase',
    customerAppBaseUrl: process.env.FRONTEND_BASE_URL || '',
    petpoojaConnectionId: '',
    paymentConnectionId: '',
    whatsappConnectionId: '',
    heroEyebrow: 'Multi-brand pickup commerce',
    heroTitle: 'Order ahead. Pay online. Pick up fast.',
    heroSubtitle: 'Launch branded ordering, payments, and WhatsApp re-engagement from one operating layer.',
    logoText: 'PikQuik',
    logoUrl: '',
    primaryColor: '#007a63',
    accentColor: '#ffd84d',
    accentTextColor: '#202020',
    backgroundColor: '#fffaf0',
    surfaceColor: '#ffffff'
  }
];

const defaultOutlets = [
  {
    id: 'showcase_hq',
    brandId: 'showcase',
    petpoojaConnectionId: '',
    paymentConnectionId: '',
    whatsappConnectionId: '',
    name: 'Showcase HQ',
    status: 'ACTIVE',
    pickupLabel: 'Pickup counter',
    address: 'Bangalore, India',
    latitude: 12.9783,
    longitude: 77.6634,
    locationKeywords: ['showcase', 'demo', 'hq', 'bangalore'],
    timezone: 'Asia/Kolkata',
    paymentProvider: 'Generic',
    paymentMode: 'payment_link',
    petpoojaOutletId: 'PP_OUTLET_SHOWCASE_HQ',
    supportPhone: '+91-9000000001'
  }
];
const defaultPetpoojaConnections = [];
const defaultPaymentConnection = {
  id: '',
  name: 'Primary Payment Connector',
  provider: 'RAZORPAY',
  status: 'ACTIVE',
  apiKey: '',
  apiSecret: '',
  webhookSecret: '',
  accountId: '',
  paymentMode: 'payment_link'
};
const defaultPaymentConnections = [];
const defaultWhatsAppConnection = {
  id: '',
  name: 'Primary WhatsApp Connector',
  status: 'ACTIVE',
  businessAccountId: '',
  phoneNumber: '',
  phoneNumberId: '',
  verifyToken: '',
  accessToken: '',
  graphVersion: 'v25.0',
  orderNotificationRecipients: ''
};
const defaultWhatsAppConnections = [];

const ADMIN_ROLES = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  BRAND_ADMIN: 'BRAND_ADMIN',
  OUTLET_MANAGER: 'OUTLET_MANAGER'
};
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function hashAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 210000;
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2:${iterations}:${salt}:${hash}`;
}

function verifyAdminPassword(password, storedHash) {
  const parts = String(storedHash || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, iterationsValue, salt, expectedHash] = parts;
  const iterations = Number(iterationsValue);
  if (!Number.isFinite(iterations) || !salt || !expectedHash) return false;
  const actualHash = crypto.pbkdf2Sync(String(password || ''), salt, iterations, 32, 'sha256').toString('hex');
  return timingSafeStringEqual(actualHash, expectedHash);
}

function normalizeAdminUser(user, index = 0) {
  const source = user && typeof user === 'object' ? user : {};
  const role = String(source.role || ADMIN_ROLES.BRAND_ADMIN).trim().toUpperCase();
  const normalized = {
    id: String(source.id || '').trim() || `admin_user_${index + 1}`,
    email: String(source.email || source.username || '').trim().toLowerCase(),
    name: String(source.name || source.email || source.username || '').trim(),
    role: Object.values(ADMIN_ROLES).includes(role) ? role : ADMIN_ROLES.BRAND_ADMIN,
    status: String(source.status || 'ACTIVE').trim().toUpperCase(),
    brandIds: Array.isArray(source.brandIds) ? source.brandIds.map((value) => String(value).trim()).filter(Boolean) : [],
    outletIds: Array.isArray(source.outletIds) ? source.outletIds.map((value) => String(value).trim()).filter(Boolean) : [],
    passwordHash: String(source.passwordHash || '').trim(),
    createdAt: String(source.createdAt || new Date().toISOString()).trim(),
    updatedAt: String(source.updatedAt || source.createdAt || new Date().toISOString()).trim()
  };

  if (!normalized.email) throw new Error(`Admin user at index ${index} is missing email`);
  if (!normalized.passwordHash) throw new Error(`Admin user ${normalized.email} is missing password hash`);
  if (!['ACTIVE', 'INACTIVE'].includes(normalized.status)) {
    throw new Error(`Admin user ${normalized.email} has invalid status`);
  }

  return normalized;
}

function normalizeAdminUsers(rawUsers) {
  if (!Array.isArray(rawUsers)) {
    throw new Error('Admin users must be an array');
  }

  const seenEmails = new Set();
  return rawUsers.map((user, index) => {
    const normalized = normalizeAdminUser(user, index);
    if (seenEmails.has(normalized.email)) {
      throw new Error(`Duplicate admin user email: ${normalized.email}`);
    }
    seenEmails.add(normalized.email);
    return normalized;
  });
}

function buildSeedAdminUsers() {
  if (!ADMIN_SEED_EMAIL || !ADMIN_SEED_PASSWORD) return [];
  return normalizeAdminUsers([{
    id: `admin_${ADMIN_SEED_EMAIL.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'platform'}`,
    email: ADMIN_SEED_EMAIL,
    name: 'Platform Admin',
    role: ADMIN_ROLES.PLATFORM_ADMIN,
    status: 'ACTIVE',
    brandIds: [],
    outletIds: [],
    passwordHash: hashAdminPassword(ADMIN_SEED_PASSWORD),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }]);
}

function loadAdminUsersFromDisk() {
  try {
    const raw = readFileSync(adminUsersFile, 'utf8');
    return normalizeAdminUsers(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to load admin users, using seed users instead.', error.message);
    }
    const seedUsers = buildSeedAdminUsers();
    if (seedUsers.length) {
      persistAdminUsers(seedUsers);
    }
    return seedUsers;
  }
}

function persistAdminUsers(nextUsers = adminUsers) {
  mkdirSync(path.dirname(adminUsersFile), { recursive: true });
  writeFileSync(adminUsersFile, JSON.stringify(nextUsers, null, 2));
}

function normalizeAdminSession(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  return {
    token: String(source.token || '').trim(),
    userId: String(source.userId || '').trim(),
    createdAt: String(source.createdAt || new Date().toISOString()).trim(),
    expiresAt: String(source.expiresAt || '').trim()
  };
}

function loadAdminSessionsFromDisk() {
  try {
    const raw = readFileSync(adminSessionsFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Admin sessions must be an array');
    const now = new Date().toISOString();
    return new Map(parsed
      .map(normalizeAdminSession)
      .filter((session) => session.token && session.userId && session.expiresAt.localeCompare(now) > 0)
      .map((session) => [session.token, session]));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to load admin sessions, using empty sessions instead.', error.message);
    }
    return new Map();
  }
}

function persistAdminSessions() {
  mkdirSync(path.dirname(adminSessionsFile), { recursive: true });
  writeFileSync(adminSessionsFile, JSON.stringify([...adminSessions.values()], null, 2));
}

function getAdminUser(userId) {
  return adminUsers.find((user) => user.id === userId) || null;
}

function getPlatformSystemAdmin() {
  return {
    id: 'platform_api_token',
    email: 'platform-api-token',
    name: 'Platform API Token',
    role: ADMIN_ROLES.PLATFORM_ADMIN,
    status: 'ACTIVE',
    brandIds: [],
    outletIds: []
  };
}

function verifyAdminLogin(email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = adminUsers.find((candidate) => candidate.email === normalizedEmail);
  if (!user || user.status !== 'ACTIVE') return null;
  if (!verifyAdminPassword(password, user.passwordHash)) return null;
  return user;
}

function createAdminSession(userId) {
  const token = nanoid(48);
  const session = {
    token,
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString()
  };
  adminSessions.set(token, session);
  persistAdminSessions();
  return session;
}

function isPlatformAdmin(user) {
  return user?.role === ADMIN_ROLES.PLATFORM_ADMIN;
}

function getAuthorizedBrandIds(user) {
  if (isPlatformAdmin(user)) return brands.map((brand) => brand.id);
  const brandIds = new Set(Array.isArray(user?.brandIds) ? user.brandIds : []);
  (Array.isArray(user?.outletIds) ? user.outletIds : []).forEach((outletId) => {
    const outlet = outlets.find((item) => item.id === outletId);
    if (outlet?.brandId) brandIds.add(outlet.brandId);
  });
  return [...brandIds];
}

function getAuthorizedOutletIds(user) {
  if (isPlatformAdmin(user)) return outlets.map((outlet) => outlet.id);
  const brandIds = new Set(getAuthorizedBrandIds(user));
  const outletIds = new Set(Array.isArray(user?.outletIds) ? user.outletIds : []);
  outlets.forEach((outlet) => {
    if (brandIds.has(outlet.brandId)) outletIds.add(outlet.id);
  });
  return [...outletIds];
}

function canAccessBrand(user, brandId) {
  if (isPlatformAdmin(user)) return true;
  return getAuthorizedBrandIds(user).includes(String(brandId || '').trim());
}

function canAccessOutlet(user, outletId) {
  if (isPlatformAdmin(user)) return true;
  return getAuthorizedOutletIds(user).includes(String(outletId || '').trim());
}

function getScopedBrandsForAdmin(user) {
  const authorizedBrandIds = new Set(getAuthorizedBrandIds(user));
  return brands.filter((brand) => authorizedBrandIds.has(brand.id));
}

function getScopedOutletsForAdmin(user) {
  const authorizedOutletIds = new Set(getAuthorizedOutletIds(user));
  return outlets.filter((outlet) => authorizedOutletIds.has(outlet.id));
}

function sanitizeAdminUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    brandIds: user.brandIds || [],
    outletIds: user.outletIds || [],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function sanitizePetpoojaConnection(connection) {
  return {
    ...connection,
    accessToken: '',
    appKey: '',
    appSecret: ''
  };
}

function sanitizePaymentConnection(connection) {
  return {
    ...connection,
    apiKey: '',
    apiSecret: '',
    webhookSecret: ''
  };
}

function sanitizeWhatsAppConnection(connection) {
  return {
    ...connection,
    verifyToken: '',
    accessToken: ''
  };
}

function replaceAdminUsers(nextUsers, { persist = true } = {}) {
  const normalizedUsers = normalizeAdminUsers(nextUsers);
  if (!normalizedUsers.some((user) => user.role === ADMIN_ROLES.PLATFORM_ADMIN && user.status === 'ACTIVE')) {
    throw new Error('At least one active platform admin is required');
  }
  adminUsers = normalizedUsers;
  if (persist) persistAdminUsers(normalizedUsers);
  return normalizedUsers;
}

function upsertAdminUsersFromPayload(rawUsers) {
  if (!Array.isArray(rawUsers)) {
    throw new Error('Admin users must be an array');
  }

  const existingById = new Map(adminUsers.map((user) => [user.id, user]));
  const now = new Date().toISOString();
  const nextUsers = rawUsers.map((rawUser, index) => {
    const id = String(rawUser?.id || '').trim() || `admin_${nanoid(10)}`;
    const existing = existingById.get(id);
    const password = String(rawUser?.password || '').trim();
    if (!existing && !password) {
      throw new Error(`Password is required for new admin user at index ${index}`);
    }
    return {
      id,
      email: String(rawUser?.email || existing?.email || '').trim().toLowerCase(),
      name: String(rawUser?.name || existing?.name || rawUser?.email || '').trim(),
      role: String(rawUser?.role || existing?.role || ADMIN_ROLES.BRAND_ADMIN).trim().toUpperCase(),
      status: String(rawUser?.status || existing?.status || 'ACTIVE').trim().toUpperCase(),
      brandIds: Array.isArray(rawUser?.brandIds) ? rawUser.brandIds : (existing?.brandIds || []),
      outletIds: Array.isArray(rawUser?.outletIds) ? rawUser.outletIds : (existing?.outletIds || []),
      passwordHash: password ? hashAdminPassword(password) : existing.passwordHash,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
  });
  return replaceAdminUsers(nextUsers);
}

const defaultMenu = [
  {
    id: 'rajma_bowl',
    petpoojaItemId: 'PP_RAJMA_BOWL',
    name: 'Rajma Bowl',
    description: 'Rajma, rice, lachha onions and salad.',
    price: 130,
    category: 'Lunch Bowls',
    image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80',
    available: true
  },
  {
    id: 'mexican_rice_bowl',
    petpoojaItemId: 'PP_MEXICAN_RICE_BOWL',
    name: 'Mexican Rice Bowl',
    description: 'Mexican rice, chilli beans, hung curd and salad.',
    price: 130,
    category: 'Lunch Bowls',
    image: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80',
    available: true
  },
  {
    id: 'veg_fried_rice',
    petpoojaItemId: 'PP_VEG_FRIED_RICE',
    name: 'Veg Fried Rice',
    description: 'Fried rice with black bean sauce and salad.',
    price: 130,
    category: 'Lunch Bowls',
    image: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=800&q=80',
    available: true
  },
  {
    id: 'bisi_bele_bath',
    petpoojaItemId: 'PP_BISI_BELE_BATH',
    name: 'Bisi Bele Bath',
    description: 'Classic South Indian rice bowl with khara boondi and raitha.',
    price: 100,
    category: 'South Indian Classics',
    image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=800&q=80',
    available: true
  },
  {
    id: 'chilli_corn',
    petpoojaItemId: 'PP_CHILLI_CORN',
    name: 'Tossed Chilli Corn',
    description: 'Sweet corn tossed with chilli, herbs and spices.',
    price: 80,
    category: 'Sides',
    image: 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?auto=format&fit=crop&w=800&q=80',
    available: true
  }
];
const SAMPLE_CSV_HEADERS = ['Item Name', 'Description', 'Price', 'Category'];
const SAMPLE_CSV_TEXT = [
  SAMPLE_CSV_HEADERS.join(','),
  'Filter Coffee,"Strong, rich South Indian filter coffee",60,Beverages',
  'Masala Tea,Spiced chai with milk,40,Beverages'
].join('\n');
const DEFAULT_PETPOOJA_API_BASE_URL = 'https://api.petpooja.com';
const ORDER_FLOW = {
  SESSION_CREATED: 'SESSION_CREATED',
  WHATSAPP_INITIATED: 'WHATSAPP_INITIATED',
  OUTLET_RESOLVED: 'OUTLET_RESOLVED',
  MENU_SHARED: 'MENU_SHARED',
  CHECKOUT_CREATED: 'CHECKOUT_CREATED',
  PAYMENT_LINK_CREATED: 'PAYMENT_LINK_CREATED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  PETPOOJA_SYNC_PENDING: 'PETPOOJA_SYNC_PENDING',
  PETPOOJA_SYNCED: 'PETPOOJA_SYNCED',
  PETPOOJA_SYNC_FAILED: 'PETPOOJA_SYNC_FAILED',
  PICKUP_CODE_SENT: 'PICKUP_CODE_SENT',
  PICKUP_VERIFIED: 'PICKUP_VERIFIED',
  PAYMENT_FAILED: 'PAYMENT_FAILED'
};
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const rawOutletId = String(req.query?.outletId || getDefaultOutletId()).trim();
      const safeOutletId = rawOutletId.replace(/[^a-zA-Z0-9_-]/g, '_') || getDefaultOutletId();
      const outletUploadDir = path.join(UPLOAD_DIR, safeOutletId);
      mkdirSync(outletUploadDir, { recursive: true });
      cb(null, outletUploadDir);
    },
    filename: (req, file, cb) => {
      const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${nanoid(8)}${extension}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image uploads are allowed'));
      return;
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

let brands = loadBrandsFromDisk();
let petpoojaConnections = loadPetpoojaConnectionsFromDisk();
let paymentConnections = loadPaymentConnectionsFromDisk();
let outlets = loadOutletsFromDisk();
let menusByOutlet = loadMenusFromDisk();
let uploadedImagesByOutlet = loadUploadedImagesFromDisk();
let auditLogsByOutlet = loadAuditLogsFromDisk();
let whatsappEvents = loadWhatsAppEventsFromDisk();
let whatsappCampaigns = loadWhatsAppCampaignsFromDisk();
let whatsappConnections = loadWhatsAppConnectionsFromDisk();
let adminUsers = loadAdminUsersFromDisk();
let adminSessions = loadAdminSessionsFromDisk();
loadRuntimeStoresFromDisk();

function normalizeBrands(rawBrands) {
  if (!Array.isArray(rawBrands) || rawBrands.length === 0) {
    throw new Error('Brands must be a non-empty array');
  }

  const seenIds = new Set();
  return rawBrands.map((brand, index) => {
    if (!brand || typeof brand !== 'object') {
      throw new Error(`Brand at index ${index} must be an object`);
    }

    const normalizedBrand = {
      id: String(brand.id || '').trim(),
      name: String(brand.name || '').trim(),
      customerAppBaseUrl: String(brand.customerAppBaseUrl || '').trim().replace(/\/+$/, ''),
      petpoojaConnectionId: String(brand.petpoojaConnectionId || '').trim(),
      paymentConnectionId: String(brand.paymentConnectionId || '').trim(),
      whatsappConnectionId: String(brand.whatsappConnectionId || '').trim(),
      heroEyebrow: String(brand.heroEyebrow || brand.name || '').trim(),
      heroTitle: String(brand.heroTitle || 'Order ahead, pick up faster').trim(),
      heroSubtitle: String(brand.heroSubtitle || 'Place your order, pay online, and collect it with your pickup code.').trim(),
      logoText: String(brand.logoText || brand.name || '').trim(),
      logoUrl: String(brand.logoUrl || '').trim(),
      primaryColor: String(brand.primaryColor || '#007a63').trim(),
      accentColor: String(brand.accentColor || '#ffd84d').trim(),
      accentTextColor: String(brand.accentTextColor || '#202020').trim(),
      backgroundColor: String(brand.backgroundColor || '#fffaf0').trim(),
      surfaceColor: String(brand.surfaceColor || '#ffffff').trim()
    };

    if (!normalizedBrand.id) throw new Error(`Brand at index ${index} is missing id`);
    if (seenIds.has(normalizedBrand.id)) throw new Error(`Duplicate brand id: ${normalizedBrand.id}`);
    if (!normalizedBrand.name) throw new Error(`Brand ${normalizedBrand.id} is missing name`);
    if (!normalizedBrand.customerAppBaseUrl) throw new Error(`Brand ${normalizedBrand.id} is missing customer app URL`);
    if (!normalizedBrand.heroTitle) throw new Error(`Brand ${normalizedBrand.id} is missing tag line`);

    seenIds.add(normalizedBrand.id);
    return normalizedBrand;
  });
}

function normalizeOutlets(rawOutlets) {
  if (!Array.isArray(rawOutlets) || rawOutlets.length === 0) {
    throw new Error('Outlets must be a non-empty array');
  }

  const seenIds = new Set();
  return rawOutlets.map((outlet, index) => {
    if (!outlet || typeof outlet !== 'object') {
      throw new Error(`Outlet at index ${index} must be an object`);
    }

    const normalizedOutlet = {
      id: String(outlet.id || '').trim(),
      brandId: String(outlet.brandId || defaultBrands[0]?.id || '').trim(),
      petpoojaConnectionId: String(outlet.petpoojaConnectionId || '').trim(),
      paymentConnectionId: String(outlet.paymentConnectionId || '').trim(),
      whatsappConnectionId: String(outlet.whatsappConnectionId || '').trim(),
      name: String(outlet.name || '').trim(),
      status: String(outlet.status || 'ACTIVE').trim().toUpperCase(),
      pickupLabel: String(outlet.pickupLabel || '').trim(),
      address: String(outlet.address || '').trim(),
      customerAppBaseUrl: String(outlet.customerAppBaseUrl || '').trim().replace(/\/+$/, ''),
      latitude: outlet.latitude === '' || outlet.latitude == null ? null : Number(outlet.latitude),
      longitude: outlet.longitude === '' || outlet.longitude == null ? null : Number(outlet.longitude),
      locationKeywords: Array.isArray(outlet.locationKeywords)
        ? outlet.locationKeywords.map((value) => String(value).trim()).filter(Boolean)
        : String(outlet.locationKeywords || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
      timezone: String(outlet.timezone || 'Asia/Kolkata').trim(),
      paymentProvider: String(outlet.paymentProvider || 'Generic').trim(),
      paymentMode: String(outlet.paymentMode || 'payment_link').trim(),
      petpoojaOutletId: String(outlet.petpoojaOutletId || '').trim(),
      petpoojaRestaurantId: String(outlet.petpoojaRestaurantId || '').trim(),
      supportPhone: String(outlet.supportPhone || '').trim()
    };

    if (!normalizedOutlet.id) throw new Error(`Outlet at index ${index} is missing id`);
    if (seenIds.has(normalizedOutlet.id)) throw new Error(`Duplicate outlet id: ${normalizedOutlet.id}`);
    if (!normalizedOutlet.brandId) throw new Error(`Outlet ${normalizedOutlet.id} is missing brand id`);
    if (!normalizedOutlet.name) throw new Error(`Outlet ${normalizedOutlet.id} is missing name`);
    if (!getBrand(normalizedOutlet.brandId)) throw new Error(`Outlet ${normalizedOutlet.id} references unknown brand ${normalizedOutlet.brandId}`);
    if (!['ACTIVE', 'INACTIVE'].includes(normalizedOutlet.status)) {
      throw new Error(`Outlet ${normalizedOutlet.id} has invalid status`);
    }
    if ((normalizedOutlet.latitude !== null && !Number.isFinite(normalizedOutlet.latitude)) ||
      (normalizedOutlet.longitude !== null && !Number.isFinite(normalizedOutlet.longitude))) {
      throw new Error(`Outlet ${normalizedOutlet.id} has invalid coordinates`);
    }

    seenIds.add(normalizedOutlet.id);
    return normalizedOutlet;
  });
}

function loadBrandsFromDisk() {
  try {
    const raw = readFileSync(BRANDS_FILE, 'utf8');
    return normalizeBrands(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to load brands file, using defaults instead.', error.message);
    }
    persistBrands(defaultBrands);
    return normalizeBrands(defaultBrands);
  }
}

function persistBrands(nextBrands) {
  mkdirSync(path.dirname(BRANDS_FILE), { recursive: true });
  writeFileSync(BRANDS_FILE, JSON.stringify(nextBrands, null, 2));
}

function getEncryptionKeyBuffer() {
  if (!APP_ENCRYPTION_KEY) return null;
  return crypto.createHash('sha256').update(APP_ENCRYPTION_KEY).digest();
}

function encryptStoredSecret(value) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return '';

  const key = getEncryptionKeyBuffer();
  if (!key) {
    throw new Error('APP_ENCRYPTION_KEY must be configured before saving Petpooja credentials');
  }

  if (normalizedValue.startsWith('enc::')) return normalizedValue;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(normalizedValue, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc::${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptStoredSecret(value) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return '';
  if (!normalizedValue.startsWith('enc::')) return normalizedValue;

  const key = getEncryptionKeyBuffer();
  if (!key) {
    throw new Error('APP_ENCRYPTION_KEY is required to read encrypted Petpooja credentials');
  }

  const parts = normalizedValue.replace(/^enc::/, '').split(':');
  if (parts.length !== 3) {
    throw new Error('Stored Petpooja credential is malformed');
  }

  const [ivBase64, tagBase64, encryptedBase64] = parts;
  const iv = Buffer.from(ivBase64, 'base64');
  const tag = Buffer.from(tagBase64, 'base64');
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

function normalizePetpoojaConnection(rawConnection, index = 0) {
  if (!rawConnection || typeof rawConnection !== 'object') {
    throw new Error(`Petpooja connection at index ${index} must be an object`);
  }

  const normalizedConnection = {
    id: String(rawConnection.id || '').trim(),
    name: String(rawConnection.name || '').trim(),
    apiBaseUrl: String(rawConnection.apiBaseUrl || DEFAULT_PETPOOJA_API_BASE_URL).trim().replace(/\/+$/, ''),
    accessToken: '',
    appKey: '',
    appSecret: '',
    restaurantId: String(rawConnection.restaurantId || '').trim(),
    status: String(rawConnection.status || 'ACTIVE').trim().toUpperCase(),
    lastSyncAt: String(rawConnection.lastSyncAt || '').trim(),
    lastError: String(rawConnection.lastError || '').trim()
  };

  try {
    normalizedConnection.accessToken = decryptStoredSecret(rawConnection.accessToken);
    normalizedConnection.appKey = decryptStoredSecret(rawConnection.appKey);
    normalizedConnection.appSecret = decryptStoredSecret(rawConnection.appSecret);
  } catch (error) {
    normalizedConnection.lastError = error.message;
  }

  if (!normalizedConnection.id) throw new Error(`Petpooja connection at index ${index} is missing id`);
  if (!normalizedConnection.name) throw new Error(`Petpooja connection ${normalizedConnection.id} is missing name`);
  if (!['ACTIVE', 'INACTIVE'].includes(normalizedConnection.status)) {
    throw new Error(`Petpooja connection ${normalizedConnection.id} has invalid status`);
  }

  return normalizedConnection;
}

function normalizePetpoojaConnections(rawConnections) {
  if (!Array.isArray(rawConnections)) {
    throw new Error('Petpooja connections must be an array');
  }

  const seenIds = new Set();
  return rawConnections.map((connection, index) => {
    const normalizedConnection = normalizePetpoojaConnection(connection, index);
    if (seenIds.has(normalizedConnection.id)) {
      throw new Error(`Duplicate Petpooja connection id: ${normalizedConnection.id}`);
    }
    seenIds.add(normalizedConnection.id);
    return normalizedConnection;
  });
}

function serializePetpoojaConnection(connection) {
  return {
    id: connection.id,
    name: connection.name,
    apiBaseUrl: connection.apiBaseUrl,
    accessToken: encryptStoredSecret(connection.accessToken),
    appKey: encryptStoredSecret(connection.appKey),
    appSecret: encryptStoredSecret(connection.appSecret),
    restaurantId: connection.restaurantId,
    status: connection.status,
    lastSyncAt: connection.lastSyncAt || '',
    lastError: connection.lastError || ''
  };
}

function loadPetpoojaConnectionsFromDisk() {
  try {
    const raw = readFileSync(petpoojaConnectionsFile, 'utf8');
    return normalizePetpoojaConnections(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to load Petpooja connections file, using defaults instead.', error.message);
    }
    persistPetpoojaConnections(defaultPetpoojaConnections);
    return normalizePetpoojaConnections(defaultPetpoojaConnections);
  }
}

function persistPetpoojaConnections(nextConnections) {
  mkdirSync(path.dirname(petpoojaConnectionsFile), { recursive: true });
  writeFileSync(
    petpoojaConnectionsFile,
    JSON.stringify(nextConnections.map((connection) => serializePetpoojaConnection(connection)), null, 2)
  );
}

function normalizePaymentConnection(rawConnection, index = 0) {
  if (!rawConnection || typeof rawConnection !== 'object') {
    throw new Error(`Payment connector at index ${index} must be an object`);
  }

  const normalizedConnection = {
    id: String(rawConnection.id || '').trim() || `payment_connector_${index + 1}`,
    name: String(rawConnection.name || defaultPaymentConnection.name).trim(),
    provider: String(rawConnection.provider || defaultPaymentConnection.provider).trim().toUpperCase(),
    status: String(rawConnection.status || defaultPaymentConnection.status).trim().toUpperCase(),
    apiKey: '',
    apiSecret: '',
    webhookSecret: '',
    accountId: String(rawConnection.accountId || '').trim(),
    paymentMode: String(rawConnection.paymentMode || defaultPaymentConnection.paymentMode).trim(),
    lastError: String(rawConnection.lastError || '').trim()
  };

  try {
    normalizedConnection.apiKey = decryptStoredSecret(rawConnection.apiKey || rawConnection.keyId);
    normalizedConnection.apiSecret = decryptStoredSecret(rawConnection.apiSecret || rawConnection.keySecret);
    normalizedConnection.webhookSecret = decryptStoredSecret(rawConnection.webhookSecret);
  } catch (error) {
    normalizedConnection.lastError = error.message;
  }

  if (!normalizedConnection.name) throw new Error(`Payment connector ${normalizedConnection.id} is missing name`);
  if (!['RAZORPAY', 'CASHFREE', 'PHONEPE', 'PAYU', 'STRIPE', 'GENERIC'].includes(normalizedConnection.provider)) {
    throw new Error(`Payment connector ${normalizedConnection.id} has invalid provider`);
  }
  if (!['ACTIVE', 'INACTIVE'].includes(normalizedConnection.status)) {
    throw new Error(`Payment connector ${normalizedConnection.id} has invalid status`);
  }

  return normalizedConnection;
}

function normalizePaymentConnections(rawConnections) {
  if (!Array.isArray(rawConnections)) {
    throw new Error('Payment connectors must be an array');
  }

  const seenIds = new Set();
  return rawConnections.map((connection, index) => {
    const normalizedConnection = normalizePaymentConnection(connection, index);
    if (seenIds.has(normalizedConnection.id)) {
      throw new Error(`Duplicate payment connector id: ${normalizedConnection.id}`);
    }
    seenIds.add(normalizedConnection.id);
    return normalizedConnection;
  });
}

function serializePaymentConnection(connection) {
  return {
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    status: connection.status,
    apiKey: encryptStoredSecret(connection.apiKey),
    apiSecret: encryptStoredSecret(connection.apiSecret),
    webhookSecret: encryptStoredSecret(connection.webhookSecret),
    accountId: connection.accountId,
    paymentMode: connection.paymentMode,
    lastError: connection.lastError || ''
  };
}

function loadPaymentConnectionsFromDisk() {
  try {
    const raw = readFileSync(paymentConnectionsFile, 'utf8');
    return normalizePaymentConnections(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to load payment connectors file, using defaults instead.', error.message);
    }
    persistPaymentConnections(defaultPaymentConnections);
    return normalizePaymentConnections(defaultPaymentConnections);
  }
}

function persistPaymentConnections(nextConnections) {
  mkdirSync(path.dirname(paymentConnectionsFile), { recursive: true });
  writeFileSync(
    paymentConnectionsFile,
    JSON.stringify(nextConnections.map((connection) => serializePaymentConnection(connection)), null, 2)
  );
}

function normalizeWhatsAppConnection(rawConnection, index = 0) {
  const source = rawConnection && typeof rawConnection === 'object' ? rawConnection : {};
  let accessToken = '';
  let verifyToken = '';
  let lastError = String(source.lastError || '').trim();

  try {
    accessToken = decryptStoredSecret(source.accessToken);
    verifyToken = decryptStoredSecret(source.verifyToken);
  } catch (error) {
    lastError = error.message;
  }

  const normalizedConnection = {
    id: String(source.id || '').trim() || `whatsapp_connector_${index + 1}`,
    name: String(source.name || defaultWhatsAppConnection.name).trim(),
    status: String(source.status || defaultWhatsAppConnection.status).trim().toUpperCase(),
    businessAccountId: String(source.businessAccountId || '').trim(),
    phoneNumber: String(source.phoneNumber || '').trim(),
    phoneNumberId: String(source.phoneNumberId || '').trim(),
    verifyToken,
    accessToken,
    graphVersion: String(source.graphVersion || defaultWhatsAppConnection.graphVersion).trim(),
    orderNotificationRecipients: Array.isArray(source.orderNotificationRecipients)
      ? source.orderNotificationRecipients.map((value) => normalizeWhatsAppRecipient(value)).filter(Boolean).join(',')
      : String(source.orderNotificationRecipients || '').split(',').map((value) => normalizeWhatsAppRecipient(value)).filter(Boolean).join(','),
    lastError
  };

  if (!['ACTIVE', 'INACTIVE'].includes(normalizedConnection.status)) {
    throw new Error('WhatsApp connector status must be ACTIVE or INACTIVE');
  }
  if (!normalizedConnection.name) {
    throw new Error(`WhatsApp connector ${normalizedConnection.id} is missing name`);
  }

  if (!normalizedConnection.graphVersion) {
    normalizedConnection.graphVersion = defaultWhatsAppConnection.graphVersion;
  }

  return normalizedConnection;
}

function normalizeWhatsAppConnections(rawConnections) {
  if (!Array.isArray(rawConnections)) {
    throw new Error('WhatsApp connectors must be an array');
  }

  const seenIds = new Set();
  return rawConnections.map((connection, index) => {
    const normalizedConnection = normalizeWhatsAppConnection(connection, index);
    if (seenIds.has(normalizedConnection.id)) {
      throw new Error(`Duplicate WhatsApp connector id: ${normalizedConnection.id}`);
    }
    seenIds.add(normalizedConnection.id);
    return normalizedConnection;
  });
}

function serializeWhatsAppConnection(connection) {
  return {
    id: connection.id,
    name: connection.name,
    status: connection.status,
    businessAccountId: connection.businessAccountId,
    phoneNumber: connection.phoneNumber,
    phoneNumberId: connection.phoneNumberId,
    verifyToken: encryptStoredSecret(connection.verifyToken),
    accessToken: encryptStoredSecret(connection.accessToken),
    graphVersion: connection.graphVersion,
    orderNotificationRecipients: connection.orderNotificationRecipients || '',
    lastError: connection.lastError || ''
  };
}

function loadWhatsAppConnectionsFromDisk() {
  try {
    const raw = readFileSync(whatsappConnectionsFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return normalizeWhatsAppConnections(parsed);
    }
    if (parsed && typeof parsed === 'object') {
      const migrated = [normalizeWhatsAppConnection({ id: 'primary_whatsapp_connector', ...parsed }, 0)];
      persistWhatsAppConnections(migrated);
      return migrated;
    }
    return [];
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to load WhatsApp connector file, using defaults instead.', error.message);
    }
    persistWhatsAppConnections(defaultWhatsAppConnections);
    return normalizeWhatsAppConnections(defaultWhatsAppConnections);
  }
}

function persistWhatsAppConnections(nextConnections = whatsappConnections) {
  mkdirSync(path.dirname(whatsappConnectionsFile), { recursive: true });
  writeFileSync(whatsappConnectionsFile, JSON.stringify(nextConnections.map((connection) => serializeWhatsAppConnection(connection)), null, 2));
}

function normalizeWhatsAppCampaign(entry, index = 0) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Campaign at index ${index} must be an object`);
  }

  return {
    id: String(entry.id || '').trim() || `campaign_${index + 1}`,
    outletId: String(entry.outletId || '').trim(),
    brandId: String(entry.brandId || '').trim(),
    imageUrl: String(entry.imageUrl || '').trim(),
    caption: String(entry.caption || '').trim(),
    recipients: Array.isArray(entry.recipients)
      ? entry.recipients.map((value) => normalizeWhatsAppRecipient(value)).filter(Boolean)
      : [],
    sentCount: Number(entry.sentCount || 0),
    failedCount: Number(entry.failedCount || 0),
    createdAt: String(entry.createdAt || '').trim() || new Date().toISOString(),
    createdBy: String(entry.createdBy || 'admin-ui').trim()
  };
}

function loadWhatsAppCampaignsFromDisk() {
  try {
    const raw = readFileSync(whatsappCampaignsFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((entry, index) => normalizeWhatsAppCampaign(entry, index)) : [];
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to load WhatsApp campaigns, using empty list instead.', error.message);
    }
    persistWhatsAppCampaigns([]);
    return [];
  }
}

function persistWhatsAppCampaigns(nextCampaigns = whatsappCampaigns) {
  mkdirSync(path.dirname(whatsappCampaignsFile), { recursive: true });
  writeFileSync(whatsappCampaignsFile, JSON.stringify(nextCampaigns, null, 2));
}

function loadOutletsFromDisk() {
  try {
    const raw = readFileSync(OUTLETS_FILE, 'utf8');
    return normalizeOutlets(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to load outlets file, using defaults instead.', error.message);
    }
    persistOutlets(defaultOutlets);
    return normalizeOutlets(defaultOutlets);
  }
}

function persistOutlets(nextOutlets) {
  mkdirSync(path.dirname(OUTLETS_FILE), { recursive: true });
  writeFileSync(OUTLETS_FILE, JSON.stringify(nextOutlets, null, 2));
}

function buildDefaultMenusByOutlet() {
  return Object.fromEntries(outlets.map((outlet) => [outlet.id, defaultMenu]));
}

function loadMenusFromDisk() {
  try {
    const raw = readFileSync(MENU_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const legacyMenus = Object.fromEntries(outlets.map((outlet) => [outlet.id, parsed]));
      persistMenus(legacyMenus);
      return normalizeMenusByOutlet(legacyMenus);
    }
    return normalizeMenusByOutlet(parsed);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to load menu file, using defaults instead.', error.message);
    }
    const defaultMenus = buildDefaultMenusByOutlet();
    persistMenus(defaultMenus);
    return normalizeMenusByOutlet(defaultMenus);
  }
}

function persistMenus(nextMenusByOutlet) {
  mkdirSync(path.dirname(MENU_FILE), { recursive: true });
  writeFileSync(MENU_FILE, JSON.stringify(nextMenusByOutlet, null, 2));
}

function serializeStore(store) {
  return [...store.values()];
}

function loadMapStoreFromDisk(filePath, label) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} store must be an array`);
    }
    return new Map(parsed.map((entry) => [entry.id, entry]));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Failed to load ${label} store, using empty data instead.`, error.message);
    }
    persistMapStore(filePath, new Map());
    return new Map();
  }
}

function persistMapStore(filePath, store) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(serializeStore(store), null, 2));
}

function persistSessions() {
  persistMapStore(sessionsFile, sessions);
}

function persistOrders() {
  persistMapStore(ordersFile, orders);
}

function reloadMap(target, source) {
  target.clear();
  source.forEach((value, key) => {
    target.set(key, value);
  });
}

function loadRuntimeStoresFromDisk() {
  reloadMap(sessions, loadMapStoreFromDisk(sessionsFile, 'session'));
  reloadMap(orders, loadMapStoreFromDisk(ordersFile, 'order'));
}

function normalizeMenu(rawMenu) {
  if (!Array.isArray(rawMenu) || rawMenu.length === 0) {
    throw new Error('Menu must be a non-empty array');
  }

  const seenIds = new Set();
  return rawMenu.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Menu item at index ${index} must be an object`);
    }

    const rawName = String(item.name || '').trim();
    const generatedName = rawName || `Untitled item ${index + 1}`;
    const generatedIdBase = String(item.id || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || generatedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `item_${index + 1}`;
    let generatedId = generatedIdBase;
    let duplicateCounter = 2;
    while (seenIds.has(generatedId)) {
      generatedId = `${generatedIdBase}_${duplicateCounter}`;
      duplicateCounter += 1;
    }

    const rawPrice = Number(item.price);
    const normalizedItem = {
      id: generatedId,
      petpoojaItemId: String(item.petpoojaItemId || '').trim() || `AUTO_${generatedId.toUpperCase()}`,
      name: generatedName,
      description: String(item.description || '').trim(),
      price: Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : 0,
      category: String(item.category || '').trim() || 'Uncategorized',
      image: String(item.image || '').trim(),
      available: item.available !== false
    };

    if (seenIds.has(normalizedItem.id)) throw new Error(`Duplicate menu item id: ${normalizedItem.id}`);
    if (!normalizedItem.name) throw new Error(`Menu item ${normalizedItem.id} is missing name`);
    if (!Number.isFinite(normalizedItem.price) || normalizedItem.price < 0) {
      throw new Error(`Menu item ${normalizedItem.id} has invalid price`);
    }

    seenIds.add(normalizedItem.id);
    return normalizedItem;
  });
}

function normalizeMenusByOutlet(rawMenusByOutlet) {
  if (!rawMenusByOutlet || typeof rawMenusByOutlet !== 'object' || Array.isArray(rawMenusByOutlet)) {
    throw new Error('Menus must be stored as an outlet map');
  }

  const normalized = {};
  const outletIds = new Set(outlets.map((outlet) => outlet.id));
  for (const outletId of outletIds) {
    const outletMenu = rawMenusByOutlet[outletId] || defaultMenu;
    normalized[outletId] = normalizeMenu(outletMenu);
  }
  return normalized;
}

function normalizeOutletScopedStore(rawStore, normalizeEntry) {
  const normalized = {};
  if (rawStore && typeof rawStore === 'object' && !Array.isArray(rawStore)) {
    for (const [outletId, entries] of Object.entries(rawStore)) {
      normalized[outletId] = Array.isArray(entries) ? entries.map((entry, index) => normalizeEntry(entry, outletId, index)) : [];
    }
  }

  for (const outlet of outlets) {
    if (!normalized[outlet.id]) {
      normalized[outlet.id] = [];
    }
  }

  return normalized;
}

function normalizeUploadedImage(entry, outletId, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Uploaded image at index ${index} for outlet ${outletId} must be an object`);
  }

  return {
    id: String(entry.id || `img_${nanoid(8)}`).trim(),
    outletId,
    imageUrl: String(entry.imageUrl || '').trim(),
    filename: String(entry.filename || '').trim(),
    originalName: String(entry.originalName || '').trim(),
    mimeType: String(entry.mimeType || '').trim(),
    size: Number(entry.size || 0),
    uploadedBy: String(entry.uploadedBy || 'admin-ui').trim(),
    uploadedAt: String(entry.uploadedAt || new Date().toISOString()).trim()
  };
}

function normalizeAuditEntry(entry, outletId, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Audit entry at index ${index} for outlet ${outletId} must be an object`);
  }

  return {
    id: String(entry.id || `audit_${nanoid(8)}`).trim(),
    outletId,
    action: String(entry.action || '').trim(),
    entityType: String(entry.entityType || '').trim(),
    entityId: String(entry.entityId || '').trim(),
    summary: String(entry.summary || '').trim(),
    actor: String(entry.actor || 'system').trim(),
    metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
    createdAt: String(entry.createdAt || new Date().toISOString()).trim()
  };
}

function normalizeWhatsAppEvent(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`WhatsApp event at index ${index} must be an object`);
  }

  return {
    id: String(entry.id || `waevt_${nanoid(8)}`).trim(),
    direction: String(entry.direction || 'inbound').trim(),
    customerMobile: String(entry.customerMobile || '').trim(),
    eventType: String(entry.eventType || 'message').trim(),
    summary: String(entry.summary || '').trim(),
    payload: entry.payload && typeof entry.payload === 'object' ? entry.payload : {},
    createdAt: String(entry.createdAt || new Date().toISOString()).trim()
  };
}

function loadOutletScopedStoreFromDisk(filePath, label, normalizeEntry) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeOutletScopedStore(parsed, normalizeEntry);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Failed to load ${label}, using empty data instead.`, error.message);
    }
    const emptyStore = normalizeOutletScopedStore({}, normalizeEntry);
    persistOutletScopedStore(filePath, emptyStore);
    return emptyStore;
  }
}

function persistOutletScopedStore(filePath, store) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(store, null, 2));
}

function loadUploadedImagesFromDisk() {
  return loadOutletScopedStoreFromDisk(imageManifestFile, 'uploaded image manifest', normalizeUploadedImage);
}

function persistUploadedImages() {
  persistOutletScopedStore(imageManifestFile, uploadedImagesByOutlet);
}

function loadAuditLogsFromDisk() {
  return loadOutletScopedStoreFromDisk(auditLogFile, 'audit logs', normalizeAuditEntry);
}

function persistAuditLogs() {
  persistOutletScopedStore(auditLogFile, auditLogsByOutlet);
}

function loadWhatsAppEventsFromDisk() {
  try {
    const raw = readFileSync(whatsappEventsFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('WhatsApp event store must be an array');
    }
    return parsed.map((entry, index) => normalizeWhatsAppEvent(entry, index));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to load WhatsApp events, using empty data instead.', error.message);
    }
    persistWhatsAppEvents([]);
    return [];
  }
}

function persistWhatsAppEvents(nextEvents = whatsappEvents) {
  mkdirSync(path.dirname(whatsappEventsFile), { recursive: true });
  writeFileSync(whatsappEventsFile, JSON.stringify(nextEvents, null, 2));
}

export function listWhatsAppEvents(limit = 20) {
  return [...whatsappEvents]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export function recordWhatsAppEvent(entry) {
  const normalizedEvent = normalizeWhatsAppEvent(entry, 0);
  whatsappEvents = [normalizedEvent, ...whatsappEvents].slice(0, 100);
  persistWhatsAppEvents();
  return normalizedEvent;
}

function ensureOutletScopedStores() {
  uploadedImagesByOutlet = normalizeOutletScopedStore(uploadedImagesByOutlet, normalizeUploadedImage);
  auditLogsByOutlet = normalizeOutletScopedStore(auditLogsByOutlet, normalizeAuditEntry);
}

function getValidatedOutletId(outletId) {
  const resolvedOutletId = String(outletId || getDefaultOutletId()).trim();
  if (!outlets.some((outlet) => outlet.id === resolvedOutletId)) {
    throw new Error(`Unknown outlet: ${resolvedOutletId}`);
  }
  return resolvedOutletId;
}

export function getUploadedImagesByOutlet(outletId) {
  return [...(uploadedImagesByOutlet[getValidatedOutletId(outletId)] || [])]
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
}

export function listAuditLogsByOutlet(outletId) {
  return [...(auditLogsByOutlet[getValidatedOutletId(outletId)] || [])]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function logAuditEvent({
  outletId,
  action,
  entityType,
  entityId,
  summary,
  actor = 'system',
  metadata = {}
}) {
  const resolvedOutletId = getValidatedOutletId(outletId);
  const entry = normalizeAuditEntry({
    id: `audit_${nanoid(10)}`,
    action,
    entityType,
    entityId,
    summary,
    actor,
    metadata,
    createdAt: new Date().toISOString()
  }, resolvedOutletId, 0);

  auditLogsByOutlet[resolvedOutletId] = [entry, ...(auditLogsByOutlet[resolvedOutletId] || [])];
  persistAuditLogs();
  return entry;
}

export function recordUploadedImage({
  outletId,
  imageUrl,
  filename,
  originalName,
  mimeType,
  size,
  uploadedBy = 'admin-ui'
}) {
  const resolvedOutletId = getValidatedOutletId(outletId);
  const imageRecord = normalizeUploadedImage({
    id: `img_${nanoid(10)}`,
    imageUrl,
    filename,
    originalName,
    mimeType,
    size,
    uploadedBy,
    uploadedAt: new Date().toISOString()
  }, resolvedOutletId, 0);

  uploadedImagesByOutlet[resolvedOutletId] = [imageRecord, ...(uploadedImagesByOutlet[resolvedOutletId] || [])];
  persistUploadedImages();
  logAuditEvent({
    outletId: resolvedOutletId,
    action: 'IMAGE_UPLOADED',
    entityType: 'image',
    entityId: imageRecord.id,
    summary: `Uploaded image ${imageRecord.originalName || imageRecord.filename}`,
    actor: uploadedBy,
    metadata: {
      imageUrl: imageRecord.imageUrl,
      filename: imageRecord.filename,
      mimeType: imageRecord.mimeType,
      size: imageRecord.size
    }
  });

  return imageRecord;
}

function getDefaultOutletId() {
  return outlets.find((outlet) => outlet.status === 'ACTIVE')?.id || outlets[0]?.id || defaultOutlets[0]?.id || 'default_outlet';
}

function getOutletMenu(outletId) {
  return menusByOutlet[outletId] || menusByOutlet[getDefaultOutletId()] || normalizeMenu(defaultMenu);
}

export function getMenu({ includeUnavailable = false, outletId } = {}) {
  const menu = getOutletMenu(outletId || getDefaultOutletId());
  return includeUnavailable ? [...menu] : menu.filter((item) => item.available);
}

export function getOutlets() {
  return [...outlets];
}

export function getBrands() {
  return [...brands];
}

export function getPetpoojaConnections() {
  return petpoojaConnections.map((connection) => ({ ...connection }));
}

export function getPaymentConnections() {
  return paymentConnections.map((connection) => ({ ...connection }));
}

export function getWhatsAppConnections() {
  return whatsappConnections.map((connection) => ({ ...connection }));
}

function getBrand(brandId) {
  return brands.find((brand) => brand.id === brandId) || null;
}

function getPetpoojaConnection(connectionId) {
  return petpoojaConnections.find((connection) => connection.id === connectionId) || null;
}

function getPaymentConnection(connectionId) {
  return paymentConnections.find((connection) => connection.id === connectionId) || null;
}

function getWhatsAppConnection(connectionId) {
  return whatsappConnections.find((connection) => connection.id === connectionId) || null;
}

function getOutlet(outletId) {
  return outlets.find((outlet) => outlet.id === outletId) || null;
}

function getBrandForOutlet(outletId) {
  const outlet = getOutlet(outletId);
  return getBrand(outlet?.brandId);
}

function getBrandingForOutlet(outletId) {
  const outlet = getOutlet(outletId);
  const brand = getBrandForOutlet(outletId);
  return {
    outletId: outlet?.id || outletId || getDefaultOutletId(),
    brandId: brand?.id || outlet?.brandId || defaultBrands[0]?.id || 'default',
    brandName: brand?.name || outlet?.name || 'Brand',
    logoText: brand?.logoText || brand?.name || outlet?.name || 'Brand',
    logoUrl: brand?.logoUrl || '',
    heroEyebrow: brand?.heroEyebrow || outlet?.pickupLabel || 'Pickup counter',
    heroTitle: brand?.heroTitle || 'Order ahead, pick up faster',
    heroSubtitle: brand?.heroSubtitle || 'Place your order, pay online, and collect it with your pickup code.',
    primaryColor: brand?.primaryColor || '#007a63',
    accentColor: brand?.accentColor || '#ffd84d',
    accentTextColor: brand?.accentTextColor || '#202020',
    backgroundColor: brand?.backgroundColor || '#fffaf0',
    surfaceColor: brand?.surfaceColor || '#ffffff',
    outletName: outlet?.name || '',
    pickupLabel: outlet?.pickupLabel || '',
    address: outlet?.address || ''
  };
}

function resolvePetpoojaConnectionForOutlet(outletId) {
  const outlet = getOutlet(outletId);
  const brand = outlet ? getBrand(outlet.brandId) : null;
  const connectionId =
    String(outlet?.petpoojaConnectionId || '').trim() ||
    String(brand?.petpoojaConnectionId || '').trim();

  return {
    outlet,
    brand,
    connectionId,
    connection: connectionId ? getPetpoojaConnection(connectionId) : null
  };
}

function resolvePaymentConnectionForOutlet(outletId) {
  const outlet = getOutlet(outletId);
  const brand = outlet ? getBrand(outlet.brandId) : null;
  const connectionId =
    String(outlet?.paymentConnectionId || '').trim() ||
    String(brand?.paymentConnectionId || '').trim();

  return {
    outlet,
    brand,
    connectionId,
    connection: connectionId ? getPaymentConnection(connectionId) : null
  };
}

function resolveWhatsAppConnectionForOutlet(outletId) {
  const outlet = getOutlet(outletId);
  const brand = outlet ? getBrand(outlet.brandId) : null;
  const connectionId =
    String(outlet?.whatsappConnectionId || '').trim() ||
    String(brand?.whatsappConnectionId || '').trim();

  return {
    outlet,
    brand,
    connectionId,
    connection: connectionId ? getWhatsAppConnection(connectionId) : null
  };
}

function resolveBrandFromWhatsAppPhoneNumberId(phoneNumberId) {
  const normalizedPhoneNumberId = String(phoneNumberId || '').trim();
  if (!normalizedPhoneNumberId) return null;

  const connector = whatsappConnections.find((connection) => String(connection.phoneNumberId || '').trim() === normalizedPhoneNumberId);
  if (!connector) return null;

  const outletOverride = outlets.find((item) => item.whatsappConnectionId === connector.id) || null;
  const brand = brands.find((item) => item.whatsappConnectionId === connector.id) ||
    (outletOverride ? getBrand(outletOverride.brandId) : null);

  return brand ? { brand, connector } : null;
}

function buildShowcaseBrand(brand) {
  const brandOutlets = outlets.filter((outlet) => outlet.brandId === brand.id);
  const activeOutlets = brandOutlets.filter((outlet) => outlet.status === 'ACTIVE');
  const primaryOutlet = activeOutlets[0] || brandOutlets[0] || null;
  return {
    id: brand.id,
    name: brand.name,
    customerAppBaseUrl: brand.customerAppBaseUrl || '',
    heroEyebrow: brand.heroEyebrow,
    heroTitle: brand.heroTitle,
    heroSubtitle: brand.heroSubtitle,
    logoText: brand.logoText,
    logoUrl: brand.logoUrl,
    primaryColor: brand.primaryColor,
    accentColor: brand.accentColor,
    accentTextColor: brand.accentTextColor,
    backgroundColor: brand.backgroundColor,
    surfaceColor: brand.surfaceColor,
    primaryOutletId: primaryOutlet?.id || '',
    primaryOutletName: primaryOutlet?.name || '',
    outletCount: brandOutlets.length,
    activeOutletCount: activeOutlets.length
  };
}

export function replaceBrands(nextBrands, { persist = true } = {}) {
  const normalizedBrands = normalizeBrands(nextBrands);
  const brandIds = new Set(normalizedBrands.map((brand) => brand.id));
  const invalidBrandPaymentConnector = normalizedBrands.find((brand) => brand.paymentConnectionId && !getPaymentConnection(brand.paymentConnectionId));
  if (invalidBrandPaymentConnector) {
    throw new Error(`Brand ${invalidBrandPaymentConnector.id} references missing payment connector ${invalidBrandPaymentConnector.paymentConnectionId}`);
  }
  const invalidBrandConnector = normalizedBrands.find((brand) => brand.whatsappConnectionId && !getWhatsAppConnection(brand.whatsappConnectionId));
  if (invalidBrandConnector) {
    throw new Error(`Brand ${invalidBrandConnector.id} references missing WhatsApp connector ${invalidBrandConnector.whatsappConnectionId}`);
  }
  const fallbackBrandId = normalizedBrands[0]?.id || '';
  const nextOutlets = outlets.map((outlet) => (
    brandIds.has(outlet.brandId)
      ? outlet
      : { ...outlet, brandId: fallbackBrandId }
  ));
  brands = normalizedBrands;
  outlets = nextOutlets;
  if (persist) {
    persistBrands(normalizedBrands);
    persistOutlets(nextOutlets);
    persistUploadedImages();
    persistAuditLogs();
  }
  return normalizedBrands;
}

export function replacePetpoojaConnections(nextConnections, { persist = true } = {}) {
  const normalizedConnections = normalizePetpoojaConnections(nextConnections);
  petpoojaConnections = normalizedConnections;

  if (persist) {
    persistPetpoojaConnections(normalizedConnections);
  }

  return normalizedConnections;
}

export function replacePaymentConnections(nextConnections, { persist = true } = {}) {
  const normalizedConnections = normalizePaymentConnections(nextConnections);
  paymentConnections = normalizedConnections;

  if (persist) {
    persistPaymentConnections(normalizedConnections);
  }

  return normalizedConnections;
}

export function replaceWhatsAppConnections(nextConnections, { persist = true } = {}) {
  const normalizedConnections = normalizeWhatsAppConnections(nextConnections);
  whatsappConnections = normalizedConnections;

  if (persist) {
    persistWhatsAppConnections(normalizedConnections);
  }

  return normalizedConnections;
}

function mergeConnectorSecrets(existingConnections, requestedConnections, secretFields = []) {
  const existingById = new Map(existingConnections.map((connection) => [connection.id, connection]));
  return (Array.isArray(requestedConnections) ? requestedConnections : []).map((connection) => {
    const existing = existingById.get(String(connection?.id || '').trim());
    if (!existing) return connection;
    return secretFields.reduce((merged, field) => {
      if (String(merged?.[field] || '').trim()) return merged;
      return { ...merged, [field]: existing[field] || '' };
    }, { ...connection });
  });
}

export function replaceOutlets(nextOutlets, { persist = true } = {}) {
  const normalizedOutlets = normalizeOutlets(nextOutlets);
  const invalidOutletPaymentConnector = normalizedOutlets.find((outlet) => outlet.paymentConnectionId && !getPaymentConnection(outlet.paymentConnectionId));
  if (invalidOutletPaymentConnector) {
    throw new Error(`Outlet ${invalidOutletPaymentConnector.id} references missing payment connector ${invalidOutletPaymentConnector.paymentConnectionId}`);
  }
  const invalidOutletConnector = normalizedOutlets.find((outlet) => outlet.whatsappConnectionId && !getWhatsAppConnection(outlet.whatsappConnectionId));
  if (invalidOutletConnector) {
    throw new Error(`Outlet ${invalidOutletConnector.id} references missing WhatsApp connector ${invalidOutletConnector.whatsappConnectionId}`);
  }
  outlets = normalizedOutlets;
  ensureOutletScopedStores();
  if (persist) {
    persistOutlets(normalizedOutlets);
    persistUploadedImages();
    persistAuditLogs();
  }
  return normalizedOutlets;
}

export function replaceMenu(nextMenu, { outletId = getDefaultOutletId(), persist = true } = {}) {
  const normalizedMenu = normalizeMenu(nextMenu);
  menusByOutlet = {
    ...menusByOutlet,
    [outletId]: normalizedMenu
  };
  if (persist) {
    persistMenus(menusByOutlet);
  }
  return normalizedMenu;
}

function listAudienceByOutlet(outletId) {
  const seen = new Map();
  listOrdersByOutlet(outletId).forEach((order) => {
    if (order.paymentStatus !== 'PAID') return;
    if (!order.marketingConsent?.whatsappUpdates) return;
    const mobile = normalizeWhatsAppRecipient(order.customerMobile);
    if (!mobile) return;
    if (!seen.has(mobile)) {
      seen.set(mobile, {
        customerMobile: mobile,
        lastOrderId: order.id,
        lastOrderedAt: order.createdAt,
        totalOrders: 1,
        optedInAt: order.marketingConsent?.optedInAt || order.createdAt
      });
      return;
    }

    const current = seen.get(mobile);
    current.totalOrders += 1;
    if (String(order.createdAt).localeCompare(String(current.lastOrderedAt)) > 0) {
      current.lastOrderedAt = order.createdAt;
      current.lastOrderId = order.id;
    }
  });

  return [...seen.values()].sort((left, right) => String(right.lastOrderedAt).localeCompare(String(left.lastOrderedAt)));
}

function listWhatsAppCampaigns(outletId = '') {
  return whatsappCampaigns.filter((campaign) => !outletId || campaign.outletId === outletId);
}

function parseCsvRow(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

export function parseMenuCsv(csvText) {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least one menu item');
  }

  const headers = parseCsvRow(lines[0]);
  const normalizedHeaders = headers.map((header) =>
    String(header || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  );

  const getValue = (row, aliases) => {
    for (const alias of aliases) {
      const index = normalizedHeaders.indexOf(alias);
      if (index >= 0) return row[index] ?? '';
    }
    return '';
  };

  const csvMenu = lines.slice(1).map((line, lineIndex) => {
    const values = parseCsvRow(line);
    const availableValue = String(getValue(values, ['available', 'is_available']) || '').trim().toLowerCase();

    const item = {
      id: getValue(values, ['id', 'item_id']),
      petpoojaItemId: getValue(values, ['petpoojaitemid', 'petpooja_item_id', 'petpooja_id']),
      name: getValue(values, ['item_name', 'name']),
      description: getValue(values, ['description', 'item_description']),
      price: getValue(values, ['price', 'item_price']),
      category: getValue(values, ['category', 'category_name']),
      image: getValue(values, ['image_url', 'image', 'photo', 'photo_url']),
      available: availableValue ? !['false', '0', 'no'].includes(availableValue) : true,
      _lineIndex: lineIndex + 2
    };

    const hasAnyContent = [item.id, item.petpoojaItemId, item.name, item.description, item.price, item.category, item.image]
      .some((value) => String(value || '').trim() !== '');
    if (!hasAnyContent) {
      return null;
    }

    return item;
  }).filter(Boolean);

  if (!csvMenu.length) {
    throw new Error('CSV must include at least one non-empty menu item row');
  }

  try {
    return normalizeMenu(csvMenu);
  } catch (error) {
    throw new Error(`CSV validation failed: ${error.message}`);
  }
}

export function parseMenuSpreadsheet(base64Content) {
  if (!base64Content) {
    throw new Error('Spreadsheet content is required');
  }

  const workbook = XLSX.read(Buffer.from(base64Content, 'base64'), { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Spreadsheet does not contain any sheets');
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  if (!rows.length) {
    throw new Error('Spreadsheet must include a header row and at least one menu item');
  }

  const normalizeImportedRow = (row) => {
    const entries = Object.entries(row).map(([key, value]) => [
      String(key || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, ''),
      value
    ]);
    const rowMap = new Map(entries);
    const getValue = (...aliases) => {
      for (const alias of aliases) {
        if (rowMap.has(alias)) return rowMap.get(alias);
      }
      return '';
    };
    const rawAvailableValue = getValue('available', 'is_available');
    const availableValue = String(rawAvailableValue ?? '').trim().toLowerCase();
    return {
      id: getValue('id', 'item_id'),
      petpoojaItemId: getValue('petpoojaitemid', 'petpooja_item_id', 'petpooja_id'),
      name: getValue('item_name', 'name'),
      description: getValue('description', 'item_description'),
      price: getValue('price', 'item_price'),
      category: getValue('category', 'category_name'),
      image: getValue('image_url', 'image', 'photo', 'photo_url'),
      available: availableValue ? !['false', '0', 'no'].includes(availableValue) : true
    };
  };

  const normalizedRows = rows
    .map(normalizeImportedRow)
    .filter((row) => [row.id, row.petpoojaItemId, row.name, row.description, row.price, row.category, row.image]
      .some((value) => String(value || '').trim() !== ''));

  if (!normalizedRows.length) {
    throw new Error('Spreadsheet must include at least one non-empty menu item row');
  }

  try {
    return normalizeMenu(normalizedRows);
  } catch (error) {
    throw new Error(`Spreadsheet validation failed: ${error.message}`);
  }
}

function getPublicBaseUrl(req) {
  const forwardedProto = req.get('x-forwarded-proto');
  const protocol = forwardedProto ? forwardedProto.split(',')[0] : req.protocol;
  return `${protocol}://${req.get('host')}`;
}

function haversineDistanceKm(origin, destination) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(destination.latitude - origin.latitude);
  const dLon = toRadians(destination.longitude - origin.longitude);
  const lat1 = toRadians(origin.latitude);
  const lat2 = toRadians(destination.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function resolveOutletFromCustomerContext({ text, latitude, longitude, brandId = '' }) {
  const brandScopedOutlets = brandId
    ? outlets.filter((outlet) => outlet.brandId === brandId)
    : outlets;
  const activeOutlets = brandScopedOutlets.filter((outlet) => outlet.status === 'ACTIVE');
  const candidates = activeOutlets.length ? activeOutlets : brandScopedOutlets.length ? brandScopedOutlets : outlets;
  const normalizedText = String(text || '').trim().toLowerCase();

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const locatable = candidates.filter((outlet) => Number.isFinite(outlet.latitude) && Number.isFinite(outlet.longitude));
    if (locatable.length) {
      const origin = { latitude, longitude };
      const nearestOutlet = [...locatable].sort((left, right) =>
        haversineDistanceKm(origin, left) - haversineDistanceKm(origin, right)
      )[0];
      return {
        outletId: nearestOutlet.id,
        resolutionSource: 'coordinates'
      };
    }
  }

  if (normalizedText) {
    const keywordMatch = candidates.find((outlet) => {
      const keywords = [
        outlet.name,
        outlet.address,
        ...(outlet.locationKeywords || [])
      ]
        .map((value) => String(value || '').toLowerCase())
        .filter(Boolean);
      return keywords.some((keyword) => normalizedText.includes(keyword));
    });
    if (keywordMatch) {
      return {
        outletId: keywordMatch.id,
        resolutionSource: 'keyword'
      };
    }
  }

  return {
    outletId: getDefaultOutletId(),
    resolutionSource: 'default'
  };
}

function findSessionByCustomerMobile(customerMobile) {
  return [...sessions.values()]
    .filter((session) => session.customerMobile === customerMobile)
    .sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)))[0] || null;
}

function updateSession(sessionId, patch) {
  const currentSession = sessions.get(sessionId);
  if (!currentSession) {
    throw new Error('Session not found');
  }

  const nextSession = {
    ...currentSession,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  sessions.set(sessionId, nextSession);
  persistSessions();
  return nextSession;
}

function buildOrderLink({ sessionId, outletId, channel = 'whatsapp' }) {
  const frontendBaseUrl = getCustomerAppBaseUrl(outletId);
  return `${frontendBaseUrl}?session=${encodeURIComponent(sessionId)}&outlet=${encodeURIComponent(outletId)}&channel=${encodeURIComponent(channel)}`;
}

function getCustomerAppBaseUrl(outletId) {
  const outlet = getOutlet(outletId);
  const brand = getBrand(outlet?.brandId);
  return String(outlet?.customerAppBaseUrl || brand?.customerAppBaseUrl || process.env.FRONTEND_BASE_URL || 'http://localhost:5173').trim().replace(/\/+$/, '');
}

function createOrRefreshWhatsAppSession({ customerMobile, outletId, resolutionSource }) {
  const existingSession = findSessionByCustomerMobile(customerMobile);
  if (existingSession) {
    return updateSession(existingSession.id, {
      customerMobile,
      outletId,
      channel: 'WHATSAPP',
      resolutionSource,
      flowState: ORDER_FLOW.OUTLET_RESOLVED,
      lastInboundAt: new Date().toISOString()
    });
  }

  const sessionId = nanoid(16);
  const session = {
    id: sessionId,
    customerMobile,
    outletId,
    channel: 'WHATSAPP',
    resolutionSource,
    flowState: ORDER_FLOW.WHATSAPP_INITIATED,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastInboundAt: new Date().toISOString()
  };
  sessions.set(sessionId, session);
  persistSessions();
  return session;
}

function extractWhatsAppEvents(payload) {
  return (payload?.entry || []).flatMap((entry) =>
    (entry?.changes || []).flatMap((change) => {
      const phoneNumberId = change?.value?.metadata?.phone_number_id || '';
      return (change?.value?.messages || []).map((message) => ({
        ...message,
        _metaPhoneNumberId: phoneNumberId
      }));
    })
  );
}

function getWhatsAppMessageText(message) {
  if (message?.text?.body) {
    return message.text.body;
  }
  if (message?.interactive?.button_reply?.title) {
    return message.interactive.button_reply.title;
  }
  if (message?.interactive?.list_reply?.title) {
    return message.interactive.list_reply.title;
  }
  return '';
}

function buildWhatsAppMenuMessage(outlet, session) {
  const orderLink = buildOrderLink({ sessionId: session.id, outletId: outlet.id });
  const branding = getBrandingForOutlet(outlet.id);
  return `Welcome to ${branding.brandName}.\n\nClosest outlet: ${outlet.name}\nPickup: ${outlet.pickupLabel}\nAddress: ${outlet.address}\n\nOpen the menu and place your prepaid WhatsApp order here:\n${orderLink}`;
}

function buildPickupConfirmationMessage(order) {
  const branding = getBrandingForOutlet(order.outletId);
  const pickupPoint = order.pickupLabel || branding.pickupLabel || `${branding.brandName} counter`;
  return `Payment received ✅\n\nOrder: ${order.id}\nPickup code: ${order.pickupCode}\nTotal: ₹${order.total}\nShow this code at the ${pickupPoint}.`;
}

function getBackendOrderNotificationRecipients(order) {
  const { connection } = resolveWhatsAppConnectionForOutlet(order?.outletId);
  return String(connection?.orderNotificationRecipients || process.env.BACKEND_ORDER_WHATSAPP_RECIPIENTS || '')
    .split(',')
    .map((value) => normalizeWhatsAppRecipient(value))
    .filter(Boolean);
}

function buildBackendOrderNotificationMessage(order) {
  const outlet = getOutlet(order.outletId);
  const branding = getBrandingForOutlet(order.outletId);
  const itemLines = (order.items || [])
    .map((item) => `- ${item.name} x ${item.qty} = ₹${item.lineTotal}`)
    .join('\n');

  return [
    `New paid order for ${branding.brandName}`,
    '',
    `Outlet: ${outlet?.name || order.outletId}`,
    `Order: ${order.id}`,
    `Customer: ${order.customerMobile}`,
    `Total: ₹${order.total}`,
    `Pickup code: ${order.pickupCode}`,
    '',
    'Items:',
    itemLines || '- No items found',
    '',
    `Payment: ${order.payment?.provider || order.paymentProvider || 'Payment gateway'} ${order.payment?.paymentReference ? `(${order.payment.paymentReference})` : ''}`.trim()
  ].join('\n');
}

async function notifyBackendTeamOfPaidOrder(order) {
  const recipients = getBackendOrderNotificationRecipients(order);
  if (!recipients.length) {
    return { sentCount: 0, failedCount: 0 };
  }

  const message = buildBackendOrderNotificationMessage(order);
  let sentCount = 0;
  let failedCount = 0;

  for (const recipient of recipients) {
    try {
      await sendWhatsAppMessage(recipient, message, { outletId: order.outletId });
      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      logAuditEvent({
        outletId: order.outletId,
        action: 'BACKEND_ORDER_NOTIFICATION_FAILED',
        entityType: 'order',
        entityId: order.id,
        summary: `Failed backend WhatsApp notification for order ${order.id}`,
        actor: 'payment-webhook',
        metadata: {
          recipient,
          error: error.message
        }
      });
    }
  }

  if (sentCount > 0) {
    logAuditEvent({
      outletId: order.outletId,
      action: 'BACKEND_ORDER_NOTIFICATION_SENT',
      entityType: 'order',
      entityId: order.id,
      summary: `Sent backend WhatsApp notification for order ${order.id}`,
      actor: 'payment-webhook',
      metadata: {
        sentCount,
        failedCount
      }
    });
  }

  return { sentCount, failedCount };
}

export async function handleIncomingWhatsAppMessage(message) {
  const customerMobile = message?.from;
  if (!customerMobile) {
    return null;
  }

  const incomingPhoneNumberId = String(message?._metaPhoneNumberId || '').trim();
  const brandResolution = resolveBrandFromWhatsAppPhoneNumberId(incomingPhoneNumberId);

  recordWhatsAppEvent({
    direction: 'inbound',
    customerMobile,
    eventType: message?.type || 'message',
    summary: getWhatsAppMessageText(message) || 'Inbound WhatsApp event',
    payload: {
      ...message,
      brandId: brandResolution?.brand?.id || '',
      connectorId: brandResolution?.connector?.id || ''
    },
    createdAt: new Date().toISOString()
  });

  const messageText = getWhatsAppMessageText(message);
  const latitude = Number(message?.location?.latitude);
  const longitude = Number(message?.location?.longitude);
  const resolution = resolveOutletFromCustomerContext({
    text: messageText,
    latitude,
    longitude,
    brandId: brandResolution?.brand?.id || ''
  });
  const outlet = outlets.find((item) => item.id === resolution.outletId) || outlets[0];
  const session = createOrRefreshWhatsAppSession({
    customerMobile,
    outletId: outlet.id,
    resolutionSource: resolution.resolutionSource
  });

  let replyText = buildWhatsAppMenuMessage(outlet, session);
  const normalizedText = String(messageText || '').trim().toLowerCase();

  if (normalizedText && !['hi', 'hello', 'menu', 'start'].includes(normalizedText)) {
    replyText = `I mapped you to ${outlet.name} based on "${messageText}".\n\n${buildWhatsAppMenuMessage(outlet, session)}`;
  }

  await sendWhatsAppMessage(customerMobile, replyText, { outletId: outlet.id, connectionId: brandResolution?.connector?.id || '' });
  updateSession(session.id, {
    flowState: ORDER_FLOW.MENU_SHARED,
    lastSharedLink: buildOrderLink({ sessionId: session.id, outletId: outlet.id })
  });
  logAuditEvent({
    outletId: outlet.id,
    action: 'WHATSAPP_MENU_SHARED',
    entityType: 'session',
    entityId: session.id,
    summary: `Shared WhatsApp order link with ${customerMobile}`,
    actor: 'whatsapp-webhook',
    metadata: {
      customerMobile,
      resolutionSource: resolution.resolutionSource
    }
  });

  return session;
}

export async function pullMenuFromPetpooja(outletId, { persist = true } = {}) {
  const resolvedOutletId = getValidatedOutletId(outletId);
  const result = await petpoojaProvider.pullMenu({ outletId: resolvedOutletId });
  const nextMenu = replaceMenu(result.menu, { outletId: resolvedOutletId, persist });
  logAuditEvent({
    outletId: resolvedOutletId,
    action: 'MENU_PULLED_FROM_PETPOOJA',
    entityType: 'menu',
    entityId: resolvedOutletId,
    summary: `Pulled menu from Petpooja provider for outlet ${resolvedOutletId}`,
    actor: 'admin-ui',
    metadata: {
      source: result.source || 'petpooja-provider',
      syncedAt: result.syncedAt || null,
      note: result.note || null
    }
  });
  return {
    outletId: resolvedOutletId,
    menu: nextMenu,
    sync: result
  };
}

function getPetpoojaConfigSnapshot(outletId = '') {
  const { outlet, brand, connectionId, connection } = resolvePetpoojaConnectionForOutlet(outletId);
  const configuredApiBaseUrl = String(connection?.apiBaseUrl || DEFAULT_PETPOOJA_API_BASE_URL).trim();
  const appKey = String(connection?.appKey || '').trim();
  const appSecret = String(connection?.appSecret || '').trim();
  const accessToken = String(connection?.accessToken || '').trim();
  const restaurantId = String(outlet?.petpoojaRestaurantId || connection?.restaurantId || '').trim();
  const missing = [];

  if (!APP_ENCRYPTION_KEY) missing.push('APP_ENCRYPTION_KEY');
  if (!connectionId) missing.push('petpoojaConnectionId');
  if (connectionId && !connection) missing.push('assigned Petpooja connection');
  if (!configuredApiBaseUrl) missing.push('Petpooja API base URL');
  if (!appKey) missing.push('Petpooja app key');
  if (!appSecret) missing.push('Petpooja app secret');
  if (!accessToken) missing.push('Petpooja access token');
  if (!restaurantId) missing.push('Petpooja restaurant ID');
  if (outlet && !String(outlet.petpoojaOutletId || '').trim()) missing.push('petpoojaOutletId');

  return {
    configured: missing.length === 0,
    missing,
    apiBaseUrl: configuredApiBaseUrl,
    restaurantId,
    outletId: outlet?.id || '',
    brandId: brand?.id || '',
    brandName: brand?.name || '',
    petpoojaConnectionId: connectionId,
    petpoojaConnectionName: connection?.name || '',
    petpoojaOutletId: outlet?.petpoojaOutletId || '',
    auth: {
      appKeyConfigured: Boolean(appKey),
      appSecretConfigured: Boolean(appSecret),
      accessTokenConfigured: Boolean(accessToken),
      encryptionKeyConfigured: Boolean(APP_ENCRYPTION_KEY)
    }
  };
}

function buildPetpoojaOrderPayload(order) {
  return {
    source: 'whatsapp_web_order',
    outletId: order.outletId,
    petpoojaOutletId: outlets.find((outlet) => outlet.id === order.outletId)?.petpoojaOutletId || null,
    orderId: order.id,
    customerMobile: order.customerMobile,
    paymentMode: 'Online Prepaid - Razorpay',
    items: order.items.map((item) => ({
      item_id: item.petpoojaItemId,
      qty: item.qty,
      rate: item.unitPrice
    })),
    notes: `Channel: ${order.channel || 'web'}. Pickup code: ${order.pickupCode}.`
  };
}

const petpoojaProvider = {
  async pushPaidOrder({ order }) {
    const payload = buildPetpoojaOrderPayload(order);
    const config = getPetpoojaConfigSnapshot(order.outletId);
    console.log('PETPOOJA_PROVIDER_PLACEHOLDER_ORDER', payload);
    return {
      status: config.configured ? 'PENDING_API_SPEC' : 'PENDING_CONFIGURATION',
      externalOrderId: null,
      payload,
      config
    };
  },
  async pullMenu({ outletId }) {
    const existingMenu = getMenu({ includeUnavailable: true, outletId });
    const config = getPetpoojaConfigSnapshot(outletId);
    return {
      menu: existingMenu,
      source: config.configured ? 'petpooja-configured-placeholder' : 'placeholder',
      syncedAt: new Date().toISOString(),
      note: config.configured
        ? 'Petpooja credentials are configured. Replace petpoojaProvider.pullMenu with the exact live Petpooja menu endpoint once the API spec is confirmed.'
        : 'Petpooja menu sync is waiting for configuration. Add a Petpooja connection, assign it to the brand or outlet, and complete the outlet mapping fields.',
      config
    };
  }
};

let whatsappFetch = globalThis.fetch?.bind(globalThis);
let paymentFetch = globalThis.fetch?.bind(globalThis);

function buildWhatsAppConnectionSnapshot(connection = null) {
  const configuredConnection = connection || null;
  return {
    ...configuredConnection,
    accessToken: configuredConnection?.accessToken || String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim(),
    phoneNumberId: configuredConnection?.phoneNumberId || String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
    verifyToken: configuredConnection?.verifyToken || String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim(),
    graphVersion: configuredConnection?.graphVersion || String(process.env.WHATSAPP_GRAPH_VERSION || '').trim() || 'v25.0'
  };
}

function getPlatformWhatsAppConnectionSnapshot() {
  return buildWhatsAppConnectionSnapshot(whatsappConnections[0] || null);
}

function getWhatsAppConnectionSnapshotForOutlet(outletId) {
  const resolved = resolveWhatsAppConnectionForOutlet(outletId);
  return {
    ...resolved,
    snapshot: buildWhatsAppConnectionSnapshot(resolved.connection)
  };
}

function normalizeWhatsAppRecipient(value) {
  return String(value || '')
    .trim()
    .replace(/[^\d+]/g, '');
}

async function sendWhatsAppViaMeta(payload, connectionSnapshot = getPlatformWhatsAppConnectionSnapshot()) {
  const accessToken = connectionSnapshot.accessToken;
  const phoneNumberId = connectionSnapshot.phoneNumberId;
  const graphVersion = connectionSnapshot.graphVersion || 'v25.0';

  if (!accessToken || !phoneNumberId || !whatsappFetch) {
    return null;
  }

  const response = await whatsappFetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  let parsedResponse = null;
  try {
    parsedResponse = responseText ? JSON.parse(responseText) : null;
  } catch {
    parsedResponse = responseText;
  }

  if (!response.ok) {
    throw new Error(
      `Meta WhatsApp send failed: ${response.status} ${typeof parsedResponse === 'string' ? parsedResponse : JSON.stringify(parsedResponse)}`
    );
  }

  return {
    provider: 'meta-cloud-api',
    phoneNumberId,
    payload,
    response: parsedResponse
  };
}

const whatsappProvider = {
  async sendMessage({ to, text, outletId = '', connectionId = '' }) {
    const connectionSnapshot = connectionId
      ? buildWhatsAppConnectionSnapshot(getWhatsAppConnection(connectionId))
      : (outletId ? getWhatsAppConnectionSnapshotForOutlet(outletId).snapshot : getPlatformWhatsAppConnectionSnapshot());
    const metaResult = await sendWhatsAppViaMeta({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeWhatsAppRecipient(to),
      type: 'text',
      text: {
        preview_url: false,
        body: text
      }
    }, connectionSnapshot);
    if (metaResult) {
      console.log('WHATSAPP_PROVIDER_META_MESSAGE', metaResult.response);
    } else {
      console.log('WHATSAPP_PROVIDER_PLACEHOLDER_MESSAGE', { to, text });
    }
    recordWhatsAppEvent({
      direction: 'outbound',
      customerMobile: to,
      eventType: 'message',
      summary: text.split('\n')[0] || 'Outbound WhatsApp message',
      payload: metaResult || { provider: 'placeholder', to, text, outletId, connectionId: connectionId || '' },
      createdAt: new Date().toISOString()
    });
    return { ok: true, provider: metaResult?.provider || 'placeholder' };
  },
  async sendImageMessage({ to, imageUrl, caption = '', outletId = '', connectionId = '' }) {
    const connectionSnapshot = connectionId
      ? buildWhatsAppConnectionSnapshot(getWhatsAppConnection(connectionId))
      : (outletId ? getWhatsAppConnectionSnapshotForOutlet(outletId).snapshot : getPlatformWhatsAppConnectionSnapshot());
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeWhatsAppRecipient(to),
      type: 'image',
      image: {
        link: imageUrl,
        caption
      }
    };
    const metaResult = await sendWhatsAppViaMeta(payload, connectionSnapshot);
    if (metaResult) {
      console.log('WHATSAPP_PROVIDER_META_IMAGE', metaResult.response);
    } else {
      console.log('WHATSAPP_PROVIDER_PLACEHOLDER_IMAGE', { to, imageUrl, caption });
    }
    recordWhatsAppEvent({
      direction: 'outbound',
      customerMobile: to,
      eventType: 'image_message',
      summary: caption || 'Outbound WhatsApp image message',
      payload: metaResult || { provider: 'placeholder', to, imageUrl, caption, outletId, connectionId: connectionId || '' },
      createdAt: new Date().toISOString()
    });
    return { ok: true, provider: metaResult?.provider || 'placeholder' };
  }
};

async function syncOrderToPetpooja(order) {
  order.petpoojaSync = {
    ...(order.petpoojaSync || {}),
    status: 'PENDING',
    lastAttemptAt: new Date().toISOString(),
    payload: buildPetpoojaOrderPayload(order)
  };
  persistOrders();

  try {
    const syncResult = await petpoojaProvider.pushPaidOrder({ order });
    order.petpoojaSync = {
      ...order.petpoojaSync,
      status: syncResult.status === 'SYNCED' ? 'SYNCED' : 'PENDING_CONFIGURATION',
      syncedAt: syncResult.status === 'SYNCED' ? new Date().toISOString() : null,
      externalOrderId: syncResult.externalOrderId || null,
      providerResponse: syncResult
    };
    logAuditEvent({
      outletId: order.outletId,
      action: syncResult.status === 'SYNCED' ? 'PETPOOJA_ORDER_SYNCED' : 'PETPOOJA_SYNC_PENDING',
      entityType: 'petpooja-order',
      entityId: order.id,
      summary: `Petpooja sync ${syncResult.status === 'SYNCED' ? 'completed' : 'queued'} for order ${order.id}`,
      actor: 'petpooja-provider',
      metadata: {
        externalOrderId: syncResult.externalOrderId || null
      }
    });
  } catch (error) {
    order.petpoojaSync = {
      ...order.petpoojaSync,
      status: 'FAILED',
      error: error.message
    };
    logAuditEvent({
      outletId: order.outletId,
      action: 'PETPOOJA_SYNC_FAILED',
      entityType: 'petpooja-order',
      entityId: order.id,
      summary: `Petpooja sync failed for order ${order.id}`,
      actor: 'petpooja-provider',
      metadata: {
        error: error.message
      }
    });
  }

  persistOrders();
}

function renderAdminMenuPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Weborder Admin</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --surface: rgba(255, 252, 246, 0.92);
        --surface-strong: #ffffff;
        --surface-muted: #f2eadc;
        --line: #ddd1bf;
        --text: #171411;
        --muted: #6f675d;
        --primary: #0a6f5c;
        --primary-deep: #084d41;
        --accent: #ffd86f;
        --danger-bg: #fff0ef;
        --danger-text: #b1261d;
        --ok-bg: #e7fbf3;
        --ok-text: #0b7a63;
        --shadow: 0 20px 50px rgba(28, 21, 12, 0.08);
        --text-base: 16px;
        --text-small: 14px;
        --text-label: 14px;
        --text-title: 46px;
        --text-section: 28px;
        --font-ui: "Avenir Next", "Aptos", "Inter", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --font-display: "Iowan Old Style", "New York", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      }
      body {
        margin: 0;
        font-family: var(--font-ui);
        background:
          radial-gradient(circle at top left, rgba(255, 227, 154, 0.24), transparent 28%),
          radial-gradient(circle at top right, rgba(10, 111, 92, 0.1), transparent 22%),
          linear-gradient(180deg, #f8f4ec 0%, var(--bg) 100%);
        color: var(--text);
        font-size: var(--text-base);
        letter-spacing: -0.01em;
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
      }
      .shell { max-width: 1180px; margin: 0 auto; padding: 34px 22px 64px; }
      .hero {
        position: relative;
        overflow: hidden;
        background: linear-gradient(135deg, #fff1b2 0%, #ffe18d 42%, #ffd469 100%);
        border-radius: 34px;
        padding: 34px;
        box-shadow: var(--shadow);
        border: 1px solid rgba(140, 109, 32, 0.12);
      }
      .hero::after {
        content: "";
        position: absolute;
        inset: auto -10% -45% auto;
        width: 320px;
        height: 320px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.22);
        filter: blur(4px);
      }
      .hero p:first-child {
        margin: 0 0 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        font-size: 13px;
        font-weight: 600;
        color: var(--primary);
      }
      h1 {
        margin: 0 0 10px;
        font-size: var(--text-title);
        line-height: 0.92;
        letter-spacing: -0.04em;
        font-weight: 700;
        font-family: var(--font-display);
      }
      h2 { margin: 0; font-size: var(--text-section); line-height: 1.05; letter-spacing: -0.03em; font-weight: 600; font-family: var(--font-display); }
      p { line-height: 1.58; font-size: var(--text-base); color: var(--muted); }
      .section-nav {
        position: sticky;
        top: 12px;
        z-index: 5;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-top: 18px;
        padding: 8px;
        border: 1px solid rgba(116, 93, 61, 0.14);
        border-radius: 22px;
        background: rgba(255, 252, 246, 0.86);
        box-shadow: 0 14px 32px rgba(28, 21, 12, 0.08);
        backdrop-filter: blur(14px);
      }
      .section-nav a {
        min-height: 42px;
        border-radius: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 12px;
        color: var(--text);
        text-decoration: none;
        font-size: 13px;
        font-weight: 700;
        text-align: center;
        background: rgba(255, 255, 255, 0.74);
        border: 1px solid rgba(116, 93, 61, 0.1);
      }
      .section-nav a:hover { box-shadow: 0 10px 22px rgba(23, 20, 17, 0.08); }
      .grid { display: grid; gap: 22px; margin-top: 20px; }
      .flow-section {
        --section-color: var(--primary);
        --section-bg: rgba(10, 111, 92, 0.08);
        display: grid;
        gap: 18px;
        margin-top: 30px;
        scroll-margin-top: 96px;
      }
      .flow-section.setup { --section-color: #0a6f5c; --section-bg: rgba(10, 111, 92, 0.09); }
      .flow-section.connectors { --section-color: #315f9c; --section-bg: rgba(49, 95, 156, 0.1); }
      .flow-section.analytics { --section-color: #8a4f16; --section-bg: rgba(210, 130, 42, 0.12); }
      .flow-section.marketing { --section-color: #9a3760; --section-bg: rgba(154, 55, 96, 0.1); }
      .flow-section-head {
        padding: 18px 20px;
        border-radius: 22px;
        border: 1px solid rgba(116, 93, 61, 0.12);
        border-left: 6px solid var(--section-color);
        background: linear-gradient(135deg, var(--section-bg), rgba(255, 255, 255, 0.72));
      }
      .flow-section-kicker {
        margin: 0 0 6px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        font-size: 12px;
        font-weight: 700;
        color: var(--section-color);
      }
      .flow-section-head h2 { margin: 0; }
      .flow-section-head p { margin: 8px 0 0; }
      .flow-section-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 14px;
      }
      .flow-chip {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(116, 93, 61, 0.12);
        color: var(--text);
        font-size: 12px;
        font-weight: 700;
      }
      .panel {
        background: linear-gradient(180deg, var(--surface-strong), var(--surface));
        border-radius: 28px;
        padding: 24px;
        box-shadow: var(--shadow);
        border: 1px solid rgba(116, 93, 61, 0.12);
        backdrop-filter: blur(10px);
      }
      .panel > h2 + .hint { margin-top: 10px; }
      label { display: block; font-weight: 500; margin-bottom: 8px; font-size: var(--text-label); letter-spacing: 0; text-transform: none; }
      input[type="text"], input[type="number"], textarea, .field-textarea {
        width: 100%;
        border-radius: 16px;
        border: 1px solid var(--line);
        padding: 13px 15px;
        font: inherit;
        font-size: 15px;
        line-height: 1.4;
        box-sizing: border-box;
        background: rgba(255,255,255,0.92);
        color: var(--text);
        transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
      }
      input[type="text"]:focus, input[type="number"]:focus, textarea:focus, select:focus {
        outline: none;
        border-color: rgba(10, 111, 92, 0.45);
        box-shadow: 0 0 0 4px rgba(10, 111, 92, 0.12);
        background: #fff;
      }
      textarea { min-height: 260px; resize: vertical; font-size: var(--text-small); line-height: 1.5; }
      .field-textarea { min-height: 92px; resize: vertical; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
      button, .file-label, .link-btn {
        border: none;
        border-radius: 999px;
        min-height: 46px;
        min-width: 160px;
        padding: 0 22px;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: var(--text-small);
        line-height: 1;
        letter-spacing: 0.01em;
        white-space: nowrap;
        box-sizing: border-box;
        transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
      }
      button:hover, .file-label:hover, .link-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 20px rgba(23, 20, 17, 0.08); }
      button.primary { background: linear-gradient(180deg, #10836a 0%, var(--primary) 100%); color: #fff; }
      button.secondary, .file-label, .link-btn { background: linear-gradient(180deg, #f6efe3 0%, #ece2d1 100%); color: var(--text); }
      button.danger { background: var(--danger-bg); color: var(--danger-text); }
      input[type="file"] { display: none; }
      .status { margin-top: 16px; padding: 14px 16px; border-radius: 18px; display: none; border: 1px solid transparent; font-weight: 500; }
      .status.show { display: block; }
      .status.ok { background: var(--ok-bg); color: var(--ok-text); border-color: rgba(11, 122, 99, 0.12); }
      .status.error { background: var(--danger-bg); color: var(--danger-text); border-color: rgba(177, 38, 29, 0.12); }
      .hint { color: var(--muted); font-size: var(--text-small); line-height: 1.55; }
      .micro-copy { margin-top: 8px; color: var(--muted); font-size: 13px; line-height: 1.5; }
      .note-card { margin-top: 18px; padding: 16px 18px; border-radius: 20px; background: linear-gradient(180deg, #fffaf1, #f7efdf); border: 1px solid rgba(142, 115, 68, 0.16); }
      .note-card strong { display: block; margin-bottom: 6px; font-size: 15px; font-weight: 600; }
      .preview { margin-top: 18px; display: grid; gap: 12px; }
      .preview-card { border: 1px solid #ece5d9; border-radius: 20px; padding: 16px; background: #fffcf6; }
      .preview-card strong { display: block; margin-bottom: 4px; font-weight: 600; }
      .data-table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: var(--text-small); }
      .data-table th, .data-table td { text-align: left; padding: 12px 10px; border-bottom: 1px solid #ece5d9; vertical-align: top; }
      .data-table th { color: var(--muted); font-weight: 600; font-size: 12px; letter-spacing: 0.04em; text-transform: none; }
      .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 5px 11px; background: var(--surface-muted); font-size: 13px; font-weight: 600; }
      .menu-items { display: grid; gap: 18px; margin-top: 18px; }
      .menu-item { border: 1px solid #ece5d9; border-radius: 22px; padding: 18px; background: #fffcf6; display: grid; gap: 14px; }
      .item-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .item-head strong { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; font-family: var(--font-ui); }
      .item-head-actions {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 156px));
        gap: 8px;
        align-items: stretch;
      }
      .item-head-actions button {
        min-height: 42px;
        width: 100%;
        min-width: 0;
        padding-inline: 18px;
      }
      .item-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .full { grid-column: 1 / -1; }
      .checkbox-row { display: flex; align-items: center; gap: 10px; }
      .checkbox-row input { width: 18px; height: 18px; }
      .image-preview { width: 100%; max-width: 180px; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 16px; border: 1px solid #ece5d9; background: #f3eee4; }
      .image-preview.empty { display: grid; place-items: center; color: #7b7569; font-size: var(--text-small); padding: 14px; }
      .image-tools {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 200px));
        align-items: stretch;
        gap: 10px;
        margin-top: 10px;
      }
      .image-tools .file-label,
      .image-tools button {
        min-height: 40px;
        width: 100%;
        min-width: 0;
        padding-inline: 18px;
      }
      details { border: 1px solid #ece5d9; border-radius: 20px; padding: 16px 18px; background: #fffcf6; margin-top: 18px; }
      summary { cursor: pointer; font-weight: 600; font-size: var(--text-small); }
      select { width: 100%; border-radius: 16px; border: 1px solid var(--line); padding: 13px 15px; font: inherit; box-sizing: border-box; background: rgba(255,255,255,0.92); }
      .outlet-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 18px; }
      .field-group-title { margin: 8px 0 0; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: none; color: var(--muted); }
      .checkbox-row label { margin: 0; font-size: var(--text-small); font-weight: 500; letter-spacing: 0; text-transform: none; }
      @media (max-width: 720px) {
        .item-grid, .outlet-grid { grid-template-columns: 1fr; }
        .item-head-actions, .image-tools { grid-template-columns: 1fr; }
        .section-nav { grid-template-columns: repeat(2, minmax(0, 1fr)); position: static; }
        .shell { padding-inline: 16px; }
        .hero { padding: 24px; }
        h1 { font-size: 34px; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <p>Weborder Console</p>
        <h1>Brand, outlet, and menu operations</h1>
        <p>Manage branded ordering surfaces, outlet configuration, menus, payments, and WhatsApp journeys from one polished operational console.</p>
        <form method="post" action="/admin/logout" style="position:relative; z-index:1; margin-top:18px;">
          <button class="secondary" type="submit">Log out</button>
        </form>
      </section>

      <nav class="section-nav" aria-label="Admin setup sections">
        <a href="#outlet-setup">Outlet Setup</a>
        <a href="#connectors-setup">Connectors Setup</a>
        <a href="#live-analytics">Live Analytics</a>
        <a href="#whatsapp-marketing">WhatsApp Marketing</a>
      </nav>

      <section class="flow-section setup" id="outlet-setup">
        <div class="flow-section-head">
          <p class="flow-section-kicker">Section 1</p>
          <h2>Outlet Setup</h2>
          <p class="hint">Set up the brand and outlet structure first so links, menus, routing, and checkout all point to the right destination.</p>
          <div class="flow-section-meta">
            <span class="flow-chip">Brand profile</span>
            <span class="flow-chip">Outlet routing</span>
            <span class="flow-chip">Customer links</span>
          </div>
        </div>
        <div class="grid">
          <section class="panel">
            <h2 id="brand-panel-title">Brand Profile</h2>
            <p class="hint" id="brand-panel-hint">Your workspace was created from signup. Review these details only when your brand profile or customer app URL changes.</p>
            <label for="brand-select" id="brand-select-label">Current Brand</label>
            <select id="brand-select"></select>
            <div class="actions" id="brand-actions">
              <button class="secondary" id="add-brand" type="button">Add brand</button>
              <button class="secondary" id="remove-brand" type="button">Remove brand</button>
              <button class="primary" id="save-brands" type="button">Save Brand Profile</button>
            </div>
            <div id="brand-status" class="status"></div>
            <div id="brand-form" class="outlet-grid"></div>
          </section>

          <section class="panel">
            <h2>Outlets</h2>
            <p class="hint">Set the outlet details used for menus, orders, payments, and nearest-outlet routing.</p>
            <div id="outlet-select-wrap">
              <label for="outlet-select">Current outlet</label>
              <select id="outlet-select"></select>
            </div>
            <div id="outlet-select-empty" class="micro-copy" style="display:none;">Add your first outlet to continue.</div>
            <div class="actions">
              <button class="secondary" id="add-outlet" type="button">Add outlet</button>
              <button class="primary" id="save-outlets" type="button">Save outlets</button>
            </div>
            <div id="outlet-status" class="status"></div>
            <div id="outlet-form" class="outlet-grid"></div>
          </section>
        </div>
      </section>

      <section class="flow-section connectors" id="connectors-setup">
        <div class="flow-section-head">
          <p class="flow-section-kicker">Section 2</p>
          <h2>Connectors Setup</h2>
          <p class="hint">Save shared integrations once, then map them to the right brand or outlet before you sync menus and go live.</p>
          <div class="flow-section-meta">
            <span class="flow-chip">Petpooja</span>
            <span class="flow-chip">Payments</span>
            <span class="flow-chip">WhatsApp</span>
            <span class="flow-chip">Menu</span>
          </div>
        </div>
        <div class="grid">
          <section class="panel">
            <h2>Petpooja Connections</h2>
            <p class="hint">Save each Petpooja account once, then reuse it where needed.</p>
            <div class="note-card">
              <strong>Account details</strong>
              <span class="hint">Keep account credentials here. Outlet-specific IDs live in Outlets.</span>
            </div>
            <div id="petpooja-connection-select-wrap">
              <label for="petpooja-connection-select">Saved Petpooja account</label>
              <select id="petpooja-connection-select"></select>
              <p class="micro-copy">Shown only when more than one account is saved.</p>
            </div>
            <div class="actions">
              <button class="secondary" id="add-petpooja-connection" type="button">Add connection</button>
              <button class="secondary" id="remove-petpooja-connection" type="button">Remove connection</button>
              <button class="primary" id="save-petpooja-connections" type="button">Save connections</button>
            </div>
            <div id="petpooja-connection-status" class="status"></div>
            <div id="petpooja-connection-form" class="outlet-grid"></div>
          </section>

          <section class="panel">
            <h2>Payment Connectors</h2>
            <p class="hint">Save each payment account once, assign it to a brand, and optionally override it for specific outlets.</p>
            <div class="note-card">
              <strong>Connector details</strong>
              <span class="hint">Use one brand-level gateway account by default. Only add outlet-level overrides when settlement must flow to a different merchant account.</span>
            </div>
            <div id="payment-connection-select-wrap">
              <label for="payment-connection-select">Saved payment connector</label>
              <select id="payment-connection-select"></select>
              <p class="micro-copy">Shown only when more than one connector is saved.</p>
            </div>
            <div class="actions">
              <button class="secondary" id="add-payment-connection" type="button">Add Payment Connector</button>
              <button class="secondary" id="remove-payment-connection" type="button">Remove Payment Connector</button>
              <button class="primary" id="save-payment-connections" type="button">Save Payment Connectors</button>
            </div>
            <div id="payment-connection-status" class="status"></div>
            <div id="payment-connection-form" class="outlet-grid"></div>
            <div class="note-card">
              <strong>Assignments</strong>
              <span class="hint">Use the current Brand and Outlet selected elsewhere on this page, then choose the payment connector mapping here.</span>
            </div>
            <div id="payment-assignment-form" class="outlet-grid"></div>
            <div class="actions">
              <button class="secondary" id="save-payment-assignments" type="button">Save Payment Assignments</button>
            </div>
          </section>

          <section class="panel">
            <h2>WhatsApp Connectors</h2>
            <p class="hint">Save reusable WhatsApp connectors here, assign one as the brand default, and optionally override it per outlet.</p>
            <div class="note-card">
              <strong>Connector details</strong>
              <span class="hint">Each brand can reuse one shared number across multiple outlets, or an outlet can override it with a dedicated number later.</span>
            </div>
            <div id="whatsapp-connection-select-wrap">
              <label for="whatsapp-connection-select">Saved WhatsApp connector</label>
              <select id="whatsapp-connection-select"></select>
              <p class="micro-copy">Shown only when more than one connector is saved.</p>
            </div>
            <div class="actions">
              <button class="secondary" id="add-whatsapp-connection" type="button">Add WhatsApp Connector</button>
              <button class="secondary" id="remove-whatsapp-connection" type="button">Remove WhatsApp Connector</button>
            </div>
            <div id="whatsapp-connection-status" class="status"></div>
            <div id="whatsapp-connection-form" class="outlet-grid"></div>
            <div class="actions">
              <button class="primary" id="save-whatsapp-connection" type="button">Save WhatsApp Connector</button>
            </div>
            <div class="note-card">
              <strong>Assignments</strong>
              <span class="hint">Use the current Brand and Outlet selected elsewhere on this page, then choose the connector mapping here.</span>
            </div>
            <div id="whatsapp-assignment-form" class="outlet-grid"></div>
            <div class="actions">
              <button class="secondary" id="save-whatsapp-assignments" type="button">Save WhatsApp Assignments</button>
            </div>
          </section>

          <section class="panel">
            <h2>Menu</h2>
            <p class="hint">Bring in a menu from a file or pull it from Petpooja, then review and save.</p>
            <div class="actions">
              <label class="file-label primary" for="menu-file">Upload Menu File</label>
              <input id="menu-file" type="file" accept=".json,.csv,.xlsx,.xls,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
              <button class="primary" id="pull-petpooja-menu" type="button">Pull From Petpooja</button>
            </div>
            <div class="actions">
              <a class="link-btn" href="/api/admin/menu/sample.csv" download="menu-sample.csv">Download Sample CSV</a>
              <button class="secondary" id="load-current" type="button">Reload Current Menu</button>
              <button class="secondary" id="add-item" type="button">Add Menu Item</button>
              <button class="primary" id="save-menu" type="button">Save Menu</button>
            </div>
            <div class="micro-copy">For Petpooja sync, save the account first and finish the outlet mapping.</div>
            <div id="status" class="status"></div>
            <div id="menu-items" class="menu-items"></div>
            <details>
              <summary>Advanced JSON Editor</summary>
              <p class="hint">This stays in sync with the form. You can still paste raw JSON if needed.</p>
              <label for="menu-json">Menu JSON</label>
              <textarea id="menu-json"></textarea>
            </details>
          </section>
        </div>
      </section>

      <section class="flow-section analytics" id="live-analytics">
        <div class="flow-section-head">
          <p class="flow-section-kicker">Section 3</p>
          <h2>Live Analytics</h2>
          <p class="hint">Track the selected outlet’s live order, payment, and WhatsApp activity once the setup is complete.</p>
          <div class="flow-section-meta">
            <span class="flow-chip">Orders</span>
            <span class="flow-chip">Payments</span>
            <span class="flow-chip">WhatsApp activity</span>
          </div>
        </div>
        <div class="grid">
          <section class="panel">
            <h2>Orders</h2>
            <p class="hint">Orders shown here are filtered to the selected outlet.</p>
            <div id="orders-status" class="status"></div>
            <div id="orders-table"></div>
          </section>

          <section class="panel">
            <h2>Payments</h2>
            <p class="hint">Use these actions for local payment operations until the live gateway handles every payment event end to end.</p>
            <div id="payments-status" class="status"></div>
            <div id="payments-table"></div>
          </section>

          <section class="panel">
            <h2>WhatsApp Activity</h2>
            <p class="hint">Review recent inbound and outbound activity for the currently assigned brand and outlet path.</p>
            <div class="actions">
              <button class="secondary" id="refresh-whatsapp-events" type="button">Refresh WhatsApp Activity</button>
            </div>
            <div id="whatsapp-events-table"></div>
          </section>
        </div>
      </section>

      <section class="flow-section marketing" id="whatsapp-marketing">
        <div class="flow-section-head">
          <p class="flow-section-kicker">Section 4</p>
          <h2>WhatsApp Marketing</h2>
          <p class="hint">Send campaign messages after your brand, outlet, connectors, and live menu are already in place.</p>
          <div class="flow-section-meta">
            <span class="flow-chip">Audience</span>
            <span class="flow-chip">Campaign image</span>
            <span class="flow-chip">Broadcast</span>
          </div>
        </div>
        <div class="grid">
          <section class="panel">
            <h2>WhatsApp Marketing</h2>
            <p class="hint">Build a simple daily WhatsApp campaign in three steps: choose the audience, upload the campaign image, then send the message.</p>
            <div id="marketing-status" class="status"></div>
            <div class="actions">
              <button class="secondary" id="refresh-marketing-audience" type="button">Refresh Audience</button>
            </div>
            <p class="field-group-title">Step 1</p>
            <label>Choose audience</label>
            <p class="micro-copy">Select previous opted-in customers from this outlet.</p>
            <div id="marketing-audience"></div>
            <p class="field-group-title">Step 2</p>
            <label for="marketing-image-file">Campaign Image</label>
            <p class="micro-copy">Upload the image you want to send in the morning campaign.</p>
            <div class="image-tools">
              <label class="file-label" for="marketing-image-file">Upload Campaign Image</label>
              <input id="marketing-image-file" type="file" accept="image/*" />
            </div>
            <label for="marketing-image-url">Campaign image URL</label>
            <input id="marketing-image-url" type="text" placeholder="Upload an image or paste an existing public image URL" />
            <label for="marketing-caption">Caption</label>
            <textarea id="marketing-caption" style="min-height: 88px;"></textarea>
            <p class="field-group-title">Step 3</p>
            <label>Send message</label>
            <p class="micro-copy">Review the image and caption, then send this campaign to the selected audience.</p>
            <div class="actions">
              <button class="primary" id="send-marketing-campaign" type="button">Send Campaign</button>
            </div>
            <div id="marketing-campaigns"></div>
          </section>
        </div>
      </section>

      <div style="display:none;">
          <input id="image-file" type="file" accept="image/*" />
          <button id="upload-image" type="button"></button>
          <div id="image-status"></div>
          <textarea id="image-url"></textarea>
          <div id="image-library"></div>
          <div id="preview"></div>
          <div id="audit-table"></div>
      </div>
    </div>

    <script>
      const textarea = document.getElementById('menu-json');
      const fileInput = document.getElementById('menu-file');
      const imageFileInput = document.getElementById('image-file');
      const uploadImageButton = document.getElementById('upload-image');
      const imageUrlTextarea = document.getElementById('image-url');
      const imageLibrary = document.getElementById('image-library');
      const addItemButton = document.getElementById('add-item');
      const pullPetpoojaMenuButton = document.getElementById('pull-petpooja-menu');
      const saveButton = document.getElementById('save-menu');
      const loadButton = document.getElementById('load-current');
      const statusBox = document.getElementById('status');
      const imageStatusBox = document.getElementById('image-status');
      const brandStatusBox = document.getElementById('brand-status');
      const outletStatusBox = document.getElementById('outlet-status');
      const petpoojaConnectionStatusBox = document.getElementById('petpooja-connection-status');
      const petpoojaConnectionSelectWrap = document.getElementById('petpooja-connection-select-wrap');
      const petpoojaConnectionSelect = document.getElementById('petpooja-connection-select');
      const petpoojaConnectionForm = document.getElementById('petpooja-connection-form');
      const paymentConnectionStatusBox = document.getElementById('payment-connection-status');
      const paymentConnectionSelectWrap = document.getElementById('payment-connection-select-wrap');
      const paymentConnectionSelect = document.getElementById('payment-connection-select');
      const paymentConnectionForm = document.getElementById('payment-connection-form');
      const paymentAssignmentForm = document.getElementById('payment-assignment-form');
      const brandPanelTitle = document.getElementById('brand-panel-title');
      const brandPanelHint = document.getElementById('brand-panel-hint');
      const brandSelectLabel = document.getElementById('brand-select-label');
      const brandSelect = document.getElementById('brand-select');
      const brandForm = document.getElementById('brand-form');
      const brandActions = document.getElementById('brand-actions');
      const outletSelectWrap = document.getElementById('outlet-select-wrap');
      const outletSelectEmpty = document.getElementById('outlet-select-empty');
      const outletSelect = document.getElementById('outlet-select');
      const outletForm = document.getElementById('outlet-form');
      const ordersStatusBox = document.getElementById('orders-status');
      const paymentsStatusBox = document.getElementById('payments-status');
      const ordersTable = document.getElementById('orders-table');
      const paymentsTable = document.getElementById('payments-table');
      const auditTable = document.getElementById('audit-table');
      const addWhatsAppConnectionButton = document.getElementById('add-whatsapp-connection');
      const removeWhatsAppConnectionButton = document.getElementById('remove-whatsapp-connection');
      const whatsappConnectionSelectWrap = document.getElementById('whatsapp-connection-select-wrap');
      const whatsappConnectionSelect = document.getElementById('whatsapp-connection-select');
      const whatsappConnectionStatusBox = document.getElementById('whatsapp-connection-status');
      const whatsappConnectionForm = document.getElementById('whatsapp-connection-form');
      const whatsappAssignmentForm = document.getElementById('whatsapp-assignment-form');
      const saveWhatsAppAssignmentsButton = document.getElementById('save-whatsapp-assignments');
      const saveWhatsAppConnectionButton = document.getElementById('save-whatsapp-connection');
      const whatsappEventsTable = document.getElementById('whatsapp-events-table');
      const refreshWhatsAppEventsButton = document.getElementById('refresh-whatsapp-events');
      const marketingStatusBox = document.getElementById('marketing-status');
      const marketingAudience = document.getElementById('marketing-audience');
      const marketingCampaigns = document.getElementById('marketing-campaigns');
      const marketingImageFile = document.getElementById('marketing-image-file');
      const marketingImageUrl = document.getElementById('marketing-image-url');
      const marketingCaption = document.getElementById('marketing-caption');
      const refreshMarketingAudienceButton = document.getElementById('refresh-marketing-audience');
      const sendMarketingCampaignButton = document.getElementById('send-marketing-campaign');
      const preview = document.getElementById('preview');
      const menuItemsContainer = document.getElementById('menu-items');
      const categoryOptions = ['Lunch Bowls', 'South Indian Classics', 'Sides', 'Beverages', 'Breakfast', 'Snacks', 'Desserts'];
      const addBrandButton = document.getElementById('add-brand');
      const removeBrandButton = document.getElementById('remove-brand');
      const saveBrandsButton = document.getElementById('save-brands');
      const addPetpoojaConnectionButton = document.getElementById('add-petpooja-connection');
      const removePetpoojaConnectionButton = document.getElementById('remove-petpooja-connection');
      const savePetpoojaConnectionsButton = document.getElementById('save-petpooja-connections');
      const addPaymentConnectionButton = document.getElementById('add-payment-connection');
      const removePaymentConnectionButton = document.getElementById('remove-payment-connection');
      const savePaymentConnectionsButton = document.getElementById('save-payment-connections');
      const savePaymentAssignmentsButton = document.getElementById('save-payment-assignments');
      const addOutletButton = document.getElementById('add-outlet');
      const saveOutletsButton = document.getElementById('save-outlets');
      let brandState = [];
      let petpoojaConnectionState = [];
      let paymentConnectionState = [];
      let outletState = [];
      let whatsappConnectionState = [];
      let marketingAudienceState = [];
      let currentAdminUser = null;
      const selectedMarketingRecipients = new Set();

      function defaultItem() {
        return {
          id: '',
          petpoojaItemId: '',
          name: '',
          description: '',
          price: '',
          category: '',
          image: '',
          available: true
        };
      }

      function defaultOutlet() {
        return {
          id: '',
          brandId: brandState[0]?.id || 'neubar',
          petpoojaConnectionId: '',
          whatsappConnectionId: '',
          name: '',
          status: 'ACTIVE',
          pickupLabel: '',
          address: '',
          customerAppBaseUrl: '',
          timezone: 'Asia/Kolkata',
          latitude: '',
          longitude: '',
          locationKeywords: '',
          paymentProvider: 'Generic',
          paymentMode: 'payment_link',
          petpoojaOutletId: '',
          supportPhone: ''
        };
      }

      function defaultBrand() {
        return {
          id: '',
          name: '',
          petpoojaConnectionId: '',
          whatsappConnectionId: '',
          customerAppBaseUrl: '',
          heroEyebrow: '',
          heroTitle: '',
          heroSubtitle: '',
          logoText: '',
          logoUrl: '',
          primaryColor: '#007a63',
          accentColor: '#ffd84d',
          accentTextColor: '#202020',
          backgroundColor: '#fffaf0',
          surfaceColor: '#ffffff'
        };
      }

      function defaultPetpoojaConnection() {
        return {
          id: '',
          name: '',
          apiBaseUrl: '',
          accessToken: '',
          appKey: '',
          appSecret: '',
          restaurantId: '',
          status: 'ACTIVE'
        };
      }

      function defaultPaymentConnection() {
        return {
          id: '',
          name: 'Primary Payment Connector',
          provider: 'GENERIC',
          status: 'ACTIVE',
          apiKey: '',
          apiSecret: '',
          webhookSecret: '',
          accountId: '',
          paymentMode: 'payment_link'
        };
      }

      function defaultWhatsAppConnection() {
        return {
          id: '',
          name: 'Primary WhatsApp Connector',
          status: 'ACTIVE',
          businessAccountId: '',
          phoneNumber: '',
          phoneNumberId: '',
          verifyToken: '',
          accessToken: '',
          graphVersion: 'v25.0',
          orderNotificationRecipients: ''
        };
      }

      function setStatus(message, type) {
        statusBox.textContent = message;
        statusBox.className = 'status show ' + type;
      }

      function setImageStatus(message, type) {
        imageStatusBox.textContent = message;
        imageStatusBox.className = 'status show ' + type;
      }

      function setOutletStatus(message, type) {
        outletStatusBox.textContent = message;
        outletStatusBox.className = 'status show ' + type;
      }

      function setBrandStatus(message, type) {
        brandStatusBox.textContent = message;
        brandStatusBox.className = 'status show ' + type;
      }

      function setPetpoojaConnectionStatus(message, type) {
        petpoojaConnectionStatusBox.textContent = message;
        petpoojaConnectionStatusBox.className = message ? 'status show ' + type : 'status';
      }

      function setPaymentConnectionStatus(message, type) {
        paymentConnectionStatusBox.textContent = message;
        paymentConnectionStatusBox.className = message ? 'status show ' + type : 'status';
      }

      function setWhatsAppConnectionStatus(message, type) {
        whatsappConnectionStatusBox.textContent = message;
        whatsappConnectionStatusBox.className = message ? 'status show ' + type : 'status';
      }

      function setOrdersStatus(message, type) {
        ordersStatusBox.textContent = message;
        ordersStatusBox.className = message ? 'status show ' + type : 'status';
      }

      function setPaymentsStatus(message, type) {
        paymentsStatusBox.textContent = message;
        paymentsStatusBox.className = message ? 'status show ' + type : 'status';
      }

      function setMarketingStatus(message, type) {
        marketingStatusBox.textContent = message;
        marketingStatusBox.className = message ? 'status show ' + type : 'status';
      }

      function isPlatformAdminUser() {
        return currentAdminUser?.role === 'PLATFORM_ADMIN';
      }

      async function loadAdminProfile() {
        const res = await fetch('/api/admin/me');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load admin profile');
        currentAdminUser = data.user || null;
        applyBrandProfileMode();
      }

      async function loadAdminProfileSafely() {
        try {
          await loadAdminProfile();
        } catch (error) {
          currentAdminUser = null;
          applyBrandProfileMode();
          setBrandStatus('Brand profile is editable. Admin role details could not be loaded, so multi-brand controls are temporarily visible.', 'ok');
        }
      }

      function applyBrandProfileMode() {
        const platformAdmin = isPlatformAdminUser();
        brandPanelTitle.textContent = platformAdmin ? 'Brands' : 'Brand Profile';
        brandPanelHint.textContent = platformAdmin
          ? 'Manage brand workspaces. Each brand can then edit its own profile after signup.'
          : 'Created during signup. Edit only if your brand name, tag line, logo, or customer app URL changes.';
        saveBrandsButton.textContent = platformAdmin ? 'Save Brands' : 'Save Brand Profile';
        addBrandButton.style.display = platformAdmin ? '' : 'none';
        removeBrandButton.style.display = platformAdmin ? '' : 'none';
        const showBrandSelector = platformAdmin || brandState.length > 1;
        brandSelect.style.display = showBrandSelector ? '' : 'none';
        brandSelectLabel.style.display = showBrandSelector ? '' : 'none';
        brandActions.classList.toggle('single-action', !platformAdmin);
      }

      async function uploadImageFile(file) {
        const formData = new FormData();
        formData.append('image', file);

        const res = await fetch('/api/admin/menu/upload-image?outletId=' + encodeURIComponent(getSelectedOutletId()), {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not upload image');
        return data.imageUrl;
      }

      function escapeHtml(value) {
        return String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function slugifyIdentifier(value) {
        return String(value || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
      }

      function slugifySubdomain(value) {
        return String(value || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }

      function buildSuggestedBrandAppUrl(brandName) {
        const subdomain = slugifySubdomain(brandName);
        return subdomain ? 'https://' + subdomain + '.pikquik.com' : '';
      }

      function isSuggestedBrandAppUrl(value) {
        return /^https:\/\/[a-z0-9-]+\.pikquik\.com$/i.test(String(value || '').trim());
      }

      function renderPreview(rawText) {
        preview.innerHTML = '';
        try {
          const items = JSON.parse(rawText);
          if (!Array.isArray(items)) throw new Error('Menu JSON must be an array.');

          items.forEach((item) => {
            const card = document.createElement('div');
            card.className = 'preview-card';
            card.innerHTML = '<strong>' + (item.name || 'Untitled item') + '</strong>' +
              '<div>ID: ' + (item.id || '-') + '</div>' +
              '<div>Category: ' + (item.category || '-') + '</div>' +
              '<div>Price: ₹' + (item.price ?? '-') + '</div>' +
              '<div>Available: ' + (item.available === false ? 'No' : 'Yes') + '</div>';
            preview.appendChild(card);
          });

          if (items.length === 0) {
            preview.innerHTML = '<p class="hint">No items in this menu yet.</p>';
          }
        } catch (error) {
          preview.innerHTML = '<p class="hint">' + error.message + '</p>';
        }
      }

      function renderOrdersTable(orders) {
        if (!orders.length) {
          ordersTable.innerHTML = '<p class="hint">No orders for this outlet yet.</p>';
          return;
        }

        ordersTable.innerHTML =
          '<table class="data-table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
          orders.map((order) =>
            '<tr>' +
              '<td><strong>' + escapeHtml(order.id) + '</strong><br /><span class="hint">' + escapeHtml(order.createdAt) + '</span></td>' +
              '<td>' + escapeHtml(order.customerMobile) + '</td>' +
              '<td>₹' + escapeHtml(order.total) + '</td>' +
              '<td><span class="pill">' + escapeHtml(order.paymentStatus) + '</span></td>' +
              '<td>' + escapeHtml(order.orderStatus) + '</td>' +
              '<td>' +
                (order.paymentStatus === 'PAID'
                  ? '<button class="secondary resend-confirmation" type="button" data-order-id="' + escapeHtml(order.id) + '">Resend WhatsApp</button>'
                  : '<span class="hint">Awaiting payment</span>') +
              '</td>' +
            '</tr>'
          ).join('') +
          '</tbody></table>';
      }

      function renderPaymentsTable(payments) {
        if (!payments.length) {
          paymentsTable.innerHTML = '<p class="hint">No payment records for this outlet yet.</p>';
          return;
        }

        paymentsTable.innerHTML =
          '<table class="data-table"><thead><tr><th>Order</th><th>Provider</th><th>Amount</th><th>Payment Status</th><th>Verification</th><th>Actions</th></tr></thead><tbody>' +
          payments.map((paymentRow) =>
            '<tr>' +
              '<td><strong>' + escapeHtml(paymentRow.orderId) + '</strong><br /><span class="hint">' + escapeHtml(paymentRow.createdAt) + '</span></td>' +
              '<td>' + escapeHtml(paymentRow.payment?.provider || '-') + '</td>' +
              '<td>₹' + escapeHtml(paymentRow.total) + '</td>' +
              '<td><span class="pill">' + escapeHtml(paymentRow.payment?.status || '-') + '</span></td>' +
              '<td>' + (paymentRow.payment?.verifiedByWebhook ? 'Verified webhook' : 'Pending/manual') + '</td>' +
              '<td>' +
                (paymentRow.payment?.status === 'PAID'
                  ? '<span class="hint">No action required</span>'
                  : '<button class="primary simulate-paid" type="button" data-order-id="' + escapeHtml(paymentRow.orderId) + '">Simulate Paid</button>') +
              '</td>' +
            '</tr>'
          ).join('') +
          '</tbody></table>';
      }

      function renderImageLibrary(images) {
        if (!images.length) {
          imageLibrary.innerHTML = '<p class="hint">No uploaded images for this outlet yet.</p>';
          return;
        }

        imageLibrary.innerHTML = images.map((image) =>
          '<div class="preview-card">' +
            '<strong>' + escapeHtml(image.originalName || image.filename) + '</strong>' +
            '<div>Uploaded: ' + escapeHtml(image.uploadedAt) + '</div>' +
            '<div><a href="' + escapeHtml(image.imageUrl) + '" target="_blank" rel="noreferrer">Open image</a></div>' +
          '</div>'
        ).join('');
      }

      function renderAuditTable(entries) {
        if (!entries.length) {
          auditTable.innerHTML = '<p class="hint">No audit history for this outlet yet.</p>';
          return;
        }

        auditTable.innerHTML =
          '<table class="data-table"><thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Summary</th><th>Actor</th></tr></thead><tbody>' +
          entries.map((entry) =>
            '<tr>' +
              '<td>' + escapeHtml(entry.createdAt) + '</td>' +
              '<td><span class="pill">' + escapeHtml(entry.action) + '</span></td>' +
              '<td>' + escapeHtml(entry.entityType + (entry.entityId ? ' / ' + entry.entityId : '')) + '</td>' +
              '<td>' + escapeHtml(entry.summary) + '</td>' +
              '<td>' + escapeHtml(entry.actor || 'system') + '</td>' +
            '</tr>'
          ).join('') +
          '</tbody></table>';
      }

      function renderWhatsAppEvents(events) {
        if (!events.length) {
          whatsappEventsTable.innerHTML = '<p class="hint">No WhatsApp activity has been captured yet.</p>';
          return;
        }

        whatsappEventsTable.innerHTML =
          '<table class="data-table"><thead><tr><th>When</th><th>Direction</th><th>Customer</th><th>Summary</th><th>Payload</th></tr></thead><tbody>' +
          events.map((event) =>
            '<tr>' +
              '<td>' + escapeHtml(event.createdAt) + '</td>' +
              '<td><span class="pill">' + escapeHtml(event.direction) + '</span></td>' +
              '<td>' + escapeHtml(event.customerMobile || '-') + '</td>' +
              '<td>' + escapeHtml(event.summary || event.eventType) + '</td>' +
              '<td><details><summary>View</summary><pre style="white-space:pre-wrap;">' + escapeHtml(JSON.stringify(event.payload, null, 2)) + '</pre></details></td>' +
            '</tr>'
          ).join('') +
          '</tbody></table>';
      }

      function renderMarketingAudience(audience) {
        if (!audience.length) {
          marketingAudience.innerHTML = '<p class="hint">No prior customers available for this outlet yet.</p>';
          return;
        }

        marketingAudience.innerHTML =
          '<table class="data-table"><thead><tr><th>Select</th><th>Customer</th><th>Last Order</th><th>Orders</th></tr></thead><tbody>' +
          audience.map((entry) =>
            '<tr>' +
              '<td><input type="checkbox" class="marketing-recipient" data-mobile="' + escapeHtml(entry.customerMobile) + '"' + (selectedMarketingRecipients.has(entry.customerMobile) ? ' checked' : '') + ' /></td>' +
              '<td>' + escapeHtml(entry.customerMobile) + '</td>' +
              '<td>' + escapeHtml(entry.lastOrderId || '-') + '<br /><span class="hint">' + escapeHtml(entry.lastOrderedAt || '-') + '</span></td>' +
              '<td>' + escapeHtml(String(entry.totalOrders || 0)) + '</td>' +
            '</tr>'
          ).join('') +
          '</tbody></table>';
      }

      function renderMarketingCampaigns(campaigns) {
        if (!campaigns.length) {
          marketingCampaigns.innerHTML = '<p class="hint">No campaigns sent yet.</p>';
          return;
        }

        marketingCampaigns.innerHTML =
          '<table class="data-table"><thead><tr><th>When</th><th>Recipients</th><th>Sent</th><th>Failed</th><th>Image</th></tr></thead><tbody>' +
          campaigns.map((campaign) =>
            '<tr>' +
              '<td>' + escapeHtml(campaign.createdAt) + '</td>' +
              '<td>' + escapeHtml(String((campaign.recipients || []).length)) + '</td>' +
              '<td>' + escapeHtml(String(campaign.sentCount || 0)) + '</td>' +
              '<td>' + escapeHtml(String(campaign.failedCount || 0)) + '</td>' +
              '<td><a href="' + escapeHtml(campaign.imageUrl) + '" target="_blank" rel="noreferrer">Open image</a></td>' +
            '</tr>'
          ).join('') +
          '</tbody></table>';
      }

      function renderBrandSelector() {
        brandSelect.innerHTML = brandState.map((brand, index) =>
          '<option value="' + escapeHtml(String(index)) + '">' + escapeHtml(brand.name || brand.id || ('Brand ' + (index + 1))) + '</option>'
        ).join('');
      }

      function renderPetpoojaConnectionSelector() {
        if (!petpoojaConnectionState.length) {
          petpoojaConnectionState = [defaultPetpoojaConnection()];
        }
        petpoojaConnectionSelect.innerHTML = petpoojaConnectionState.map((connection, index) =>
          '<option value="' + escapeHtml(String(index)) + '">' + escapeHtml(connection.name || connection.id || ('Connection ' + (index + 1))) + '</option>'
        ).join('');
        petpoojaConnectionSelectWrap.style.display = petpoojaConnectionState.length > 1 ? 'block' : 'none';
      }

      function renderPaymentConnectionSelector() {
        if (!paymentConnectionState.length) {
          paymentConnectionState = [defaultPaymentConnection()];
        }
        paymentConnectionSelect.innerHTML = paymentConnectionState.map((connection, index) =>
          '<option value="' + escapeHtml(String(index)) + '">' + escapeHtml(connection.name || connection.id || ('Payment Connector ' + (index + 1))) + '</option>'
        ).join('');
        paymentConnectionSelectWrap.style.display = paymentConnectionState.length > 1 ? 'block' : 'none';
      }

      function renderBrandForm(selectedIndex) {
        const brand = brandState[selectedIndex] || defaultBrand();
        brandForm.innerHTML =
          '<div><label>Brand name</label><input type="text" data-brand-field="name" value="' + escapeHtml(brand.name) + '" placeholder="PikQuik" /></div>' +
          '<div><label>Tag line</label><input type="text" data-brand-field="heroTitle" value="' + escapeHtml(brand.heroTitle || '') + '" placeholder="Order ahead. Pay online. Pick up fast." /></div>' +
          '<div class="full"><label>App URL</label><input type="text" data-brand-field="customerAppBaseUrl" value="' + escapeHtml(brand.customerAppBaseUrl || '') + '" placeholder="https://brand.pikquik.com" /><div class="micro-copy">Required. Used for customer links shared by WhatsApp, campaigns, and payment success flows.</div></div>' +
          '<div class="full"><label>Logo (optional)</label><div class="image-tools"><label class="file-label" for="brand-logo-file">Upload logo</label><input id="brand-logo-file" type="file" accept="image/*" data-brand-logo-file="true" /></div>' +
          '<input type="text" data-brand-field="logoUrl" value="' + escapeHtml(brand.logoUrl || '') + '" placeholder="Logo will be uploaded and linked automatically" readonly />' +
          (brand.logoUrl ? '<div style="margin-top:8px;"><img class="image-preview" src="' + escapeHtml(brand.logoUrl) + '" alt="' + escapeHtml(brand.name || 'Brand logo') + '" style="max-width:180px; max-height:56px; width:auto; height:auto; object-fit:contain;" /></div>' : '') +
          '</div>';
      }

      function renderPetpoojaConnectionForm(selectedIndex) {
        const connection = petpoojaConnectionState[selectedIndex] || defaultPetpoojaConnection();
        petpoojaConnectionForm.innerHTML =
          '<div class="full"><div class="hint">Save the account once, then assign it below.</div></div>' +
          '<div class="full field-group-title">Account</div>' +
          '<div><label>Internal connection ID</label><input type="text" data-petpooja-connection-field="id" value="' + escapeHtml(connection.id) + '" placeholder="petpooja_primary" /></div>' +
          '<div><label>Display name</label><input type="text" data-petpooja-connection-field="name" value="' + escapeHtml(connection.name) + '" placeholder="Primary Petpooja Account" /></div>' +
          '<div><label>Status</label><select data-petpooja-connection-field="status"><option value="ACTIVE"' + (connection.status === 'ACTIVE' ? ' selected' : '') + '>Active</option><option value="INACTIVE"' + (connection.status === 'INACTIVE' ? ' selected' : '') + '>Inactive</option></select></div>' +
          '<div><label>Restaurant ID</label><input type="text" data-petpooja-connection-field="restaurantId" value="' + escapeHtml(connection.restaurantId || '') + '" placeholder="Shared restaurant ID for this Petpooja account" /></div>' +
          '<div class="full field-group-title">Credentials</div>' +
          '<div class="full micro-copy">Paste the values from Petpooja.</div>' +
          '<div><label>API base URL</label><input type="text" data-petpooja-connection-field="apiBaseUrl" value="' + escapeHtml(connection.apiBaseUrl || '') + '" placeholder="' + escapeHtml(DEFAULT_PETPOOJA_API_BASE_URL) + '" /></div>' +
          '<div><label>Access token</label><input type="text" data-petpooja-connection-field="accessToken" value="' + escapeHtml(connection.accessToken || '') + '" placeholder="Paste the refreshed Petpooja access token" /></div>' +
          '<div><label>App key</label><input type="text" data-petpooja-connection-field="appKey" value="' + escapeHtml(connection.appKey || '') + '" /></div>' +
          '<div><label>App secret</label><input type="text" data-petpooja-connection-field="appSecret" value="' + escapeHtml(connection.appSecret || '') + '" /></div>' +
          '<div class="full micro-copy">Then assign the account in Outlets and pull the menu.</div>';
      }

      function renderPaymentConnectionForm(selectedIndex) {
        const connection = paymentConnectionState[selectedIndex] || defaultPaymentConnection();
        paymentConnectionForm.innerHTML =
          '<div class="full"><div class="hint">Save the payment account once, then assign it to brands or outlets.</div></div>' +
          '<div class="full field-group-title">Connector</div>' +
          '<div><label>Internal connector ID</label><input type="text" data-payment-connection-field="id" value="' + escapeHtml(connection.id || '') + '" placeholder="brand_main_razorpay" /></div>' +
          '<div><label>Display name</label><input type="text" data-payment-connection-field="name" value="' + escapeHtml(connection.name || '') + '" placeholder="Primary Payment Connector" /></div>' +
          '<div><label>Provider</label><select data-payment-connection-field="provider">' +
            '<option value="GENERIC"' + (connection.provider === 'GENERIC' ? ' selected' : '') + '>Generic</option>' +
            '<option value="RAZORPAY"' + (connection.provider === 'RAZORPAY' ? ' selected' : '') + '>Razorpay</option>' +
            '<option value="CASHFREE"' + (connection.provider === 'CASHFREE' ? ' selected' : '') + '>Cashfree</option>' +
            '<option value="PHONEPE"' + (connection.provider === 'PHONEPE' ? ' selected' : '') + '>PhonePe</option>' +
            '<option value="PAYU"' + (connection.provider === 'PAYU' ? ' selected' : '') + '>PayU</option>' +
            '<option value="STRIPE"' + (connection.provider === 'STRIPE' ? ' selected' : '') + '>Stripe</option>' +
          '</select></div>' +
          '<div><label>Status</label><select data-payment-connection-field="status"><option value="ACTIVE"' + (connection.status === 'ACTIVE' ? ' selected' : '') + '>Active</option><option value="INACTIVE"' + (connection.status === 'INACTIVE' ? ' selected' : '') + '>Inactive</option></select></div>' +
          '<div class="full field-group-title">Credentials</div>' +
          '<div><label>API key / client ID</label><input type="text" data-payment-connection-field="apiKey" value="' + escapeHtml(connection.apiKey || '') + '" placeholder="Gateway API key or client id" /></div>' +
          '<div><label>API secret</label><input type="text" data-payment-connection-field="apiSecret" value="' + escapeHtml(connection.apiSecret || '') + '" placeholder="Gateway API secret" /></div>' +
          '<div><label>Webhook secret</label><input type="text" data-payment-connection-field="webhookSecret" value="' + escapeHtml(connection.webhookSecret || '') + '" placeholder="Gateway webhook secret" /></div>' +
          '<div><label>Merchant / account ID (optional)</label><input type="text" data-payment-connection-field="accountId" value="' + escapeHtml(connection.accountId || '') + '" placeholder="Linked account, sub-account, or merchant id" /></div>' +
          '<div class="full"><label>Payment mode</label><input type="text" data-payment-connection-field="paymentMode" value="' + escapeHtml(connection.paymentMode || 'payment_link') + '" placeholder="payment_link, hosted_checkout, intent" /></div>' +
          '<div class="full micro-copy">Razorpay is implemented today. Other providers can be configured now and enabled with their API handlers next.</div>';
      }

      function renderPaymentAssignments() {
        const currentBrand = brandState[Number(brandSelect.value || 0)] || defaultBrand();
        const currentOutlet = outletState[Number(outletSelect.value || 0)] || defaultOutlet();
        const connectorOptions = ['<option value="">No connector assigned</option>'].concat(
          paymentConnectionState.map((connection) =>
            '<option value="' + escapeHtml(connection.id || '') + '"' + (currentBrand.paymentConnectionId === connection.id ? ' selected' : '') + '>' + escapeHtml(connection.name || connection.id) + '</option>'
          )
        ).join('');
        const outletConnectorOptions = ['<option value="">Use brand default</option>'].concat(
          paymentConnectionState.map((connection) =>
            '<option value="' + escapeHtml(connection.id || '') + '"' + (currentOutlet.paymentConnectionId === connection.id ? ' selected' : '') + '>' + escapeHtml(connection.name || connection.id) + '</option>'
          )
        ).join('');
        paymentAssignmentForm.innerHTML =
          '<div class="full"><div class="hint">Assignments follow the Brand and Outlet currently selected on this page.</div></div>' +
          '<div><label>Current brand</label><input type="text" value="' + escapeHtml(currentBrand.name || currentBrand.id || 'No brand selected') + '" readonly /></div>' +
          '<div><label>Brand default payment connector</label><select data-payment-brand-assignment="paymentConnectionId">' + connectorOptions + '</select></div>' +
          '<div><label>Current outlet</label><input type="text" value="' + escapeHtml(currentOutlet.name || currentOutlet.id || 'No outlet selected') + '" readonly /></div>' +
          '<div><label>Outlet payment connector override</label><select data-payment-outlet-assignment="paymentConnectionId">' + outletConnectorOptions + '</select></div>';
      }

      function renderWhatsAppConnectionSelector() {
        if (!whatsappConnectionState.length) {
          whatsappConnectionState = [defaultWhatsAppConnection()];
        }
        whatsappConnectionSelect.innerHTML = whatsappConnectionState.map((connection, index) =>
          '<option value="' + escapeHtml(String(index)) + '">' + escapeHtml(connection.name || connection.id || ('WhatsApp Connector ' + (index + 1))) + '</option>'
        ).join('');
        whatsappConnectionSelectWrap.style.display = whatsappConnectionState.length > 1 ? 'block' : 'none';
      }

      function renderWhatsAppConnectionForm(selectedIndex) {
        const connection = whatsappConnectionState[selectedIndex] || defaultWhatsAppConnection();
        whatsappConnectionForm.innerHTML =
          '<div class="full"><div class="hint">Save the Meta account once, then monitor events below.</div></div>' +
          '<div class="full field-group-title">Connector</div>' +
          '<div><label>Internal connector ID</label><input type="text" data-whatsapp-connection-field="id" value="' + escapeHtml(connection.id || '') + '" placeholder="brand_main_whatsapp" /></div>' +
          '<div><label>Display name</label><input type="text" data-whatsapp-connection-field="name" value="' + escapeHtml(connection.name || '') + '" placeholder="Primary WhatsApp Connector" /></div>' +
          '<div><label>Status</label><select data-whatsapp-connection-field="status"><option value="ACTIVE"' + (connection.status === 'ACTIVE' ? ' selected' : '') + '>Active</option><option value="INACTIVE"' + (connection.status === 'INACTIVE' ? ' selected' : '') + '>Inactive</option></select></div>' +
          '<div><label>WhatsApp number</label><input type="text" data-whatsapp-connection-field="phoneNumber" value="' + escapeHtml(connection.phoneNumber || '') + '" placeholder="+919900000001" /></div>' +
          '<div class="full field-group-title">Credentials</div>' +
          '<div><label>Phone number ID</label><input type="text" data-whatsapp-connection-field="phoneNumberId" value="' + escapeHtml(connection.phoneNumberId || '') + '" placeholder="Meta phone number id" /></div>' +
          '<div><label>Verify token</label><input type="text" data-whatsapp-connection-field="verifyToken" value="' + escapeHtml(connection.verifyToken || '') + '" placeholder="Meta webhook verify token" /></div>' +
          '<div class="full"><label>Access token</label><input type="text" data-whatsapp-connection-field="accessToken" value="' + escapeHtml(connection.accessToken || '') + '" placeholder="Paste the Meta Cloud API access token" /></div>' +
          '<div class="full field-group-title">Order alerts</div>' +
          '<div class="full"><label>Paid order alert recipients</label><input type="text" data-whatsapp-connection-field="orderNotificationRecipients" value="' + escapeHtml(connection.orderNotificationRecipients || '') + '" placeholder="919900000001,919900000002" /><div class="micro-copy">These backend team numbers receive paid-order WhatsApp alerts. The WhatsApp number above is the sender; these are the recipients.</div></div>' +
          '<div class="full micro-copy">Graph version stays on the backend default unless you change it in code. Saved fields are used first for webhook verification and outbound sends.</div>';
      }

      function renderWhatsAppAssignments() {
        const currentBrand = brandState[Number(brandSelect.value || 0)] || defaultBrand();
        const currentOutlet = outletState[Number(outletSelect.value || 0)] || defaultOutlet();
        const connectorOptions = ['<option value="">No connector assigned</option>'].concat(
          whatsappConnectionState.map((connection) =>
            '<option value="' + escapeHtml(connection.id || '') + '"' + (currentBrand.whatsappConnectionId === connection.id ? ' selected' : '') + '>' + escapeHtml(connection.name || connection.id) + '</option>'
          )
        ).join('');
        const outletConnectorOptions = ['<option value="">Use brand default</option>'].concat(
          whatsappConnectionState.map((connection) =>
            '<option value="' + escapeHtml(connection.id || '') + '"' + (currentOutlet.whatsappConnectionId === connection.id ? ' selected' : '') + '>' + escapeHtml(connection.name || connection.id) + '</option>'
          )
        ).join('');
        whatsappAssignmentForm.innerHTML =
          '<div class="full"><div class="hint">Assignments follow the Brand and Outlet currently selected on this page.</div></div>' +
          '<div><label>Current brand</label><input type="text" value="' + escapeHtml(currentBrand.name || currentBrand.id || 'No brand selected') + '" readonly /></div>' +
          '<div><label>Brand default connector</label><select data-whatsapp-brand-assignment="whatsappConnectionId">' + connectorOptions + '</select></div>' +
          '<div><label>Current outlet</label><input type="text" value="' + escapeHtml(currentOutlet.name || currentOutlet.id || 'No outlet selected') + '" readonly /></div>' +
          '<div><label>Outlet connector override</label><select data-whatsapp-outlet-assignment="whatsappConnectionId">' + outletConnectorOptions + '</select></div>';
      }

      function renderOutletSelector() {
        if (!outletState.length) {
          outletSelect.innerHTML = '';
          outletSelectWrap.style.display = 'none';
          outletSelectEmpty.style.display = 'block';
          return;
        }
        outletSelect.innerHTML = outletState.map((outlet, index) =>
          '<option value="' + escapeHtml(String(index)) + '">' + escapeHtml(outlet.name || outlet.id || ('Outlet ' + (index + 1))) + '</option>'
        ).join('');
        outletSelectWrap.style.display = outletState.length > 1 ? 'block' : 'none';
        outletSelectEmpty.style.display = 'none';
        if (outletState.length === 1) {
          outletSelect.value = '0';
        }
      }

      function renderOutletForm(selectedIndex) {
        const outlet = outletState[selectedIndex] || defaultOutlet();
        const brandOptions = brandState.map((brand) =>
          '<option value="' + escapeHtml(brand.id) + '"' + (outlet.brandId === brand.id ? ' selected' : '') + '>' + escapeHtml(brand.name || brand.id) + '</option>'
        ).join('');
        const connectionOptions = ['<option value="">Use brand default</option>'].concat(
          petpoojaConnectionState.map((connection) =>
            '<option value="' + escapeHtml(connection.id) + '"' + (outlet.petpoojaConnectionId === connection.id ? ' selected' : '') + '>' + escapeHtml(connection.name || connection.id) + '</option>'
          )
        ).join('');
        outletForm.innerHTML =
          '<div><label>Outlet id</label><input type="text" data-outlet-field="id" value="' + escapeHtml(outlet.id) + '" /></div>' +
          '<div><label>Brand</label><select data-outlet-field="brandId">' + brandOptions + '</select></div>' +
          '<div><label>Petpooja connection override</label><select data-outlet-field="petpoojaConnectionId">' + connectionOptions + '</select></div>' +
          '<div><label>Outlet name</label><input type="text" data-outlet-field="name" value="' + escapeHtml(outlet.name) + '" /></div>' +
          '<div><label>Status</label><select data-outlet-field="status"><option value="ACTIVE"' + (outlet.status === 'ACTIVE' ? ' selected' : '') + '>Active</option><option value="INACTIVE"' + (outlet.status === 'INACTIVE' ? ' selected' : '') + '>Inactive</option></select></div>' +
          '<div><label>Pickup label</label><input type="text" data-outlet-field="pickupLabel" value="' + escapeHtml(outlet.pickupLabel) + '" /></div>' +
          '<div><label>Address</label><input type="text" data-outlet-field="address" value="' + escapeHtml(outlet.address) + '" /></div>' +
          '<div><label>Outlet URL override</label><input type="text" data-outlet-field="customerAppBaseUrl" value="' + escapeHtml(outlet.customerAppBaseUrl || '') + '" /></div>' +
          '<div><label>Latitude</label><input type="text" data-outlet-field="latitude" value="' + escapeHtml(outlet.latitude ?? '') + '" /></div>' +
          '<div><label>Longitude</label><input type="text" data-outlet-field="longitude" value="' + escapeHtml(outlet.longitude ?? '') + '" /></div>' +
          '<div><label>Location keywords</label><input type="text" data-outlet-field="locationKeywords" value="' + escapeHtml(Array.isArray(outlet.locationKeywords) ? outlet.locationKeywords.join(', ') : outlet.locationKeywords || '') + '" /></div>' +
          '<div><label>Timezone</label><input type="text" data-outlet-field="timezone" value="' + escapeHtml(outlet.timezone) + '" /></div>' +
          '<div><label>Payment provider</label><input type="text" data-outlet-field="paymentProvider" value="' + escapeHtml(outlet.paymentProvider) + '" /></div>' +
          '<div><label>Payment mode</label><input type="text" data-outlet-field="paymentMode" value="' + escapeHtml(outlet.paymentMode) + '" /></div>' +
          '<div><label>Petpooja outlet id</label><input type="text" data-outlet-field="petpoojaOutletId" value="' + escapeHtml(outlet.petpoojaOutletId) + '" /></div>' +
          '<div><label>Petpooja restaurant id</label><input type="text" data-outlet-field="petpoojaRestaurantId" value="' + escapeHtml(outlet.petpoojaRestaurantId || '') + '" /></div>' +
          '<div><label>Support phone</label><input type="text" data-outlet-field="supportPhone" value="' + escapeHtml(outlet.supportPhone) + '" /></div>';
      }

      function syncOutletStateFromForm() {
        const selectedIndex = Number(outletSelect.value || 0);
        if (!outletState[selectedIndex]) return;
        Array.from(outletForm.querySelectorAll('[data-outlet-field]')).forEach((field) => {
          outletState[selectedIndex][field.dataset.outletField] = field.value.trim();
        });
        renderOutletSelector();
        outletSelect.value = String(selectedIndex);
      }

      function syncBrandStateFromForm() {
        const selectedIndex = Number(brandSelect.value || 0);
        if (!brandState[selectedIndex]) return;
        const previousAppUrl = brandState[selectedIndex].customerAppBaseUrl || '';
        Array.from(brandForm.querySelectorAll('[data-brand-field]')).forEach((field) => {
          brandState[selectedIndex][field.dataset.brandField] = field.value.trim();
        });
        if (!brandState[selectedIndex].id && brandState[selectedIndex].name) {
          brandState[selectedIndex].id = slugifyIdentifier(brandState[selectedIndex].name);
        }
        const suggestedAppUrl = buildSuggestedBrandAppUrl(brandState[selectedIndex].name);
        if (
          suggestedAppUrl &&
          (!brandState[selectedIndex].customerAppBaseUrl || isSuggestedBrandAppUrl(previousAppUrl))
        ) {
          brandState[selectedIndex].customerAppBaseUrl = suggestedAppUrl;
          const appUrlField = brandForm.querySelector('[data-brand-field="customerAppBaseUrl"]');
          if (appUrlField) appUrlField.value = suggestedAppUrl;
        }
        if (brandState[selectedIndex].name) {
          brandState[selectedIndex].logoText = brandState[selectedIndex].name;
        }
        if (!brandState[selectedIndex].heroEyebrow) {
          brandState[selectedIndex].heroEyebrow = brandState[selectedIndex].name || 'Brand';
        }
        renderBrandSelector();
        brandSelect.value = String(selectedIndex);
      }

      function syncPetpoojaConnectionStateFromForm() {
        const selectedIndex = Number(petpoojaConnectionSelect.value || 0);
        if (!petpoojaConnectionState[selectedIndex]) return;
        Array.from(petpoojaConnectionForm.querySelectorAll('[data-petpooja-connection-field]')).forEach((field) => {
          petpoojaConnectionState[selectedIndex][field.dataset.petpoojaConnectionField] = field.value.trim();
        });
        renderPetpoojaConnectionSelector();
        petpoojaConnectionSelect.value = String(selectedIndex);
      }

      function syncPaymentConnectionStateFromForm() {
        const selectedIndex = Number(paymentConnectionSelect.value || 0);
        if (!paymentConnectionState[selectedIndex]) return;
        Array.from(paymentConnectionForm.querySelectorAll('[data-payment-connection-field]')).forEach((field) => {
          paymentConnectionState[selectedIndex][field.dataset.paymentConnectionField] = field.value.trim();
        });
        renderPaymentConnectionSelector();
        paymentConnectionSelect.value = String(selectedIndex);
      }

      function syncWhatsAppConnectionStateFromForm() {
        const selectedIndex = Number(whatsappConnectionSelect.value || 0);
        if (!whatsappConnectionState[selectedIndex]) return;
        Array.from(whatsappConnectionForm.querySelectorAll('[data-whatsapp-connection-field]')).forEach((field) => {
          whatsappConnectionState[selectedIndex][field.dataset.whatsappConnectionField] = field.value.trim();
        });
        renderWhatsAppConnectionSelector();
        whatsappConnectionSelect.value = String(selectedIndex);
      }

      function getSelectedOutletId() {
        const selectedIndex = Number(outletSelect.value || 0);
        return outletState[selectedIndex]?.id || outletState[0]?.id || 'showcase_hq';
      }

      async function loadBrands() {
        const res = await fetch('/api/admin/brands');
        const data = await res.json();
        brandState = data.brands || [];
        if (!brandState.length) {
          brandState = [defaultBrand()];
          setBrandStatus('Add your brand profile to continue. The app URL will auto-fill from the brand name.', 'ok');
        }
        renderBrandSelector();
        applyBrandProfileMode();
        renderBrandForm(0);
        renderPaymentAssignments();
        renderWhatsAppAssignments();
      }

      async function loadPetpoojaConnections() {
        const res = await fetch('/api/admin/petpooja-connections');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load Petpooja connections');
        petpoojaConnectionState = (data.connections && data.connections.length) ? data.connections : [defaultPetpoojaConnection()];
        renderPetpoojaConnectionSelector();
        renderPetpoojaConnectionForm(0);
        if (brandState.length) {
          renderBrandForm(Number(brandSelect.value || 0));
        }
        if (outletState.length) {
          renderOutletForm(Number(outletSelect.value || 0));
        }
      }

      async function loadPaymentConnections() {
        const res = await fetch('/api/admin/payment-connections');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load payment connectors');
        paymentConnectionState = (data.connections && data.connections.length) ? data.connections : [defaultPaymentConnection()];
        renderPaymentConnectionSelector();
        renderPaymentConnectionForm(0);
        renderPaymentAssignments();
      }

      async function loadWhatsAppConnections() {
        const res = await fetch('/api/admin/whatsapp-connections');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load WhatsApp connectors');
        whatsappConnectionState = (data.connections && data.connections.length) ? data.connections : [defaultWhatsAppConnection()];
        renderWhatsAppConnectionSelector();
        renderWhatsAppConnectionForm(0);
        renderWhatsAppAssignments();
      }

      async function loadOutlets() {
        const res = await fetch('/api/admin/outlets');
        const data = await res.json();
        outletState = data.outlets || [];
        renderOutletSelector();
        renderOutletForm(0);
        renderPaymentAssignments();
        renderWhatsAppAssignments();
      }

      function createItemCard(item, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'menu-item';
        const categoryListId = 'category-options-' + index;
        const hasImage = Boolean(item.image);
        wrapper.innerHTML =
          '<div class="item-head">' +
            '<strong>Item ' + (index + 1) + '</strong>' +
            '<div class="item-head-actions">' +
              '<button class="secondary move-up" type="button">Move up</button>' +
              '<button class="secondary move-down" type="button">Move down</button>' +
              '<button class="danger delete-item" type="button">Delete</button>' +
            '</div>' +
          '</div>' +
          '<div class="item-grid">' +
            '<div><label>Item id</label><input type="text" data-field="id" value="' + escapeHtml(item.id) + '" /></div>' +
            '<div><label>Petpooja item id</label><input type="text" data-field="petpoojaItemId" value="' + escapeHtml(item.petpoojaItemId) + '" /></div>' +
            '<div><label>Name</label><input type="text" data-field="name" value="' + escapeHtml(item.name) + '" /></div>' +
            '<div><label>Price</label><input type="number" min="0" step="0.01" data-field="price" value="' + escapeHtml(item.price) + '" /></div>' +
            '<div><label>Category</label><input type="text" list="' + categoryListId + '" data-field="category" value="' + escapeHtml(item.category) + '" /><datalist id="' + categoryListId + '">' +
              categoryOptions.map((option) => '<option value="' + escapeHtml(option) + '"></option>').join('') +
            '</datalist></div>' +
            '<div><label>Image URL</label><input type="text" data-field="image" value="' + escapeHtml(item.image) + '" />' +
              '<div class="image-tools">' +
                '<label class="file-label" for="row-image-file-' + index + '">Choose image</label>' +
                '<input id="row-image-file-' + index + '" type="file" accept="image/*" data-row-image-file="true" />' +
              '</div>' +
            '</div>' +
            '<div class="full">' + (hasImage
              ? '<img class="image-preview" data-image-preview="true" src="' + escapeHtml(item.image) + '" alt="' + escapeHtml(item.name || 'Menu item image') + '" />'
              : '<div class="image-preview empty" data-image-preview="true">No image preview</div>') +
            '</div>' +
            '<div class="full"><label>Description</label><textarea class="field-textarea" data-field="description">' + escapeHtml(item.description) + '</textarea></div>' +
            '<div class="full checkbox-row"><input type="checkbox" data-field="available" ' + (item.available === false ? '' : 'checked') + ' /><label style="margin:0;">Available</label></div>' +
          '</div>';
        return wrapper;
      }

      function renderMenuEditor(items) {
        menuItemsContainer.innerHTML = '';
        items.forEach((item, index) => {
          menuItemsContainer.appendChild(createItemCard(item, index));
        });
        if (items.length === 0) {
          menuItemsContainer.innerHTML = '<div class="hint">No items yet. Click "Add Menu Item" to start.</div>';
        }
      }

      function collectMenuFromEditor() {
        const cards = Array.from(menuItemsContainer.querySelectorAll('.menu-item'));
        return cards.map((card) => {
          const getValue = (field) => card.querySelector('[data-field="' + field + '"]').value;
          return {
            id: getValue('id').trim(),
            petpoojaItemId: getValue('petpoojaItemId').trim(),
            name: getValue('name').trim(),
            description: getValue('description').trim(),
            price: Number(getValue('price')),
            category: getValue('category').trim(),
            image: getValue('image').trim(),
            available: card.querySelector('[data-field="available"]').checked
          };
        });
      }

      function updateImagePreview(card) {
        const previewNode = card.querySelector('[data-image-preview="true"]');
        const imageUrl = card.querySelector('[data-field="image"]').value.trim();
        const itemName = card.querySelector('[data-field="name"]').value.trim() || 'Menu item image';
        if (!imageUrl) {
          previewNode.outerHTML = '<div class="image-preview empty" data-image-preview="true">No image preview</div>';
          return;
        }

        if (previewNode.tagName === 'IMG') {
          previewNode.src = imageUrl;
          previewNode.alt = itemName;
          previewNode.className = 'image-preview';
          return;
        }

        previewNode.outerHTML = '<img class="image-preview" data-image-preview="true" src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(itemName) + '" />';
      }

      function syncJsonFromEditor() {
        textarea.value = JSON.stringify(collectMenuFromEditor(), null, 2);
        renderPreview(textarea.value);
      }

      function syncEditorFromJson(rawText) {
        const items = JSON.parse(rawText);
        if (!Array.isArray(items)) throw new Error('Menu JSON must be an array.');
        renderMenuEditor(items);
        renderPreview(rawText);
      }

      async function convertCsvToMenu(csvText) {
        const res = await fetch('/api/admin/menu/parse-csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csvText })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not parse CSV');
        return data.menu;
      }

      async function convertSpreadsheetToMenu(base64Content) {
        const res = await fetch('/api/admin/menu/parse-spreadsheet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Content })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not parse spreadsheet');
        return data.menu;
      }

      async function readFileAsBase64(file) {
        const arrayBuffer = await file.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(arrayBuffer);
        for (let index = 0; index < bytes.length; index += 1) {
          binary += String.fromCharCode(bytes[index]);
        }
        return btoa(binary);
      }

      async function loadCurrentMenu() {
        const res = await fetch('/api/admin/menu?outletId=' + encodeURIComponent(getSelectedOutletId()));
        const data = await res.json();
        textarea.value = JSON.stringify(data.menu, null, 2);
        syncEditorFromJson(textarea.value);
      }

      async function loadOrdersAndPayments() {
        const outletId = getSelectedOutletId();
        const [ordersRes, paymentsRes, imagesRes, auditRes] = await Promise.all([
          fetch('/api/admin/orders?outletId=' + encodeURIComponent(outletId)),
          fetch('/api/admin/payments?outletId=' + encodeURIComponent(outletId)),
          fetch('/api/admin/menu/images?outletId=' + encodeURIComponent(outletId)),
          fetch('/api/admin/audit-logs?outletId=' + encodeURIComponent(outletId))
        ]);
        const ordersData = await ordersRes.json();
        const paymentsData = await paymentsRes.json();
        const imagesData = await imagesRes.json();
        const auditData = await auditRes.json();
        if (!ordersRes.ok) throw new Error(ordersData.error || 'Could not load orders');
        if (!paymentsRes.ok) throw new Error(paymentsData.error || 'Could not load payments');
        if (!imagesRes.ok) throw new Error(imagesData.error || 'Could not load images');
        if (!auditRes.ok) throw new Error(auditData.error || 'Could not load audit history');
        renderOrdersTable(ordersData.orders || []);
        renderPaymentsTable(paymentsData.payments || []);
        renderImageLibrary(imagesData.images || []);
        renderAuditTable(auditData.entries || []);
      }

      async function loadWhatsAppEvents() {
        const res = await fetch('/api/admin/whatsapp-events');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load WhatsApp events');
        renderWhatsAppEvents(data.events || []);
      }

      async function loadMarketingData() {
        const outletId = getSelectedOutletId();
        const [audienceRes, campaignsRes] = await Promise.all([
          fetch('/api/admin/marketing/audience?outletId=' + encodeURIComponent(outletId)),
          fetch('/api/admin/whatsapp-campaigns?outletId=' + encodeURIComponent(outletId))
        ]);
        const audienceData = await audienceRes.json();
        const campaignsData = await campaignsRes.json();
        if (!audienceRes.ok) throw new Error(audienceData.error || 'Could not load WhatsApp audience');
        if (!campaignsRes.ok) throw new Error(campaignsData.error || 'Could not load WhatsApp campaigns');
        marketingAudienceState = audienceData.audience || [];
        selectedMarketingRecipients.clear();
        renderMarketingAudience(marketingAudienceState);
        renderMarketingCampaigns(campaignsData.campaigns || []);
      }

      brandSelect.addEventListener('change', () => {
        renderBrandForm(Number(brandSelect.value || 0));
        renderPaymentAssignments();
        renderWhatsAppAssignments();
      });

      petpoojaConnectionSelect.addEventListener('change', () => {
        renderPetpoojaConnectionForm(Number(petpoojaConnectionSelect.value || 0));
      });

      paymentConnectionSelect.addEventListener('change', () => {
        renderPaymentConnectionForm(Number(paymentConnectionSelect.value || 0));
      });

      whatsappConnectionSelect.addEventListener('change', () => {
        renderWhatsAppConnectionForm(Number(whatsappConnectionSelect.value || 0));
      });

      brandForm.addEventListener('input', () => {
        syncBrandStateFromForm();
      });

      petpoojaConnectionForm.addEventListener('input', () => {
        syncPetpoojaConnectionStateFromForm();
      });

      paymentConnectionForm.addEventListener('input', () => {
        syncPaymentConnectionStateFromForm();
      });

      whatsappConnectionForm.addEventListener('input', () => {
        syncWhatsAppConnectionStateFromForm();
      });

      brandForm.addEventListener('change', async (event) => {
        const fileInput = event.target.closest('[data-brand-logo-file="true"]');
        if (!fileInput) return;
        try {
          const file = fileInput.files[0];
          if (!file) return;
          const imageUrl = await uploadImageFile(file);
          const logoField = brandForm.querySelector('[data-brand-field="logoUrl"]');
          if (logoField) {
            logoField.value = imageUrl;
          }
          syncBrandStateFromForm();
          renderBrandForm(Number(brandSelect.value || 0));
          setBrandStatus('Brand logo uploaded and linked.', 'ok');
          await loadOrdersAndPayments();
        } catch (error) {
          setBrandStatus(error.message, 'error');
        }
      });

      outletSelect.addEventListener('change', () => {
        renderOutletForm(Number(outletSelect.value || 0));
        renderPaymentAssignments();
        renderWhatsAppAssignments();
        Promise.all([loadCurrentMenu(), loadOrdersAndPayments(), loadMarketingData()]).catch((error) => setStatus(error.message, 'error'));
      });

      outletForm.addEventListener('input', () => {
        syncOutletStateFromForm();
      });

      addBrandButton.addEventListener('click', () => {
        brandState.push(defaultBrand());
        renderBrandSelector();
        brandSelect.value = String(brandState.length - 1);
        renderBrandForm(brandState.length - 1);
        renderPaymentAssignments();
        renderWhatsAppAssignments();
        setBrandStatus('New brand row added. Fill the details or remove it before saving.', 'ok');
      });

      addPetpoojaConnectionButton.addEventListener('click', () => {
        petpoojaConnectionState.push(defaultPetpoojaConnection());
        renderPetpoojaConnectionSelector();
        petpoojaConnectionSelect.value = String(petpoojaConnectionState.length - 1);
        renderPetpoojaConnectionForm(petpoojaConnectionState.length - 1);
        setPetpoojaConnectionStatus('New Petpooja connection row added. Fill the details or remove it before saving.', 'ok');
      });

      addPaymentConnectionButton.addEventListener('click', () => {
        paymentConnectionState.push(defaultPaymentConnection());
        renderPaymentConnectionSelector();
        paymentConnectionSelect.value = String(paymentConnectionState.length - 1);
        renderPaymentConnectionForm(paymentConnectionState.length - 1);
        renderPaymentAssignments();
        setPaymentConnectionStatus('New payment connector row added. Fill the details or remove it before saving.', 'ok');
      });

      removePetpoojaConnectionButton.addEventListener('click', () => {
        const selectedIndex = Number(petpoojaConnectionSelect.value || 0);
        const selectedConnection = petpoojaConnectionState[selectedIndex];
        if (!selectedConnection) return;
        if (petpoojaConnectionState.length <= 1) {
          setPetpoojaConnectionStatus('At least one connection row is required in the editor.', 'error');
          return;
        }
        if (
          selectedConnection.id &&
          (brandState.some((brand) => brand.petpoojaConnectionId === selectedConnection.id) ||
           outletState.some((outlet) => outlet.petpoojaConnectionId === selectedConnection.id))
        ) {
          setPetpoojaConnectionStatus('Reassign brands or outlets before removing this connection.', 'error');
          return;
        }
        petpoojaConnectionState.splice(selectedIndex, 1);
        renderPetpoojaConnectionSelector();
        const nextIndex = Math.max(0, Math.min(selectedIndex, petpoojaConnectionState.length - 1));
        petpoojaConnectionSelect.value = String(nextIndex);
        renderPetpoojaConnectionForm(nextIndex);
        renderBrandForm(Number(brandSelect.value || 0));
        renderOutletForm(Number(outletSelect.value || 0));
        setPetpoojaConnectionStatus('Connection removed from the editor. Click Save connections to persist.', 'ok');
      });

      removePaymentConnectionButton.addEventListener('click', () => {
        const selectedIndex = Number(paymentConnectionSelect.value || 0);
        const selectedConnection = paymentConnectionState[selectedIndex];
        if (!selectedConnection) return;
        if (paymentConnectionState.length <= 1) {
          setPaymentConnectionStatus('At least one payment connector row is required in the editor.', 'error');
          return;
        }
        if (
          selectedConnection.id &&
          (brandState.some((brand) => brand.paymentConnectionId === selectedConnection.id) ||
           outletState.some((outlet) => outlet.paymentConnectionId === selectedConnection.id))
        ) {
          setPaymentConnectionStatus('Reassign brands or outlets before removing this payment connector.', 'error');
          return;
        }
        paymentConnectionState.splice(selectedIndex, 1);
        renderPaymentConnectionSelector();
        const nextIndex = Math.max(0, Math.min(selectedIndex, paymentConnectionState.length - 1));
        paymentConnectionSelect.value = String(nextIndex);
        renderPaymentConnectionForm(nextIndex);
        renderPaymentAssignments();
        setPaymentConnectionStatus('Payment connector removed from the editor. Click Save Payment Connectors to persist.', 'ok');
      });

      removeBrandButton.addEventListener('click', () => {
        const selectedIndex = Number(brandSelect.value || 0);
        const selectedBrand = brandState[selectedIndex];
        if (!selectedBrand) return;
        if (brandState.length <= 1) {
          setBrandStatus('At least one brand is required.', 'error');
          return;
        }
        if (selectedBrand.id && outletState.some((outlet) => outlet.brandId === selectedBrand.id)) {
          setBrandStatus('Reassign outlets before removing this brand.', 'error');
          return;
        }
        brandState.splice(selectedIndex, 1);
        renderBrandSelector();
        const nextIndex = Math.max(0, Math.min(selectedIndex, brandState.length - 1));
        brandSelect.value = String(nextIndex);
        renderBrandForm(nextIndex);
        renderOutletForm(Number(outletSelect.value || 0));
        renderWhatsAppAssignments();
        setBrandStatus('Brand removed from the editor. Click Save Brands to persist.', 'ok');
      });

      saveBrandsButton.addEventListener('click', async () => {
        try {
          syncBrandStateFromForm();
          const invalidBrand = brandState.find((brand) => !String(brand.name || '').trim() || !String(brand.heroTitle || '').trim() || !String(brand.customerAppBaseUrl || '').trim());
          if (invalidBrand) {
            throw new Error('Each brand needs a brand name, tag line, and app URL before saving.');
          }
          const res = await fetch('/api/admin/brands', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ brands: brandState })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not save brands');
          brandState = data.brands;
          renderBrandSelector();
          renderBrandForm(Number(brandSelect.value || 0));
          renderOutletForm(Number(outletSelect.value || 0));
          renderWhatsAppAssignments();
          setBrandStatus('Brand settings saved.', 'ok');
        } catch (error) {
          setBrandStatus(error.message, 'error');
        }
      });

      savePetpoojaConnectionsButton.addEventListener('click', async () => {
        try {
          syncPetpoojaConnectionStateFromForm();
          const res = await fetch('/api/admin/petpooja-connections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connections: petpoojaConnectionState })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not save Petpooja connections');
          petpoojaConnectionState = data.connections || [];
          renderPetpoojaConnectionSelector();
          renderPetpoojaConnectionForm(Number(petpoojaConnectionSelect.value || 0));
          renderBrandForm(Number(brandSelect.value || 0));
          renderOutletForm(Number(outletSelect.value || 0));
          setPetpoojaConnectionStatus('Petpooja connections saved.', 'ok');
        } catch (error) {
          setPetpoojaConnectionStatus(error.message, 'error');
        }
      });

      savePaymentConnectionsButton.addEventListener('click', async () => {
        try {
          syncPaymentConnectionStateFromForm();
          const res = await fetch('/api/admin/payment-connections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connections: paymentConnectionState })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not save payment connectors');
          paymentConnectionState = (data.connections && data.connections.length) ? data.connections : [defaultPaymentConnection()];
          renderPaymentConnectionSelector();
          renderPaymentConnectionForm(Number(paymentConnectionSelect.value || 0));
          renderPaymentAssignments();
          setPaymentConnectionStatus('Payment connectors saved.', 'ok');
        } catch (error) {
          setPaymentConnectionStatus(error.message, 'error');
        }
      });

      saveWhatsAppConnectionButton.addEventListener('click', async () => {
        try {
          syncWhatsAppConnectionStateFromForm();
          const res = await fetch('/api/admin/whatsapp-connections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connections: whatsappConnectionState })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not save WhatsApp connectors');
          whatsappConnectionState = (data.connections && data.connections.length) ? data.connections : [defaultWhatsAppConnection()];
          renderWhatsAppConnectionSelector();
          renderWhatsAppConnectionForm(Number(whatsappConnectionSelect.value || 0));
          renderWhatsAppAssignments();
          setWhatsAppConnectionStatus('WhatsApp connectors saved.', 'ok');
        } catch (error) {
          setWhatsAppConnectionStatus(error.message, 'error');
        }
      });

      addWhatsAppConnectionButton.addEventListener('click', () => {
        whatsappConnectionState.push(defaultWhatsAppConnection());
        renderWhatsAppConnectionSelector();
        whatsappConnectionSelect.value = String(whatsappConnectionState.length - 1);
        renderWhatsAppConnectionForm(whatsappConnectionState.length - 1);
        renderWhatsAppAssignments();
        setWhatsAppConnectionStatus('New WhatsApp connector row added. Fill the details, then click Save WhatsApp Connector.', 'ok');
      });

      removeWhatsAppConnectionButton.addEventListener('click', () => {
        const selectedIndex = Number(whatsappConnectionSelect.value || 0);
        const selectedConnection = whatsappConnectionState[selectedIndex];
        if (!selectedConnection) return;
        if (whatsappConnectionState.length <= 1) {
          setWhatsAppConnectionStatus('At least one connector row is required in the editor.', 'error');
          return;
        }
        if (
          selectedConnection.id &&
          (brandState.some((brand) => brand.whatsappConnectionId === selectedConnection.id) ||
           outletState.some((outlet) => outlet.whatsappConnectionId === selectedConnection.id))
        ) {
          setWhatsAppConnectionStatus('Reassign brands or outlets before removing this connector.', 'error');
          return;
        }
        whatsappConnectionState.splice(selectedIndex, 1);
        renderWhatsAppConnectionSelector();
        const nextIndex = Math.max(0, Math.min(selectedIndex, whatsappConnectionState.length - 1));
        whatsappConnectionSelect.value = String(nextIndex);
        renderWhatsAppConnectionForm(nextIndex);
        renderWhatsAppAssignments();
        setWhatsAppConnectionStatus('Connector removed from the editor. Click Save WhatsApp Connector to persist.', 'ok');
      });

      saveWhatsAppAssignmentsButton.addEventListener('click', async () => {
        try {
          const selectedBrandIndex = Number(brandSelect.value || 0);
          const selectedOutletIndex = Number(outletSelect.value || 0);
          const brandAssignmentField = whatsappAssignmentForm.querySelector('[data-whatsapp-brand-assignment="whatsappConnectionId"]');
          const outletAssignmentField = whatsappAssignmentForm.querySelector('[data-whatsapp-outlet-assignment="whatsappConnectionId"]');
          if (brandState[selectedBrandIndex] && brandAssignmentField) {
            brandState[selectedBrandIndex].whatsappConnectionId = brandAssignmentField.value.trim();
          }
          if (outletState[selectedOutletIndex] && outletAssignmentField) {
            outletState[selectedOutletIndex].whatsappConnectionId = outletAssignmentField.value.trim();
          }

          const [brandsRes, outletsRes] = await Promise.all([
            fetch('/api/admin/brands', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ brands: brandState })
            }),
            fetch('/api/admin/outlets', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ outlets: outletState })
            })
          ]);
          const brandsData = await brandsRes.json();
          const outletsData = await outletsRes.json();
          if (!brandsRes.ok) throw new Error(brandsData.error || 'Could not save brand WhatsApp assignment');
          if (!outletsRes.ok) throw new Error(outletsData.error || 'Could not save outlet WhatsApp assignment');
          brandState = brandsData.brands || [];
          outletState = outletsData.outlets || [];
          renderBrandSelector();
          renderBrandForm(Number(brandSelect.value || 0));
          renderOutletSelector();
          renderOutletForm(Number(outletSelect.value || 0));
          renderWhatsAppAssignments();
          setWhatsAppConnectionStatus('WhatsApp brand and outlet assignments saved.', 'ok');
        } catch (error) {
          setWhatsAppConnectionStatus(error.message, 'error');
        }
      });

      savePaymentAssignmentsButton.addEventListener('click', async () => {
        try {
          const selectedBrandIndex = Number(brandSelect.value || 0);
          const selectedOutletIndex = Number(outletSelect.value || 0);
          const brandAssignmentField = paymentAssignmentForm.querySelector('[data-payment-brand-assignment="paymentConnectionId"]');
          const outletAssignmentField = paymentAssignmentForm.querySelector('[data-payment-outlet-assignment="paymentConnectionId"]');
          if (brandState[selectedBrandIndex] && brandAssignmentField) {
            brandState[selectedBrandIndex].paymentConnectionId = brandAssignmentField.value.trim();
          }
          if (outletState[selectedOutletIndex] && outletAssignmentField) {
            outletState[selectedOutletIndex].paymentConnectionId = outletAssignmentField.value.trim();
          }

          const [brandsRes, outletsRes] = await Promise.all([
            fetch('/api/admin/brands', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ brands: brandState })
            }),
            fetch('/api/admin/outlets', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ outlets: outletState })
            })
          ]);
          const brandsData = await brandsRes.json();
          const outletsData = await outletsRes.json();
          if (!brandsRes.ok) throw new Error(brandsData.error || 'Could not save brand payment assignment');
          if (!outletsRes.ok) throw new Error(outletsData.error || 'Could not save outlet payment assignment');
          brandState = brandsData.brands || [];
          outletState = outletsData.outlets || [];
          renderBrandSelector();
          renderBrandForm(Number(brandSelect.value || 0));
          renderOutletSelector();
          renderOutletForm(Number(outletSelect.value || 0));
          renderPaymentAssignments();
          setPaymentConnectionStatus('Payment brand and outlet assignments saved.', 'ok');
        } catch (error) {
          setPaymentConnectionStatus(error.message, 'error');
        }
      });

      addOutletButton.addEventListener('click', () => {
        outletState.push(defaultOutlet());
        renderOutletSelector();
        outletSelect.value = String(outletState.length - 1);
        renderOutletForm(outletState.length - 1);
        renderWhatsAppAssignments();
      });

      saveOutletsButton.addEventListener('click', async () => {
        try {
          syncOutletStateFromForm();
          const res = await fetch('/api/admin/outlets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outlets: outletState })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not save outlets');
          outletState = data.outlets;
          renderOutletSelector();
          renderOutletForm(Number(outletSelect.value || 0));
          renderWhatsAppAssignments();
          setOutletStatus('Outlet settings saved.', 'ok');
        } catch (error) {
          setOutletStatus(error.message, 'error');
        }
      });

      fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try {
          const lowercaseName = file.name.toLowerCase();
          const isCsv = lowercaseName.endsWith('.csv') || file.type === 'text/csv';
          const isSpreadsheet = lowercaseName.endsWith('.xlsx') || lowercaseName.endsWith('.xls');
          if (isCsv) {
            const fileText = await file.text();
            const menu = await convertCsvToMenu(fileText);
            textarea.value = JSON.stringify(menu, null, 2);
            setStatus('CSV parsed into menu rows. Review and click Save Menu.', 'ok');
          } else if (isSpreadsheet) {
            const menu = await convertSpreadsheetToMenu(await readFileAsBase64(file));
            textarea.value = JSON.stringify(menu, null, 2);
            setStatus('Excel file parsed into menu rows. Review and click Save Menu.', 'ok');
          } else {
            const fileText = await file.text();
            textarea.value = fileText;
            setStatus('Loaded JSON file into the editor. Review and click Save Menu.', 'ok');
          }
          syncEditorFromJson(textarea.value);
        } catch (error) {
          setStatus(error.message, 'error');
        }
      });

      textarea.addEventListener('input', () => {
        try {
          syncEditorFromJson(textarea.value);
        } catch (error) {
          renderPreview(textarea.value);
        }
      });

      menuItemsContainer.addEventListener('input', () => {
        Array.from(menuItemsContainer.querySelectorAll('.menu-item')).forEach((card) => updateImagePreview(card));
        syncJsonFromEditor();
      });

      menuItemsContainer.addEventListener('change', (event) => {
        const fileInput = event.target.closest('[data-row-image-file="true"]');
        if (!fileInput) return;
        const card = fileInput.closest('.menu-item');
        const imageField = card?.querySelector('[data-field="image"]');
        const file = fileInput.files[0];
        if (!card || !imageField || !file) return;

        uploadImageFile(file)
          .then((imageUrl) => {
            imageField.value = imageUrl;
            updateImagePreview(card);
            syncJsonFromEditor();
            setImageStatus('Image uploaded into the selected item.', 'ok');
            return loadOrdersAndPayments();
          })
          .catch((error) => {
            setImageStatus(error.message, 'error');
          });
      });

      menuItemsContainer.addEventListener('click', (event) => {
        const card = event.target.closest('.menu-item');
        if (!card) return;

        if (event.target.classList.contains('delete-item')) {
          card.remove();
        } else if (event.target.classList.contains('move-up')) {
          const previous = card.previousElementSibling;
          if (previous) {
            menuItemsContainer.insertBefore(card, previous);
          }
        } else if (event.target.classList.contains('move-down')) {
          const next = card.nextElementSibling;
          if (next) {
            menuItemsContainer.insertBefore(next, card);
          }
        } else {
          return;
        }

        Array.from(menuItemsContainer.querySelectorAll('.menu-item .item-head strong')).forEach((label, index) => {
          label.textContent = 'Item ' + (index + 1);
        });
        syncJsonFromEditor();
      });

      addItemButton.addEventListener('click', () => {
        const items = collectMenuFromEditor();
        items.push(defaultItem());
        renderMenuEditor(items);
        syncJsonFromEditor();
      });

      loadButton.addEventListener('click', async () => {
        try {
          await Promise.all([loadCurrentMenu(), loadOrdersAndPayments()]);
          setStatus('Loaded the current backend menu.', 'ok');
        } catch (error) {
          setStatus(error.message, 'error');
        }
      });

      saveButton.addEventListener('click', async () => {
        try {
          const menu = collectMenuFromEditor();
          const res = await fetch('/api/admin/menu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outletId: getSelectedOutletId(), menu })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not save menu');
          textarea.value = JSON.stringify(data.menu, null, 2);
          syncEditorFromJson(textarea.value);
          setStatus('Menu saved. The ordering API now uses these menu rows.', 'ok');
        } catch (error) {
          setStatus(error.message, 'error');
        }
      });

      pullPetpoojaMenuButton.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/admin/menu/pull-from-petpooja', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outletId: getSelectedOutletId() })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not pull menu from Petpooja');
          textarea.value = JSON.stringify(data.menu, null, 2);
          syncEditorFromJson(textarea.value);
          setStatus('Pulled menu from Petpooja provider hook.', 'ok');
          await loadOrdersAndPayments();
        } catch (error) {
          setStatus(error.message, 'error');
        }
      });

      refreshWhatsAppEventsButton.addEventListener('click', async () => {
        try {
          await loadWhatsAppEvents();
          setStatus('Loaded recent WhatsApp activity.', 'ok');
        } catch (error) {
          setStatus(error.message, 'error');
        }
      });

      refreshMarketingAudienceButton.addEventListener('click', async () => {
        try {
          await loadMarketingData();
          setMarketingStatus('Loaded latest WhatsApp audience and campaign history.', 'ok');
        } catch (error) {
          setMarketingStatus(error.message, 'error');
        }
      });

      marketingImageFile.addEventListener('change', async () => {
        try {
          const file = marketingImageFile.files[0];
          if (!file) return;
          marketingImageUrl.value = await uploadImageFile(file);
          setMarketingStatus('Campaign image uploaded and linked.', 'ok');
          await loadOrdersAndPayments();
        } catch (error) {
          setMarketingStatus(error.message, 'error');
        }
      });

      marketingAudience.addEventListener('change', (event) => {
        const checkbox = event.target.closest('.marketing-recipient');
        if (!checkbox) return;
        const mobile = checkbox.dataset.mobile;
        if (!mobile) return;
        if (checkbox.checked) {
          selectedMarketingRecipients.add(mobile);
        } else {
          selectedMarketingRecipients.delete(mobile);
        }
      });

      sendMarketingCampaignButton.addEventListener('click', async () => {
        try {
          const recipients = Array.from(selectedMarketingRecipients);
          const imageUrl = marketingImageUrl.value.trim();
          const caption = marketingCaption.value.trim();
          if (!recipients.length) throw new Error('Select at least one customer before sending a campaign');
          if (!imageUrl) throw new Error('Add an image URL for the campaign');

          const res = await fetch('/api/admin/whatsapp-campaigns/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              outletId: getSelectedOutletId(),
              recipients,
              imageUrl,
              caption
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not send WhatsApp campaign');
          setMarketingStatus('Campaign sent. Delivered: ' + (data.campaign?.sentCount || 0) + ', failed: ' + (data.campaign?.failedCount || 0) + '.', 'ok');
          await loadMarketingData();
        } catch (error) {
          setMarketingStatus(error.message, 'error');
        }
      });

      // Render Petpooja credentials immediately so the setup form is visible
      // even before the async admin data load completes.
      brandState = [defaultBrand()];
      renderBrandSelector();
      applyBrandProfileMode();
      renderBrandForm(0);
      setBrandStatus('Add your brand profile to continue. The app URL will auto-fill from the brand name.', 'ok');
      petpoojaConnectionState = [defaultPetpoojaConnection()];
      renderPetpoojaConnectionSelector();
      renderPetpoojaConnectionForm(0);
      paymentConnectionState = [defaultPaymentConnection()];
      renderPaymentConnectionSelector();
      renderPaymentConnectionForm(0);
      renderPaymentAssignments();
      whatsappConnectionState = [defaultWhatsAppConnection()];
      renderWhatsAppConnectionSelector();
      renderWhatsAppConnectionForm(0);
      renderWhatsAppAssignments();

      uploadImageButton.addEventListener('click', async () => {
        try {
          const file = imageFileInput.files[0];
          if (!file) throw new Error('Choose an image file first');

          imageUrlTextarea.value = await uploadImageFile(file);
          setImageStatus('Image uploaded. Copy this URL into any menu item image field.', 'ok');
          await loadOrdersAndPayments();
        } catch (error) {
          setImageStatus(error.message, 'error');
        }
      });

      ordersTable.addEventListener('click', async (event) => {
        const button = event.target.closest('.resend-confirmation');
        if (!button) return;
        try {
          const res = await fetch('/api/admin/orders/' + encodeURIComponent(button.dataset.orderId) + '/resend-confirmation', {
            method: 'POST'
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not resend confirmation');
          setOrdersStatus('WhatsApp confirmation resent.', 'ok');
        } catch (error) {
          setOrdersStatus(error.message, 'error');
        }
      });

      paymentsTable.addEventListener('click', async (event) => {
        const button = event.target.closest('.simulate-paid');
        if (!button) return;
        try {
          const res = await fetch('/api/admin/payments/' + encodeURIComponent(button.dataset.orderId) + '/simulate-paid', {
            method: 'POST'
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not simulate payment');
          setPaymentsStatus('Payment moved to PAID via admin action.', 'ok');
          await loadOrdersAndPayments();
        } catch (error) {
          setPaymentsStatus(error.message, 'error');
        }
      });

      loadBrands()
        .then(() => loadAdminProfileSafely())
        .then(() => loadPetpoojaConnections())
        .then(() => loadPaymentConnections())
        .then(() => loadWhatsAppConnections())
        .then(() => Promise.all([loadOutlets(), loadCurrentMenu(), loadOrdersAndPayments(), loadWhatsAppEvents(), loadMarketingData()]))
        .catch((error) => setStatus(error.message, 'error'));
    </script>
  </body>
</html>`;
}

function generatePickupCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function calculateCart(items, outletId) {
  const outletMenu = getOutletMenu(outletId);
  const detailedItems = items.map((cartItem) => {
    const item = outletMenu.find((m) => m.id === cartItem.itemId);
    if (!item) throw new Error(`Invalid item: ${cartItem.itemId}`);
    const qty = Number(cartItem.qty || 0);
    if (qty <= 0) throw new Error(`Invalid quantity for ${item.name}`);
    return {
      itemId: item.id,
      petpoojaItemId: item.petpoojaItemId,
      name: item.name,
      qty,
      unitPrice: item.price,
      lineTotal: item.price * qty
    };
  });

  const total = detailedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  return { detailedItems, total };
}

async function createRazorpayPaymentLink(order, connectionConfig) {
  const fallbackPaymentLink = `${getCustomerAppBaseUrl(order.outletId)}/success?orderId=${order.id}`;
  const connectionId = connectionConfig.connectionId;
  const connection = connectionConfig.connection;

  if (!connection || connection.status !== 'ACTIVE') {
    if (IS_PRODUCTION && !ALLOW_PAYMENT_FALLBACK) {
      throw new Error('Live Razorpay connector is required before checkout can create a payment link');
    }
    return {
      paymentLink: fallbackPaymentLink,
      provider: 'Razorpay',
      mode: 'payment_link',
      connectorId: connectionId || '',
      connectorName: connection?.name || '',
      paymentLinkId: `plink_${order.id}`,
      providerOrderId: null,
      accountId: connection?.accountId || '',
      liveConfigured: false
    };
  }

  if (!connection.apiKey || !connection.apiSecret || !paymentFetch) {
    if (IS_PRODUCTION && !ALLOW_PAYMENT_FALLBACK) {
      throw new Error(`Payment connector ${connection.name || connection.id} is missing live API credentials`);
    }
    return {
      paymentLink: fallbackPaymentLink,
      provider: connection.provider,
      mode: connection.paymentMode || 'payment_link',
      connectorId: connection.id,
      connectorName: connection.name,
      paymentLinkId: `plink_${order.id}`,
      providerOrderId: null,
      accountId: connection.accountId || '',
      liveConfigured: false
    };
  }

  const authHeader = Buffer.from(`${connection.apiKey}:${connection.apiSecret}`).toString('base64');
  const response = await paymentFetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authHeader}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: Math.round(Number(order.total || 0) * 100),
      currency: 'INR',
      description: `Order ${order.id} for ${order.outletId}`,
      reference_id: order.id,
      notify: {
        sms: true,
        email: false
      },
      reminder_enable: true,
      callback_url: `${getCustomerAppBaseUrl(order.outletId)}/success?orderId=${encodeURIComponent(order.id)}`,
      callback_method: 'get',
      notes: {
        orderId: order.id,
        outletId: order.outletId,
        brandId: order.brandId || '',
        paymentConnectionId: connection.id
      }
    })
  });

  const responseText = await response.text();
  let parsedResponse = null;
  try {
    parsedResponse = responseText ? JSON.parse(responseText) : null;
  } catch {
    parsedResponse = responseText;
  }

  if (!response.ok) {
    throw new Error(
      `Razorpay payment link failed: ${response.status} ${typeof parsedResponse === 'string' ? parsedResponse : JSON.stringify(parsedResponse)}`
    );
  }

  return {
    paymentLink: parsedResponse?.short_url || parsedResponse?.payment_link || parsedResponse?.url || fallbackPaymentLink,
    provider: connection.provider,
    mode: connection.paymentMode || 'payment_link',
    connectorId: connection.id,
    connectorName: connection.name,
    paymentLinkId: parsedResponse?.id || `plink_${order.id}`,
    providerOrderId: parsedResponse?.order_id || null,
    accountId: connection.accountId || '',
    liveConfigured: true,
    raw: parsedResponse
  };
}

async function createPaymentLinkForOrder(order) {
  const connectionConfig = resolvePaymentConnectionForOutlet(order.outletId);
  const { connection } = connectionConfig;
  const fallbackPaymentLink = `${getCustomerAppBaseUrl(order.outletId)}/success?orderId=${order.id}`;

  if (!connection || connection.status !== 'ACTIVE') {
    if (IS_PRODUCTION && !ALLOW_PAYMENT_FALLBACK) {
      throw new Error('An active live payment connector is required before checkout can create a payment link');
    }
    return {
      paymentLink: fallbackPaymentLink,
      provider: order.paymentProvider || 'GENERIC',
      mode: order.paymentMode || 'payment_link',
      connectorId: connectionConfig.connectionId || '',
      connectorName: connection?.name || '',
      paymentLinkId: `plink_${order.id}`,
      providerOrderId: null,
      accountId: connection?.accountId || '',
      liveConfigured: false
    };
  }

  switch (connection.provider) {
    case 'RAZORPAY':
      return createRazorpayPaymentLink(order, connectionConfig);
    default:
      if (IS_PRODUCTION && !ALLOW_PAYMENT_FALLBACK) {
        throw new Error(`Payment provider ${connection.provider} is not implemented for live checkout`);
      }
      return {
        paymentLink: fallbackPaymentLink,
        provider: connection.provider,
        mode: connection.paymentMode || order.paymentMode || 'payment_link',
        connectorId: connection.id,
        connectorName: connection.name,
        paymentLinkId: `plink_${order.id}`,
        providerOrderId: null,
        accountId: connection.accountId || '',
        liveConfigured: false
      };
  }
}

function buildPaymentRecord(order, paymentLinkConfig) {
  return {
    provider: paymentLinkConfig.provider || 'Razorpay',
    mode: paymentLinkConfig.mode || 'payment_link',
    status: 'PENDING',
    amount: order.total,
    currency: 'INR',
    paymentLink: paymentLinkConfig.paymentLink,
    paymentLinkId: paymentLinkConfig.paymentLinkId || `plink_${order.id}`,
    connectorId: paymentLinkConfig.connectorId || '',
    connectorName: paymentLinkConfig.connectorName || '',
    providerOrderId: paymentLinkConfig.providerOrderId || null,
    accountId: paymentLinkConfig.accountId || '',
    liveConfigured: Boolean(paymentLinkConfig.liveConfigured),
    paymentReference: null,
    verifiedByWebhook: false,
    lastEvent: 'PAYMENT_LINK_CREATED',
    lastEventAt: new Date().toISOString(),
    paidAt: null,
    channel: order.channel || 'web'
  };
}

async function pushOrderToPetpooja(order) {
  await syncOrderToPetpooja(order);
}

async function sendWhatsAppMessage(to, text, options = {}) {
  return whatsappProvider.sendMessage({ to, text, ...options });
}

async function sendWhatsAppImageMessage(to, imageUrl, caption = '', options = {}) {
  return whatsappProvider.sendImageMessage({ to, imageUrl, caption, ...options });
}

function getSessionOrDefault({ sessionId, customerMobile, outletId }) {
  const fallbackOutlet =
    outlets.find((outlet) => outlet.id === outletId) ||
    outlets.find((outlet) => outlet.status === 'ACTIVE') ||
    outlets[0];
  return sessions.get(sessionId) || {
    id: sessionId || 'demo-session',
    customerMobile: customerMobile || 'demo-customer',
    outletId: fallbackOutlet?.id || defaultOutlets[0]?.id || 'default_outlet',
    channel: 'WEB',
    flowState: ORDER_FLOW.SESSION_CREATED
  };
}

function hasPriorOrdersForCustomer(customerMobile) {
  const normalizedMobile = normalizeWhatsAppRecipient(customerMobile);
  if (!normalizedMobile || normalizedMobile === 'demo-customer') {
    return false;
  }

  return [...orders.values()].some((order) => normalizeWhatsAppRecipient(order.customerMobile) === normalizedMobile);
}

function getCheckoutConfig(session) {
  const normalizedMobile = normalizeWhatsAppRecipient(session?.customerMobile);
  const isRealWhatsAppCustomer = Boolean(
    normalizedMobile &&
    normalizedMobile !== 'demo-customer' &&
    String(session?.channel || '').toUpperCase() === 'WHATSAPP'
  );
  const marketingOptInEligible = isRealWhatsAppCustomer && !hasPriorOrdersForCustomer(normalizedMobile);

  return {
    marketingOptInEligible,
    marketingOptInDefault: marketingOptInEligible,
    marketingOptInLabel: 'Receive updates on WhatsApp'
  };
}

function buildOrderAdminSummary(order) {
  return {
    id: order.id,
    outletId: order.outletId,
    customerMobile: order.customerMobile,
    channel: order.channel || 'WEB',
    total: order.total,
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    flowState: order.flowState || null,
    brandId: order.brandId || '',
    pickupCode: order.pickupCode,
    codeActive: order.codeActive,
    createdAt: order.createdAt,
    paidAt: order.paidAt || null,
    payment: order.payment,
    marketingConsent: order.marketingConsent || null,
    petpoojaSync: order.petpoojaSync,
    items: order.items
  };
}

function listOrdersByOutlet(outletId) {
  return [...orders.values()]
    .filter((order) => !outletId || order.outletId === outletId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(buildOrderAdminSummary);
}

function listPaymentsByOutlet(outletId) {
  return listOrdersByOutlet(outletId).map((order) => ({
    orderId: order.id,
    outletId: order.outletId,
    customerMobile: order.customerMobile,
    total: order.total,
    orderStatus: order.orderStatus,
    createdAt: order.createdAt,
    payment: order.payment
  }));
}

async function finalizePaidOrder(order, paymentUpdate = {}) {
  if (order.paymentStatus === 'PAID') {
    return order;
  }

  order.paymentStatus = 'PAID';
  order.orderStatus = 'PAID';
  order.flowState = ORDER_FLOW.PAYMENT_CONFIRMED;
  order.pickupCode = generatePickupCode();
  order.codeActive = true;
  order.paidAt = new Date().toISOString();
  order.payment = {
    ...order.payment,
    ...paymentUpdate,
    status: 'PAID',
    lastEvent: paymentUpdate.lastEvent || 'PAYMENT_CAPTURED',
    lastEventAt: new Date().toISOString(),
    paidAt: order.paidAt
  };

  await pushOrderToPetpooja(order);
  try {
    await sendWhatsAppMessage(order.customerMobile, buildPickupConfirmationMessage(order), { outletId: order.outletId });
  } catch (error) {
    logAuditEvent({
      outletId: order.outletId,
      action: 'CUSTOMER_PAYMENT_CONFIRMATION_FAILED',
      entityType: 'order',
      entityId: order.id,
      summary: `Failed customer WhatsApp payment confirmation for order ${order.id}`,
      actor: 'payment-webhook',
      metadata: {
        customerMobile: order.customerMobile,
        error: error.message
      }
    });
  }
  await notifyBackendTeamOfPaidOrder(order);
  order.flowState = ORDER_FLOW.PICKUP_CODE_SENT;

  persistOrders();

  return order;
}

function markOrderPaymentFailed(order, failureReason = 'Payment failed') {
  order.paymentStatus = 'FAILED';
  order.orderStatus = 'PAYMENT_FAILED';
  order.flowState = ORDER_FLOW.PAYMENT_FAILED;
  order.payment = {
    ...order.payment,
    status: 'FAILED',
    failureReason,
    lastEvent: 'PAYMENT_FAILED',
    lastEventAt: new Date().toISOString()
  };
  persistOrders();
  return order;
}

export async function createCheckoutOrder({ sessionId, items, customerMobile, outletId, channel = 'WEB', marketingOptIn } = {}) {
  const session = getSessionOrDefault({ sessionId, customerMobile, outletId });
  const { detailedItems, total } = calculateCart(items || [], session.outletId);
  const orderId = `NB-${nanoid(8).toUpperCase()}`;
  const checkoutConfig = getCheckoutConfig(session);
  const marketingUpdatesEnabled = checkoutConfig.marketingOptInEligible ? marketingOptIn !== false : false;

  const order = {
    id: orderId,
    sessionId: session.id,
    outletId: session.outletId,
    brandId: getOutlet(session.outletId)?.brandId || '',
    customerMobile: session.customerMobile,
    channel: session.channel || channel || 'WEB',
    items: detailedItems,
    total,
    paymentProvider: getOutlet(session.outletId)?.paymentProvider || 'GENERIC',
    paymentMode: getOutlet(session.outletId)?.paymentMode || 'payment_link',
    paymentStatus: 'PENDING',
    orderStatus: 'AWAITING_PAYMENT',
    flowState: ORDER_FLOW.CHECKOUT_CREATED,
    pickupCode: null,
    codeActive: false,
    createdAt: new Date().toISOString(),
    marketingConsent: {
      whatsappUpdates: marketingUpdatesEnabled,
      eligibleOnCheckout: checkoutConfig.marketingOptInEligible,
      optedInAt: marketingUpdatesEnabled ? new Date().toISOString() : null,
      source: 'checkout'
    },
    petpoojaSync: {
      status: 'NOT_STARTED',
      externalOrderId: null,
      lastAttemptAt: null,
      syncedAt: null,
      error: null
    }
  };

  const paymentLinkConfig = await createPaymentLinkForOrder(order);
  order.payment = buildPaymentRecord(order, paymentLinkConfig);
  order.paymentLink = paymentLinkConfig.paymentLink;
  order.flowState = ORDER_FLOW.PAYMENT_LINK_CREATED;
  orders.set(orderId, order);
  persistOrders();
  if (sessions.has(session.id)) {
    updateSession(session.id, {
      flowState: ORDER_FLOW.CHECKOUT_CREATED,
      lastOrderId: orderId
    });
  }
  logAuditEvent({
    outletId: order.outletId,
    action: 'CHECKOUT_CREATED',
    entityType: 'order',
    entityId: order.id,
    summary: `Created checkout for ${order.channel} order ${order.id}`,
    actor: 'checkout-api',
    metadata: {
      channel: order.channel,
      total: order.total
    }
  });

  return { orderId, total, paymentLink: paymentLinkConfig.paymentLink };
}

export function getOrder(orderId) {
  return orders.get(orderId) || null;
}

export async function markOrderPaid(orderId) {
  const order = orders.get(orderId);
  if (!order) {
    throw new Error('Order not found');
  }
  return finalizePaidOrder(order, {
    paymentReference: `manual_${order.id}`,
    verifiedByWebhook: false,
    lastEvent: 'MANUAL_PAID'
  });
}

function extractOrderIdFromWebhook(payload) {
  const linkEntity = payload?.payload?.payment_link?.entity;
  const paymentEntity = payload?.payload?.payment?.entity;
  return (
    linkEntity?.notes?.orderId ||
    paymentEntity?.notes?.orderId ||
    linkEntity?.reference_id ||
    paymentEntity?.reference_id ||
    null
  );
}

function verifyRazorpayWebhookSignature(req) {
  const orderId = extractOrderIdFromWebhook(req.body || {});
  const order = orderId ? orders.get(orderId) : null;
  const connector = order?.payment?.connectorId ? getPaymentConnection(order.payment.connectorId) : null;
  const secret = String(connector?.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET is not configured');
  }

  const signature = req.get('x-razorpay-signature');
  if (!signature) {
    throw new Error('Missing Razorpay signature');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody || Buffer.from(''))
    .digest('hex');

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid Razorpay signature');
  }
}

function verifyMetaWebhookSignature(req) {
  const appSecret = String(process.env.WHATSAPP_APP_SECRET || '').trim();
  if (!appSecret) {
    if (IS_PRODUCTION) {
      throw new Error('WHATSAPP_APP_SECRET is not configured');
    }
    return;
  }

  const signature = String(req.get('x-hub-signature-256') || '').trim();
  if (!signature.startsWith('sha256=')) {
    throw new Error('Missing Meta webhook signature');
  }

  const expected = `sha256=${crypto
    .createHmac('sha256', appSecret)
    .update(req.rawBody || Buffer.from(''))
    .digest('hex')}`;
  if (!timingSafeStringEqual(signature, expected)) {
    throw new Error('Invalid Meta webhook signature');
  }
}

async function handleVerifiedPaymentEvent(payload, { verifiedByWebhook }) {
  const orderId = extractOrderIdFromWebhook(payload);
  if (!orderId) {
    throw new Error('Could not determine orderId from payment event');
  }

  const order = orders.get(orderId);
  if (!order) {
    throw new Error('Order not found');
  }

  const event = payload?.event;
  if (event === 'payment_link.paid' || event === 'payment.captured') {
    return finalizePaidOrder(order, {
      paymentReference:
        payload?.payload?.payment?.entity?.id ||
        payload?.payload?.payment_link?.entity?.id ||
        order.payment?.paymentReference ||
        null,
      paymentLinkId:
        payload?.payload?.payment_link?.entity?.id ||
        order.payment?.paymentLinkId ||
        null,
      verifiedByWebhook,
      lastEvent: event
    });
  }

  if (event === 'payment.failed') {
    return markOrderPaymentFailed(order, payload?.payload?.payment?.entity?.error_description || 'Payment failed');
  }

  return order;
}

export function resetStore() {
  sessions.clear();
  orders.clear();
  persistSessions();
  persistOrders();
  brands = normalizeBrands(defaultBrands);
  petpoojaConnections = normalizePetpoojaConnections(defaultPetpoojaConnections);
  outlets = normalizeOutlets(defaultOutlets);
  menusByOutlet = normalizeMenusByOutlet(buildDefaultMenusByOutlet());
  uploadedImagesByOutlet = normalizeOutletScopedStore({}, normalizeUploadedImage);
  auditLogsByOutlet = normalizeOutletScopedStore({}, normalizeAuditEntry);
  persistPetpoojaConnections(petpoojaConnections);
  persistUploadedImages();
  persistAuditLogs();
}

export function reloadPersistentStore() {
  loadRuntimeStoresFromDisk();
}

export function clearRuntimeStoreMemoryOnly() {
  sessions.clear();
  orders.clear();
}

export function configureRuntimeStoreFiles({ sessionsPath, ordersPath } = {}) {
  if (sessionsPath) {
    sessionsFile = sessionsPath;
  }
  if (ordersPath) {
    ordersFile = ordersPath;
  }
  loadRuntimeStoresFromDisk();
}

export function reloadAdminStore() {
  uploadedImagesByOutlet = loadUploadedImagesFromDisk();
  auditLogsByOutlet = loadAuditLogsFromDisk();
}

export function configureAdminStoreFiles({ imageManifestPath, auditLogPath, petpoojaConnectionsPath } = {}) {
  if (imageManifestPath) {
    imageManifestFile = imageManifestPath;
  }
  if (auditLogPath) {
    auditLogFile = auditLogPath;
  }
  if (petpoojaConnectionsPath) {
    petpoojaConnectionsFile = petpoojaConnectionsPath;
  }
  reloadAdminStore();
}

export function configureWhatsAppEventStoreFile({ whatsappEventsPath } = {}) {
  if (whatsappEventsPath) {
    whatsappEventsFile = whatsappEventsPath;
  }
  whatsappEvents = loadWhatsAppEventsFromDisk();
}

export function configureWhatsAppTransport({ fetchImpl } = {}) {
  whatsappFetch = fetchImpl || globalThis.fetch?.bind(globalThis) || null;
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'Weborder Platform Backend' });
});

app.post('/api/session', async (req, res) => {
  const {
    customerMobile = 'demo-customer',
    outletId = getDefaultOutletId(),
    channel = 'WEB',
    flowState = ORDER_FLOW.SESSION_CREATED
  } = req.body || {};
  const sessionId = nanoid(16);
  sessions.set(sessionId, {
    id: sessionId,
    customerMobile,
    outletId,
    channel: String(channel).toUpperCase(),
    flowState,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  persistSessions();

  const link = buildOrderLink({ sessionId, outletId, channel: String(channel).toLowerCase() });
  res.json({ sessionId, link });
});

app.get('/api/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId) || {
    id: req.params.sessionId,
    customerMobile: 'demo-customer',
    outletId: getDefaultOutletId(),
    channel: 'WEB',
    flowState: ORDER_FLOW.SESSION_CREATED
  };
  res.json(session);
});

app.get('/api/menu', (req, res) => {
  const outletId = String(req.query.outletId || getDefaultOutletId());
  const sessionId = String(req.query.sessionId || '').trim();
  const session = sessionId ? sessions.get(sessionId) : null;
  res.json({
    outletId,
    brand: getBrandingForOutlet(outletId),
    checkoutConfig: getCheckoutConfig(session),
    menu: getMenu({ outletId })
  });
});

app.get('/api/branding', (req, res) => {
  const outletId = String(req.query.outletId || getDefaultOutletId());
  res.json({ branding: getBrandingForOutlet(outletId) });
});

app.get('/api/showcase', (req, res) => {
  res.json({
    brands: getBrands().map(buildShowcaseBrand),
    outlets: getOutlets().map((outlet) => ({
      id: outlet.id,
      brandId: outlet.brandId,
      name: outlet.name,
      status: outlet.status,
      pickupLabel: outlet.pickupLabel,
      address: outlet.address
    }))
  });
});

app.get('/api/admin/me', (req, res) => {
  const user = req.adminUser;
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      brandIds: getAuthorizedBrandIds(user),
      outletIds: getAuthorizedOutletIds(user)
    }
  });
});

app.get('/api/admin/users', requirePlatformAdmin, (req, res) => {
  res.json({
    users: adminUsers.map(sanitizeAdminUser),
    roles: Object.values(ADMIN_ROLES)
  });
});

app.post('/api/admin/users', requirePlatformAdmin, (req, res) => {
  try {
    const nextUsers = upsertAdminUsersFromPayload(req.body?.users);
    res.json({ ok: true, users: nextUsers.map(sanitizeAdminUser) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/admin/outlets', (req, res) => {
  res.json({ outlets: getScopedOutletsForAdmin(req.adminUser) });
});

app.get('/api/admin/brands', (req, res) => {
  res.json({ brands: getScopedBrandsForAdmin(req.adminUser) });
});

app.get('/api/admin/petpooja-connections', (req, res) => {
  const connections = getPetpoojaConnections();
  res.json({ connections: isPlatformAdmin(req.adminUser) ? connections : connections.map(sanitizePetpoojaConnection) });
});

app.get('/api/admin/payment-connections', (req, res) => {
  const connections = getPaymentConnections();
  res.json({ connections: isPlatformAdmin(req.adminUser) ? connections : connections.map(sanitizePaymentConnection) });
});

app.get('/api/admin/whatsapp-connections', (req, res) => {
  const connections = getWhatsAppConnections();
  res.json({ connections: isPlatformAdmin(req.adminUser) ? connections : connections.map(sanitizeWhatsAppConnection) });
});

app.post('/api/admin/brands', (req, res) => {
  try {
    const requestedBrands = Array.isArray(req.body?.brands) ? req.body.brands : [];
    const isPlatform = isPlatformAdmin(req.adminUser);
    const authorizedBrandIds = getAuthorizedBrandIds(req.adminUser);
    let nextBrands;

    if (isPlatform) {
      nextBrands = replaceBrands(requestedBrands);
    } else if (!authorizedBrandIds.length && requestedBrands.length === 1) {
      const firstBrandId = String(requestedBrands[0]?.id || '').trim();
      if (!firstBrandId) throw new Error('Brand id is required before saving');
      nextBrands = replaceBrands([...brands, requestedBrands[0]]);
      const userIndex = adminUsers.findIndex((user) => user.id === req.adminUser.id);
      if (userIndex >= 0) {
        adminUsers[userIndex] = {
          ...adminUsers[userIndex],
          brandIds: [firstBrandId],
          updatedAt: new Date().toISOString()
        };
        req.adminUser = adminUsers[userIndex];
        persistAdminUsers(adminUsers);
      }
    } else if (requestedBrands.some((brand) => !canAccessBrand(req.adminUser, brand?.id))) {
      res.status(403).json({ error: 'Brand access denied' });
      return;
    } else {
      nextBrands = replaceBrands(brands.map((brand) => requestedBrands.find((candidate) => candidate.id === brand.id) || brand));
    }

    nextBrands.forEach((brand) => {
      logAuditEvent({
        outletId: null,
        action: 'BRAND_SAVED',
        entityType: 'brand',
        entityId: brand.id,
        summary: `Saved brand configuration for ${brand.name}`,
        actor: req.adminUser?.email || 'admin-ui',
        metadata: {
          customerAppBaseUrl: brand.customerAppBaseUrl
        }
      });
    });
    res.json({ ok: true, brands: nextBrands });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/petpooja-connections', (req, res) => {
  try {
    const requestedConnections = isPlatformAdmin(req.adminUser)
      ? req.body?.connections
      : mergeConnectorSecrets(petpoojaConnections, req.body?.connections, ['accessToken', 'appKey', 'appSecret']);
    const nextConnections = replacePetpoojaConnections(requestedConnections);
    res.json({
      ok: true,
      connections: isPlatformAdmin(req.adminUser) ? nextConnections : nextConnections.map(sanitizePetpoojaConnection)
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/payment-connections', (req, res) => {
  try {
    const requestedConnections = isPlatformAdmin(req.adminUser)
      ? req.body?.connections
      : mergeConnectorSecrets(paymentConnections, req.body?.connections, ['apiKey', 'apiSecret', 'webhookSecret']);
    const nextConnections = replacePaymentConnections(requestedConnections);
    nextConnections.forEach((connection) => {
      logAuditEvent({
        outletId: null,
        action: 'PAYMENT_CONNECTOR_SAVED',
        entityType: 'payment_connector',
        entityId: connection.id,
        summary: `Saved payment connector ${connection.name}`,
        actor: req.adminUser?.email || 'admin-ui',
        metadata: {
          provider: connection.provider,
          status: connection.status,
          accountId: connection.accountId,
          paymentMode: connection.paymentMode
        }
      });
    });
    res.json({
      ok: true,
      connections: isPlatformAdmin(req.adminUser) ? nextConnections : nextConnections.map(sanitizePaymentConnection)
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/whatsapp-connections', (req, res) => {
  try {
    const requestedConnections = isPlatformAdmin(req.adminUser)
      ? req.body?.connections
      : mergeConnectorSecrets(whatsappConnections, req.body?.connections, ['verifyToken', 'accessToken']);
    const nextConnections = replaceWhatsAppConnections(requestedConnections);
    nextConnections.forEach((connection) => {
      logAuditEvent({
        outletId: null,
        action: 'WHATSAPP_CONNECTOR_SAVED',
        entityType: 'whatsapp_connector',
        entityId: connection.id,
        summary: `Saved WhatsApp connector ${connection.name}`,
        actor: req.adminUser?.email || 'admin-ui',
        metadata: {
          status: connection.status,
          phoneNumber: connection.phoneNumber,
          phoneNumberId: connection.phoneNumberId,
          graphVersion: connection.graphVersion
        }
      });
    });
    res.json({
      ok: true,
      connections: isPlatformAdmin(req.adminUser) ? nextConnections : nextConnections.map(sanitizeWhatsAppConnection)
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/outlets', (req, res) => {
  try {
    const requestedOutlets = Array.isArray(req.body?.outlets) ? req.body.outlets : [];
    if (!isPlatformAdmin(req.adminUser) && requestedOutlets.some((outlet) => !canAccessOutlet(req.adminUser, outlet?.id))) {
      res.status(403).json({ error: 'Outlet access denied' });
      return;
    }
    const nextOutlets = isPlatformAdmin(req.adminUser)
      ? replaceOutlets(requestedOutlets)
      : replaceOutlets(outlets.map((outlet) => requestedOutlets.find((candidate) => candidate.id === outlet.id) || outlet));
    nextOutlets.forEach((outlet) => {
      logAuditEvent({
        outletId: outlet.id,
        action: 'OUTLET_SAVED',
        entityType: 'outlet',
        entityId: outlet.id,
        summary: `Saved outlet configuration for ${outlet.name}`,
        actor: req.adminUser?.email || 'admin-ui',
        metadata: {
          status: outlet.status,
          paymentProvider: outlet.paymentProvider,
          paymentMode: outlet.paymentMode
        }
      });
    });
    res.json({ ok: true, outlets: nextOutlets });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/admin/menu', (req, res) => {
  const outletId = String(req.query.outletId || getDefaultOutletId());
  if (!requireOutletAccess(req, res, outletId)) return;
  res.json({ outletId, menu: getMenu({ includeUnavailable: true, outletId }) });
});

app.get('/api/admin/orders', (req, res) => {
  const outletId = String(req.query.outletId || '');
  if (outletId) {
    if (!requireOutletAccess(req, res, outletId)) return;
    res.json({ orders: listOrdersByOutlet(outletId) });
    return;
  }
  const authorizedOutletIds = new Set(getAuthorizedOutletIds(req.adminUser));
  res.json({ orders: listOrdersByOutlet('').filter((order) => authorizedOutletIds.has(order.outletId)) });
});

app.get('/api/admin/marketing/audience', (req, res) => {
  const outletId = String(req.query.outletId || getDefaultOutletId());
  if (!requireOutletAccess(req, res, outletId)) return;
  res.json({ audience: listAudienceByOutlet(outletId) });
});

app.get('/api/admin/whatsapp-campaigns', (req, res) => {
  const outletId = String(req.query.outletId || '');
  if (outletId) {
    if (!requireOutletAccess(req, res, outletId)) return;
    res.json({ campaigns: listWhatsAppCampaigns(outletId) });
    return;
  }
  const authorizedOutletIds = new Set(getAuthorizedOutletIds(req.adminUser));
  res.json({ campaigns: listWhatsAppCampaigns('').filter((campaign) => authorizedOutletIds.has(campaign.outletId)) });
});

app.post('/api/admin/whatsapp-campaigns/send', async (req, res) => {
  try {
    const outletId = String(req.body?.outletId || getDefaultOutletId()).trim();
    if (!requireOutletAccess(req, res, outletId)) return;
    const outlet = getOutlet(outletId);
    if (!outlet) throw new Error('Outlet not found');

    const recipients = Array.isArray(req.body?.recipients)
      ? req.body.recipients.map((value) => normalizeWhatsAppRecipient(value)).filter(Boolean)
      : [];
    if (!recipients.length) throw new Error('Select at least one recipient');

    const imageUrl = String(req.body?.imageUrl || '').trim();
    if (!imageUrl) throw new Error('Image URL is required');

    const caption = String(req.body?.caption || '').trim();
    let sentCount = 0;
    let failedCount = 0;

    for (const recipient of recipients) {
      try {
        await sendWhatsAppImageMessage(recipient, imageUrl, caption, { outletId });
        sentCount += 1;
      } catch (error) {
        failedCount += 1;
        logAuditEvent({
          outletId,
          action: 'WHATSAPP_CAMPAIGN_SEND_FAILED',
          entityType: 'whatsapp_campaign',
          entityId: recipient,
          summary: `Failed WhatsApp campaign send to ${recipient}`,
          actor: req.adminUser?.email || 'admin-ui',
          metadata: { error: error.message, imageUrl }
        });
      }
    }

    const campaign = normalizeWhatsAppCampaign({
      id: `campaign_${nanoid(10)}`,
      outletId,
      brandId: outlet.brandId,
      imageUrl,
      caption,
      recipients,
      sentCount,
      failedCount,
      createdAt: new Date().toISOString(),
      createdBy: req.adminUser?.email || 'admin-ui'
    });
    whatsappCampaigns = [campaign, ...whatsappCampaigns].slice(0, 100);
    persistWhatsAppCampaigns();

    logAuditEvent({
      outletId,
      action: 'WHATSAPP_CAMPAIGN_SENT',
      entityType: 'whatsapp_campaign',
      entityId: campaign.id,
      summary: `Sent WhatsApp image campaign to ${sentCount} recipients`,
      actor: req.adminUser?.email || 'admin-ui',
      metadata: {
        imageUrl,
        sentCount,
        failedCount
      }
    });

    res.json({ ok: true, campaign });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/admin/payments', (req, res) => {
  const outletId = String(req.query.outletId || '');
  if (outletId) {
    if (!requireOutletAccess(req, res, outletId)) return;
    res.json({ payments: listPaymentsByOutlet(outletId) });
    return;
  }
  const authorizedOutletIds = new Set(getAuthorizedOutletIds(req.adminUser));
  res.json({ payments: listPaymentsByOutlet('').filter((payment) => authorizedOutletIds.has(payment.outletId)) });
});

app.get('/api/admin/menu/images', (req, res) => {
  try {
    const outletId = String(req.query.outletId || getDefaultOutletId());
    if (!requireOutletAccess(req, res, outletId)) return;
    res.json({ images: getUploadedImagesByOutlet(outletId) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/admin/audit-logs', (req, res) => {
  try {
    const outletId = String(req.query.outletId || getDefaultOutletId());
    if (!requireOutletAccess(req, res, outletId)) return;
    res.json({ entries: listAuditLogsByOutlet(outletId) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/admin/whatsapp-events', (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    res.json({ events: listWhatsAppEvents(limit) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/admin/petpooja-config', (req, res) => {
  try {
    const outletId = req.query?.outletId || '';
    res.json({ ok: true, config: getPetpoojaConfigSnapshot(outletId) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/admin/menu/sample.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="menu-sample.csv"');
  res.send(SAMPLE_CSV_TEXT);
});

app.post('/api/admin/menu/parse-csv', (req, res) => {
  try {
    const nextMenu = parseMenuCsv(req.body?.csvText);
    res.json({ ok: true, menu: nextMenu });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/menu/parse-spreadsheet', (req, res) => {
  try {
    const nextMenu = parseMenuSpreadsheet(req.body?.base64Content);
    res.json({ ok: true, menu: nextMenu });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/menu/pull-from-petpooja', async (req, res) => {
  try {
    const outletId = String(req.body?.outletId || getDefaultOutletId());
    if (!requireOutletAccess(req, res, outletId)) return;
    const pulledMenu = await pullMenuFromPetpooja(outletId);
    res.json({ ok: true, ...pulledMenu });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/menu/upload-image', (req, res) => {
  upload.single('image')(req, res, (error) => {
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Image file is required' });
      return;
    }

    try {
      const outletId = getValidatedOutletId(req.query?.outletId);
      if (!requireOutletAccess(req, res, outletId)) return;
      const imageUrl = `${getPublicBaseUrl(req)}/uploads/${encodeURIComponent(outletId)}/${encodeURIComponent(req.file.filename)}`;
      const image = recordUploadedImage({
        outletId,
        imageUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadedBy: req.adminUser?.email || 'admin-ui'
      });
      res.json({ ok: true, imageUrl, image });
    } catch (uploadError) {
      res.status(400).json({ error: uploadError.message });
    }
  });
});

app.post('/api/admin/orders/:orderId/resend-confirmation', async (req, res) => {
  try {
    const order = orders.get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!requireOutletAccess(req, res, order.outletId)) return;
    if (order.paymentStatus !== 'PAID') return res.status(400).json({ error: 'Order is not paid yet' });

    await sendWhatsAppMessage(order.customerMobile, buildPickupConfirmationMessage(order), { outletId: order.outletId });
    logAuditEvent({
      outletId: order.outletId,
      action: 'ORDER_CONFIRMATION_RESENT',
      entityType: 'order',
      entityId: order.id,
      summary: `Resent WhatsApp confirmation for order ${order.id}`,
      actor: req.adminUser?.email || 'admin-ui',
      metadata: {
        customerMobile: order.customerMobile
      }
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/payments/:orderId/simulate-paid', async (req, res) => {
  if (IS_PRODUCTION && !ALLOW_PAYMENT_FALLBACK) {
    res.status(403).json({ error: 'Manual payment simulation is disabled in production' });
    return;
  }

  try {
    const existingOrder = orders.get(req.params.orderId);
    if (!existingOrder) return res.status(404).json({ error: 'Order not found' });
    if (!requireOutletAccess(req, res, existingOrder.outletId)) return;
    const order = await markOrderPaid(req.params.orderId);
    logAuditEvent({
      outletId: order.outletId,
      action: 'PAYMENT_MARKED_PAID',
      entityType: 'payment',
      entityId: order.id,
      summary: `Marked payment as paid for order ${order.id}`,
      actor: req.adminUser?.email || 'admin-ui',
      metadata: {
        paymentStatus: order.paymentStatus,
        paymentReference: order.payment?.paymentReference || null
      }
    });
    res.json({ ok: true, order });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/menu', (req, res) => {
  try {
    const outletId = String(req.body?.outletId || getDefaultOutletId());
    if (!requireOutletAccess(req, res, outletId)) return;
    const nextMenu = replaceMenu(req.body?.menu, { outletId });
    logAuditEvent({
      outletId,
      action: 'MENU_SAVED',
      entityType: 'menu',
      entityId: outletId,
      summary: `Saved menu for outlet ${outletId}`,
      actor: req.adminUser?.email || 'admin-ui',
      metadata: {
        itemCount: nextMenu.length
      }
    });
    res.json({ ok: true, outletId, menu: nextMenu });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/admin/menu', (req, res) => {
  res.type('html').send(renderAdminMenuPage());
});

app.post('/api/checkout', async (req, res) => {
  try {
    const order = await createCheckoutOrder(req.body || {});
    res.json(order);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/mock-payment-success', async (req, res) => {
  res.status(410).json({ error: 'Mock payment completion is disabled. Use webhook or admin payment actions.' });
});

app.post('/razorpay/webhook', async (req, res) => {
  try {
    verifyRazorpayWebhookSignature(req);
    const order = await handleVerifiedPaymentEvent(req.body, { verifiedByWebhook: true });
    logAuditEvent({
      outletId: order.outletId,
      action: 'PAYMENT_WEBHOOK_PROCESSED',
      entityType: 'payment',
      entityId: order.id,
      summary: `Processed Razorpay webhook for order ${order.id}`,
      actor: 'razorpay-webhook',
      metadata: {
        paymentStatus: order.paymentStatus,
        event: req.body?.event || null
      }
    });
    res.json({ ok: true, orderId: order.id, paymentStatus: order.paymentStatus });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/orders/:orderId', (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({
    ...order,
    branding: getBrandingForOutlet(order.outletId)
  });
});

app.post('/api/verify-pickup', (req, res) => {
  const { code } = req.body;
  const order = [...orders.values()].find((o) => o.pickupCode === code);

  if (!order) return res.status(404).json({ error: 'Invalid pickup code' });
  if (!order.codeActive) return res.status(400).json({ error: 'Code already used or inactive' });
  if (order.paymentStatus !== 'PAID') return res.status(400).json({ error: 'Payment not completed' });

  order.codeActive = false;
  order.orderStatus = 'PICKED_UP';
  order.pickedUpAt = new Date().toISOString();
  persistOrders();
  logAuditEvent({
    outletId: order.outletId,
    action: 'PICKUP_VERIFIED',
    entityType: 'order',
    entityId: order.id,
    summary: `Verified pickup code for order ${order.id}`,
    actor: 'pickup-counter',
    metadata: {
      pickupCode: order.pickupCode
    }
  });

  res.json({ ok: true, order });
});

app.post('/whatsapp/webhook', async (req, res) => {
  try {
    verifyMetaWebhookSignature(req);
    const messages = extractWhatsAppEvents(req.body);
    for (const message of messages) {
      await handleIncomingWhatsAppMessage(message);
    }
    console.log('WHATSAPP_WEBHOOK_RECEIVED', JSON.stringify(req.body, null, 2));
  } catch (error) {
    console.error('WHATSAPP_WEBHOOK_ERROR', error.message);
  }
  res.json({ ok: true });
});

app.get('/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const matchesSavedConnector = whatsappConnections.some((connection) => buildWhatsAppConnectionSnapshot(connection).verifyToken === token);
  const platformSnapshot = getPlatformWhatsAppConnectionSnapshot();
  if (mode === 'subscribe' && (matchesSavedConnector || token === platformSnapshot.verifyToken)) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  app.listen(PORT, () => {
    console.log(`Weborder backend running on http://localhost:${PORT}`);
  });
}
