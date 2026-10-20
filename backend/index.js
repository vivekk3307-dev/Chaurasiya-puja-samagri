import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import products from './data/products.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT) || 5000;
const salesFilePath = path.join(__dirname, 'data', 'sales.json');

app.use(cors());
app.use(express.json());

const ensureSalesFile = () => {
  const dir = path.dirname(salesFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(salesFilePath)) {
    fs.writeFileSync(salesFilePath, JSON.stringify([], null, 2));
  }
};

const readSales = () => {
  ensureSalesFile();
  try {
    return JSON.parse(fs.readFileSync(salesFilePath, 'utf-8'));
  } catch {
    return [];
  }
};

const writeSales = (sales) => {
  ensureSalesFile();
  fs.writeFileSync(salesFilePath, JSON.stringify(sales, null, 2));
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'Chaurasiya Puja Samagri API' });
});

app.get('/api/products', (_req, res) => {
  res.json(products);
});

app.get('/api/sales', (_req, res) => {
  res.json(readSales());
});

app.post('/api/sales', (req, res) => {
  const sale = req.body;
  if (!sale || !Array.isArray(sale.items) || sale.items.length === 0) {
    return res.status(400).json({ error: 'Sale payload is invalid.' });
  }

  const sales = readSales();
  const invoice = {
    ...sale,
    id: sale.id || `sale-${Date.now()}`,
    createdAt: sale.createdAt || new Date().toISOString()
  };

  sales.push(invoice);
  writeSales(sales);
  return res.status(201).json(invoice);
});

const distPath = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`);
});
