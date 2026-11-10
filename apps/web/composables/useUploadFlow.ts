import { ref } from 'vue';
import type {
  UploadCreateRequest,
  UploadCreateResponse,
} from '@flowvis/contracts';
import { resolveApiErrorMessageVi, uploadPresignedFile } from '../utils/api-client.ts';

export interface UploadFlowClient {
  createUpload(
    request: UploadCreateRequest,
    options?: { signal?: AbortSignal },
  ): Promise<UploadCreateResponse>;
}

export type UploadFlowResult<T> =
  | { status: 'ok'; key: string; data: T }
  | { status: 'aborted' }
  | { status: 'error'; messageVi: string };

export interface UploadFlowStartOptions<T> {
  file: File | Blob;
  declaration: UploadCreateRequest;
  /** Gọi bước xác nhận (ảnh hoặc video) sau khi PUT thành công. */
  confirm: (key: string, options: { signal: AbortSignal }) => Promise<T>;
}

/**
 * Luồng tải lên dùng chung: createUpload -> PUT presigned -> confirm,
 * kèm tiến trình, hủy và xử lý lỗi tiếng Việt. Mỗi nơi tự lo kiểm tra và hiển thị.
 */
export function useUploadFlow(client: UploadFlowClient) {
  const progress = ref(0);
  let controller: AbortController | null = null;

  function cancel(): void {
    if (controller) {
      controller.abort();
      controller = null;
    }
  }

  function reset(): void {
    cancel();
    progress.value = 0;
  }

  async function start<T>(
    options: UploadFlowStartOptions<T>,
  ): Promise<UploadFlowResult<T>> {
    const { file, declaration, confirm } = options;
    cancel();
    progress.value = 0;
    const own = new AbortController();
    controller = own;
    const signal = own.signal;
    try {
      const createRes = await client.createUpload(declaration, { signal });
      if (signal.aborted) return { status: 'aborted' };

      await uploadPresignedFile({
        uploadUrl: createRes.uploadUrl,
        headers: createRes.headers,
        file,
        signal,
        onProgress: (percent) => {
          if (controller === own) progress.value = percent;
        },
      });
      if (signal.aborted) return { status: 'aborted' };

      const data = await confirm(createRes.key, { signal });
      if (signal.aborted) return { status: 'aborted' };

      progress.value = 100;
      return { status: 'ok', key: createRes.key, data };
    } catch (error: unknown) {
      if (signal.aborted) return { status: 'aborted' };
      return { status: 'error', messageVi: resolveApiErrorMessageVi(error) };
    } finally {
      if (controller === own) controller = null;
    }
  }

  return { progress, start, cancel, reset };
}
