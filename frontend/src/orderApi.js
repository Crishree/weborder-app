export function isTerminalPaymentStatus(status) {
  return ['PAID', 'FAILED', 'REFUNDED', 'CANCELLED'].includes(status || '');
}

export async function loadOrderStatus({
  apiBase,
  orderId,
  fetchImpl = fetch
}) {
  const orderRes = await fetchImpl(`${apiBase}/api/orders/${orderId}`);
  const orderData = await orderRes.json();
  if (!orderRes.ok) {
    throw new Error(orderData.error || 'Could not load order');
  }

  return orderData;
}
