import crypto from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiErrorCode,
  ImageMetaSchema,
  MAX_UNCONFIRMED_RAW_UPLOADS,
  getApiErrorMessageVi,
  type UploadConfirmResponse,
  type UploadCreateRequest,
  type UploadCreateResponse,
} from '@motion-ai/contracts';
import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { PrismaService } from '../../infra/prisma.service.js';
import {
  STORAGE_PORT,
  StoragePreconditionFailedError,
  type StoragePort,
} from '../../ports/index.js';

export const PRESIGN_TTL_SECONDS = 10 * 60;
export const PENDING_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_IMAGE_LONG_SIDE_PX = 2048;

const FORMAT_TO_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function apiError(
  Ctor: new (body: { code: ApiErrorCode; message: string }) => Error,
  code: ApiErrorCode,
  message?: string,
): Error {
  return new Ctor({ code, message: message ?? getApiErrorMessageVi(code) });
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async create(userId: string, req: UploadCreateRequest): Promise<UploadCreateResponse> {
    const uuid = crypto.randomUUID();
    const key = `in-raw/${userId}/${uuid}`;

    await this.prisma.$transaction(async (tx) => {
      // Khóa dòng user để hai request song song không cùng vượt giới hạn.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const since = new Date(Date.now() - PENDING_WINDOW_MS);
      const pending = await tx.upload.count({
        where: { userId, status: 'pending', createdAt: { gt: since } },
      });
      if (pending >= MAX_UNCONFIRMED_RAW_UPLOADS) {
        throw apiError(
          BadRequestException,
          ApiErrorCode.VALIDATION_FAILED,
          `Bạn có quá nhiều ảnh tạm chưa xác nhận (tối đa ${MAX_UNCONFIRMED_RAW_UPLOADS}). Hãy hoàn tất hoặc đợi các ảnh tạm hết hạn rồi thử lại.`,
        );
      }
      await tx.upload.create({
        data: {
          userId,
          key,
          kind: 'image',
          mimeType: req.mimeType,
          declaredBytes: req.sizeBytes,
        },
      });
    });

    let presigned;
    try {
      presigned = await this.storage.presignPut({
        key,
        contentType: req.mimeType,
        contentLength: req.sizeBytes,
        expiresInSeconds: PRESIGN_TTL_SECONDS,
      });
    } catch (err) {
      await this.prisma.upload.updateMany({
        where: { key, status: 'pending' },
        data: { status: 'expired' },
      });
      throw err;
    }
    return {
      key,
      method: 'PUT',
      uploadUrl: presigned.url,
      headers: presigned.headers,
      expiresAt: presigned.expiresAt.toISOString(),
    };
  }

  private async rejectInvalid(rawKey: string, message: string): Promise<never> {
    try {
      await this.storage.delete(rawKey);
    } catch (err) {
      this.logger.warn(`Không xóa được đối tượng ${rawKey}: ${String(err)}`);
    }
    await this.prisma.upload.updateMany({
      where: { key: rawKey, status: 'pending' },
      data: { status: 'expired' },
    });
    throw apiError(BadRequestException, ApiErrorCode.VALIDATION_FAILED, message);
  }

  async confirm(userId: string, rawKey: string): Promise<UploadConfirmResponse> {
    const upload = await this.prisma.upload.findUnique({ where: { key: rawKey } });
    if (!upload) throw apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    if (upload.userId !== userId) throw apiError(ForbiddenException, ApiErrorCode.FORBIDDEN);
    if (upload.status !== 'pending') throw apiError(ConflictException, ApiErrorCode.CONFLICT);

    const head = await this.storage.head(rawKey);
    if (!head) {
      throw apiError(
        BadRequestException,
        ApiErrorCode.VALIDATION_FAILED,
        'Chưa tìm thấy ảnh đã tải lên. Vui lòng tải ảnh lên trước khi xác nhận.',
      );
    }
    if (head.sizeBytes !== upload.declaredBytes) {
      return this.rejectInvalid(rawKey, 'Dung lượng ảnh tải lên không khớp với khai báo.');
    }

    let width: number;
    let height: number;
    let finalHead = head;
    const body = await this.storage.getObject(rawKey);
    let meta: Metadata;
    try {
      meta = await sharp(body).metadata();
    } catch {
      return this.rejectInvalid(rawKey, 'Tệp tải lên không phải ảnh hợp lệ.');
    }
    if (
      !meta.format ||
      FORMAT_TO_MIME[meta.format] !== upload.mimeType ||
      !meta.width ||
      !meta.height
    ) {
      return this.rejectInvalid(rawKey, 'Tệp tải lên không phải ảnh hợp lệ.');
    }
    width = meta.width;
    height = meta.height;
    const pre = ImageMetaSchema.safeParse({
      mimeType: upload.mimeType,
      sizeBytes: head.sizeBytes,
      width,
      height,
    });
    if (!pre.success) {
      return this.rejectInvalid(
        rawKey,
        pre.error.issues[0]?.message ?? getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      );
    }
    if (Math.max(width, height) > MAX_IMAGE_LONG_SIDE_PX) {
      let resized: { data: Buffer; info: OutputInfo };
      try {
        resized = await sharp(body)
          .rotate()
          .resize({
            width: MAX_IMAGE_LONG_SIDE_PX,
            height: MAX_IMAGE_LONG_SIDE_PX,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .toBuffer({ resolveWithObject: true });
      } catch {
        return this.rejectInvalid(rawKey, 'Tệp tải lên không phải ảnh hợp lệ.');
      }
      // ETag lấy từ phản hồi PutObject, không HEAD lại: tránh nhận byte do client ghi đè sau khi đã kiểm tra.
      const storedEtag = await this.storage.putObject(rawKey, resized.data, upload.mimeType);
      width = resized.info.width;
      height = resized.info.height;
      finalHead = { sizeBytes: resized.data.length, etag: storedEtag };
    }

    const image = ImageMetaSchema.safeParse({
      mimeType: upload.mimeType,
      sizeBytes: finalHead.sizeBytes,
      width,
      height,
    });
    if (!image.success) {
      return this.rejectInvalid(
        rawKey,
        image.error.issues[0]?.message ?? getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      );
    }

    const confirmedKey = `in/${userId}/${rawKey.split('/')[2]}`;
    try {
      await this.storage.copyIfMatch(rawKey, confirmedKey, finalHead.etag);
    } catch (err) {
      if (err instanceof StoragePreconditionFailedError) {
        throw apiError(ConflictException, ApiErrorCode.CONFLICT);
      }
      throw err;
    }

    const updated = await this.prisma.upload.updateMany({
      where: { key: rawKey, status: 'pending' },
      data: {
        status: 'confirmed',
        confirmedKey,
        sizeBytes: finalHead.sizeBytes,
        etag: finalHead.etag,
        width,
        height,
        confirmedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw apiError(ConflictException, ApiErrorCode.CONFLICT);

    return { key: confirmedKey, image: image.data } as UploadConfirmResponse;
  }

  /** Chuyển bản ghi pending quá 24 giờ sang expired. Trả số bản ghi đã chuyển. */
  async expireStalePending(now: Date = new Date()): Promise<number> {
    const res = await this.prisma.upload.updateMany({
      where: { status: 'pending', createdAt: { lte: new Date(now.getTime() - PENDING_WINDOW_MS) } },
      data: { status: 'expired' },
    });
    return res.count;
  }
}
