const express = require('express');
const { supabase } = require('../utils/db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/shared
// Returns only resources shared TO the currently authenticated user.
// Each result also contains the sender (the user who created the share).
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const { data: shares, error: sharesError } = await supabase
    .from('shares')
    .select(`
      id,
      resource_type,
      resource_id,
      grantee_user_id,
      role,
      created_by,
      created_at
    `)
    .eq('grantee_user_id', userId);

  if (sharesError) throw sharesError;

  const receivedShares = shares || [];
  if (!receivedShares.length) {
    return res.json({ files: [], folders: [], shares: [] });
  }

  const fileIds = receivedShares
    .filter(s => s.resource_type === 'file')
    .map(s => s.resource_id);

  const folderIds = receivedShares
    .filter(s => s.resource_type === 'folder')
    .map(s => s.resource_id);

  const [filesResult, foldersResult] = await Promise.all([
    fileIds.length
      ? supabase
          .from('files')
          .select(`
            id,
            name,
            mime_type,
            size_bytes,
            owner_id,
            folder_id,
            is_deleted,
            created_at,
            updated_at
          `)
          .in('id', fileIds)
          .eq('is_deleted', false)
      : Promise.resolve({ data: [], error: null }),

    folderIds.length
      ? supabase
          .from('folders')
          .select(`
            id,
            name,
            owner_id,
            parent_id,
            is_deleted,
            created_at,
            updated_at
          `)
          .in('id', folderIds)
          .eq('is_deleted', false)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (filesResult.error) throw filesResult.error;
  if (foldersResult.error) throw foldersResult.error;

  // Use created_by as the sender. For older share rows where created_by
  // was not populated, fall back to the resource owner.
  const senderIds = new Set(
    receivedShares.map(s => s.created_by).filter(Boolean)
  );
  (filesResult.data || []).forEach(f => senderIds.add(f.owner_id));
  (foldersResult.data || []).forEach(f => senderIds.add(f.owner_id));

  let senders = [];
  if (senderIds.size) {
    const { data, error } = await supabase
      .from('users')
      .select('id,name,email,image_url')
      .in('id', [...senderIds]);
    if (error) throw error;
    senders = data || [];
  }

  const senderMap = new Map(senders.map(user => [String(user.id), user]));
  const resourceMap = new Map([
    ...(filesResult.data || []).map(f => [`file:${f.id}`, f]),
    ...(foldersResult.data || []).map(f => [`folder:${f.id}`, f])
  ]);

  const enrichedShares = receivedShares
    .filter(share => resourceMap.has(`${share.resource_type}:${share.resource_id}`))
    .map(share => {
      const resource = resourceMap.get(`${share.resource_type}:${share.resource_id}`);
      const sender = senderMap.get(String(share.created_by)) || senderMap.get(String(resource.owner_id)) || null;
      return { ...share, sender };
    });

  const fileShareMap = new Map(
    enrichedShares
      .filter(s => s.resource_type === 'file')
      .map(s => [String(s.resource_id), s])
  );
  const folderShareMap = new Map(
    enrichedShares
      .filter(s => s.resource_type === 'folder')
      .map(s => [String(s.resource_id), s])
  );

  const files = (filesResult.data || [])
    .filter(file => fileShareMap.has(String(file.id)))
    .map(file => {
      const share = fileShareMap.get(String(file.id));
      return { ...file, shared_role: share.role, shared_by: share.sender };
    });

  const folders = (foldersResult.data || [])
    .filter(folder => folderShareMap.has(String(folder.id)))
    .map(folder => {
      const share = folderShareMap.get(String(folder.id));
      return { ...folder, shared_role: share.role, shared_by: share.sender };
    });

  res.json({ files, folders, shares: enrichedShares });
}));

module.exports = router;

