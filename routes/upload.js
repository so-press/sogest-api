import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { handleResponse } from '../inc/core/response.js';

dotenv.config();
const router = express.Router();
export const routePath = '/upload';
export const requireAuth = true;

let allowedTypes = [];
try {
  const conf = JSON.parse(fs.readFileSync('./config/config.json'));
  if (Array.isArray(conf.allowedFileTypes)) {
    allowedTypes = conf.allowedFileTypes;
  }
} catch (err) {
  // ignore if config missing
}

const upload = multer({ storage: multer.memoryStorage() });

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY
  },
  forcePathStyle: true
});

/**
 * @openapi
 * /upload:
 *   post:
 *     tags: [Upload]
 *     summary: Upload d'un fichier vers le stockage S3
 *     security:
 *       - jwtAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:   { type: string, format: binary }
 *               folder: { type: string, description: Dossier dans le bucket }
 *               name:   { type: string, description: Nom de fichier souhaité }
 *     responses:
 *       200:
 *         description: Upload réussi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string, format: uri }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       409: { description: Un fichier portant ce nom existe déjà sur S3 }
 */
router.post('/', upload.single('file'), handleResponse(async (req, res) => {

  if (!req.file) {
    res.status(400);
    throw new Error('No file provided');
  }

  if (allowedTypes.length && !allowedTypes.includes(req.file.mimetype)) {
    res.status(400);
    throw new Error('Invalid file type');
  }

  const folder = (req.body.folder || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.\./g, '');
  const name = path.basename(req.body.name || req.file.originalname);
  const key = folder ? `${folder}/${name}` : name;

  // Check if file already exists on S3
  let exists = false;
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key
    }));
    exists = true;
  } catch (err) {
    if (err.name !== 'NotFound') {
      throw err; // other errors, like permission denied
    }
  }

  if (exists) {
    res.status(409);
    throw new Error('File already exists on S3');
  }

  const command = new PutObjectCommand({
    ACL: 'public-read',
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: req.file.buffer,
    ContentType: req.file.mimetype
  });

  await s3.send(command);

  const baseUrl = process.env.S3_PUBLIC_URL || `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}`;
  return { url: `${baseUrl}/${key}` };
}));

export default router;
