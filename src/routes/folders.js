const express = require('express');
const { z } = require('zod');

const {
  supabase,
  ensureFolderAccess,
  ensureResourceAccess,
  logActivity
} = require('../utils/db');

const {
  apiError
} = require('../utils/errors');

const asyncHandler =
  require('../utils/asyncHandler');


const router = express.Router();


// ======================================================
// VALIDATION
// ======================================================

const folderInput = z.object({

  name:
    z.string()
      .trim()
      .min(1)
      .max(150),

  parentId:
    z.string()
      .uuid()
      .nullable()
      .optional()

});


// ======================================================
// GET ROOT / FOLDER CONTENTS
// ======================================================
//
// GET /api/folders
// GET /api/folders?parentId=<id>
//
// Root:
//   parentId = null
//
// IMPORTANT:
// For NULL parent_id we use .is()
// instead of .eq().
//

router.get(
  '/',
  asyncHandler(async (req, res) => {

    const parentId =
      req.query.parentId ||
      null;


    // --------------------------------------------------
    // Verify access when inside a folder
    // --------------------------------------------------

    if (parentId) {

      await ensureFolderAccess(
        req.user.id,
        parentId,
        'read'
      );

    }


    // ==================================================
    // FOLDERS QUERY
    // ==================================================

    let folderQuery =
      supabase
        .from('folders')
        .select(
          `
          id,
          name,
          owner_id,
          parent_id,
          is_deleted,
          created_at,
          updated_at
          `
        )
        .eq(
          'is_deleted',
          false
        );


    // ==================================================
    // FILES QUERY
    // ==================================================

    let fileQuery =
      supabase
        .from('files')
        .select(
          `
          id,
          name,
          mime_type,
          size_bytes,
          owner_id,
          folder_id,
          is_deleted,
          created_at,
          updated_at
          `
        )
        .eq(
          'is_deleted',
          false
        );


    // ==================================================
    // ROOT vs CHILD FOLDER
    // ==================================================

    if (parentId) {

      // ------------------------------------------------
      // Inside a folder
      // ------------------------------------------------

      folderQuery =
        folderQuery
          .eq(
            'parent_id',
            parentId
          );

      fileQuery =
        fileQuery
          .eq(
            'folder_id',
            parentId
          );

    } else {

      // ------------------------------------------------
      // ROOT / MY DRIVE
      // ------------------------------------------------
      //
      // THIS IS THE IMPORTANT FIX.
      //
      // NULL must be queried using .is()
      // ------------------------------------------------

      folderQuery =
        folderQuery
          .is(
            'parent_id',
            null
          )
          .eq(
            'owner_id',
            req.user.id
          );


      fileQuery =
        fileQuery
          .is(
            'folder_id',
            null
          )
          .eq(
            'owner_id',
            req.user.id
          );

    }


    // ==================================================
    // SORT
    // ==================================================

    folderQuery =
      folderQuery.order(
        'name',
        {
          ascending: true
        }
      );


    fileQuery =
      fileQuery.order(
        'name',
        {
          ascending: true
        }
      );


    // ==================================================
    // FETCH BOTH
    // ==================================================

    const [
      folderResult,
      fileResult
    ] = await Promise.all([

      folderQuery,

      fileQuery

    ]);


    // --------------------------------------------------
    // Handle query errors
    // --------------------------------------------------

    if (folderResult.error) {
      throw folderResult.error;
    }

    if (fileResult.error) {
      throw fileResult.error;
    }


    // ==================================================
    // RESPONSE
    // ==================================================

    res.json({

      folders:
        folderResult.data ||
        [],

      files:
        fileResult.data ||
        []

    });

  })
);


// ======================================================
// GET SINGLE FOLDER
// ======================================================
//
// GET /api/folders/:id
//
// Returns:
// - current folder
// - child folders
// - child files
// - parent
//

