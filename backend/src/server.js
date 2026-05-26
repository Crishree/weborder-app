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
let sessionsFile = process.env.SESSIONS_FILE || path.join(__dirname, '..', 'data', 'sessions.json');
let ordersFile = process.env.ORDERS_FILE || path.join(__dirname, '..', 'data', 'orders.json');
let imageManifestFile = process.env.IMAGE_MANIFEST_FILE || path.join(__dirname, '..', 'data', 'uploaded-images.json');
let auditLogFile = process.env.AUDIT_LOG_FILE || path.join(__dirname, '..', 'data', 'audit-logs.json');
let whatsappEventsFile = process.env.WHATSAPP_EVENTS_FILE || path.join(__dirname, '..', 'data', 'whatsapp-events.json');
let whatsappCampaignsFile = process.env.WHATSAPP_CAMPAIGNS_FILE || path.join(__dirname, '..', 'data', 'whatsapp-campaigns.json');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');

app.use(cors());
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buffer) => {
    req.rawBody = buffer;
  }
}));
app.use('/uploads', express.static(UPLOAD_DIR));

const sessions = new Map();
const orders = new Map();

const defaultBrands = [
  {
    id: 'showcase',
    name: 'PikQuik Showcase',
    customerAppBaseUrl: process.env.FRONTEND_BASE_URL || '',
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
    name: 'Showcase HQ',
    status: 'ACTIVE',
    pickupLabel: 'Pickup counter',
    address: 'Bangalore, India',
    latitude: 12.9783,
    longitude: 77.6634,
    locationKeywords: ['showcase', 'demo', 'hq', 'bangalore'],
    timezone: 'Asia/Kolkata',
    paymentProvider: 'Razorpay',
    paymentMode: 'payment_link',
    petpoojaOutletId: 'PP_OUTLET_SHOWCASE_HQ',
    supportPhone: '+91-9000000001'
  }
];

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
const SAMPLE_CSV_HEADERS = ['id', 'petpoojaItemId', 'name', 'description', 'price', 'category', 'image', 'available'];
const SAMPLE_CSV_TEXT = [
  SAMPLE_CSV_HEADERS.join(','),
  'filter_coffee,PP_FILTER_COFFEE,Filter Coffee,"Strong, rich South Indian filter coffee",60,Beverages,https://example.com/filter-coffee.jpg,true',
  'masala_tea,PP_MASALA_TEA,Masala Tea,Spiced chai with milk,40,Beverages,https://example.com/masala-tea.jpg,false'
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
let outlets = loadOutletsFromDisk();
let menusByOutlet = loadMenusFromDisk();
let uploadedImagesByOutlet = loadUploadedImagesFromDisk();
let auditLogsByOutlet = loadAuditLogsFromDisk();
let whatsappEvents = loadWhatsAppEventsFromDisk();
let whatsappCampaigns = loadWhatsAppCampaignsFromDisk();
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
      paymentProvider: String(outlet.paymentProvider || 'Razorpay').trim(),
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

    const normalizedItem = {
      id: String(item.id || '').trim(),
      petpoojaItemId: String(item.petpoojaItemId || '').trim(),
      name: String(item.name || '').trim(),
      description: String(item.description || '').trim(),
      price: Number(item.price),
      category: String(item.category || '').trim(),
      image: String(item.image || '').trim(),
      available: item.available !== false
    };

    if (!normalizedItem.id) throw new Error(`Menu item at index ${index} is missing id`);
    if (seenIds.has(normalizedItem.id)) throw new Error(`Duplicate menu item id: ${normalizedItem.id}`);
    if (!normalizedItem.name) throw new Error(`Menu item ${normalizedItem.id} is missing name`);
    if (!normalizedItem.petpoojaItemId) throw new Error(`Menu item ${normalizedItem.id} is missing petpoojaItemId`);
    if (!normalizedItem.category) throw new Error(`Menu item ${normalizedItem.id} is missing category`);
    if (!normalizedItem.description) throw new Error(`Menu item ${normalizedItem.id} is missing description`);
    if (!normalizedItem.image) throw new Error(`Menu item ${normalizedItem.id} is missing image`);
    if (!Number.isFinite(normalizedItem.price) || normalizedItem.price <= 0) {
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

function getBrand(brandId) {
  return brands.find((brand) => brand.id === brandId) || null;
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
  const invalidOutlet = outlets.find((outlet) => !brandIds.has(outlet.brandId));
  if (invalidOutlet) {
    throw new Error(`Cannot save brands because outlet ${invalidOutlet.id} references missing brand ${invalidOutlet.brandId}`);
  }
  brands = normalizedBrands;
  if (persist) {
    persistBrands(normalizedBrands);
  }
  return normalizedBrands;
}

export function replaceOutlets(nextOutlets, { persist = true } = {}) {
  const normalizedOutlets = normalizeOutlets(nextOutlets);
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
  const requiredHeaders = ['id', 'petpoojaItemId', 'name', 'description', 'price', 'category', 'image'];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new Error(`CSV is missing required columns: ${missingHeaders.join(', ')}`);
  }

  const csvMenu = lines.slice(1).map((line, lineIndex) => {
    const values = parseCsvRow(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    const availableValue = String(row.available || '').trim().toLowerCase();

    return {
      id: row.id,
      petpoojaItemId: row.petpoojaItemId,
      name: row.name,
      description: row.description,
      price: row.price,
      category: row.category,
      image: row.image,
      available: availableValue ? !['false', '0', 'no'].includes(availableValue) : true,
      _lineIndex: lineIndex + 2
    };
  });

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

  try {
    return normalizeMenu(rows);
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

function resolveOutletFromCustomerContext({ text, latitude, longitude }) {
  const activeOutlets = outlets.filter((outlet) => outlet.status === 'ACTIVE');
  const candidates = activeOutlets.length ? activeOutlets : outlets;
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
    (entry?.changes || []).flatMap((change) => change?.value?.messages || [])
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

export async function handleIncomingWhatsAppMessage(message) {
  const customerMobile = message?.from;
  if (!customerMobile) {
    return null;
  }

  recordWhatsAppEvent({
    direction: 'inbound',
    customerMobile,
    eventType: message?.type || 'message',
    summary: getWhatsAppMessageText(message) || 'Inbound WhatsApp event',
    payload: message,
    createdAt: new Date().toISOString()
  });

  const messageText = getWhatsAppMessageText(message);
  const latitude = Number(message?.location?.latitude);
  const longitude = Number(message?.location?.longitude);
  const resolution = resolveOutletFromCustomerContext({
    text: messageText,
    latitude,
    longitude
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

  await sendWhatsAppMessage(customerMobile, replyText);
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
  const outlet = outletId ? getOutlet(outletId) : null;
  const configuredApiBaseUrl = String(process.env.PETPOOJA_API_BASE_URL || DEFAULT_PETPOOJA_API_BASE_URL).trim();
  const appKey = String(process.env.PETPOOJA_APP_KEY || '').trim();
  const appSecret = String(process.env.PETPOOJA_APP_SECRET || '').trim();
  const accessToken = String(process.env.PETPOOJA_ACCESS_TOKEN || '').trim();
  const restaurantId = String(outlet?.petpoojaRestaurantId || process.env.PETPOOJA_RESTAURANT_ID || '').trim();
  const missing = [];

  if (!configuredApiBaseUrl) missing.push('PETPOOJA_API_BASE_URL');
  if (!appKey) missing.push('PETPOOJA_APP_KEY');
  if (!appSecret) missing.push('PETPOOJA_APP_SECRET');
  if (!accessToken) missing.push('PETPOOJA_ACCESS_TOKEN');
  if (!restaurantId) missing.push('PETPOOJA_RESTAURANT_ID');
  if (outlet && !String(outlet.petpoojaOutletId || '').trim()) missing.push('petpoojaOutletId');

  return {
    configured: missing.length === 0,
    missing,
    apiBaseUrl: configuredApiBaseUrl,
    restaurantId,
    outletId: outlet?.id || '',
    petpoojaOutletId: outlet?.petpoojaOutletId || '',
    auth: {
      appKeyConfigured: Boolean(appKey),
      appSecretConfigured: Boolean(appSecret),
      accessTokenConfigured: Boolean(accessToken)
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
        : 'Petpooja menu sync is waiting for configuration. Add API base URL, access token, app key, app secret, restaurant ID, and outlet mapping fields.',
      config
    };
  }
};

let whatsappFetch = globalThis.fetch?.bind(globalThis);

function normalizeWhatsAppRecipient(value) {
  return String(value || '')
    .trim()
    .replace(/[^\d+]/g, '');
}

async function sendWhatsAppViaMeta(payload) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';

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
    payload,
    response: parsedResponse
  };
}

const whatsappProvider = {
  async sendMessage({ to, text }) {
    const metaResult = await sendWhatsAppViaMeta({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeWhatsAppRecipient(to),
      type: 'text',
      text: {
        preview_url: false,
        body: text
      }
    });
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
      payload: metaResult || { provider: 'placeholder', to, text },
      createdAt: new Date().toISOString()
    });
    return { ok: true, provider: metaResult?.provider || 'placeholder' };
  },
  async sendImageMessage({ to, imageUrl, caption = '' }) {
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
    const metaResult = await sendWhatsAppViaMeta(payload);
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
      payload: metaResult || { provider: 'placeholder', to, imageUrl, caption },
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
      .grid { display: grid; gap: 22px; margin-top: 26px; }
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
      </section>

      <div class="grid">
        <section class="panel">
          <h2>Brands</h2>
          <p class="hint">Manage shared brand identity here. Multiple outlets can point to one brand so they share the same domain, voice, theme, and logo.</p>
          <div class="note-card">
            <strong>About customer app base URL</strong>
            <span class="hint">Use this only when a brand should open on its own customer-facing domain, such as <code>https://brand.example.com</code>. If left blank, links fall back to the outlet override first and then the server-level default domain.</span>
          </div>
          <label for="brand-select">Current Brand</label>
          <select id="brand-select"></select>
          <div class="actions">
            <button class="secondary" id="add-brand" type="button">Add brand</button>
            <button class="secondary" id="remove-brand" type="button">Remove brand</button>
            <button class="primary" id="save-brands" type="button">Save brands</button>
          </div>
          <div id="brand-status" class="status"></div>
          <div id="brand-form" class="outlet-grid"></div>
        </section>

        <section class="panel">
          <h2>Outlets</h2>
          <p class="hint">Switch the active outlet context and manage outlet-level configuration here. Menu, order, and payment views below will follow the selected outlet.</p>
          <label for="outlet-select">Current Outlet</label>
          <select id="outlet-select"></select>
          <div class="actions">
            <button class="secondary" id="add-outlet" type="button">Add outlet</button>
            <button class="primary" id="save-outlets" type="button">Save outlets</button>
          </div>
          <div id="outlet-status" class="status"></div>
          <div id="outlet-form" class="outlet-grid"></div>
        </section>

        <section class="panel">
          <h2>Petpooja Integration</h2>
          <p class="hint">Set up the exact credentials and outlet mappings needed for live Petpooja menu sync. This panel shows what the admin must fill, what must be configured in Render, and how the sync workflow works.</p>
          <div class="note-card">
            <strong>What the admin needs to do</strong>
            <span class="hint">Fill the outlet mapping fields in the Outlets section below, confirm the Petpooja credentials are present in Render environment variables, then click <code>Pull From Petpooja</code> in the Menu Items section for the selected outlet.</span>
          </div>
          <div class="note-card">
            <strong>What we need from Petpooja</strong>
            <span class="hint">Access token, App Key, App Secret, Restaurant ID, and the exact outlet mapping ID used by Petpooja for this outlet. Once those are available, the backend can fetch categories, item names, prices, and availability status for that outlet.</span>
          </div>
          <div id="petpooja-config-status" class="status"></div>
          <div id="petpooja-config-card" class="preview"></div>
        </section>

        <section class="panel">
          <h2>Menu Items</h2>
          <p class="hint">Use the row editor below. CSV and Excel headers supported: <code>id,petpoojaItemId,name,description,price,category,image,available</code>.</p>
          <div class="actions">
            <label class="file-label" for="menu-file">Choose JSON, CSV, or Excel File</label>
            <input id="menu-file" type="file" accept=".json,.csv,.xlsx,.xls,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
            <a class="link-btn" href="/api/admin/menu/sample.csv" download="menu-sample.csv">Download Sample CSV</a>
            <button class="secondary" id="load-current" type="button">Reload Current Menu</button>
            <button class="secondary" id="pull-petpooja-menu" type="button">Pull From Petpooja</button>
            <button class="secondary" id="add-item" type="button">Add Menu Item</button>
            <button class="primary" id="save-menu" type="button">Save Menu</button>
          </div>
          <div id="status" class="status"></div>
          <div id="menu-items" class="menu-items"></div>
          <details>
            <summary>Advanced JSON Editor</summary>
            <p class="hint">This stays in sync with the form. You can still paste raw JSON if needed.</p>
            <label for="menu-json">Menu JSON</label>
            <textarea id="menu-json"></textarea>
          </details>
        </section>

        <section class="panel">
          <h2>Image Upload</h2>
          <p class="hint">Upload a menu image for the selected outlet. The backend will host it, store the metadata, and return a URL you can paste into the menu item's image field.</p>
          <div class="actions">
            <label class="file-label" for="image-file">Choose image</label>
            <input id="image-file" type="file" accept="image/*" />
            <button class="primary" id="upload-image" type="button">Upload Image</button>
          </div>
          <div id="image-status" class="status"></div>
          <label for="image-url" style="margin-top: 16px;">Uploaded image URL</label>
          <textarea id="image-url" style="min-height: 88px;"></textarea>
        </section>

        <section class="panel">
          <h2>Image Library</h2>
          <p class="hint">These are the persisted uploaded images for the selected outlet.</p>
          <div id="image-library"></div>
        </section>

        <section class="panel">
          <h2>Preview</h2>
          <p class="hint">This preview reads from the form and JSON editor before you save.</p>
          <div id="preview" class="preview"></div>
        </section>

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
          <h2>Audit Log</h2>
          <p class="hint">Outlet-scoped admin history for menu, payment, order, and image operations.</p>
          <div id="audit-table"></div>
        </section>

        <section class="panel">
          <h2>WhatsApp Test Mode</h2>
          <p class="hint">Use Meta Cloud API test mode before switching to a live brand-owned WhatsApp number.</p>
          <div class="preview-card">
            <strong>Test Checklist</strong>
            <div>1. Expose this backend on a public HTTPS URL using ngrok or a deployed endpoint.</div>
            <div>2. In Meta App Dashboard, set the callback URL to <code>/whatsapp/webhook</code>.</div>
            <div>3. Set <code>WHATSAPP_VERIFY_TOKEN</code> in the backend and use the same value in Meta webhook setup.</div>
            <div>4. Add your own phone number as a test recipient in Meta Cloud API.</div>
            <div>5. Send <code>Hi</code> or a location hint such as <code>Bagmane</code> to the Meta test number.</div>
            <div>6. Confirm the webhook events below show both the inbound message and the outbound menu link reply.</div>
          </div>
          <div class="actions">
            <button class="secondary" id="refresh-whatsapp-events" type="button">Refresh WhatsApp Events</button>
          </div>
          <div id="whatsapp-events-table"></div>
        </section>

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
      const petpoojaConfigStatusBox = document.getElementById('petpooja-config-status');
      const petpoojaConfigCard = document.getElementById('petpooja-config-card');
      const brandSelect = document.getElementById('brand-select');
      const brandForm = document.getElementById('brand-form');
      const outletSelect = document.getElementById('outlet-select');
      const outletForm = document.getElementById('outlet-form');
      const ordersStatusBox = document.getElementById('orders-status');
      const paymentsStatusBox = document.getElementById('payments-status');
      const ordersTable = document.getElementById('orders-table');
      const paymentsTable = document.getElementById('payments-table');
      const auditTable = document.getElementById('audit-table');
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
      const addOutletButton = document.getElementById('add-outlet');
      const saveOutletsButton = document.getElementById('save-outlets');
      let brandState = [];
      let outletState = [];
      let marketingAudienceState = [];
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
          name: '',
          status: 'ACTIVE',
          pickupLabel: '',
          address: '',
          customerAppBaseUrl: '',
          timezone: 'Asia/Kolkata',
          latitude: '',
          longitude: '',
          locationKeywords: '',
          paymentProvider: 'Razorpay',
          paymentMode: 'payment_link',
          petpoojaOutletId: '',
          supportPhone: ''
        };
      }

      function defaultBrand() {
        return {
          id: '',
          name: '',
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
          whatsappEventsTable.innerHTML = '<p class="hint">No WhatsApp webhook events captured yet.</p>';
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

      function renderBrandForm(selectedIndex) {
        const brand = brandState[selectedIndex] || defaultBrand();
        brandForm.innerHTML =
          '<div><label>Brand id</label><input type="text" data-brand-field="id" value="' + escapeHtml(brand.id) + '" /></div>' +
          '<div><label>Brand name</label><input type="text" data-brand-field="name" value="' + escapeHtml(brand.name) + '" /></div>' +
          '<div><label>Customer app base URL (optional)</label><input type="text" data-brand-field="customerAppBaseUrl" value="' + escapeHtml(brand.customerAppBaseUrl || '') + '" placeholder="https://brand.pikquik.com" /><div class="micro-copy">Used for WhatsApp, campaign, and payment-success links when this brand owns its own domain.</div></div>' +
          '<div><label>Hero eyebrow</label><input type="text" data-brand-field="heroEyebrow" value="' + escapeHtml(brand.heroEyebrow || '') + '" /></div>' +
          '<div class="full field-group-title">Customer-facing identity</div>' +
          '<div><label>Hero title</label><input type="text" data-brand-field="heroTitle" value="' + escapeHtml(brand.heroTitle || '') + '" /></div>' +
          '<div class="full"><label>Hero subtitle</label><textarea class="field-textarea" data-brand-field="heroSubtitle">' + escapeHtml(brand.heroSubtitle || '') + '</textarea></div>' +
          '<div><label>Logo text</label><input type="text" data-brand-field="logoText" value="' + escapeHtml(brand.logoText || '') + '" /></div>' +
          '<div class="full"><label>Brand logo</label><div class="image-tools"><label class="file-label" for="brand-logo-file">Upload logo</label><input id="brand-logo-file" type="file" accept="image/*" data-brand-logo-file="true" /></div>' +
          '<input type="text" data-brand-field="logoUrl" value="' + escapeHtml(brand.logoUrl || '') + '" placeholder="Logo will be uploaded and linked automatically" readonly />' +
          (brand.logoUrl ? '<div style="margin-top:8px;"><img class="image-preview" src="' + escapeHtml(brand.logoUrl) + '" alt="' + escapeHtml(brand.name || 'Brand logo') + '" style="max-width:180px; max-height:56px; width:auto; height:auto; object-fit:contain;" /></div>' : '') +
          '</div>' +
          '<div class="full field-group-title">Visual system</div>' +
          '<div><label>Primary color</label><input type="text" data-brand-field="primaryColor" value="' + escapeHtml(brand.primaryColor || '#007a63') + '" /></div>' +
          '<div><label>Accent color</label><input type="text" data-brand-field="accentColor" value="' + escapeHtml(brand.accentColor || '#ffd84d') + '" /></div>' +
          '<div><label>Accent text color</label><input type="text" data-brand-field="accentTextColor" value="' + escapeHtml(brand.accentTextColor || '#202020') + '" /></div>' +
          '<div><label>Background color</label><input type="text" data-brand-field="backgroundColor" value="' + escapeHtml(brand.backgroundColor || '#fffaf0') + '" /></div>' +
          '<div><label>Surface color</label><input type="text" data-brand-field="surfaceColor" value="' + escapeHtml(brand.surfaceColor || '#ffffff') + '" /></div>';
      }

      function renderOutletSelector() {
        outletSelect.innerHTML = outletState.map((outlet, index) =>
          '<option value="' + escapeHtml(String(index)) + '">' + escapeHtml(outlet.name || outlet.id || ('Outlet ' + (index + 1))) + '</option>'
        ).join('');
      }

      function renderOutletForm(selectedIndex) {
        const outlet = outletState[selectedIndex] || defaultOutlet();
        const brandOptions = brandState.map((brand) =>
          '<option value="' + escapeHtml(brand.id) + '"' + (outlet.brandId === brand.id ? ' selected' : '') + '>' + escapeHtml(brand.name || brand.id) + '</option>'
        ).join('');
        outletForm.innerHTML =
          '<div><label>Outlet id</label><input type="text" data-outlet-field="id" value="' + escapeHtml(outlet.id) + '" /></div>' +
          '<div><label>Brand</label><select data-outlet-field="brandId">' + brandOptions + '</select></div>' +
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
        Array.from(brandForm.querySelectorAll('[data-brand-field]')).forEach((field) => {
          brandState[selectedIndex][field.dataset.brandField] = field.value.trim();
        });
        renderBrandSelector();
        brandSelect.value = String(selectedIndex);
      }

      function getSelectedOutletId() {
        const selectedIndex = Number(outletSelect.value || 0);
        return outletState[selectedIndex]?.id || outletState[0]?.id || 'showcase_hq';
      }

      function setPetpoojaConfigStatus(message, kind) {
        petpoojaConfigStatusBox.textContent = message;
        petpoojaConfigStatusBox.className = 'status show ' + (kind || 'ok');
      }

      function renderPetpoojaConfig(config) {
        if (!config) {
          petpoojaConfigCard.innerHTML = '<div class="preview-card"><strong>Petpooja configuration unavailable</strong><span class="hint">Choose an outlet and reload the panel.</span></div>';
          return;
        }

        const missingList = (config.missing || []).length
          ? '<ul class="showcase-list">' + config.missing.map((entry) => '<li>' + escapeHtml(entry) + '</li>').join('') + '</ul>'
          : '<div class="hint">All required configuration fields are present. Live menu sync still needs the exact Petpooja endpoint workflow.</div>';

        petpoojaConfigCard.innerHTML =
          '<div class="preview-card">' +
            '<strong>Fill these in the admin</strong>' +
            '<ul class="showcase-list">' +
              '<li><code>Petpooja outlet id</code> in the selected outlet</li>' +
              '<li><code>Petpooja restaurant id</code> in the selected outlet, if it differs per restaurant</li>' +
              '<li><code>Petpooja item id</code> on each menu item if you plan to push paid orders back later</li>' +
            '</ul>' +
          '</div>' +
          '<div class="preview-card">' +
            '<strong>Configure these in Render</strong>' +
            '<ul class="showcase-list">' +
              '<li><code>PETPOOJA_API_BASE_URL</code></li>' +
              '<li><code>PETPOOJA_ACCESS_TOKEN</code></li>' +
              '<li><code>PETPOOJA_APP_KEY</code></li>' +
              '<li><code>PETPOOJA_APP_SECRET</code></li>' +
              '<li><code>PETPOOJA_RESTAURANT_ID</code> if it is shared across outlets</li>' +
            '</ul>' +
          '</div>' +
          '<div class="preview-card">' +
            '<strong>Current outlet mapping</strong>' +
            '<div class="hint">Outlet ID: ' + escapeHtml(config.outletId || 'Not selected') + '</div>' +
            '<div class="hint">Petpooja outlet ID: ' + escapeHtml(config.petpoojaOutletId || 'Missing') + '</div>' +
            '<div class="hint">Restaurant ID: ' + escapeHtml(config.restaurantId || 'Missing') + '</div>' +
          '</div>' +
          '<div class="preview-card">' +
            '<strong>Global credential state</strong>' +
            '<div class="hint">API base URL: ' + escapeHtml(config.apiBaseUrl || DEFAULT_PETPOOJA_API_BASE_URL) + '</div>' +
            '<div class="hint">Access token configured: ' + (config.auth?.accessTokenConfigured ? 'Yes' : 'No') + '</div>' +
            '<div class="hint">App key configured: ' + (config.auth?.appKeyConfigured ? 'Yes' : 'No') + '</div>' +
            '<div class="hint">App secret configured: ' + (config.auth?.appSecretConfigured ? 'Yes' : 'No') + '</div>' +
          '</div>' +
          '<div class="preview-card">' +
            '<strong>Missing before live menu sync</strong>' +
            missingList +
          '</div>' +
          '<div class="preview-card">' +
            '<strong>How this works</strong>' +
            '<ol class="showcase-list">' +
              '<li>Select the outlet you want to sync.</li>' +
              '<li>Confirm the required mapping fields and credentials above show as configured.</li>' +
              '<li>Click <code>Pull From Petpooja</code> in the Menu Items section.</li>' +
              '<li>The backend calls the Petpooja menu endpoint for that outlet and converts the response into menu rows.</li>' +
              '<li>Review the imported rows, then click <code>Save Menu</code> if you want to persist them as the live storefront menu.</li>' +
            '</ol>' +
          '</div>';
      }

      async function loadPetpoojaConfig() {
        const outletId = getSelectedOutletId();
        const res = await fetch('/api/admin/petpooja-config?outletId=' + encodeURIComponent(outletId));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load Petpooja configuration');
        renderPetpoojaConfig(data.config);
        if (data.config?.configured) {
          setPetpoojaConfigStatus('Petpooja credentials and outlet mappings are configured. Live endpoint wiring is the final remaining step.', 'ok');
        } else {
          setPetpoojaConfigStatus('Petpooja integration is not fully configured yet. Complete the missing fields below and in Render environment variables.', 'error');
        }
      }

      async function loadBrands() {
        const res = await fetch('/api/admin/brands');
        const data = await res.json();
        brandState = data.brands || [];
        renderBrandSelector();
        renderBrandForm(0);
      }

      async function loadOutlets() {
        const res = await fetch('/api/admin/outlets');
        const data = await res.json();
        outletState = data.outlets || [];
        renderOutletSelector();
        renderOutletForm(0);
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
      });

      brandForm.addEventListener('input', () => {
        syncBrandStateFromForm();
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
        Promise.all([loadCurrentMenu(), loadOrdersAndPayments(), loadMarketingData(), loadPetpoojaConfig()]).catch((error) => setStatus(error.message, 'error'));
      });

      outletForm.addEventListener('input', () => {
        syncOutletStateFromForm();
      });

      addBrandButton.addEventListener('click', () => {
        brandState.push(defaultBrand());
        renderBrandSelector();
        brandSelect.value = String(brandState.length - 1);
        renderBrandForm(brandState.length - 1);
        setBrandStatus('New brand row added. Fill the details or remove it before saving.', 'ok');
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
        setBrandStatus('Brand removed from the editor. Click Save Brands to persist.', 'ok');
      });

      saveBrandsButton.addEventListener('click', async () => {
        try {
          syncBrandStateFromForm();
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
          setBrandStatus('Brand settings saved.', 'ok');
        } catch (error) {
          setBrandStatus(error.message, 'error');
        }
      });

      addOutletButton.addEventListener('click', () => {
        outletState.push(defaultOutlet());
        renderOutletSelector();
        outletSelect.value = String(outletState.length - 1);
        renderOutletForm(outletState.length - 1);
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
          await loadPetpoojaConfig();
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
          await Promise.all([loadCurrentMenu(), loadOrdersAndPayments(), loadPetpoojaConfig()]);
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
          setStatus('Loaded recent WhatsApp webhook events.', 'ok');
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
        .then(() => Promise.all([loadOutlets(), loadCurrentMenu(), loadOrdersAndPayments(), loadWhatsAppEvents(), loadMarketingData(), loadPetpoojaConfig()]))
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

async function createRazorpayPaymentLink(order) {
  // TODO: Replace with Razorpay Payment Links API call.
  // Return the live payment link URL after integrating Razorpay.
  return `${getCustomerAppBaseUrl(order.outletId)}/success?orderId=${order.id}`;
}

function buildPaymentRecord(order, paymentLink) {
  return {
    provider: 'Razorpay',
    mode: 'payment_link',
    status: 'PENDING',
    amount: order.total,
    currency: 'INR',
    paymentLink,
    paymentLinkId: `plink_${order.id}`,
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

async function sendWhatsAppMessage(to, text) {
  return whatsappProvider.sendMessage({ to, text });
}

async function sendWhatsAppImageMessage(to, imageUrl, caption = '') {
  return whatsappProvider.sendImageMessage({ to, imageUrl, caption });
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
  await sendWhatsAppMessage(order.customerMobile, buildPickupConfirmationMessage(order));
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
    customerMobile: session.customerMobile,
    channel: session.channel || channel || 'WEB',
    items: detailedItems,
    total,
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

  const paymentLink = await createRazorpayPaymentLink(order);
  order.payment = buildPaymentRecord(order, paymentLink);
  order.paymentLink = paymentLink;
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

  return { orderId, total, paymentLink };
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
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
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
  outlets = normalizeOutlets(defaultOutlets);
  menusByOutlet = normalizeMenusByOutlet(buildDefaultMenusByOutlet());
  uploadedImagesByOutlet = normalizeOutletScopedStore({}, normalizeUploadedImage);
  auditLogsByOutlet = normalizeOutletScopedStore({}, normalizeAuditEntry);
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

export function configureAdminStoreFiles({ imageManifestPath, auditLogPath } = {}) {
  if (imageManifestPath) {
    imageManifestFile = imageManifestPath;
  }
  if (auditLogPath) {
    auditLogFile = auditLogPath;
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

app.get('/api/admin/outlets', (req, res) => {
  res.json({ outlets: getOutlets() });
});

app.get('/api/admin/brands', (req, res) => {
  res.json({ brands: getBrands() });
});

app.post('/api/admin/brands', (req, res) => {
  try {
    const nextBrands = replaceBrands(req.body?.brands);
    nextBrands.forEach((brand) => {
      logAuditEvent({
        outletId: null,
        action: 'BRAND_SAVED',
        entityType: 'brand',
        entityId: brand.id,
        summary: `Saved brand configuration for ${brand.name}`,
        actor: 'admin-ui',
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

app.post('/api/admin/outlets', (req, res) => {
  try {
    const nextOutlets = replaceOutlets(req.body?.outlets);
    nextOutlets.forEach((outlet) => {
      logAuditEvent({
        outletId: outlet.id,
        action: 'OUTLET_SAVED',
        entityType: 'outlet',
        entityId: outlet.id,
        summary: `Saved outlet configuration for ${outlet.name}`,
        actor: 'admin-ui',
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
  res.json({ outletId, menu: getMenu({ includeUnavailable: true, outletId }) });
});

app.get('/api/admin/orders', (req, res) => {
  const outletId = String(req.query.outletId || '');
  res.json({ orders: listOrdersByOutlet(outletId) });
});

app.get('/api/admin/marketing/audience', (req, res) => {
  const outletId = String(req.query.outletId || getDefaultOutletId());
  res.json({ audience: listAudienceByOutlet(outletId) });
});

app.get('/api/admin/whatsapp-campaigns', (req, res) => {
  const outletId = String(req.query.outletId || '');
  res.json({ campaigns: listWhatsAppCampaigns(outletId) });
});

app.post('/api/admin/whatsapp-campaigns/send', async (req, res) => {
  try {
    const outletId = String(req.body?.outletId || getDefaultOutletId()).trim();
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
        await sendWhatsAppImageMessage(recipient, imageUrl, caption);
        sentCount += 1;
      } catch (error) {
        failedCount += 1;
        logAuditEvent({
          outletId,
          action: 'WHATSAPP_CAMPAIGN_SEND_FAILED',
          entityType: 'whatsapp_campaign',
          entityId: recipient,
          summary: `Failed WhatsApp campaign send to ${recipient}`,
          actor: 'admin-ui',
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
      createdBy: 'admin-ui'
    });
    whatsappCampaigns = [campaign, ...whatsappCampaigns].slice(0, 100);
    persistWhatsAppCampaigns();

    logAuditEvent({
      outletId,
      action: 'WHATSAPP_CAMPAIGN_SENT',
      entityType: 'whatsapp_campaign',
      entityId: campaign.id,
      summary: `Sent WhatsApp image campaign to ${sentCount} recipients`,
      actor: 'admin-ui',
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
  res.json({ payments: listPaymentsByOutlet(outletId) });
});

app.get('/api/admin/menu/images', (req, res) => {
  try {
    const outletId = String(req.query.outletId || getDefaultOutletId());
    res.json({ images: getUploadedImagesByOutlet(outletId) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/admin/audit-logs', (req, res) => {
  try {
    const outletId = String(req.query.outletId || getDefaultOutletId());
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
    const pulledMenu = await pullMenuFromPetpooja(req.body?.outletId);
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
      const imageUrl = `${getPublicBaseUrl(req)}/uploads/${encodeURIComponent(outletId)}/${encodeURIComponent(req.file.filename)}`;
      const image = recordUploadedImage({
        outletId,
        imageUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadedBy: 'admin-ui'
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
    if (order.paymentStatus !== 'PAID') return res.status(400).json({ error: 'Order is not paid yet' });

    await sendWhatsAppMessage(order.customerMobile, buildPickupConfirmationMessage(order));
    logAuditEvent({
      outletId: order.outletId,
      action: 'ORDER_CONFIRMATION_RESENT',
      entityType: 'order',
      entityId: order.id,
      summary: `Resent WhatsApp confirmation for order ${order.id}`,
      actor: 'admin-ui',
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
  try {
    const order = await markOrderPaid(req.params.orderId);
    logAuditEvent({
      outletId: order.outletId,
      action: 'PAYMENT_MARKED_PAID',
      entityType: 'payment',
      entityId: order.id,
      summary: `Marked payment as paid for order ${order.id}`,
      actor: 'admin-ui',
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
    const nextMenu = replaceMenu(req.body?.menu, { outletId });
    logAuditEvent({
      outletId,
      action: 'MENU_SAVED',
      entityType: 'menu',
      entityId: outletId,
      summary: `Saved menu for outlet ${outletId}`,
      actor: 'admin-ui',
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
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  app.listen(PORT, () => {
    console.log(`Weborder backend running on http://localhost:${PORT}`);
  });
}
