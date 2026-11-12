import type { LegalDocument } from './terms';

export const privacy: LegalDocument = {
  version: '2026-11-01',
  status: 'draft',
  title: 'Chính sách quyền riêng tư',
  sections: [
    {
      heading: '1. Dữ liệu chúng tôi thu thập',
      paragraphs: [
        'Địa chỉ email từ tài khoản Google đăng nhập; giá trị băm của địa chỉ IP và thiết bị (phục vụ chống lạm dụng, không lưu IP gốc); ảnh, video bạn tải lên và kết quả được tạo; lịch sử tác vụ, giao dịch credit và nạp tiền; thời điểm và phiên bản Điều khoản bạn đã đồng ý.',
      ],
    },
    {
      heading: '2. Mục đích sử dụng',
      paragraphs: [
        'Dữ liệu chỉ dùng để cung cấp dịch vụ, tính phí credit, chống gian lận và xử lý báo cáo vi phạm. Nội dung tải lên được gửi tới nhà cung cấp GPU để xử lý.',
      ],
    },
    {
      heading: '3. Thời hạn lưu trữ',
      paragraphs: [
        'Ảnh, video đầu vào tự động xóa sau 7 ngày. Kết quả tự động xóa sau 30 ngày kể từ khi tạo.',
      ],
    },
    {
      heading: '4. Liên kết chia sẻ',
      paragraphs: [
        'Khi bạn tạo liên kết chia sẻ kết quả, bất kỳ ai có token trong liên kết đều xem được kết quả đó cho đến khi bạn thu hồi hoặc kết quả hết hạn. Hãy chỉ chia sẻ với người bạn tin tưởng.',
      ],
    },
    {
      heading: '5. Liên hệ',
      paragraphs: [
        'Để yêu cầu xóa dữ liệu hoặc báo cáo vấn đề quyền riêng tư, dùng liên kết “Báo cáo vi phạm” ở chân trang để gửi email tới chúng tôi.',
      ],
    },
  ],
};
