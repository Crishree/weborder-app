import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyQuantityChange,
  buildCartItems,
  calculateCartSummary,
  submitCheckout
} from './cartFlow.js';

test('cart quantity changes simulate add and remove interactions', () => {
  let cart = {};

  cart = applyQuantityChange(cart, 'rajma_bowl', 1);
  cart = applyQuantityChange(cart, 'rajma_bowl', 2);
  cart = applyQuantityChange(cart, 'chilli_corn', 1);
  cart = applyQuantityChange(cart, 'rajma_bowl', 1);
  cart = applyQuantityChange(cart, 'chilli_corn', 0);

  assert.deepEqual(cart, { rajma_bowl: 1 });
});

test('buildCartItems and calculateCartSummary produce the visible cart state', () => {
  const menu = [
    { id: 'rajma_bowl', name: 'Rajma Bowl', price: 130 },
    { id: 'chilli_corn', name: 'Tossed Chilli Corn', price: 80 }
  ];
  const cart = {
    rajma_bowl: 2,
    chilli_corn: 1,
    missing_item: 3
  };

  const cartItems = buildCartItems(cart, menu);
  const summary = calculateCartSummary(cartItems);

  assert.deepEqual(cartItems, [
    { id: 'rajma_bowl', name: 'Rajma Bowl', price: 130, qty: 2 },
    { id: 'chilli_corn', name: 'Tossed Chilli Corn', price: 80, qty: 1 }
  ]);
  assert.deepEqual(summary, { totalQty: 3, total: 340 });
});

test('submitCheckout posts the cart and returns the payment link', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { paymentLink: 'http://localhost:5173/success?orderId=NB-TEST1234' };
      }
    };
  };

  const paymentLink = await submitCheckout({
    apiBase: 'http://localhost:4000',
    sessionId: 'demo-session',
    outletId: 'bagmane_virgo',
    marketingOptIn: true,
    cartItems: [
      { id: 'rajma_bowl', qty: 2 },
      { id: 'chilli_corn', qty: 1 }
    ],
    fetchImpl
  });

  assert.equal(paymentLink, 'http://localhost:5173/success?orderId=NB-TEST1234');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:4000/api/checkout');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(
    calls[0].options.body,
    JSON.stringify({
      sessionId: 'demo-session',
      outletId: 'bagmane_virgo',
      marketingOptIn: true,
      items: [
        { itemId: 'rajma_bowl', qty: 2 },
        { itemId: 'chilli_corn', qty: 1 }
      ]
    })
  );
});

test('submitCheckout surfaces checkout errors', async () => {
  const fetchImpl = async () => ({
    ok: false,
    async json() {
      return { error: 'Checkout failed' };
    }
  });

  await assert.rejects(
    submitCheckout({
      apiBase: 'http://localhost:4000',
      sessionId: 'demo-session',
      outletId: 'bagmane_virgo',
      marketingOptIn: false,
      cartItems: [{ id: 'rajma_bowl', qty: 1 }],
      fetchImpl
    }),
    /Checkout failed/
  );
});
