const express = require('express');
const { z } = require('zod');

const {
  supabase,
  ensureResourceAccess
} = require('../utils/db');

const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

const schema = z.object({
  resourceType: z.enum(['file', 'folder']),
  resourceId: z.string().uuid()
});


// ======================================================
// GET STARRED
// ======================================================

router.get('/', asyncHandler(async (req, res) => {

  const { data, error } = await supabase
    .from('stars')
    .select('*')
    .eq('user_id', req.user.id);

  if (error) {
    throw error;
  }

  res.json({
    stars: data || []
  });

}));


// ======================================================
// STAR RESOURCE
// ======================================================

router.post('/', asyncHandler(async (req, res) => {

  const input = schema.parse(req.body);

  await ensureResourceAccess(
    req.user.id,
    input.resourceType,
    input.resourceId,
    'read'
  );

  const {
    data,
    error
  } = await supabase
    .from('stars')
    .upsert(
      {
        user_id: req.user.id,
        resource_type: input.resourceType,
        resource_id: input.resourceId
      },
      {
        onConflict: 'user_id,resource_type,resource_id'
      }
    )
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  res.status(201).json({
    star: data
  });

}));


// ======================================================
// UNSTAR RESOURCE
// ======================================================

router.delete('/', asyncHandler(async (req, res) => {

  const input = schema.parse(req.body);

  const {
    error
  } = await supabase
    .from('stars')
    .delete()
    .match({
      user_id: req.user.id,
      resource_type: input.resourceType,
      resource_id: input.resourceId
    });

  if (error) {
    throw error;
  }

  res.json({
    ok: true
  });

}));


module.exports = router;