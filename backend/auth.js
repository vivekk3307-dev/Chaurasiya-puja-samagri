import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { database } from './database.js';

const cookieName = 'puja_admin_session';
const sessionLifetimeSeconds = 8 * 60 * 60;
const findSession = database.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ?');
const insertSession = database.prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)');
const deleteSession = database.prepare('DELETE FROM admin_sessions WHERE token_hash = ?');
const deleteExpiredSessions = database.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?');

const sign = (value) => createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('base64url');
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

const readCookie = (request) => {
  const cookieHeader = request.headers.cookie || '';
  const entry = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  return entry ? entry.slice(cookieName.length + 1) : '';
};

export const verifyPassword = (candidate) => {
  if (typeof candidate !== 'string') return false;
  const expected = Buffer.from(createHmac('sha256', 'password-check').update(process.env.ADMIN_PASSWORD).digest());
  const provided = Buffer.from(createHmac('sha256', 'password-check').update(candidate).digest());
  return timingSafeEqual(expected, provided);
};

export const createSession = (secure) => {
  const expires = Math.floor(Date.now() / 1000) + sessionLifetimeSeconds;
  const token = randomBytes(32).toString('base64url');
  const payload = `${expires}.${token}`;
  const value = `${payload}.${sign(payload)}`;
  deleteExpiredSessions.run(Math.floor(Date.now() / 1000));
  insertSession.run(hashToken(token), expires);
  return `${cookieName}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${sessionLifetimeSeconds}${secure ? '; Secure' : ''}`;
};

export const clearSession = (request, secure) => {
  const token = getValidToken(request);
  if (token) deleteSession.run(hashToken(token));
  return `${cookieName}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure ? '; Secure' : ''}`;
};

const getValidToken = (request) => {
  const value = readCookie(request);
  const [expiresText, token, signature, extra] = value.split('.');
  if (!expiresText || !token || !signature || extra || Number(expiresText) <= Math.floor(Date.now() / 1000)) return null;

  const payload = `${expiresText}.${token}`;
  const expectedSignature = Buffer.from(sign(payload));
  const providedSignature = Buffer.from(signature);
  if (expectedSignature.length !== providedSignature.length || !timingSafeEqual(expectedSignature, providedSignature)) return null;
  const session = findSession.get(hashToken(token));
  return session && session.expires_at > Math.floor(Date.now() / 1000) ? token : null;
};

export const isAuthenticated = (request) => Boolean(getValidToken(request));

export const requireAuthentication = (request, response, next) => {
  if (!isAuthenticated(request)) {
    return response.status(401).json({ error: 'Admin login required.' });
  }
  return next();
};
