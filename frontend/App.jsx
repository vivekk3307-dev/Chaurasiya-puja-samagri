import { useEffect, useMemo, useState } from 'react';
import productsData from './data/products';

const STORAGE_KEYS = {
  customerDraft: 'chaurasiyaCustomerDraft',
  cartDraft: 'chaurasiyaCartDraft',
  savedBillData: 'chaurasiyaPujaSamagriData'
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(value || 0));

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const normalizeUnit = (unit = '') => String(unit).trim().toLowerCase();

const safeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildDefaultProducts = () => productsData.map((product) => ({
  ...product,
  baseUnit: normalizeUnit(product.units?.[0] || 'piece'),
  saleUnits: Array.from(new Set([...(product.units || []), ...(product.units || [])].map(normalizeUnit).filter(Boolean))),
  stockBase: Number(product.stock?.split(' ')[0] || 0) || 0,
  lowStockThreshold: 5,
  stockStatus: 'In stock'
}));

export default function App() {
  const [products, setProducts] = useState(buildDefaultProducts);
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [unitFilter, setUnitFilter] = useState('all');
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryCategory, setInventoryCategory] = useState('all');
  const [salesHistory, setSalesHistory] = useState([]);
  const [invoicePreview, setInvoicePreview] = useState(null);
  const [lastCompletedInvoice, setLastCompletedInvoice] = useState(null);
  const [toast, setToast] = useState('');

  const categories = useMemo(
    () => ['all', ...new Set(products.map((product) => product.category))],
    [products]
  );

  useEffect(() => {
    const savedCustomer = localStorage.getItem(STORAGE_KEYS.customerDraft);
    const savedCart = localStorage.getItem(STORAGE_KEYS.cartDraft);
    const billData = localStorage.getItem(STORAGE_KEYS.savedBillData);

    if (savedCustomer) {
      try {
        const parsed = JSON.parse(savedCustomer);
        setCustomerName(parsed.name || '');
        setCustomerPhone(parsed.phone || '');
      } catch {
        // ignore invalid local data
      }
    }

    if (savedCart) {
      try {
        setCart(JSON.parse(savedCart));
      } catch {
        // ignore invalid local data
      }
    }

    if (billData) {
      try {
        const parsed = JSON.parse(billData);
        if (parsed.customerName) setCustomerName(parsed.customerName);
        if (parsed.customerPhone) setCustomerPhone(parsed.customerPhone);
        if (Array.isArray(parsed.cart)) setCart(parsed.cart);
      } catch {
        // ignore invalid local data
      }
    }

    fetch('/api/products')
      .then((res) => res.json())
      .then((serverProducts) => {
        if (Array.isArray(serverProducts) && serverProducts.length) {
          setProducts(serverProducts.map((product) => ({
            ...product,
            baseUnit: normalizeUnit(product.units?.[0] || 'piece'),
            saleUnits: Array.from(new Set((product.units || []).map(normalizeUnit).filter(Boolean))),
            stockBase: Number(product.stock?.split(' ')[0] || 0) || 0,
            lowStockThreshold: 5,
            stockStatus: 'In stock'
          })));
        }
      })
      .catch(() => {
        // keep default product list on API failure
      });

    fetch('/api/sales')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setSalesHistory(data);
      })
      .catch(() => {
        // ignore sales API failure
      });
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.customerDraft, JSON.stringify({ name: customerName, phone: customerPhone }));
  }, [customerName, customerPhone]);

  useEffect(() => {
    if (cart.length) {
      localStorage.setItem(STORAGE_KEYS.cartDraft, JSON.stringify(cart));
    } else {
      localStorage.removeItem(STORAGE_KEYS.cartDraft);
    }
  }, [cart]);

  const filteredProducts = useMemo(() => {
    const lowerSearch = search.trim().toLowerCase();
    return products.filter((product) => {
      const haystack = [product.name, product.category, ...(product.brands || []), ...(product.units || [])]
        .join(' ')
        .toLowerCase();
      const matchesSearch = !lowerSearch || haystack.includes(lowerSearch);
      const matchesCategory = category === 'all' || product.category === category;
      const matchesUnit = unitFilter === 'all' || (product.units || []).includes(unitFilter);
      return matchesSearch && matchesCategory && matchesUnit;
    });
  }, [products, search, category, unitFilter]);

  const inventoryRows = useMemo(() => {
    return products.filter((product) => {
      const term = inventorySearch.trim().toLowerCase();
      const matchesSearch = !term || [product.name, product.category, ...(product.brands || [])].join(' ').toLowerCase().includes(term);
      const matchesCategory = inventoryCategory === 'all' || product.category === inventoryCategory;
      return matchesSearch && matchesCategory;
    });
  }, [products, inventorySearch, inventoryCategory]);

  const totals = useMemo(() => {
    const itemsCount = cart.length;
    const totalQty = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const totalAmount = cart.reduce((sum, item) => sum + money((Number(item.price || 0) * Number(item.qty || 0))), 0);
    return { itemsCount, totalQty, totalAmount: money(totalAmount) };
  }, [cart]);

  const addToCart = (product, selectedUnit = product.units?.[0] || 'piece') => {
    const currentLine = cart.find((item) => item.id === product.id && item.unit === selectedUnit);
    const nextQty = currentLine ? Number(currentLine.qty || 0) + 1 : 1;
    const nextItem = {
      id: product.id,
      name: product.name,
      brand: product.brands?.[0] || 'Standard',
      unit: selectedUnit,
      qty: nextQty,
      price: product.price,
      amount: money(product.price * nextQty)
    };

    if (currentLine) {
      setCart((prev) => prev.map((item) => (item.id === product.id && item.unit === selectedUnit ? { ...item, qty: nextQty, amount: money(product.price * nextQty) } : item)));
    } else {
      setCart((prev) => [...prev, nextItem]);
    }
  };

  const updateCartLine = (id, unit, field, value) => {
    setCart((prev) => prev.map((item) => {
      if (item.id !== id || item.unit !== unit) return item;
      const next = { ...item, [field]: field === 'qty' ? Number(value || 0) : value };
      if (field === 'qty' || field === 'price') {
        next.amount = money((Number(next.qty || 0) * Number(next.price || 0)));
      }
      return next;
    }));
  };

  const removeCartLine = (id, unit) => setCart((prev) => prev.filter((item) => !(item.id === id && item.unit === unit)));

  const clearCart = () => setCart([]);

  const showToast = (message, isError = false) => {
    setToast(message);
    const color = isError ? '#a74d42' : '#1d5e32';
    const panel = document.getElementById('toast');
    if (panel) {
      panel.style.color = color;
      panel.style.borderColor = isError ? 'rgba(167,77,66,0.24)' : 'rgba(29,94,50,0.2)';
    }
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => setToast(''), 2200);
  };

  const buildInvoiceDocument = (completed = false, invoiceNumber = null) => {
    const items = cart.map((item) => ({
      productId: item.id,
      name: item.name,
      brand: item.brand,
      unit: item.unit,
      quantity: safeNumber(item.qty, 0),
      rate: safeNumber(item.price, 0),
      amount: money(safeNumber(item.qty, 0) * safeNumber(item.price, 0))
    }));
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    return {
      invoiceNumber: invoiceNumber || `CPS-${String(Date.now()).slice(-4)}`,
      generatedAt: new Date().toISOString(),
      customerName: customerName || 'Walk-in Customer',
      customerPhone: customerPhone || 'N/A',
      items,
      subtotal,
      totalQty: items.reduce((sum, item) => sum + item.quantity, 0),
      grandTotal: subtotal,
      completed,
      shopName: 'Chaurasiya Puja Samagri',
      shopAddress: 'Shop No. 7, Rampur Road',
      shopPhone: '9516733895'
    };
  };

  const completeSale = async () => {
    if (!cart.length) {
      showToast('Cart is empty. Add at least one product before completing a sale.', true);
      return;
    }

    const invoiceDoc = buildInvoiceDocument(true);
    const payload = {
      invoiceNumber: invoiceDoc.invoiceNumber,
      generatedAt: invoiceDoc.generatedAt,
      customerName: invoiceDoc.customerName,
      customerPhone: invoiceDoc.customerPhone,
      items: invoiceDoc.items,
      subtotal: invoiceDoc.subtotal,
      totalQty: invoiceDoc.totalQty,
      grandTotal: invoiceDoc.grandTotal,
      completed: true,
      shopName: invoiceDoc.shopName,
      shopAddress: invoiceDoc.shopAddress,
      shopPhone: invoiceDoc.shopPhone
    };

    try {
      const response = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error('Unable to save sale');
      }
      const savedSale = await response.json();
      setSalesHistory((prev) => [savedSale, ...prev]);
      setLastCompletedInvoice(savedSale);
      setInvoicePreview({ ...invoiceDoc, completed: true, invoiceNumber: savedSale.invoiceNumber || invoiceDoc.invoiceNumber });
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      localStorage.removeItem(STORAGE_KEYS.cartDraft);
      showToast('Sale completed and saved successfully.');
    } catch (error) {
      console.error(error);
      showToast('Unable to save the invoice. Please try again.', true);
    }
  };

  const generateBillPreview = () => {
    if (!cart.length) {
      showToast('Cart is empty. Add items to generate a preview.', true);
      return;
    }
    setInvoicePreview(buildInvoiceDocument(false));
  };

  const printInvoice = () => {
    const printable = invoicePreview || lastCompletedInvoice || (cart.length ? buildInvoiceDocument(false) : null);
    if (!printable) {
      showToast('No invoice is available to print.', true);
      return;
    }
    setInvoicePreview(printable);
    setTimeout(() => window.print(), 150);
  };

  const saveCurrentData = () => {
    try {
      const payload = {
        billNumber: Date.now(),
        customerName,
        customerPhone,
        cart,
        savedAt: new Date().toISOString()
      };
      localStorage.setItem(STORAGE_KEYS.savedBillData, JSON.stringify(payload));
      showToast('Draft saved successfully.');
    } catch {
      showToast('Unable to save the draft.', true);
    }
  };

  const clearSavedData = () => {
    localStorage.removeItem(STORAGE_KEYS.savedBillData);
    showToast('Saved draft cleared.');
  };

  const loadSavedData = () => {
    const saved = localStorage.getItem(STORAGE_KEYS.savedBillData);
    if (!saved) {
      showToast('No saved draft found.', true);
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      setCart(Array.isArray(parsed.cart) ? parsed.cart : []);
      setCustomerName(parsed.customerName || '');
      setCustomerPhone(parsed.customerPhone || '');
      showToast('Saved draft loaded.');
    } catch {
      showToast('Saved draft is invalid.', true);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <div className="logo-box" aria-label="Chaurasiya Puja Samagri logo">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M24 6C19.4 12.2 16.8 17.1 16.8 22.2C16.8 26.8 20.2 30.2 24 30.2C27.8 30.2 31.2 26.8 31.2 22.2C31.2 17.1 28.6 12.2 24 6Z" stroke="currentColor" strokeWidth="2.2"/>
              <path d="M12 34.5H36" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
              <path d="M18 39H30" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="brand-copy">
            <h1>Chaurasiya Puja Samagri</h1>
            <p>Wholesale billing system • Hinglish dashboard • Cart me price edit • Print + PDF ready</p>
          </div>
        </div>
        <div className="shop-meta">
          <div><strong>Address:</strong> Shop No. 7, Rampur Road</div>
          <div><strong>Phone:</strong> 9516733895</div>
          <div><strong>Categories:</strong> Puja Essentials • Dry Fruits / Grocery • Oils / Kapoor / Agarbatti</div>
          <div><strong>Abhi ka time:</strong> {new Date().toLocaleString('en-IN')}</div>
        </div>
      </header>

      <main className="main-grid">
        <section className="panel">
          <div className="section-head">
            <div className="section-title">
              <small>Product Control</small>
              <h2>Samagri Catalog</h2>
            </div>
            <div className="stat-chip">{products.length} items ready</div>
          </div>

          <div className="controls">
            <div className="field">
              <label htmlFor="searchInput">Search product / brand / category</label>
              <input className="input" id="searchInput" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Jaise: kapoor, premium, dry fruits..." />
            </div>
            <div className="field">
              <label htmlFor="categoryFilter">Category filter</label>
              <select className="select" id="categoryFilter" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">Sab categories</option>
                {categories.filter((cat) => cat !== 'all').map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="unitQuickFilter">Unit help</label>
              <select className="select" id="unitQuickFilter" value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
                <option value="all">Sab units</option>
                {['goni', 'half goni', 'quarter goni', 'kg', 'gram', 'packet', 'piece', 'box'].map((unit) => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="products-grid">
            {filteredProducts.map((product) => (
              <article key={product.id} className="product-card">
                <img src={product.image} alt={product.name} />
                <div className="product-info">
                  <div className="product-badges">
                    <span>{product.category}</span>
                    {product.brands?.slice(0, 2).map((brand) => <span key={brand}>{brand}</span>)}
                  </div>
                  <h3>{product.name}</h3>
                  <p className="price-row">₹{formatCurrency(product.price)}</p>
                  <p className="muted">Stock: {product.stock || 'N/A'}</p>
                  <div className="product-actions">
                    {product.units?.map((unit) => (
                      <button key={unit} className="mini-btn" onClick={() => addToCart(product, unit)}>
                        Add {unit}
                      </button>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="panel billing-panel">
          <div className="bill-card-top">
            <div className="section-title">
              <small>Order Details</small>
              <h2>Aaj ka Bill</h2>
            </div>
            <div className="bill-grid">
              <div className="bill-field">
                <label htmlFor="customerName">Customer name</label>
                <input className="input" id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer ka naam" />
              </div>
              <div className="bill-field">
                <label htmlFor="customerPhone">Customer phone</label>
                <input className="input" id="customerPhone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Optional phone number" />
              </div>
            </div>
            <div className="helper-line">Tip: Product add karne ke baad cart me price, qty aur unit change kar sakte ho.</div>
          </div>

          <div className="cart-list">
            {cart.length === 0 ? <div className="empty-cart">Cart is empty.</div> : cart.map((item) => (
              <div key={`${item.id}-${item.unit}`} className="cart-row">
                <div className="cart-main">
                  <strong>{item.name}</strong>
                  <small>{item.brand} • {item.unit}</small>
                </div>
                <div className="cart-controls">
                  <input
                    className="qty-input"
                    type="number"
                    min="0"
                    value={item.qty}
                    onChange={(e) => updateCartLine(item.id, item.unit, 'qty', e.target.value)}
                  />
                  <input
                    className="price-input"
                    type="number"
                    min="0"
                    value={item.price}
                    onChange={(e) => updateCartLine(item.id, item.unit, 'price', e.target.value)}
                  />
                  <button className="remove-btn" onClick={() => removeCartLine(item.id, item.unit)}>Remove</button>
                </div>
                <div className="cart-total">₹{formatCurrency(item.amount || 0)}</div>
              </div>
            ))}
          </div>

          <div id="toast" className="cart-validation" role="status" aria-live="polite">{toast}</div>

          <div className="bill-totals">
            <div className="total-row"><span>Items count</span><strong id="itemCount">{totals.itemsCount}</strong></div>
            <div className="total-row"><span>Total quantity</span><strong id="totalQty">{totals.totalQty}</strong></div>
            <div className="total-row"><span>Bill amount</span><strong className="grand-total">₹{formatCurrency(totals.totalAmount)}</strong></div>
          </div>

          <div className="actions">
            <button className="action-btn primary" onClick={generateBillPreview}>Generate Bill</button>
            <button className="action-btn green" onClick={completeSale}>Complete Sale</button>
            <button className="action-btn blue" onClick={saveCurrentData}>Save Data</button>
            <button className="action-btn purple" onClick={printInvoice}>Print</button>
            <button className="action-btn green" onClick={printInvoice}>PDF</button>
          </div>

          <div className="quick-actions">
            <button className="pill-btn" onClick={clearCart}>Clear Cart</button>
            <button className="ghost-btn" onClick={loadSavedData}>Load Saved</button>
            <button className="ghost-btn" onClick={clearSavedData}>Clear Saved</button>
          </div>
        </aside>
      </main>

      <section className="panel inventory-panel">
        <div className="section-head">
          <div className="section-title">
            <small>Inventory Manager</small>
            <h2>Stock Ledger</h2>
          </div>
          <button className="ghost-btn" onClick={() => setProducts(buildDefaultProducts())}>Refresh</button>
        </div>

        <div className="inventory-controls">
          <div className="field">
            <label htmlFor="inventorySearch">Search inventory</label>
            <input className="input" id="inventorySearch" value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} placeholder="Search by name, brand, category..." />
          </div>
          <div className="field">
            <label htmlFor="inventoryCategoryFilter">Category</label>
            <select className="select" id="inventoryCategoryFilter" value={inventoryCategory} onChange={(e) => setInventoryCategory(e.target.value)}>
              <option value="all">All categories</option>
              {categories.filter((cat) => cat !== 'all').map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
        </div>

        <div className="summary-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Opening</th>
                <th>Current</th>
                <th>Sold</th>
                <th>Status</th>
                <th>Units</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {inventoryRows.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.category}</td>
                  <td>{product.stock || '0 piece'}</td>
                  <td>{product.stock || '0 piece'}</td>
                  <td>0</td>
                  <td>{product.stockStatus || 'In stock'}</td>
                  <td>{(product.units || []).join(', ')}</td>
                  <td><button className="ghost-btn small" onClick={() => addToCart(product, product.units?.[0] || 'piece')}>Quick Add</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="summary">
        <div className="section-head">
          <div className="section-title">
            <small>Sales History</small>
            <h2>Completed Sales</h2>
          </div>
          <div className="stat-chip">Live summary</div>
        </div>
        <div className="summary-wrap">
          <table>
            <thead>
              <tr>
                <th>Product / Invoice</th>
                <th>Brand</th>
                <th>Customer</th>
                <th>Unit</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Amount</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {salesHistory.length === 0 ? <tr><td colSpan="8" className="empty-cell">No completed sales yet.</td></tr> : salesHistory.map((sale) => (
                <tr key={sale.id || sale.invoiceNumber || `${sale.generatedAt}-${sale.customerName}`}>
                  <td>{sale.invoiceNumber || 'Sale'}</td>
                  <td>{sale.items?.[0]?.brand || 'Standard'}</td>
                  <td>{sale.customerName || 'Walk-in Customer'}</td>
                  <td>{sale.items?.[0]?.unit || 'piece'}</td>
                  <td>{sale.totalQty || 0}</td>
                  <td>₹{formatCurrency(sale.items?.[0]?.rate || 0)}</td>
                  <td>₹{formatCurrency(sale.grandTotal || sale.subtotal || 0)}</td>
                  <td><button className="ghost-btn small" onClick={() => setInvoicePreview(sale)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {invoicePreview && (
        <div className="invoice-modal active" id="invoiceModal" aria-hidden="false">
          <div className="invoice-modal__card">
            <div className="modal-header">
              <div className="section-title">
                <small>{invoicePreview.completed ? 'Completed' : 'Preview'}</small>
                <h2>{invoicePreview.shopName}</h2>
              </div>
              <button className="close-btn" onClick={() => setInvoicePreview(null)}>×</button>
            </div>
            <div className="invoice-content">
              <div className="invoice-header">
                <div className="invoice-title">
                  <h2>{invoicePreview.shopName}</h2>
                  <p>{invoicePreview.completed ? 'Completed Sale Invoice' : 'Invoice Preview'}</p>
                  <p>{invoicePreview.shopAddress} • Phone: {invoicePreview.shopPhone}</p>
                </div>
                <div className="invoice-meta">
                  <div><strong>Invoice No:</strong> {invoicePreview.invoiceNumber}</div>
                  <div><strong>Date & Time:</strong> {new Date(invoicePreview.generatedAt).toLocaleString('en-IN')}</div>
                  <div><strong>Mode:</strong> {invoicePreview.completed ? 'Completed & Saved' : 'Draft Preview'}</div>
                </div>
              </div>
              <div className="invoice-grid">
                <div className="invoice-box">
                  <h3>Customer Details</h3>
                  <div><strong>Name:</strong> {invoicePreview.customerName}</div>
                  <div><strong>Phone:</strong> {invoicePreview.customerPhone}</div>
                </div>
                <div className="invoice-box">
                  <h3>Order Summary</h3>
                  <div><strong>Total line items:</strong> {invoicePreview.items.length}</div>
                  <div><strong>Total quantity:</strong> {invoicePreview.totalQty}</div>
                </div>
              </div>
              <div className="invoice-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product</th>
                      <th>Brand</th>
                      <th>Unit</th>
                      <th>Qty</th>
                      <th>Rate</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoicePreview.items.map((item, index) => (
                      <tr key={`${item.productId}-${item.unit}-${index}`}>
                        <td>{index + 1}</td>
                        <td>{item.name}</td>
                        <td>{item.brand}</td>
                        <td>{item.unit}</td>
                        <td>{item.quantity}</td>
                        <td>₹{formatCurrency(item.rate)}</td>
                        <td>₹{formatCurrency(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="invoice-foot">
                <div className="note-box">
                  <h3>Notes</h3>
                  <p>{invoicePreview.completed ? 'Sale successfully completed and stock deducted once.' : 'Preview only. Inventory is still unchanged until the sale is completed.'}</p>
                </div>
                <div className="totals-box">
                  <div className="total-row"><span>Sub Total</span><strong>₹{formatCurrency(invoicePreview.subtotal)}</strong></div>
                  <div className="total-row"><span>Extra Charges</span><strong>₹0</strong></div>
                  <div className="total-row total-row--highlight"><span><strong>Grand Total</strong></span><strong>₹{formatCurrency(invoicePreview.grandTotal)}</strong></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
