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
const DEFAULT_BRANDING = {
  brandName: 'PikQuik Showcase',
  logoText: 'PikQuik',
  heroEyebrow: 'Order ahead commerce',
  heroTitle: 'Fast pickup for modern food brands',
  heroSubtitle: 'Launch branded ordering, payments, and WhatsApp re-engagement from one operating layer.',
  logoUrl: '',
  primaryColor: '#007a63',
  accentColor: '#ffd84d',
  accentTextColor: '#202020',
  backgroundColor: '#fffaf0',
  surfaceColor: '#ffffff'
};

const DEFAULT_CHECKOUT_CONFIG = {
  marketingOptInEligible: false,
  marketingOptInDefault: false,
  marketingOptInLabel: 'Receive updates on WhatsApp'
};

const DEFAULT_SHOWCASE = {
  brands: [],
  outlets: []
};

function getSessionId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('session') || 'demo-session';
}

function getOutletId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('outlet') || '';
}

function getHostname() {
  return window.location.hostname.toLowerCase();
}

function normalizeUrlHost(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function BrandMark({ branding }) {
  if (branding.logoUrl) {
    return (
      <div className="brand-mark brand-mark-image">
        <img src={branding.logoUrl} alt={branding.brandName || branding.logoText || 'Brand logo'} />
      </div>
    );
  }

  return <div className="brand-mark">{branding.logoText || branding.brandName}</div>;
}

function ProductLanding({ showcase }) {
  return (
    <div className="showcase-page">
      <section className="showcase-hero">
        <p className="showcase-kicker">PikQuik Platform</p>
        <h1>Pickup commerce infrastructure for modern food brands.</h1>
        <p className="showcase-copy">
          Launch branded storefronts, prepaid checkout, WhatsApp journeys, and outlet operations from one operating layer.
        </p>
      </section>

      <section className="showcase-grid">
        <article className="showcase-panel showcase-panel-highlight">
          <p className="showcase-label">What it handles</p>
          <ul className="showcase-list">
            <li>Brand-owned storefronts per domain</li>
            <li>Outlet-aware ordering and pickup flows</li>
            <li>WhatsApp acquisition, updates, and campaigns</li>
            <li>Admin control for menu, payments, and branding</li>
          </ul>
        </article>

        <article className="showcase-panel">
          <p className="showcase-label">Built for teams that need</p>
          <div className="showcase-metrics">
            <div><strong>Fast rollout</strong><span>Go live brand by brand, not city by city.</span></div>
            <div><strong>Shared operations</strong><span>One console for menus, campaigns, and payment visibility.</span></div>
            <div><strong>Brand flexibility</strong><span>Each brand keeps its own domain, theme, and voice.</span></div>
          </div>
        </article>
      </section>

      <section className="brand-showcase">
        <div className="section-copy">
          <p className="showcase-label">Live storefront previews</p>
          <h2>Preview the same engine across different brand identities.</h2>
        </div>
        <div className="brand-card-grid">
          {showcase.brands.map((brand) => (
            <BrandPreviewCard key={brand.id} brand={brand} />
          ))}
        </div>
      </section>
    </div>
  );
}

function BrandPreviewCard({ brand }) {
  const previewHref = brand.customerAppBaseUrl || (brand.primaryOutletId ? `/?outlet=${brand.primaryOutletId}` : '#');
  const previewLabel = brand.activeOutletCount ? `${brand.activeOutletCount} live outlet${brand.activeOutletCount > 1 ? 's' : ''}` : 'Brand preview';

  return (
    <article
      className="brand-preview-card"
      style={{
        '--brand-primary': brand.primaryColor || DEFAULT_BRANDING.primaryColor,
        '--brand-accent': brand.accentColor || DEFAULT_BRANDING.accentColor,
        '--brand-accent-text': brand.accentTextColor || DEFAULT_BRANDING.accentTextColor,
        '--brand-background': brand.backgroundColor || DEFAULT_BRANDING.backgroundColor,
        '--brand-surface': brand.surfaceColor || DEFAULT_BRANDING.surfaceColor
      }}
    >
      <div className="brand-preview-head">
        <BrandMark branding={brand} />
        <span>{previewLabel}</span>
      </div>
      <p className="showcase-label">{brand.heroEyebrow}</p>
      <h3>{brand.heroTitle}</h3>
      <p>{brand.heroSubtitle}</p>
      <a className="preview-link" href={previewHref}>
        Preview storefront
      </a>
    </article>
  );
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

function CartDrawer({
  open,
  onClose,
  cartItems,
  updateQty,
  checkout,
  loading,
  marketingOptInEligible,
  marketingOptInLabel,
  marketingOptIn,
  onMarketingOptInChange
}) {
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
          {marketingOptInEligible && (
            <label className="consent-row">
              <input
                type="checkbox"
                checked={marketingOptIn}
                onChange={(event) => onMarketingOptInChange(event.target.checked)}
              />
              <span>{marketingOptInLabel}</span>
            </label>
          )}
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
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
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
        if (nextOrder.branding) setBranding({ ...DEFAULT_BRANDING, ...nextOrder.branding });
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
  if (!order) return <div className="page center themed-page" style={getThemeStyle(branding)}><h1>Confirming your order...</h1></div>;

  if (order.paymentStatus !== 'PAID') {
    return (
      <div className="page success-page">
        <BrandMark branding={branding} />
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
    <div className="page success-page themed-page" style={getThemeStyle(branding)}>
      <BrandMark branding={branding} />
      <div className="success-card">
        <p className="badge">Payment received</p>
        <h1>Order Confirmed ✅</h1>
        <p>Show this pickup code at the {branding.brandName || 'pickup'} counter.</p>
        <div className="pickup-code">{order.pickupCode}</div>
        <p><strong>Order:</strong> {order.id}</p>
        <p><strong>Total:</strong> ₹{order.total}</p>
      </div>
    </div>
  );
}

function App() {
  const [menu, setMenu] = useState([]);
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [showcase, setShowcase] = useState(DEFAULT_SHOWCASE);
  const [checkoutConfig, setCheckoutConfig] = useState(DEFAULT_CHECKOUT_CONFIG);
  const [marketingOptIn, setMarketingOptIn] = useState(DEFAULT_CHECKOUT_CONFIG.marketingOptInDefault);
  const [cart, setCart] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sessionId = getSessionId();
  const outletId = getOutletId();

  const isSuccess = window.location.pathname.includes('success');
  const [resolvedOutletId, setResolvedOutletId] = useState(outletId);
  const [showLanding, setShowLanding] = useState(!outletId);

  useEffect(() => {
    async function loadPageState() {
      const showcaseRes = await fetch(`${API_BASE}/api/showcase`);
      const showcaseData = await showcaseRes.json();
      if (showcaseData.brands || showcaseData.outlets) {
        setShowcase({
          brands: showcaseData.brands || [],
          outlets: showcaseData.outlets || []
        });
      }

      const hostBrand = (showcaseData.brands || []).find((brand) => normalizeUrlHost(brand.customerAppBaseUrl) === getHostname());
      const nextOutletId = outletId || hostBrand?.primaryOutletId || '';
      const shouldShowLanding = !outletId && !hostBrand && !sessionId;

      setResolvedOutletId(nextOutletId);
      setShowLanding(shouldShowLanding);

      if (shouldShowLanding) {
        return;
      }

      const params = new URLSearchParams();
      if (nextOutletId) params.set('outletId', nextOutletId);
      if (sessionId) params.set('sessionId', sessionId);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`${API_BASE}/api/menu${suffix}`);
      const data = await res.json();
      setMenu(data.menu || []);
      setBranding({ ...DEFAULT_BRANDING, ...(data.brand || {}) });
      const nextCheckoutConfig = { ...DEFAULT_CHECKOUT_CONFIG, ...(data.checkoutConfig || {}) };
      setCheckoutConfig(nextCheckoutConfig);
      setMarketingOptIn(Boolean(nextCheckoutConfig.marketingOptInDefault));
    }
    if (!isSuccess) loadPageState();
  }, [isSuccess, outletId, sessionId]);

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
        outletId: resolvedOutletId,
        cartItems,
        marketingOptIn
      });
      window.location.href = paymentLink;
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (isSuccess) return <SuccessPage />;
  if (showLanding) return <ProductLanding showcase={showcase} />;

  return (
    <div className="page themed-page" style={getThemeStyle(branding)}>
      <header className="hero">
        <BrandMark branding={branding} />
        <p className="eyebrow">{branding.heroEyebrow}</p>
        <h1>{branding.heroTitle}</h1>
        <p>{branding.heroSubtitle}</p>
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
        marketingOptInEligible={checkoutConfig.marketingOptInEligible}
        marketingOptInLabel={checkoutConfig.marketingOptInLabel}
        marketingOptIn={marketingOptIn}
        onMarketingOptInChange={setMarketingOptIn}
      />
    </div>
  );
}

function getThemeStyle(branding) {
  return {
    '--brand-primary': branding.primaryColor || DEFAULT_BRANDING.primaryColor,
    '--brand-accent': branding.accentColor || DEFAULT_BRANDING.accentColor,
    '--brand-accent-text': branding.accentTextColor || DEFAULT_BRANDING.accentTextColor,
    '--brand-background': branding.backgroundColor || DEFAULT_BRANDING.backgroundColor,
    '--brand-surface': branding.surfaceColor || DEFAULT_BRANDING.surfaceColor
  };
}

createRoot(document.getElementById('root')).render(<App />);
