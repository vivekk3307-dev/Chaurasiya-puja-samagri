import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import products from './data/products.js';
import { database, getProducts, getSales, completeSale, initializeProducts } from './database.js';
import { createSession, isAuthenticated, clearSession, requireAuthentication, verifyPassword } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT) || 5000;
const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12 || process.env.ADMIN_PASSWORD.startsWith('replace-')) {
  throw new Error('Set ADMIN_PASSWORD to a value of at least 12 characters in the environment.');
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.startsWith('replace-')) {
  throw new Error('Set SESSION_SECRET to a random value of at least 32 characters in the environment.');
}

initializeProducts(products);
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

const loginAttempts = new Map();
const loginWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 10;

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'Chaurasiya Puja Samagri API' });
});

app.post('/api/auth/login', (req, res) => {
  const now = Date.now();
  const ip = req.ip;
  const previous = loginAttempts.get(ip);
  const attempts = previous && now - previous.startedAt < loginWindowMs
    ? previous
    : { count: 0, startedAt: now };

  if (attempts.count >= maxLoginAttempts) {
    return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  }

  if (!verifyPassword(req.body?.password)) {
    attempts.count += 1;
    loginAttempts.set(ip, attempts);
    return res.status(401).json({ error: 'Incorrect admin password.' });
  }

  loginAttempts.delete(ip);
  res.setHeader('Set-Cookie', createSession(isProduction));
  return res.json({ authenticated: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearSession(req, isProduction));
  return res.status(204).end();
});

app.get('/api/auth/me', (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

app.get('/api/products', (_req, res) => {
  res.json(getProducts());
});

app.get('/api/sales', requireAuthentication, (_req, res) => {
  res.json(getSales());
});

app.post('/api/sales', requireAuthentication, (req, res) => {
  const sale = completeSale(req.body);
  return res.status(201).json(sale);
});

const distPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res, next) => {
  res.sendFile(path.join(distPath, 'index.html'), (error) => {
    if (error) next(error);
  });
});

app.use((error, _req, res, _next) => {
  console.error('Request failed:', error);
  const status = Number(error.status) || 500;
  res.status(status).json({ error: status >= 500 ? 'The request could not be completed.' : error.message });
});

const server = app.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`);
});

const shutdown = () => {
  server.close(() => {
    database.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
