import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, 'data', 'store.sqlite'));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const database = new Database(databasePath);
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
database.pragma('busy_timeout = 5000');

database.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    brands TEXT NOT NULL,
    image TEXT NOT NULL,
    units TEXT NOT NULL,
    stock_base REAL NOT NULL CHECK (stock_base >= 0),
    opening_stock_base REAL NOT NULL CHECK (opening_stock_base >= 0),
    base_unit TEXT NOT NULL,
    conversions TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT UNIQUE,
    generated_at TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    items TEXT NOT NULL,
    subtotal REAL NOT NULL,
    total_qty REAL NOT NULL,
    grand_total REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
`);

const stockPattern = /^([0-9]+(?:\.[0-9]+)?)\s*(.+)$/;
const normalizeUnit = (unit) => String(unit || '').trim().toLowerCase();
const roundQuantity = (value) => Number(Number(value).toFixed(6));
const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const getStock = (stock) => {
  const match = String(stock || '').trim().match(stockPattern);
  return match
    ? { quantity: Number(match[1]), unit: normalizeUnit(match[2]) }
    : { quantity: 0, unit: 'piece' };
};

const createConversions = (baseUnit, units) => {
  const conversions = { [baseUnit]: 1 };
  if (baseUnit === 'goni' && units.includes('half goni')) conversions['half goni'] = 0.5;
  if (baseUnit === 'goni' && units.includes('quarter goni')) conversions['quarter goni'] = 0.25;
  return conversions;
};

const insertProduct = database.prepare(`
  INSERT OR IGNORE INTO products
    (id, name, category, price, brands, image, units, stock_base, opening_stock_base, base_unit, conversions)
  VALUES
    (@id, @name, @category, @price, @brands, @image, @units, @stockBase, @stockBase, @baseUnit, @conversions)
`);

const seedProducts = database.transaction((catalog) => {
  for (const product of catalog) {
    const stock = getStock(product.stock);
    const units = Array.from(new Set((product.units || []).map(normalizeUnit).filter(Boolean)));
    const baseUnit = stock.unit || units[0] || 'piece';
    const conversions = createConversions(baseUnit, units);

    insertProduct.run({
      id: Number(product.id),
      name: product.name,
      category: product.category,
      price: Number(product.price),
      brands: JSON.stringify(product.brands || []),
      image: product.image || '',
      units: JSON.stringify(units),
      stockBase: stock.quantity,
      baseUnit,
      conversions: JSON.stringify(conversions)
    });
  }
});

export const initializeProducts = (catalog) => seedProducts(catalog);

const selectProducts = database.prepare('SELECT * FROM products ORDER BY id');
export const getProducts = () => selectProducts.all().map((row) => {
  const units = JSON.parse(row.units);
  const conversions = JSON.parse(row.conversions);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: row.price,
    brands: JSON.parse(row.brands),
    image: row.image,
    units,
    saleUnits: Object.keys(conversions),
    baseUnit: row.base_unit,
    stockBase: row.stock_base,
    openingStockBase: row.opening_stock_base,
    stock: `${row.stock_base} ${row.base_unit}`,
    conversions
  };
});

const selectSales = database.prepare('SELECT * FROM sales ORDER BY id DESC');
export const getSales = () => selectSales.all().map((row) => ({
  id: `sale-${row.id}`,
  invoiceNumber: row.invoice_number,
  generatedAt: row.generated_at,
  customerName: row.customer_name,
  customerPhone: row.customer_phone,
  items: JSON.parse(row.items),
  subtotal: row.subtotal,
  totalQty: row.total_qty,
  grandTotal: row.grand_total,
  completed: true,
  shopName: 'Chaurasiya Puja Samagri',
  shopAddress: 'Shop No. 7, Rampur Road',
  shopPhone: '9516733895'
}));

const findProduct = database.prepare('SELECT * FROM products WHERE id = ?');
const updateStock = database.prepare('UPDATE products SET stock_base = ? WHERE id = ?');
const insertSale = database.prepare(`
  INSERT INTO sales
    (generated_at, customer_name, customer_phone, items, subtotal, total_qty, grand_total)
  VALUES
    (@generatedAt, @customerName, @customerPhone, @items, @subtotal, @totalQty, @grandTotal)
