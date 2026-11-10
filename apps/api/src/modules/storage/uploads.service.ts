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
  type UploadConfirmVideoResponse,
  type UploadCreateRequest,
  type ValidationReason,
  type UploadCreateResponse,
} from '@flowvis/contracts';
import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { FORMAT_TO_MIME, displaySize } from './image-utils.js';
import { MIN_VIDEO_SECONDS, VideoProbeService } from './video-probe.service.js';
import { PrismaService } from '../../infra/prisma.service.js';
import {
  STORAGE_PORT,
  StoragePreconditionFailedError,
  type StoragePort,
} from '../../ports/index.js';

export const PRESIGN_TTL_SECONDS = 10 * 60;
export const PENDING_WINDOW_MS = 24 * 60 * 60 * 1000;
export const VIDEO_PROBE_URL_TTL_SECONDS = 60;
export const MAX_IMAGE_LONG_SIDE_PX = 2048;
/** `in/` bị xóa sau 7 ngày (lifecycle R2); chừa 1 giờ biên an toàn. */
export const CONFIRMED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;

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
    private readonly videoProbe: VideoProbeService,
  ) {}

  async create(userId: string, req: UploadCreateRequest): Promise<UploadCreateResponse> {
    const uuid = crypto.randomUUID();
    const key = `in-raw/${userId}/${uuid}`;

    // Ký trước khi ghi DB: lỗi ký không để lại bản ghi pending chiếm hạn mức.
    const presigned = await this.storage.presignPut({
      key,
      contentType: req.mimeType,
      contentLength: req.sizeBytes,
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    });

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
          `Bạn có quá nhiều tệp tạm chưa xác nhận (tối đa ${MAX_UNCONFIRMED_RAW_UPLOADS}). Hãy hoàn tất hoặc đợi các tệp tạm hết hạn rồi thử lại.`,
        );
      }
      await tx.upload.create({
        data: {
          userId,
          key,
          kind: req.mimeType.startsWith('video/') ? 'video' : 'image',
          mimeType: req.mimeType,
          declaredBytes: req.sizeBytes,
        },
      });
    });

    return {
      key,
      method: 'PUT',
      uploadUrl: presigned.url,
      headers: presigned.headers,
      expiresAt: presigned.expiresAt.toISOString(),
    };
  }

  private async rejectInvalid(
    rawKey: string,
    message: string,
    reason?: ValidationReason,
  ): Promise<never> {
    // Đánh dấu expired trước: nếu xóa đối tượng lỗi thì lifecycle in-raw/ dọn sau,
    // còn bản ghi không bị kẹt pending trỏ tới đối tượng đã mất.
    await this.prisma.upload.updateMany({
      where: { key: rawKey, status: 'pending' },
      data: { status: 'expired' },
    });
    try {
      await this.storage.delete(rawKey);
    } catch (err) {
      this.logger.warn(`Không xóa được đối tượng ${rawKey}: ${String(err)}`);
    }
    throw new BadRequestException({
      code: ApiErrorCode.VALIDATION_FAILED,
      message,
      ...(reason ? { details: { reason } } : {}),
    });
  }

  private async confirmVideo(
    userId: string,
    upload: { key: string; declaredBytes: number; mimeType: string },
    head: { sizeBytes: number; etag: string },
  ): Promise<UploadConfirmVideoResponse> {
    const rawKey = upload.key;
    // URL ký ngắn hạn do server tạo từ khóa đã kiểm đúng chủ; ffprobe không nhận tên file người dùng.
    const verdict = await this.videoProbe.probeUrl(() =>
      this.storage.presignGet(rawKey, VIDEO_PROBE_URL_TTL_SECONDS),
    );
    if (!verdict.ok) {
      return this.rejectInvalid(
        rawKey,
        verdict.reason === 'VIDEO_TOO_SHORT'
          ? `Video quá ngắn, cần dài tối thiểu ${MIN_VIDEO_SECONDS} giây.`
          : 'Không đọc được video. Hãy dùng tệp MP4 hoặc MOV hợp lệ.',
        verdict.reason,
      );
    }
    const { durationSeconds, width, height } = verdict.meta;
    const confirmedKey = `in/${userId}/${rawKey.split('/')[2]}`;
    try {
      await this.storage.copyIfMatch(rawKey, confirmedKey, head.etag);
    } catch (err) {
      if (err instanceof StoragePreconditionFailedError) throw apiError(ConflictException, ApiErrorCode.CONFLICT);
      throw err;
    }
    const updated = await this.prisma.upload.updateMany({
      where: { key: rawKey, status: 'pending' },
      data: {
        status: 'confirmed',
        confirmedKey,
        sizeBytes: head.sizeBytes,
        etag: head.etag,
        width,
        height,
        durationSeconds,
        confirmedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw apiError(ConflictException, ApiErrorCode.CONFLICT);
    return {
      key: confirmedKey,
      video: {
        mimeType: upload.mimeType as 'video/mp4' | 'video/quicktime',
        sizeBytes: head.sizeBytes,
        durationSeconds,
        width,
        height,
      },
    } as UploadConfirmVideoResponse;
  }

  async confirm(userId: string, rawKey: string): Promise<UploadConfirmResponse | UploadConfirmVideoResponse> {
    const upload = await this.prisma.upload.findUnique({ where: { key: rawKey } });
    if (!upload) throw apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    if (upload.userId !== userId) throw apiError(ForbiddenException, ApiErrorCode.FORBIDDEN);
    if (upload.status !== 'pending') throw apiError(ConflictException, ApiErrorCode.CONFLICT);

    const isVideo = upload.kind === 'video';
    const head = await this.storage.head(rawKey);
    if (!head) {
      throw apiError(
        BadRequestException,
        ApiErrorCode.VALIDATION_FAILED,
        isVideo
          ? 'Chưa tìm thấy video đã tải lên. Vui lòng tải video lên trước khi xác nhận.'
          : 'Chưa tìm thấy ảnh đã tải lên. Vui lòng tải ảnh lên trước khi xác nhận.',
      );
    }
    if (head.sizeBytes !== upload.declaredBytes) {
      return this.rejectInvalid(
        rawKey,
        isVideo
          ? 'Dung lượng video tải lên không khớp với khai báo.'
          : 'Dung lượng ảnh tải lên không khớp với khai báo.',
      );
    }
    if (isVideo) return this.confirmVideo(userId, upload, head);

    let width: number;
    let height: number;
    let finalHead = head;
    let body: Buffer;
    try {
      // Ghim ETag: object bị ghi đè sau HEAD thì không đọc/giải mã byte lạ.
      body = await this.storage.getObject(rawKey, undefined, head.etag);
    } catch (err) {
      if (err instanceof StoragePreconditionFailedError) throw apiError(ConflictException, ApiErrorCode.CONFLICT);
      throw err;
    }
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
    // EXIF orientation 5-8 hoán đổi chiều ngang/dọc khi hiển thị; kiểm tra và báo cáo theo kích thước sau xoay.
    ({ width, height } = displaySize(meta));
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

  /** Trả true khi mọi khóa `in/` đều thuộc userId và đã confirmed (AD-1: chỉ storage đọc bảng uploads). */
  async areConfirmedKeysOwnedBy(
    userId: string,
    keys: string[],
    kind: 'image' | 'video' = 'image',
  ): Promise<boolean> {
    const unique = [...new Set(keys)];
    const rows = await this.prisma.upload.findMany({
      where: {
        userId,
        status: 'confirmed',
        kind,
        confirmedKey: { in: unique },
        OR: [{ confirmedAt: null }, { confirmedAt: { gte: new Date(Date.now() - CONFIRMED_RETENTION_MS) } }],
      },
      select: { confirmedKey: true },
    });
    return rows.length === unique.length;
  }

  /** Độ dài (giây, đã đo bằng ffprobe) của video `in/` đã xác nhận, còn hạn, của chủ; null nếu không hợp lệ. */
  async getConfirmedVideoDuration(userId: string, key: string): Promise<number | null> {
    const row = await this.prisma.upload.findFirst({
      where: {
        userId,
        status: 'confirmed',
        kind: 'video',
        confirmedKey: key,
        OR: [{ confirmedAt: null }, { confirmedAt: { gte: new Date(Date.now() - CONFIRMED_RETENTION_MS) } }],
      },
      select: { durationSeconds: true },
    });
    const d = row?.durationSeconds;
    return typeof d === 'number' && Number.isInteger(d) && d > 0 ? d : null;
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
