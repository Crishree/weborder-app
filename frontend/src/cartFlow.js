export function buildCartItems(cart, menu) {
  return Object.entries(cart)
    .map(([id, qty]) => {
      const item = menu.find((menuItem) => menuItem.id === id);
      return item ? { ...item, qty } : null;
    })
    .filter(Boolean)
    .filter((item) => item.qty > 0);
}

export function calculateCartSummary(cartItems) {
  return {
    totalQty: cartItems.reduce((sum, item) => sum + item.qty, 0),
    total: cartItems.reduce((sum, item) => sum + item.price * item.qty, 0)
  };
}

export function applyQuantityChange(cart, itemId, qty) {
  const next = { ...cart };
  if (qty <= 0) {
    delete next[itemId];
  } else {
    next[itemId] = qty;
  }
  return next;
}

export async function submitCheckout({
  apiBase,
  sessionId,
  outletId,
  cartItems,
  marketingOptIn = false,
  fetchImpl = fetch
}) {
  const res = await fetchImpl(`${apiBase}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      outletId,
      marketingOptIn,
      items: cartItems.map((item) => ({ itemId: item.id, qty: item.qty }))
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Checkout failed');
  }

  return data.paymentLink;
}