`);
const updateInvoiceNumber = database.prepare('UPDATE sales SET invoice_number = ? WHERE id = ?');

export const completeSale = (payload) => {
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > 200) {
    const error = new Error('A sale must contain between 1 and 200 items.');
    error.status = 400;
    throw error;
  }

  if ((payload.customerName != null && typeof payload.customerName !== 'string')
    || (payload.customerPhone != null && typeof payload.customerPhone !== 'string')) {
    const error = new Error('Customer name and phone must be text.');
    error.status = 400;
    throw error;
  }

  const customerName = typeof payload.customerName === 'string' ? payload.customerName.trim() : '';
  const customerPhone = typeof payload.customerPhone === 'string' ? payload.customerPhone.trim() : '';
  if (customerName.length > 120 || customerPhone.length > 40) {
    const error = new Error('Customer details exceed the allowed length.');
    error.status = 400;
    throw error;
  }

  const saleTransaction = database.transaction(() => {
    const requestedByProduct = new Map();
    const lineItems = payload.items.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        const error = new Error('Each sale item must be an object.');
        error.status = 400;
        throw error;
      }
      const productId = Number(item.productId);
      const quantity = Number(item.quantity);
      const rate = Number(item.rate);
      if (!Number.isSafeInteger(productId) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
        const error = new Error('Each item must have a valid product and a quantity greater than zero.');
        error.status = 400;
        throw error;
      }
      if (!Number.isFinite(rate) || rate < 0 || rate > 1_000_000_000) {
        const error = new Error('Each item must have a valid non-negative rate.');
        error.status = 400;
        throw error;
      }

      const product = findProduct.get(productId);
      if (!product) {
        const error = new Error(`Product ${productId} was not found.`);
        error.status = 400;
        throw error;
      }

      const conversions = JSON.parse(product.conversions);
      const unit = normalizeUnit(item.unit);
      const coefficient = conversions[unit];
      if (!Number.isFinite(coefficient) || coefficient <= 0) {
        const error = new Error(`${product.name} cannot be sold in "${unit || 'unknown'}" until that unit has a verified stock conversion.`);
        error.status = 400;
        throw error;
      }

      const stockQuantity = roundQuantity(quantity * coefficient);
      requestedByProduct.set(productId, roundQuantity((requestedByProduct.get(productId) || 0) + stockQuantity));
      return {
        productId,
        name: product.name,
        brand: JSON.parse(product.brands)[0] || 'Standard',
        unit,
        quantity: roundQuantity(quantity),
        rate: roundMoney(rate),
        amount: roundMoney(quantity * rate),
        stockUnit: product.base_unit,
        stockQuantity
      };
    });

    for (const [productId, requested] of requestedByProduct) {
      const product = findProduct.get(productId);
      if (requested > product.stock_base) {
        const error = new Error(`${product.name} has only ${product.stock_base} ${product.base_unit} in stock.`);
        error.status = 409;
        throw error;
      }
    }

    const generatedAt = new Date().toISOString();
    const items = JSON.stringify(lineItems);
    const subtotal = roundMoney(lineItems.reduce((sum, item) => sum + item.amount, 0));
    const totalQty = roundQuantity(lineItems.reduce((sum, item) => sum + item.quantity, 0));
    const saleRecord = insertSale.run({
      generatedAt,
      customerName: customerName || 'Walk-in Customer',
      customerPhone: customerPhone || 'N/A',
      items,
      subtotal,
      totalQty,
      grandTotal: subtotal
    });
    const id = Number(saleRecord.lastInsertRowid);
    const invoiceNumber = `CPS-${String(id).padStart(4, '0')}`;
    updateInvoiceNumber.run(invoiceNumber, id);

    for (const [productId, requested] of requestedByProduct) {
      const product = findProduct.get(productId);
      updateStock.run(roundQuantity(product.stock_base - requested), productId);
    }

    return {
      id: `sale-${id}`,
      invoiceNumber,
      generatedAt,
      customerName: customerName || 'Walk-in Customer',
      customerPhone: customerPhone || 'N/A',
      items: lineItems,
      subtotal,
      totalQty,
      grandTotal: subtotal,
      completed: true,
      shopName: 'Chaurasiya Puja Samagri',
      shopAddress: 'Shop No. 7, Rampur Road',
      shopPhone: '9516733895'
    };
  });

  return saleTransaction.immediate();
};
