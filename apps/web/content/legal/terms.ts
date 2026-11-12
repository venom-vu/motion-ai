export type LegalStatus = 'draft' | 'final';

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  version: string;
  status: LegalStatus;
  title: string;
  sections: LegalSection[];
}

export const terms: LegalDocument = {
  version: '2026-11-01',
  status: 'draft',
  title: 'Điều khoản dịch vụ',
  sections: [
    {
      heading: '1. Điều kiện sử dụng',
      paragraphs: [
        'Bạn xác nhận đủ 18 tuổi trở lên khi tạo tài khoản và sử dụng flowvis. Việc đồng ý Điều khoản được ghi nhận kèm thời điểm và phiên bản; khi Điều khoản đổi phiên bản, bạn sẽ được yêu cầu đồng ý lại.',
      ],
    },
    {
      heading: '2. Quyền sở hữu hình ảnh và video tải lên',
      paragraphs: [
        'Bạn cam kết sở hữu hoặc được cấp quyền hợp pháp đối với mọi hình ảnh, video tải lên, và được phép cho chúng tôi xử lý các nội dung đó bằng công cụ AI để tạo kết quả cho bạn.',
      ],
    },
    {
      heading: '3. Người xuất hiện trong nội dung',
      paragraphs: [
        'Mọi người xuất hiện trong nội dung tải lên phải đủ 18 tuổi. Người có khuôn mặt được sử dụng (ví dụ trong Face Swap) phải đã đồng ý rõ ràng cho việc xử lý và tạo nội dung từ hình ảnh của họ.',
      ],
    },
    {
      heading: '4. Nội dung bị cấm',
      paragraphs: [
        'Nghiêm cấm tạo hoặc tải lên nội dung khiêu dâm, nội dung bôi nhọ, xúc phạm, giả mạo danh tính để lừa đảo hoặc nội dung vi phạm pháp luật, xâm phạm quyền của người khác.',
      ],
    },
    {
      heading: '5. Nội dung do AI tạo ra',
      paragraphs: [
        'Ảnh kết quả được ghi dấu siêu dữ liệu EXIF “Software: AI Generator”. Bạn tự chịu trách nhiệm về việc sử dụng và chia sẻ kết quả.',
      ],
    },
    {
      heading: '6. Credit và nạp tiền',
      paragraphs: [
        'Credit được tạm giữ khi tạo tác vụ và hoàn lại đầy đủ nếu tác vụ thất bại. Đơn nạp tiền được duyệt sau khi đối soát chuyển khoản; vui lòng nhập đúng nội dung chuyển khoản.',
      ],
    },
    {
      heading: '7. Miễn trừ trách nhiệm',
      paragraphs: [
        'Dịch vụ được cung cấp trên cơ sở “nguyên trạng”. Chúng tôi không đảm bảo kết quả phù hợp với mọi mục đích và không chịu trách nhiệm đối với thiệt hại phát sinh từ nội dung do bạn tải lên hoặc từ việc bạn sử dụng kết quả. Dịch vụ có thể tạm dừng nhận tác vụ mới khi bảo trì.',
      ],
    },
    {
      heading: '8. Khóa tài khoản và báo cáo vi phạm',
      paragraphs: [
        'Chúng tôi có quyền khóa tài khoản vi phạm Điều khoản hoặc có dấu hiệu gian lận, và gỡ nội dung vi phạm khẩn cấp. Để báo cáo vi phạm, dùng liên kết “Báo cáo vi phạm” ở chân trang.',
      ],
    },
  ],
};
