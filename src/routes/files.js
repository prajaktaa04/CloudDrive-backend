const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');

const {
  supabase,
  ensureFolderAccess,
  ensureResourceAccess,
  logActivity
} = require('../utils/db');

const { apiError } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');

const router = express.Router();


// ======================================================
// ALLOWED FILE TYPES
// ======================================================

const allowedMimes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',

  'application/pdf',

  'text/plain',
  'text/csv',

  'application/json',

  'application/zip',

  'application/msword',
  'application/vnd.ms-excel',

  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint'
]);


// ======================================================
// MULTER
// ======================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize:
      env.maxUploadMb *
      1024 *
      1024
  }
});


// ======================================================
// SAFE FILE NAME
// ======================================================

function safeName(name) {
  return path
    .basename(String(name || 'file'))
    .replace(
      /[^a-zA-Z0-9._() -]/g,
      '_'
    )
    .slice(0, 180) || 'file';
}


// ======================================================
// GET FILES
// ======================================================
//
// GET /api/files
// GET /api/files?folderId=<id>
//

router.get(
  '/',
  asyncHandler(async (req, res) => {

    const folderId =
      req.query.folderId || null;


    // --------------------------------------------------
    // Check folder access
    // --------------------------------------------------

    if (folderId) {
      await ensureFolderAccess(
        req.user.id,
        folderId,
        'read'
      );
    }


    // --------------------------------------------------
    // Base query
    // --------------------------------------------------

    let query = supabase
      .from('files')
      .select(`
        id,
        name,
        mime_type,
        size_bytes,
        storage_key,
        owner_id,
        folder_id,
        is_deleted,
        created_at,
        updated_at
      `)
      .eq(
        'is_deleted',
        false
      );


    // --------------------------------------------------
    // Root files / folder files
    // --------------------------------------------------

    if (folderId) {

      query = query.eq(
        'folder_id',
        folderId
      );

    } else {

      query = query
        .is(
          'folder_id',
          null
        )
        .eq(
          'owner_id',
          req.user.id
        );

    }


    // --------------------------------------------------
    // Sort by name
    // --------------------------------------------------

    query = query.order(
      'name',
      {
        ascending: true
      }
    );


    const {
      data,
      error
    } = await query;


    if (error) {
      throw error;
    }


    res.json({
      files: data || []
    });

  })
);


// ======================================================
// UPLOAD FILE
// ======================================================
//
// POST /api/files
//
// multipart/form-data
//
// file      -> uploaded file
// folderId  -> optional folder ID
//

