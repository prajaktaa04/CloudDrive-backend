const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { supabase, ensureResourceAccess } = require('../utils/db');
const { apiError } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const createSchema = z.object({ resourceType: z.enum(['file','folder']), resourceId: z.string().uuid(), expiresAt: z.string().datetime().nullable().optional(), password: z.string().min(4).max(100).optional() });

router.post('/', asyncHandler(async (req, res) => {
  const input = createSchema.parse(req.body);
  const { resource } = await ensureResourceAccess(req.user.id, input.resourceType, input.resourceId, 'write');
  if (resource.owner_id !== req.user.id) throw apiError(403, 'FORBIDDEN', 'Only the owner can create public links.');
  const token = crypto.randomBytes(32).toString('base64url');
  const password_hash = input.password ? await bcrypt.hash(input.password, 10) : null;
  const { data, error } = await supabase.from('link_shares').insert({ resource_type: input.resourceType, resource_id: input.resourceId, token, password_hash, expires_at: input.expiresAt || null, created_by: req.user.id }).select('id,resource_type,resource_id,token,role,expires_at,created_at').single();
  if (error) throw error;
  res.status(201).json({ link: data });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { data: link } = await supabase.from('link_shares').select('id,resource_type,resource_id,token,role,expires_at,created_at,created_by').eq('id', req.params.id).maybeSingle();
  if (!link) throw apiError(404, 'NOT_FOUND', 'Link not found.');
  if (link.created_by !== req.user.id) throw apiError(403, 'FORBIDDEN', 'You cannot view this link.');
  res.json({ link });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { data: link } = await supabase.from('link_shares').select('*').eq('id', req.params.id).maybeSingle();
  if (!link) throw apiError(404, 'NOT_FOUND', 'Link not found.');
  if (link.created_by !== req.user.id) throw apiError(403, 'FORBIDDEN', 'You cannot revoke this link.');
  const { error } = await supabase.from('link_shares').delete().eq('id', link.id);
  if (error) throw error;
  res.json({ ok: true });
}));

router.get('/public/:token', asyncHandler(async (req, res) => {
  const { data: link } = await supabase.from('link_shares').select('*').eq('token', req.params.token).maybeSingle();
  if (!link) throw apiError(404, 'NOT_FOUND', 'Public link not found.');
  if (link.expires_at && new Date(link.expires_at) < new Date()) throw apiError(410, 'LINK_EXPIRED', 'This public link has expired.');
  if (link.password_hash) {
    const password = String(req.query.password || '');
    if (!password || !(await bcrypt.compare(password, link.password_hash))) throw apiError(401, 'PASSWORD_REQUIRED', 'A valid link password is required.');
  }
  const table = link.resource_type === 'file' ? 'files' : 'folders';
  const { data: resource } = await supabase.from(table).select('*').eq('id', link.resource_id).eq('is_deleted', false).maybeSingle();
  if (!resource) throw apiError(404, 'NOT_FOUND', 'Shared resource no longer exists.');
  let signedUrl = null;
  if (link.resource_type === 'file') {
    const { data, error } = await supabase.storage.from(process.env.SUPABASE_STORAGE_BUCKET || 'drive').createSignedUrl(resource.storage_key, 300, { download: resource.name });
    if (error) throw error;
    signedUrl = data.signedUrl;
  }
  res.json({ resource, signedUrl, role: 'viewer' });
}));

module.exports = router;
