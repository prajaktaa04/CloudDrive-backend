const supabase = require('../config/supabase');
const { apiError } = require('./errors');

async function one(query, notFoundMessage = 'Resource not found.') {
  const { data, error } = await query.single();
  if (error) throw apiError(404, 'NOT_FOUND', notFoundMessage);
  return data;
}

async function ensureFolderAccess(userId, folderId, mode = 'read') {
  if (!folderId) return null;
  const { data: folder, error } = await supabase.from('folders').select('*').eq('id', folderId).eq('is_deleted', false).maybeSingle();
  if (error || !folder) throw apiError(404, 'NOT_FOUND', 'Folder not found.');
  if (folder.owner_id === userId) return folder;
  const { data: share } = await supabase.from('shares').select('*').eq('resource_type', 'folder').eq('resource_id', folderId).eq('grantee_user_id', userId).maybeSingle();
  if (!share || (mode === 'write' && share.role !== 'editor')) throw apiError(403, 'FORBIDDEN', 'You do not have permission for this folder.');
  return folder;
}

async function ensureResourceAccess(userId, resourceType, resourceId, mode = 'read') {
  const table = resourceType === 'file' ? 'files' : 'folders';
  const { data: resource } = await supabase.from(table).select('*').eq('id', resourceId).maybeSingle();
  if (!resource || resource.is_deleted) throw apiError(404, 'NOT_FOUND', 'Resource not found.');
  if (resource.owner_id === userId) return { resource, role: 'owner' };
  const { data: share } = await supabase.from('shares').select('*').eq('resource_type', resourceType).eq('resource_id', resourceId).eq('grantee_user_id', userId).maybeSingle();
  if (!share || (mode === 'write' && share.role !== 'editor')) throw apiError(403, 'FORBIDDEN', 'You do not have permission for this resource.');
  return { resource, role: share.role };
}

async function logActivity(actorId, action, resourceType, resourceId, context = {}) {
  await supabase.from('activities').insert({ actor_id: actorId, action, resource_type: resourceType, resource_id: resourceId, context });
}

module.exports = { supabase, one, ensureFolderAccess, ensureResourceAccess, logActivity };