router.post(
  '/',
  upload.single('file'),

  asyncHandler(async (req, res) => {

    // --------------------------------------------------
    // Validate uploaded file
    // --------------------------------------------------

    if (!req.file) {
      throw apiError(
        400,
        'NO_FILE',
        'Choose a file to upload.'
      );
    }


    // --------------------------------------------------
    // Folder
    // --------------------------------------------------

    const folderId =
      req.body.folderId ||
      null;


    // --------------------------------------------------
    // Check folder permission
    // --------------------------------------------------

    if (folderId) {

      await ensureFolderAccess(
        req.user.id,
        folderId,
        'write'
      );

    }


    // --------------------------------------------------
    // Validate MIME type
    // --------------------------------------------------

    if (
      !allowedMimes.has(
        req.file.mimetype
      ) &&
      !req.file.mimetype.startsWith(
        'image/'
      )
    ) {

      throw apiError(
        400,
        'UNSUPPORTED_TYPE',
        'This file type is not allowed in the MVP.'
      );

    }


    // --------------------------------------------------
    // Generate file ID
    // --------------------------------------------------

    const fileId =
      crypto.randomUUID();


    // --------------------------------------------------
    // Clean filename
    // --------------------------------------------------

    const clean =
      safeName(
        req.file.originalname
      );


    // --------------------------------------------------
    // Extension
    // --------------------------------------------------

    const ext =
      path.extname(clean);


    // --------------------------------------------------
    // Storage key
    // --------------------------------------------------

    const storageKey =
      `tenants/${req.user.id}/files/` +
      `${fileId}-` +
      `${crypto.randomBytes(6).toString('hex')}` +
      `${ext}`;


    // --------------------------------------------------
    // SHA-256 checksum
    // --------------------------------------------------

    const checksum =
      crypto
        .createHash('sha256')
        .update(req.file.buffer)
        .digest('hex');


    // --------------------------------------------------
    // Upload to Supabase Storage
    // --------------------------------------------------

    const {
      error: uploadError
    } = await supabase
      .storage
      .from(env.bucket)
      .upload(
        storageKey,
        req.file.buffer,
        {
          contentType:
            req.file.mimetype,

          cacheControl:
            '3600',

          upsert:
            false
        }
      );


    if (uploadError) {
      throw uploadError;
    }


    // --------------------------------------------------
    // Insert database record
    // --------------------------------------------------

    const {
      data: file,
      error
    } = await supabase
      .from('files')
      .insert({

        id:
          fileId,

        name:
          clean,

        mime_type:
          req.file.mimetype,

        size_bytes:
          req.file.size,

        storage_key:
          storageKey,

        owner_id:
          req.user.id,

        folder_id:
          folderId,

        checksum

      })
      .select(`
        id,
        name,
        mime_type,
        size_bytes,
        storage_key,
        owner_id,
        folder_id,
        is_deleted,
        created_at,
        updated_at
      `)
      .single();


    // --------------------------------------------------
    // Roll back Storage upload if DB fails
    // --------------------------------------------------

    if (error) {

      await supabase
        .storage
        .from(env.bucket)
        .remove([
          storageKey
        ]);

      throw error;

    }


    // --------------------------------------------------
    // Activity
    // --------------------------------------------------

    await logActivity(
      req.user.id,
      'upload',
      'file',
      file.id,
      {
        name:
          file.name,

        sizeBytes:
          file.size_bytes
      }
    );


    res
      .status(201)
      .json({
        file
      });

  })
);


// ======================================================
// GET SINGLE FILE / PREVIEW
// ======================================================
//
// GET /api/files/:id
//
// IMPORTANT:
// This endpoint creates a signed URL WITHOUT the
// "download" parameter.
//
// Therefore the browser can open supported files
// such as PDF, PNG, JPG, TXT, etc. instead of
// forcing a download.
//

router.get(
  '/:id',

  asyncHandler(async (req, res) => {

    const {
      resource: file
    } = await ensureResourceAccess(
      req.user.id,
      'file',
      req.params.id,
      'read'
    );


    const {
      data: signed,
      error
    } = await supabase
      .storage
      .from(env.bucket)
      .createSignedUrl(
        file.storage_key,
        300
      );


    if (error) {
      throw error;
    }


    res.json({
      file,

      signedUrl:
        signed.signedUrl,

      openInBrowser:
        true
    });

  })
);


// ======================================================
// EXPLICIT PREVIEW URL
// ======================================================
//
// GET /api/files/:id/preview
//
// This route is intended specifically for double-click
// / open-file behavior on the frontend.
//

router.get(
  '/:id/preview',

  asyncHandler(async (req, res) => {

    const {
      resource: file
    } = await ensureResourceAccess(
      req.user.id,
      'file',
      req.params.id,
      'read'
    );


    const {
      data: signed,
      error
    } = await supabase
      .storage
      .from(env.bucket)
      .createSignedUrl(
        file.storage_key,
        300
      );


    if (error) {
      throw error;
    }


    res.json({
      url:
        signed.signedUrl,

      file: {
        id:
          file.id,

        name:
          file.name,

        mime_type:
          file.mime_type
      }
    });

  })
);


// ======================================================
// DOWNLOAD FILE
// ======================================================
//
// GET /api/files/:id/download
//
// This endpoint is ONLY for explicit downloading.
//

