const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { supabase } = require('../utils/db');
const { signAccessToken, signRefreshToken, verifyToken } = require('../utils/auth');
const { apiError } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { OAuth2Client } = require('google-auth-library');
const googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;

const router = express.Router();
const authSchema = z.object({ email: z.string().email().max(255), password: z.string().min(8).max(128) });
const registerSchema = authSchema.extend({ name: z.string().trim().min(2).max(80) });

const cookieBase = { httpOnly: true, sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', secure: process.env.NODE_ENV === 'production', path: '/' };
function setAuthCookies(res, user) {
  res.cookie('access_token', signAccessToken(user), { ...cookieBase, maxAge: 15 * 60 * 1000 });
  res.cookie('refresh_token', signRefreshToken(user), { ...cookieBase, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

router.post('/register', asyncHandler(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const email = input.email.toLowerCase();
  const { data: existing } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
  if (existing) throw apiError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
  const password_hash = await bcrypt.hash(input.password, 12);
  const { data: user, error } = await supabase.from('users').insert({ email, name: input.name, password_hash }).select('id,email,name,image_url,created_at').single();
  if (error) throw error;
  setAuthCookies(res, user);
  res.status(201).json({ user });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const input = authSchema.parse(req.body);
  const email = input.email.toLowerCase();
  const { data: user } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
  if (!user || !(await bcrypt.compare(input.password, user.password_hash))) throw apiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  const safe = { id: user.id, email: user.email, name: user.name, image_url: user.image_url };
  setAuthCookies(res, safe);
  res.json({ user: safe });
}));


router.post('/google', asyncHandler(async (req, res) => {
  const credential = z.string().min(20).parse(req.body?.credential);
  if (!googleClient) throw apiError(503, 'GOOGLE_NOT_CONFIGURED', 'Google OAuth is not configured on this server.');
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) throw apiError(401, 'GOOGLE_INVALID', 'Google account could not be verified.');
  const email = payload.email.toLowerCase();
  let { data: user } = await supabase.from('users').select('id,email,name,image_url').eq('email', email).maybeSingle();
  if (!user) {
    const password_hash = await bcrypt.hash(require('crypto').randomBytes(32).toString('hex'), 12);
    const created = await supabase.from('users').insert({ email, name: payload.name || email.split('@')[0], image_url: payload.picture || null, password_hash }).select('id,email,name,image_url').single();
    if (created.error) throw created.error;
    user = created.data;
  }
  setAuthCookies(res, user);
  res.json({ user });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  try {
    const payload = verifyToken(req.cookies?.refresh_token);
    if (payload.type !== 'refresh') throw new Error();
    const { data: user } = await supabase.from('users').select('id,email,name,image_url').eq('id', payload.sub).maybeSingle();
    if (!user) throw new Error();
    setAuthCookies(res, user);
    res.json({ user });
  } catch {
    throw apiError(401, 'UNAUTHORIZED', 'Refresh token is invalid or expired.');
  }
}));

router.post('/logout', (_req, res) => {
  res.clearCookie('access_token', cookieBase);
  res.clearCookie('refresh_token', cookieBase);
  res.json({ ok: true });
});

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { data: user, error } = await supabase.from('users').select('id,email,name,image_url,created_at').eq('id', req.user.id).maybeSingle();
  if (error || !user) throw apiError(401, 'UNAUTHORIZED', 'User not found.');
  res.json({ user });
}));

module.exports = router;
