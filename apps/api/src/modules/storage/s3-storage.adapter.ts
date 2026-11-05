import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import {
  StoragePreconditionFailedError,
  type StorageHeadResult,
  type StoragePort,
  type StoragePresignPutInput,
  type StoragePresignPutResult,
} from '../../ports/index.js';

export function createR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint =
    process.env.R2_ENDPOINT ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
    // R2 không hỗ trợ checksum mặc định mới của SDK trên presigned PUT.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export function getBucketName(): string {
  return process.env.R2_BUCKET ?? '';
}

function errorName(err: unknown): string {
  return (err as { name?: string })?.name ?? '';
}
function errorStatus(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
}

@Injectable()
export class S3StorageAdapter implements StoragePort {
  readonly portName = 'StoragePort' as const;
  private client?: S3Client;

  private get s3(): S3Client {
    this.client ??= createR2Client();
    return this.client;
  }

  async presignPut(input: StoragePresignPutInput): Promise<StoragePresignPutResult> {
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: getBucketName(),
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      }),
      {
        expiresIn: input.expiresInSeconds,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return {
      url,
      headers: { 'Content-Type': input.contentType },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async head(key: string): Promise<StorageHeadResult | null> {
    try {
      const res = await this.s3.send(
        new HeadObjectCommand({ Bucket: getBucketName(), Key: key }),
      );
      return {
        sizeBytes: Number(res.ContentLength ?? 0),
        etag: res.ETag ?? '',
        contentType: res.ContentType,
      };
    } catch (err) {
      if (errorName(err) === 'NotFound' || errorStatus(err) === 404) return null;
      throw err;
    }
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: getBucketName(), Key: key }),
    );
    if (!res.Body) throw new Error('Đối tượng rỗng');
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async presignGet(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: getBucketName(), Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<string> {
    const res = await this.s3.send(
      new PutObjectCommand({
        Bucket: getBucketName(),
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    if (!res.ETag) throw new Error('PutObject không trả ETag');
    return res.ETag;
  }

  async copyIfMatch(sourceKey: string, destKey: string, etag: string): Promise<void> {
    try {
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: getBucketName(),
          Key: destKey,
          CopySource: `${getBucketName()}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
          CopySourceIfMatch: etag,
        }),
      );
    } catch (err) {
      if (errorName(err) === 'PreconditionFailed' || errorStatus(err) === 412) {
        throw new StoragePreconditionFailedError();
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: getBucketName(), Key: key }));
  }
}
