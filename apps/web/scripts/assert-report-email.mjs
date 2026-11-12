// Kiểm tra email báo cáo vi phạm cho build production.
export function assertReportEmail(value, nodeEnv) {
  if (nodeEnv !== 'production') return;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      'Thiếu biến môi trường NUXT_PUBLIC_REPORT_EMAIL (email nhận báo cáo vi phạm) cho build production.',
    );
  }
}
