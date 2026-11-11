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
 * lifecycle in-raw/ 1 ngày, in/ 7 ngày và out/ 30 ngày. Bucket giữ riêng tư (không bật public access/domain).
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
            AllowedHeaders: ['content-type', 'content-length', 'range', 'if-none-match'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  // Mỗi quy tắc lifecycle dưới đây chỉ theo tiền tố riêng (in-raw/, in/, out/) nên không áp dụng
  // cho db-backup/; bản sao lưu chỉ bị xóa bởi job giữ 7 bản. Không thêm quy tắc theo toàn bucket.
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
          {
            ID: 'expire-out-30d',
            Status: 'Enabled',
            Filter: { Prefix: 'out/' },
            Expiration: { Days: 30 },
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