router.get(
  '/:id',

  asyncHandler(async (req, res) => {

    // --------------------------------------------------
    // Check folder access
    // --------------------------------------------------

    const {
      resource: folder
    } = await ensureResourceAccess(
      req.user.id,
      'folder',
      req.params.id,
      'read'
    );


    // ==================================================
    // CHILD FOLDERS
    // ==================================================

    const foldersQuery =
      supabase
        .from('folders')
        .select(
          `
          id,
          name,
          owner_id,
          parent_id,
          is_deleted,
          created_at,
          updated_at
          `
        )
        .eq(
          'parent_id',
          folder.id
        )
        .eq(
          'is_deleted',
          false
        )
        .order(
          'name',
          {
            ascending: true
          }
        );


    // ==================================================
    // CHILD FILES
    // ==================================================

    const filesQuery =
      supabase
        .from('files')
        .select(
          `
          id,
          name,
          mime_type,
          size_bytes,
          owner_id,
          folder_id,
          is_deleted,
          created_at,
          updated_at
          `
        )
        .eq(
          'folder_id',
          folder.id
        )
        .eq(
          'is_deleted',
          false
        )
        .order(
          'name',
          {
            ascending: true
          }
        );


    // ==================================================
    // PARENT FOLDER
    // ==================================================

    const parentQuery =
      folder.parent_id

        ? supabase
            .from('folders')
            .select(
              `
              id,
              name,
              parent_id
              `
            )
            .eq(
              'id',
              folder.parent_id
            )
            .maybeSingle()

        : Promise.resolve({
            data: null,
            error: null
          });


    // ==================================================
    // FETCH
    // ==================================================

    const [
      foldersResult,
      filesResult,
      parentResult
    ] = await Promise.all([

      foldersQuery,

      filesQuery,

      parentQuery

    ]);


    // --------------------------------------------------
    // Errors
    // --------------------------------------------------

    if (foldersResult.error) {
      throw foldersResult.error;
    }

    if (filesResult.error) {
      throw filesResult.error;
    }

    if (parentResult.error) {
      throw parentResult.error;
    }


    // ==================================================
    // RESPONSE
    // ==================================================

    res.json({

      folder,

      folders:
        foldersResult.data ||
        [],

      files:
        filesResult.data ||
        [],

      parent:
        parentResult.data ||
        null

    });

  })
);


// ======================================================
// CREATE FOLDER
// ======================================================
//
// POST /api/folders
//
// {
//   name,
//   parentId
// }
//

router.post(
  '/',

  asyncHandler(async (req, res) => {

    const input =
      folderInput.parse(
        req.body
      );


    // --------------------------------------------------
    // Parent permission
    // --------------------------------------------------

    if (input.parentId) {

      await ensureFolderAccess(
        req.user.id,
        input.parentId,
        'write'
      );

    }


    // --------------------------------------------------
    // Create folder
    // --------------------------------------------------

    const {
      data: folder,
      error
    } = await supabase
      .from('folders')
      .insert({

        name:
          input.name,

        owner_id:
          req.user.id,

        parent_id:
          input.parentId ??
          null

      })
      .select('*')
      .single();


    // --------------------------------------------------
    // Duplicate folder
    // --------------------------------------------------

    if (
      error?.code === '23505'
    ) {

      throw apiError(
        409,
        'DUPLICATE_NAME',
        'A folder with that name already exists here.'
      );

    }


    if (error) {
      throw error;
    }


    // --------------------------------------------------
    // Activity
    // --------------------------------------------------

    await logActivity(
      req.user.id,
      'create_folder',
      'folder',
      folder.id,
      {
        name:
          folder.name
      }
    );


    res
      .status(201)
      .json({
        folder
      });

  })
);


// ======================================================
// RENAME / MOVE FOLDER
// ======================================================
//
// PATCH /api/folders/:id
//
// {
//   name?,
//   parentId?
// }
//

