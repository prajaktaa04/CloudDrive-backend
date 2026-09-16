const express = require('express');
const { z } = require('zod');
const {
  supabase,
  logActivity
} = require('../utils/db');
const { apiError } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();


// ======================================================
// GET TRASH
// ======================================================

router.get('/', asyncHandler(async (req, res) => {

  const ownerId = req.user.id;

  const [
    { data: files, error: filesError },
    { data: folders, error: foldersError }
  ] = await Promise.all([

    supabase
      .from('files')
      .select(
        'id,name,mime_type,size_bytes,owner_id,folder_id,is_deleted,created_at,updated_at'
      )
      .eq('owner_id', ownerId)
      .eq('is_deleted', true)
      .order('updated_at', {
        ascending: false
      }),

    supabase
      .from('folders')
      .select(
        'id,name,owner_id,parent_id,is_deleted,created_at,updated_at'
      )
      .eq('owner_id', ownerId)
      .eq('is_deleted', true)
      .order('updated_at', {
        ascending: false
      })

  ]);

  if (filesError) {
    throw filesError;
  }

  if (foldersError) {
    throw foldersError;
  }

  res.json({
    files: files || [],
    folders: folders || []
  });

}));


// ======================================================
// RESTORE
// ======================================================

router.post('/restore', asyncHandler(async (req, res) => {

  const input = z
    .object({
      resourceType: z.enum(['file', 'folder']),
      resourceId: z.string().uuid()
    })
    .parse(req.body);

  const table =
    input.resourceType === 'file'
      ? 'files'
      : 'folders';


  // ----------------------------------------------------
  // Find deleted resource belonging to current user
  // ----------------------------------------------------

  const {
    data: resource,
    error: resourceError
  } = await supabase
    .from(table)
    .select('*')
    .eq('id', input.resourceId)
    .eq('owner_id', req.user.id)
    .eq('is_deleted', true)
    .maybeSingle();

  if (resourceError) {
    throw resourceError;
  }

  if (!resource) {
    throw apiError(
      404,
      'NOT_FOUND',
      'Deleted resource not found.'
    );
  }


  const now =
    new Date().toISOString();


  // ----------------------------------------------------
  // Restore requested resource
  // ----------------------------------------------------

  const {
    error: restoreError
  } = await supabase
    .from(table)
    .update({
      is_deleted: false,
      updated_at: now
    })
    .eq('id', input.resourceId)
    .eq('owner_id', req.user.id);

  if (restoreError) {
    throw restoreError;
  }


  // ----------------------------------------------------
  // If folder is restored, restore its files
  // ----------------------------------------------------

  if (input.resourceType === 'folder') {

    const {
      error: childFilesError
    } = await supabase
      .from('files')
      .update({
        is_deleted: false,
        updated_at: now
      })
      .eq('folder_id', input.resourceId)
      .eq('owner_id', req.user.id);

    if (childFilesError) {
      throw childFilesError;
    }

  }


  // ----------------------------------------------------
  // Activity
  // ----------------------------------------------------

  await logActivity(
    req.user.id,
    'restore',
    input.resourceType,
    input.resourceId,
    {
      name: resource.name
    }
  );


  res.json({
    ok: true
  });

}));


module.exports = router;