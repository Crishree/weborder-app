import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import {
  clearRuntimeStoreMemoryOnly,
  configureAdminStoreFiles,
  configureRuntimeStoreFiles,
  configureWhatsAppEventStoreFile,
  configureWhatsAppTransport,
  createCheckoutOrder,
  getOrder,
  getUploadedImagesByOutlet,
  handleIncomingWhatsAppMessage,
  getMenu,
  getOutlets,
  listAuditLogsByOutlet,
  listWhatsAppEvents,
  markOrderPaid,
  parseMenuCsv,
  parseMenuSpreadsheet,
  pullMenuFromPetpooja,
  recordUploadedImage,
  reloadAdminStore,
  reloadPersistentStore,
  replaceMenu,
  replaceOutlets,
  resetStore
} from './server.js';

test.beforeEach(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = '';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '';
  process.env.WHATSAPP_GRAPH_VERSION = '';
  configureRuntimeStoreFiles({
    sessionsPath: path.join(os.tmpdir(), 'neubar-backend-test-sessions.json'),
    ordersPath: path.join(os.tmpdir(), 'neubar-backend-test-orders.json')
  });
  configureAdminStoreFiles({
    imageManifestPath: path.join(os.tmpdir(), 'neubar-backend-test-images.json'),
    auditLogPath: path.join(os.tmpdir(), 'neubar-backend-test-audit.json')
  });
  configureWhatsAppEventStoreFile({
    whatsappEventsPath: path.join(os.tmpdir(), 'neubar-backend-test-whatsapp-events.json')
  });
  configureWhatsAppTransport({});
  resetStore();
});

test('checkout creates an order and payment success returns a stable pickup code', async () => {
  const checkout = await createCheckoutOrder({
    sessionId: 'demo-session',
    items: [
      { itemId: 'rajma_bowl', qty: 2 },
      { itemId: 'chilli_corn', qty: 1 }
    ]
  });

  assert.match(checkout.orderId, /^NB-/);
  assert.equal(checkout.total, 340);
  assert.match(checkout.paymentLink, new RegExp(`/success\\?orderId=${checkout.orderId}`));

  const pendingOrder = getOrder(checkout.orderId);
  assert.ok(pendingOrder);
  assert.equal(pendingOrder.paymentStatus, 'PENDING');
  assert.equal(pendingOrder.pickupCode, null);

  const paidOrder = await markOrderPaid(checkout.orderId);
  assert.equal(paidOrder.paymentStatus, 'PAID');
  assert.equal(paidOrder.orderStatus, 'PAID');
  assert.equal(paidOrder.codeActive, true);
  assert.match(paidOrder.pickupCode, /^\d{4}$/);

  const originalPickupCode = paidOrder.pickupCode;
  const paidAgain = await markOrderPaid(checkout.orderId);
  assert.equal(paidAgain.pickupCode, originalPickupCode);

  const storedOrder = getOrder(checkout.orderId);
  assert.equal(storedOrder.pickupCode, originalPickupCode);
  assert.equal(storedOrder.total, 340);
});

test('checkout rejects invalid cart items', async () => {
  await assert.rejects(
    createCheckoutOrder({
      sessionId: 'demo-session',
      items: [{ itemId: 'missing_item', qty: 1 }]
    }),
    /Invalid item: missing_item/
  );
});

test('orders and payments survive an in-memory reset when reloaded from disk', async () => {
  const checkout = await createCheckoutOrder({
    sessionId: 'persisted-session',
    items: [{ itemId: 'rajma_bowl', qty: 1 }]
  });

  await markOrderPaid(checkout.orderId);
  const originalOrder = getOrder(checkout.orderId);
  assert.ok(originalOrder);

  clearRuntimeStoreMemoryOnly();
  assert.equal(getOrder(checkout.orderId), null);

  reloadPersistentStore();
  const reloadedOrder = getOrder(checkout.orderId);

  assert.ok(reloadedOrder);
  assert.equal(reloadedOrder.id, checkout.orderId);
  assert.equal(reloadedOrder.paymentStatus, 'PAID');
  assert.equal(reloadedOrder.orderStatus, 'PAID');
  assert.equal(reloadedOrder.total, 130);
  assert.equal(reloadedOrder.pickupCode, originalOrder.pickupCode);
  assert.equal(reloadedOrder.payment?.status, 'PAID');
});

