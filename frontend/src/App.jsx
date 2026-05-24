import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Minus, Plus, ShoppingBag, X } from 'lucide-react';
import {
  applyQuantityChange,
  buildCartItems,
  calculateCartSummary,
  submitCheckout
} from './cartFlow.js';
import { isTerminalPaymentStatus, loadOrderStatus } from './orderApi.js';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

function getSessionId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('session') || 'demo-session';
}

function getOutletId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('outlet') || '';
}

function MenuCard({ item, qty, onAdd, onRemove }) {
  return (
    <div className="menu-card">
      <img src={item.image} alt={item.name} />
      <div className="menu-content">
        <div>
          <p className="category">{item.category}</p>
          <h3>{item.name}</h3>
          <p className="desc">{item.description}</p>
        </div>
        <div className="price-row">
          <strong>₹{item.price}</strong>
          {qty > 0 ? (
            <div className="qty-control">
              <button onClick={onRemove} aria-label={`Remove ${item.name}`}><Minus size={16} /></button>
              <span>{qty}</span>
              <button onClick={onAdd} aria-label={`Add ${item.name}`}><Plus size={16} /></button>
            </div>
          ) : (
            <button className="add-btn" onClick={onAdd} aria-label={`Add ${item.name}`}>ADD</button>
          )}
        </div>
      </div>
    </div>
  );
}

function CartDrawer({ open, onClose, cartItems, updateQty, checkout, loading }) {
  const total = cartItems.reduce((sum, row) => sum + row.price * row.qty, 0);

  return (
    <div className={`drawer-wrap ${open ? 'open' : ''}`}>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <h2>Your Cart</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close cart"><X size={20} /></button>
        </div>

        {cartItems.length === 0 ? (
          <p className="empty">Your cart is empty.</p>
        ) : (
          <div className="cart-list">
            {cartItems.map((item) => (
              <div className="cart-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <p>₹{item.price} each</p>
                </div>
                <div className="qty-control">
                  <button onClick={() => updateQty(item.id, item.qty - 1)} aria-label={`Remove ${item.name}`}><Minus size={16} /></button>
                  <span>{item.qty}</span>
                  <button onClick={() => updateQty(item.id, item.qty + 1)} aria-label={`Add ${item.name}`}><Plus size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="drawer-footer">
          <div className="total-row">
            <span>Total</span>
            <strong>₹{total}</strong>
          </div>
          <button className="checkout-btn" disabled={!cartItems.length || loading} onClick={checkout} aria-label="Proceed to pay">
            {loading ? 'Creating order...' : 'Proceed to Pay'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SuccessPage() {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('orderId');

  useEffect(() => {
    let cancelled = false;
    let timeoutId;

    async function refreshOrder() {
      try {
        const nextOrder = await loadOrderStatus({
          apiBase: API_BASE,
          orderId
        });
        if (cancelled) return;
        setOrder(nextOrder);
        setError('');

        if (!isTerminalPaymentStatus(nextOrder.paymentStatus)) {
          timeoutId = window.setTimeout(refreshOrder, 3000);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
        }
      }
    }

    if (orderId) refreshOrder();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [orderId]);

  if (error) return <div className="page center"><h1>Something went wrong</h1><p>{error}</p></div>;
  if (!order) return <div className="page center"><h1>Confirming your order...</h1></div>;

  if (order.paymentStatus !== 'PAID') {
    return (
      <div className="page success-page">
        <div className="success-card">
          <p className="badge">Payment pending</p>
          <h1>Waiting for payment confirmation</h1>
          <p>Your order has been created. We will update this screen as soon as the payment webhook confirms the result.</p>
          <p><strong>Order:</strong> {order.id}</p>
          <p><strong>Status:</strong> {order.paymentStatus}</p>
          <p><strong>Total:</strong> ₹{order.total}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page success-page">
      <div className="success-card">
        <p className="badge">Payment received</p>
        <h1>Order Confirmed ✅</h1>
        <p>Show this pickup code at the Neubar counter.</p>
        <div className="pickup-code">{order.pickupCode}</div>
        <p><strong>Order:</strong> {order.id}</p>
        <p><strong>Total:</strong> ₹{order.total}</p>
      </div>
    </div>
  );
}

function App() {
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sessionId = getSessionId();
  const outletId = getOutletId();

  const isSuccess = window.location.pathname.includes('success');

  useEffect(() => {
    async function loadMenu() {
      const suffix = outletId ? `?outletId=${encodeURIComponent(outletId)}` : '';
      const res = await fetch(`${API_BASE}/api/menu${suffix}`);
      const data = await res.json();
      setMenu(data.menu || []);
    }
    if (!isSuccess) loadMenu();
  }, [isSuccess, outletId]);

  const cartItems = useMemo(() => {
    return buildCartItems(cart, menu);
  }, [cart, menu]);

  const { totalQty, total } = calculateCartSummary(cartItems);

  function updateQty(itemId, qty) {
    setCart((prev) => applyQuantityChange(prev, itemId, qty));
  }

  async function checkout() {
    setLoading(true);
    setError('');
    try {
      const paymentLink = await submitCheckout({
        apiBase: API_BASE,
        sessionId,
        outletId,
        cartItems
      });
      window.location.href = paymentLink;
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (isSuccess) return <SuccessPage />;

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Neubar Corporate Counter</p>
        <h1>A Bowl Full of Life</h1>
        <p>Order ahead. Pay online. Pick up with your code.</p>
      </header>

      {error && <div className="error-box">{error}</div>}

      <main className="menu-list">
        {menu.map((item) => (
          <MenuCard
            key={item.id}
            item={item}
            qty={cart[item.id] || 0}
            onAdd={() => updateQty(item.id, (cart[item.id] || 0) + 1)}
            onRemove={() => updateQty(item.id, (cart[item.id] || 0) - 1)}
          />
        ))}
      </main>

      {totalQty > 0 && (
        <button className="floating-cart" onClick={() => setDrawerOpen(true)} aria-label="Open cart">
          <span><ShoppingBag size={18} /> {totalQty} item{totalQty > 1 ? 's' : ''}</span>
          <strong>₹{total}</strong>
        </button>
      )}

      <CartDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        cartItems={cartItems}
        updateQty={updateQty}
        checkout={checkout}
        loading={loading}
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
