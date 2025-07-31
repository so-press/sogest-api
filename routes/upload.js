import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import AWS from 'aws-sdk';
import fs from 'fs';
import path from 'path';
import { handleResponse } from '../inc/response.js';

dotenv.config();
const router = express.Router();
export const routePath = '/upload';
export const requireAuth = true;

// Read allowed mime types from config
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

const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  accessKeyId: process.env.S3_ACCESS_KEY,
  secretAccessKey: process.env.S3_SECRET_KEY,
  s3ForcePathStyle: true
});

/**
 * @api {post} /upload Upload a file to S3 storage
 * @apiName UploadFile
 * @apiGroup Upload
 * @apiUse JwtHeader
 * @apiBody {File} file File payload
 * @apiBody {String} [folder] Folder path in the bucket
 * @apiBody {String} [name] Desired file name
 * @apiSuccess {String} url Public URL of the uploaded file
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

  // Sanitize folder and filename to avoid path traversal
  const folder = (req.body.folder || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.\./g, '');
  const name = path.basename(req.body.name || req.file.originalname);
  const key = folder ? `${folder}/${name}` : name;

  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: req.file.buffer,
    ContentType: req.file.mimetype
  };

  await s3.upload(params).promise();
  const baseUrl = process.env.S3_PUBLIC_URL || `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}`;
  return { url: `${baseUrl}/${key}` };
}));

export default router;