router.get(
  '/:id/download',

  asyncHandler(async (req, res) => {

    const {
      resource: file
    } = await ensureResourceAccess(
      req.user.id,
      'file',
      req.params.id,
      'read'
    );


    const {
      data: signed,
      error
    } = await supabase
      .storage
      .from(env.bucket)
      .createSignedUrl(
        file.storage_key,
        300,
        {
          download:
            file.name
        }
      );


    if (error) {
      throw error;
    }


    // --------------------------------------------------
    // Activity
    // --------------------------------------------------

    await logActivity(
      req.user.id,
      'download',
      'file',
      file.id,
      {
        name:
          file.name
      }
    );


    res.json({
      url:
        signed.signedUrl
    });

  })
);


// ======================================================
// RENAME / MOVE FILE
// ======================================================
//
// PATCH /api/files/:id
//
// Body:
//
// {
//   name?: string,
//   folderId?: string | null
// }
//

router.patch(
  '/:id',

  asyncHandler(async (req, res) => {

    const {
      resource: file
    } = await ensureResourceAccess(
      req.user.id,
      'file',
      req.params.id,
      'write'
    );


    const updates = {};


    // --------------------------------------------------
    // Rename
    // --------------------------------------------------

    if (
      req.body.name !== undefined
    ) {

      const newName =
        safeName(
          String(
            req.body.name
          )
        );


      if (!newName) {

        throw apiError(
          400,
          'INVALID_NAME',
          'File name cannot be empty.'
        );

      }


      updates.name =
        newName;

    }


    // --------------------------------------------------
    // Move
    // --------------------------------------------------

    if (
      req.body.folderId !== undefined
    ) {

      const newFolderId =
        req.body.folderId ||
        null;


      if (newFolderId) {

        await ensureFolderAccess(
          req.user.id,
          newFolderId,
          'write'
        );

      }


      updates.folder_id =
        newFolderId;

    }


    // --------------------------------------------------
    // Validate updates
    // --------------------------------------------------

    if (
      !Object.keys(updates).length
    ) {

      throw apiError(
        400,
        'INVALID_INPUT',
        'No valid changes supplied.'
      );

    }


    updates.updated_at =
      new Date().toISOString();


    // --------------------------------------------------
    // Update database
    // --------------------------------------------------

    const {
      data,
      error
    } = await supabase
      .from('files')
      .update(updates)
      .eq(
        'id',
        file.id
      )
      .select(`
        id,
        name,
        mime_type,
        size_bytes,
        storage_key,
        owner_id,
        folder_id,
        is_deleted,
        created_at,
        updated_at
      `)
      .single();


    if (error) {
      throw error;
    }


    // --------------------------------------------------
    // Activity
    // --------------------------------------------------

    await logActivity(
      req.user.id,

      req.body.folderId !==
      undefined
        ? 'move'
        : 'rename',

      'file',

      file.id,

      {
        oldName:
          file.name,

        newName:
          data.name
      }
    );


    res.json({
      file:
        data
    });

  })
);


// ======================================================
// DELETE FILE
// ======================================================
//
// DELETE /api/files/:id
//
// Soft delete only.
//

router.delete(
  '/:id',

  asyncHandler(async (req, res) => {

    const {
      resource: file
    } = await ensureResourceAccess(
      req.user.id,
      'file',
      req.params.id,
      'write'
    );


    const {
      error
    } = await supabase
      .from('files')
      .update({

        is_deleted:
          true,

        updated_at:
          new Date().toISOString()

      })
      .eq(
        'id',
        file.id
      );


    if (error) {
      throw error;
    }


    // --------------------------------------------------
    // Activity
    // --------------------------------------------------

    await logActivity(
      req.user.id,
      'delete',
      'file',
      file.id,
      {
        name:
          file.name
      }
    );


    res.json({
      ok:
        true
    });

  })
);


module.exports = router;