const express = require('express');
const { supabase } = require('../utils/db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
router.get('/', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const type = String(req.query.type || 'all');
  const sort = String(req.query.sort || 'name');
  if (!q) return res.json({ files: [], folders: [] });
  const order = sort === 'date' ? { column: 'updated_at', ascending: false } : { column: 'name', ascending: true };
  let filesQuery = supabase.from('files').select('id,name,mime_type,size_bytes,owner_id,folder_id,is_deleted,created_at,updated_at').eq('owner_id', req.user.id).eq('is_deleted', false).ilike('name', `%${q}%`).order(order.column, { ascending: order.ascending }).limit(100);
  let foldersQuery = supabase.from('folders').select('id,name,owner_id,parent_id,is_deleted,created_at,updated_at').eq('owner_id', req.user.id).eq('is_deleted', false).ilike('name', `%${q}%`).order(order.column, { ascending: order.ascending }).limit(100);
  if (type === 'file') foldersQuery = null;
  if (type === 'folder') filesQuery = null;
  const [filesResult, foldersResult] = await Promise.all([filesQuery ? filesQuery : Promise.resolve({ data: [] }), foldersQuery ? foldersQuery : Promise.resolve({ data: [] })]);
  res.json({ files: filesResult.data || [], folders: foldersResult.data || [] });
}));
module.exports = router;