test('uploaded images and audit logs persist per outlet', () => {
  const image = recordUploadedImage({
    outletId: 'bagmane_virgo',
    imageUrl: 'http://localhost:4000/uploads/bagmane_virgo/filter-coffee.jpg',
    filename: 'filter-coffee.jpg',
    originalName: 'filter-coffee.jpg',
    mimeType: 'image/jpeg',
    size: 2048,
    uploadedBy: 'admin-ui'
  });

  assert.equal(getUploadedImagesByOutlet('bagmane_virgo').length, 1);
  assert.equal(getUploadedImagesByOutlet('manyata_tower').length, 0);

  reloadAdminStore();

  const persistedImages = getUploadedImagesByOutlet('bagmane_virgo');
  const persistedAudit = listAuditLogsByOutlet('bagmane_virgo');

  assert.equal(persistedImages.length, 1);
  assert.equal(persistedImages[0].id, image.id);
  assert.equal(persistedImages[0].filename, 'filter-coffee.jpg');
  assert.equal(persistedAudit.length, 1);
  assert.equal(persistedAudit[0].action, 'IMAGE_UPLOADED');
  assert.match(persistedAudit[0].summary, /filter-coffee\.jpg/);
});

test('whatsapp hi flow creates a whatsapp session and shares an outlet menu link', async () => {
  const session = await handleIncomingWhatsAppMessage({
    from: '919900000001',
    text: { body: 'Hi from Bagmane' }
  });

  assert.ok(session);
  assert.equal(session.customerMobile, '919900000001');
  assert.equal(session.outletId, 'bagmane_virgo');

  const auditEntries = listAuditLogsByOutlet('bagmane_virgo');
  assert.equal(auditEntries[0].action, 'WHATSAPP_MENU_SHARED');
  assert.equal(auditEntries[0].metadata.customerMobile, '919900000001');

  const whatsappEvents = listWhatsAppEvents();
  assert.ok(whatsappEvents.length >= 2);
  assert.equal(whatsappEvents[0].direction, 'outbound');
  assert.equal(whatsappEvents[1].direction, 'inbound');
});

test('whatsapp provider uses Meta Cloud API when credentials are configured', async () => {
  const originalAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const originalPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const originalGraphVersion = process.env.WHATSAPP_GRAPH_VERSION;
  const fetchCalls = [];

  process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1129627703565763';
  process.env.WHATSAPP_GRAPH_VERSION = 'v25.0';
  configureWhatsAppTransport({
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ messages: [{ id: 'wamid.TEST' }] });
        }
      };
    }
  });

  try {
    await handleIncomingWhatsAppMessage({
      from: '919900000001',
      text: { body: 'Hi' }
    });
  } finally {
    process.env.WHATSAPP_ACCESS_TOKEN = originalAccessToken;
    process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhoneNumberId;
    process.env.WHATSAPP_GRAPH_VERSION = originalGraphVersion;
    configureWhatsAppTransport({});
  }

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://graph.facebook.com/v25.0/1129627703565763/messages');
  assert.equal(fetchCalls[0].options.method, 'POST');
  assert.match(fetchCalls[0].options.headers.Authorization, /^Bearer test-access-token$/);

  const requestBody = JSON.parse(fetchCalls[0].options.body);
  assert.equal(requestBody.messaging_product, 'whatsapp');
  assert.equal(requestBody.to, '919900000001');
  assert.equal(requestBody.type, 'text');

  const whatsappEvents = listWhatsAppEvents();
  assert.equal(whatsappEvents[0].direction, 'outbound');
  assert.equal(whatsappEvents[0].payload.provider, 'meta-cloud-api');
});

test('petpooja menu pull hook refreshes the selected outlet menu', async () => {
  const pulledMenu = await pullMenuFromPetpooja('bagmane_virgo', { persist: false });

  assert.equal(pulledMenu.outletId, 'bagmane_virgo');
  assert.ok(Array.isArray(pulledMenu.menu));
  assert.ok(pulledMenu.menu.length > 0);
  assert.equal(getMenu({ includeUnavailable: true, outletId: 'bagmane_virgo' }).length, pulledMenu.menu.length);

  const auditEntries = listAuditLogsByOutlet('bagmane_virgo');
  assert.equal(auditEntries[0].action, 'MENU_PULLED_FROM_PETPOOJA');
});

test('menu can be replaced for admin uploads', () => {
  const nextMenu = replaceMenu(
    [
      {
        id: 'filter_coffee',
        petpoojaItemId: 'PP_FILTER_COFFEE',
        name: 'Filter Coffee',
        description: 'Strong South Indian filter coffee.',
        price: 60,
        category: 'Beverages',
        image: 'https://example.com/filter-coffee.jpg',
        available: true
      },
      {
        id: 'masala_tea',
        petpoojaItemId: 'PP_MASALA_TEA',
        name: 'Masala Tea',
        description: 'Spiced chai with milk.',
        price: 40,
        category: 'Beverages',
        image: 'https://example.com/masala-tea.jpg',
        available: false
      }
    ],
    { outletId: 'bagmane_virgo', persist: false }
  );

  assert.equal(nextMenu.length, 2);
  assert.equal(getMenu({ outletId: 'bagmane_virgo' }).length, 1);
  assert.equal(getMenu({ includeUnavailable: true, outletId: 'bagmane_virgo' }).length, 2);
});

