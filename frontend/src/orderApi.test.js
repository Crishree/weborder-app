import test from 'node:test';
import assert from 'node:assert/strict';

import { isTerminalPaymentStatus, loadOrderStatus } from './orderApi.js';

test('loadOrderStatus returns the order from the backend', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });

    if (url.endsWith('/api/orders/NB-TEST1234')) {
      return {
        ok: true,
        async json() {
          return {
            id: 'NB-TEST1234',
            pickupCode: '1234',
            total: 340,
            paymentStatus: 'PAID'
          };
        }
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const order = await loadOrderStatus({
    apiBase: 'http://localhost:4000',
    orderId: 'NB-TEST1234',
    fetchImpl
  });

  assert.deepEqual(order, {
    id: 'NB-TEST1234',
    pickupCode: '1234',
    total: 340,
    paymentStatus: 'PAID'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:4000/api/orders/NB-TEST1234');
});

test('loadOrderStatus surfaces order loading errors', async () => {
  const fetchImpl = async () => ({
    ok: false,
    async json() {
      return { error: 'Could not load order' };
    }
  });

  await assert.rejects(
    loadOrderStatus({
      apiBase: 'http://localhost:4000',
      orderId: 'NB-MISSING',
      fetchImpl
    }),
    /Could not load order/
  );
});

test('isTerminalPaymentStatus recognizes final payment states', () => {
  assert.equal(isTerminalPaymentStatus('PAID'), true);
  assert.equal(isTerminalPaymentStatus('FAILED'), true);
  assert.equal(isTerminalPaymentStatus('PENDING'), false);
});
