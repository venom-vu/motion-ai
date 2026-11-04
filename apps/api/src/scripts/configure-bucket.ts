import {
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';
import {
  createR2Client,
  getBucketName,
} from '../modules/storage/s3-storage.adapter.js';

/**
 * Cấu hình bucket R2 (idempotent, chạy thủ công): CORS chỉ cho FRONTEND_URL,
 * lifecycle in-raw/ 1 ngày và in/ 7 ngày. Bucket giữ riêng tư (không bật public access/domain).
 */
async function main(): Promise<void> {
  const bucket = getBucketName();
  if (!bucket) throw new Error('Thiếu R2_BUCKET');
  const origins = (process.env.FRONTEND_URL ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const client = createR2Client();

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            AllowedMethods: ['PUT', 'GET', 'HEAD'],
            AllowedHeaders: ['content-type', 'content-length'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: 'expire-in-raw-1d',
            Status: 'Enabled',
            Filter: { Prefix: 'in-raw/' },
            Expiration: { Days: 1 },
          },
          {
            ID: 'expire-in-7d',
            Status: 'Enabled',
            Filter: { Prefix: 'in/' },
            Expiration: { Days: 7 },
          },
        ],
      },
    }),
  );
  console.log(JSON.stringify({ status: 'ok', bucket, corsOrigins: origins }));
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