test('csv menu upload parses into normalized menu items', () => {
  const csvMenu = parseMenuCsv(`id,petpoojaItemId,name,description,price,category,image,available
filter_coffee,PP_FILTER_COFFEE,Filter Coffee,"Strong, rich South Indian filter coffee",60,Beverages,https://example.com/filter-coffee.jpg,true
masala_tea,PP_MASALA_TEA,Masala Tea,Spiced chai with milk,40,Beverages,https://example.com/masala-tea.jpg,false`);

  assert.equal(csvMenu.length, 2);
  assert.equal(csvMenu[0].name, 'Filter Coffee');
  assert.equal(csvMenu[0].price, 60);
  assert.equal(csvMenu[1].available, false);
});

test('spreadsheet menu upload parses into normalized menu items', () => {
  const worksheet = XLSX.utils.json_to_sheet([
    {
      id: 'filter_coffee',
      petpoojaItemId: 'PP_FILTER_COFFEE',
      name: 'Filter Coffee',
      description: 'Strong South Indian filter coffee.',
      price: 60,
      category: 'Beverages',
      image: 'https://example.com/filter-coffee.jpg',
      available: true
    },
    {
      id: 'masala_tea',
      petpoojaItemId: 'PP_MASALA_TEA',
      name: 'Masala Tea',
      description: 'Spiced chai with milk.',
      price: 40,
      category: 'Beverages',
      image: 'https://example.com/masala-tea.jpg',
      available: false
    }
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Menu');
  const base64Content = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

  const spreadsheetMenu = parseMenuSpreadsheet(base64Content);

  assert.equal(spreadsheetMenu.length, 2);
  assert.equal(spreadsheetMenu[0].name, 'Filter Coffee');
  assert.equal(spreadsheetMenu[0].price, 60);
  assert.equal(spreadsheetMenu[1].available, false);
});

test('outlets can be replaced for multi-outlet admin management', () => {
  const nextOutlets = replaceOutlets(
    [
      {
        id: 'bagmane_virgo',
        name: 'Bagmane Virgo',
        status: 'ACTIVE',
        pickupLabel: 'Virgo Counter',
        address: 'Bagmane Virgo, Bangalore',
        timezone: 'Asia/Kolkata',
        paymentProvider: 'Razorpay',
        paymentMode: 'payment_link',
        petpoojaOutletId: 'PP_OUTLET_BAGMANE_VIRGO',
        supportPhone: '+91-9000000001'
      },
      {
        id: 'manyata_tower',
        name: 'Manyata Tower',
        status: 'INACTIVE',
        pickupLabel: 'Tower Counter',
        address: 'Manyata Tech Park, Bangalore',
        timezone: 'Asia/Kolkata',
        paymentProvider: 'Razorpay',
        paymentMode: 'payment_link',
        petpoojaOutletId: 'PP_OUTLET_MANYATA_TOWER',
        supportPhone: '+91-9000000002'
      }
    ],
    { persist: false }
  );

  assert.equal(nextOutlets.length, 2);
  assert.equal(getOutlets()[0].id, 'bagmane_virgo');
  assert.equal(getOutlets()[1].status, 'INACTIVE');
});

test('menus are stored independently per outlet', () => {
  replaceMenu(
    [
      {
        id: 'virgo_combo',
        petpoojaItemId: 'PP_VIRGO_COMBO',
        name: 'Virgo Combo',
        description: 'Special combo for Virgo outlet.',
        price: 150,
        category: 'Combos',
        image: 'https://example.com/virgo-combo.jpg',
        available: true
      }
    ],
    { outletId: 'bagmane_virgo', persist: false }
  );

  replaceMenu(
    [
      {
        id: 'tower_combo',
        petpoojaItemId: 'PP_TOWER_COMBO',
        name: 'Tower Combo',
        description: 'Special combo for Tower outlet.',
        price: 175,
        category: 'Combos',
        image: 'https://example.com/tower-combo.jpg',
        available: true
      }
    ],
    { outletId: 'manyata_tower', persist: false }
  );

  assert.equal(getMenu({ outletId: 'bagmane_virgo' })[0].id, 'virgo_combo');
  assert.equal(getMenu({ outletId: 'manyata_tower' })[0].id, 'tower_combo');
});