router.patch(
  '/:id',

  asyncHandler(async (req, res) => {

    const input =
      z.object({

        name:
          z.string()
            .trim()
            .min(1)
            .max(150)
            .optional(),

        parentId:
          z.string()
            .uuid()
            .nullable()
            .optional()

      }).parse(
        req.body
      );


    // --------------------------------------------------
    // Existing folder
    // --------------------------------------------------

    const {
      resource: folder
    } = await ensureResourceAccess(
      req.user.id,
      'folder',
      req.params.id,
      'write'
    );


    // --------------------------------------------------
    // Cannot be own parent
    // --------------------------------------------------

    if (
      input.parentId ===
      folder.id
    ) {

      throw apiError(
        400,
        'INVALID_MOVE',
        'A folder cannot be its own parent.'
      );

    }


    // ==================================================
    // CHECK MOVE DESTINATION
    // ==================================================

    if (input.parentId) {

      await ensureFolderAccess(
        req.user.id,
        input.parentId,
        'write'
      );


      // ------------------------------------------------
      // Prevent moving folder inside itself
      // ------------------------------------------------

      let current =
        input.parentId;


      for (
        let i = 0;
        i < 50 && current;
        i++
      ) {

        const {
          data
        } = await supabase
          .from('folders')
          .select(
            'id,parent_id'
          )
          .eq(
            'id',
            current
          )
          .maybeSingle();


        if (!data) {
          break;
        }


        if (
          data.id ===
          folder.id
        ) {

          throw apiError(
            400,
            'INVALID_MOVE',
            'Cannot move a folder inside itself.'
          );

        }


        current =
          data.parent_id;

      }

    }


    // ==================================================
    // BUILD UPDATE
    // ==================================================

    const updates = {};


    if (
      input.name !==
      undefined
    ) {

      updates.name =
        input.name;

    }


    if (
      input.parentId !==
      undefined
    ) {

      updates.parent_id =
        input.parentId;

    }


    updates.updated_at =
      new Date().toISOString();


    // ==================================================
    // UPDATE
    // ==================================================

    const {
      data,
      error
    } = await supabase
      .from('folders')
      .update(updates)
      .eq(
        'id',
        folder.id
      )
      .select('*')
      .single();


    // --------------------------------------------------
    // Duplicate
    // --------------------------------------------------

    if (
      error?.code === '23505'
    ) {

      throw apiError(
        409,
        'DUPLICATE_NAME',
        'A folder with that name already exists here.'
      );

    }


    if (error) {
      throw error;
    }


    // ==================================================
    // ACTIVITY
    // ==================================================

    await logActivity(

      req.user.id,

      input.parentId !==
      undefined
        ? 'move'
        : 'rename',

      'folder',

      folder.id,

      {
        oldName:
          folder.name,

        newName:
          data.name
      }

    );


    res.json({
      folder: data
    });

  })
);


// ======================================================
// DELETE FOLDER
// ======================================================
//
// Soft delete
//

router.delete(
  '/:id',

  asyncHandler(async (req, res) => {

    const {
      resource: folder
    } = await ensureResourceAccess(
      req.user.id,
      'folder',
      req.params.id,
      'write'
    );


    // --------------------------------------------------
    // Soft delete folder
    // --------------------------------------------------

    const {
      error: folderError
    } = await supabase
      .from('folders')
      .update({

        is_deleted:
          true,

        updated_at:
          new Date().toISOString()

      })
      .eq(
        'id',
        folder.id
      );


    if (folderError) {
      throw folderError;
    }


    // --------------------------------------------------
    // Soft delete direct files
    // --------------------------------------------------

    const {
      error: fileError
    } = await supabase
      .from('files')
      .update({

        is_deleted:
          true,

        updated_at:
          new Date().toISOString()

      })
      .eq(
        'folder_id',
        folder.id
      );


    if (fileError) {
      throw fileError;
    }


    // --------------------------------------------------
    // Activity
    // --------------------------------------------------

    await logActivity(
      req.user.id,
      'delete',
      'folder',
      folder.id,
      {
        name:
          folder.name
      }
    );


    res.json({
      ok: true
    });

  })
);


module.exports = router;