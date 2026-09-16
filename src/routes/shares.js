const express = require('express');
const { z } = require('zod');

const {
  supabase,
  ensureResourceAccess,
  logActivity
} = require('../utils/db');

const { apiError } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

const schema = z.object({
  resourceType: z.enum(['file', 'folder']),
  resourceId: z.string().uuid(),
  granteeUserId: z.string().uuid(),
  role: z.enum(['viewer', 'editor'])
});


// ======================================================
// SEARCH USERS
// ======================================================

router.get(
  '/users',
  asyncHandler(async (req, res) => {

    if (!req.user?.id) {
      throw apiError(
        401,
        'UNAUTHORIZED',
        'Authentication required.'
      );
    }

    const q = String(
      req.query.q || ''
    )
      .trim()
      .toLowerCase();

    if (q.length < 2) {
      return res.json({
        users: []
      });
    }

    const {
      data,
      error
    } = await supabase
      .from('users')
      .select('id,email,name')
      .or(
        `email.ilike.%${q}%,name.ilike.%${q}%`
      )
      .limit(10);

    if (error) {
      throw error;
    }

    /*
     * Remove the currently logged-in user
     * from the search results.
     *
     * This prevents a user from sharing
     * a file/folder with themselves.
     */

    const users = (data || []).filter(
      user =>
        user.id !== req.user.id
    );

    res.json({
      users
    });

  })
);


// ======================================================
// CREATE / UPDATE SHARE
// ======================================================

router.post(
  '/',
  asyncHandler(async (req, res) => {

    if (!req.user?.id) {
      throw apiError(
        401,
        'UNAUTHORIZED',
        'Authentication required.'
      );
    }

    const input =
      schema.parse(req.body);


    /*
     * Prevent sharing with yourself.
     */

    if (
      input.granteeUserId ===
      req.user.id
    ) {
      throw apiError(
        400,
        'SELF_SHARE',
        'You cannot share a file or folder with yourself.'
      );
    }


    /*
     * Make sure the current user
     * has write access.
     */

    const {
      resource
    } = await ensureResourceAccess(
      req.user.id,
      input.resourceType,
      input.resourceId,
      'write'
    );


    /*
     * Only the owner can manage sharing.
     */

    if (
      resource.owner_id !==
      req.user.id
    ) {
      throw apiError(
        403,
        'FORBIDDEN',
        'Only the owner can manage sharing.'
      );
    }


    /*
     * Make sure recipient exists.
     */

    const {
      data: grantee,
      error: granteeError
    } = await supabase
      .from('users')
      .select('id,email,name')
      .eq(
        'id',
        input.granteeUserId
      )
      .maybeSingle();

    if (granteeError) {
      throw granteeError;
    }

    if (!grantee) {
      throw apiError(
        404,
        'USER_NOT_FOUND',
        'User not found.'
      );
    }


    /*
     * Create or update share.
     */

    const {
      data: share,
      error
    } = await supabase
      .from('shares')
      .upsert(
        {
          resource_type:
            input.resourceType,

          resource_id:
            input.resourceId,

          grantee_user_id:
            input.granteeUserId,

          role:
            input.role,

          created_by:
            req.user.id
        },
        {
          onConflict:
            'resource_type,resource_id,grantee_user_id'
        }
      )
      .select('*')
      .single();

    if (error) {
      throw error;
    }


    await logActivity(
      req.user.id,
      'share',
      input.resourceType,
      input.resourceId,
      {
        granteeUserId:
          input.granteeUserId,

        role:
          input.role
      }
    );


    res.status(201).json({
      share
    });

  })
);


// ======================================================
// GET SHARE LIST
// ======================================================

router.get(
  '/:resourceType/:resourceId',
  asyncHandler(async (req, res) => {

    if (!req.user?.id) {
      throw apiError(
        401,
        'UNAUTHORIZED',
        'Authentication required.'
      );
    }

    const {
      resource
    } = await ensureResourceAccess(
      req.user.id,
      req.params.resourceType,
      req.params.resourceId,
      'read'
    );


    if (
      resource.owner_id !==
      req.user.id
    ) {
      throw apiError(
        403,
        'FORBIDDEN',
        'Only the owner can view the share list.'
      );
    }


    const {
      data,
      error
    } = await supabase
      .from('shares')
      .select(
        `
        id,
        resource_type,
        resource_id,
        role,
        created_at,
        grantee_user_id,
        users:grantee_user_id(
          id,
          email,
          name
        )
        `
      )
      .eq(
        'resource_type',
        req.params.resourceType
      )
      .eq(
        'resource_id',
        req.params.resourceId
      );


    if (error) {
      throw error;
    }


    res.json({
      shares: data || []
    });

  })
);


// ======================================================
// DELETE / REVOKE SHARE
// ======================================================

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {

    if (!req.user?.id) {
      throw apiError(
        401,
        'UNAUTHORIZED',
        'Authentication required.'
      );
    }

    const {
      data: share,
      error: shareError
    } = await supabase
      .from('shares')
      .select('*')
      .eq(
        'id',
        req.params.id
      )
      .maybeSingle();

    if (shareError) {
      throw shareError;
    }

    if (!share) {
      throw apiError(
        404,
        'NOT_FOUND',
        'Share not found.'
      );
    }


    const {
      resource
    } = await ensureResourceAccess(
      req.user.id,
      share.resource_type,
      share.resource_id,
      'write'
    );


    if (
      resource.owner_id !==
      req.user.id
    ) {
      throw apiError(
        403,
        'FORBIDDEN',
        'Only the owner can revoke sharing.'
      );
    }


    const {
      error
    } = await supabase
      .from('shares')
      .delete()
      .eq(
        'id',
        share.id
      );

    if (error) {
      throw error;
    }


    res.json({
      ok: true
    });

  })
);


module.exports = router;