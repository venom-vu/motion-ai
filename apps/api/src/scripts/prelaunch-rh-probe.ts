import {
  RUNNINGHUB_DEFAULT_HOST,
  RunningHubOpenApiAdapter,
} from '../modules/tasks/runninghub-openapi.adapter.js';

/**
 * Bước 3 cổng trước khi bật VietQR (Story 6.11): gọi endpoint số dư RunningHub đúng cách adapter thật gọi
 * (POST, Bearer + `apiKey` trong body), in host, endpoint, HTTP status và phản hồi thô đã che khóa,
 * rồi thử `RunningHubOpenApiAdapter.getBalance()` để xác nhận adapter đọc được phản hồi.
 * Thoát 0 đạt, 1 lỗi HTTP/phản hồi không đọc được, 2 thiếu cấu hình.
 */
const MAX_RAW = 4000;
const TIMEOUT_MS = 15_000;

function mask(text: string, apiKey: string): string {
  let s = text;
  if (apiKey.length >= 4) s = s.split(apiKey).join('***');
  return s.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1***');
}

async function main(): Promise<number> {
  process.env.MOTION_PROCESS_ROLE = 'script';
  const apiKey = process.env.RUNNINGHUB_API_KEY?.trim() ?? '';
  const endpoint = process.env.RH_BALANCE_ENDPOINT?.trim() ?? '';
  const missing = [!apiKey && 'RUNNINGHUB_API_KEY', !endpoint && 'RH_BALANCE_ENDPOINT'].filter(Boolean);
  if (missing.length > 0) {
    console.error(`Thiếu biến môi trường: ${missing.join(', ')}.`);
    console.log(JSON.stringify({ ok: false, error: 'CONFIG', missing }));
    return 2;
  }
  const host = (process.env.RUNNINGHUB_API_HOST?.trim() || RUNNINGHUB_DEFAULT_HOST).replace(/\/+$/, '');
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  const started = performance.now();
  let httpStatus: number | null = null;
  let rawResponse = '';
  let rateLimitHeaders: Record<string, string> = {};
  let fetchError: string | null = null;
  try {
    const res = await fetch(`${host}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ apiKey }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    httpStatus = res.status;
    rawResponse = await res.text();
    rateLimitHeaders = Object.fromEntries(
      [...res.headers.entries()].filter(([k]) => /rate|limit|retry/i.test(k)),
    );
  } catch (err) {
    fetchError = `${(err as Error).name}: ${mask((err as Error).message, apiKey)}`;
  }
  const latencyMs = Math.round(performance.now() - started);

  let adapterCoins: number | null = null;
  let adapterError: string | null = null;
  if (!fetchError && httpStatus !== null && httpStatus < 400) {
    try {
      adapterCoins = await new RunningHubOpenApiAdapter(apiKey, host).getBalance(AbortSignal.timeout(TIMEOUT_MS));
    } catch (err) {
      adapterError = mask((err as Error).message, apiKey);
    }
  }

  const ok = !fetchError && httpStatus !== null && httpStatus < 400 && adapterCoins !== null;
  const masked = mask(rawResponse, apiKey);
  console.log(
    JSON.stringify({
      ok,
      host,
      endpoint: path,
      method: 'POST',
      httpStatus,
      latencyMs,
      rawResponse: masked.length > MAX_RAW ? `${masked.slice(0, MAX_RAW)}…` : masked,
      rateLimitHeaders,
      adapterCoins,
      ...(adapterError ? { adapterError } : {}),
      ...(fetchError ? { fetchError } : {}),
    }),
  );
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : 'prelaunch-rh-probe lỗi');
    process.exit(2);
  },
);
