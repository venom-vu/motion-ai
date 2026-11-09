/** CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF) theo EMVCo, trả về 4 ký tự hex in hoa. */
export function crc16(input: string): string {
  let crc = 0xffff;
  const bytes = Buffer.from(input, 'utf8');
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(tag: string, value: string): string {
  const len = Buffer.byteLength(value, 'utf8');
  if (len > 99) throw new Error(`Giá trị tag ${tag} quá dài`);
  return `${tag}${String(len).padStart(2, '0')}${value}`;
}

export interface VietQrInput {
  bin: string;
  accountNo: string;
  amountVnd: number;
  content: string;
}

/** Sinh chuỗi VietQR (EMVCo, chuyển nhanh NAPAS 247 tới số tài khoản). Hàm thuần, không gọi dịch vụ ngoài. */
export function buildVietQrPayload(input: VietQrInput): string {
  if (!Number.isInteger(input.amountVnd) || input.amountVnd <= 0) throw new Error('Số tiền không hợp lệ');
  const consumer = tlv('00', input.bin) + tlv('01', input.accountNo);
  const merchant = tlv('00', 'A000000727') + tlv('01', consumer) + tlv('02', 'QRIBFTTA');
  const body =
    tlv('00', '01') +
    tlv('01', '12') +
    tlv('38', merchant) +
    tlv('53', '704') +
    tlv('54', String(input.amountVnd)) +
    tlv('58', 'VN') +
    tlv('62', tlv('08', input.content)) +
    '6304';
  return body + crc16(body);
}
