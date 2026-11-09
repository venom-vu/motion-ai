<script setup lang="ts">
import { TOS_VERSION } from '@flowvis/contracts';

useHead({ title: 'Điều khoản dịch vụ - flowvis' });
</script>

<template>
  <article
    class="mx-auto max-w-3xl space-y-6 py-4 text-sm leading-relaxed text-cyber-muted"
    data-testid="page-terms"
  >
    <header class="space-y-1">
      <h1 class="text-xl font-bold text-cyber-text">Điều khoản dịch vụ</h1>
      <p class="font-mono text-xs">Phiên bản {{ TOS_VERSION }}</p>
    </header>

    <section class="space-y-2">
      <h2 class="font-semibold text-cyber-text">1. Điều kiện sử dụng</h2>
      <p>
        Bạn xác nhận đủ 18 tuổi trở lên khi tạo tài khoản và sử dụng flowvis.
        Việc đồng ý Điều khoản được ghi nhận một lần khi đăng nhập; khi Điều
        khoản thay đổi phiên bản, bạn sẽ được yêu cầu đồng ý lại.
      </p>
    </section>

    <section class="space-y-2">
      <h2 class="font-semibold text-cyber-text">2. Nội dung tải lên</h2>
      <p>
        Bạn sở hữu quyền hợp pháp đối với hình ảnh/video tải lên và bảo đảm những
        người xuất hiện trong đó đã đồng ý cho xử lý. Bạn cam kết không tạo nội
        dung vi phạm pháp luật hoặc xâm phạm quyền của người khác.
      </p>
    </section>

    <section class="space-y-2">
      <h2 class="font-semibold text-cyber-text">3. Nội dung do AI tạo ra</h2>
      <p>
        Ảnh kết quả được ghi dấu siêu dữ liệu EXIF “Software: AI Generator”. Bạn
        chịu trách nhiệm về việc sử dụng và chia sẻ kết quả.
      </p>
    </section>

    <section class="space-y-2">
      <h2 class="font-semibold text-cyber-text">4. Credit và nạp tiền</h2>
      <p>
        Credit được tạm giữ khi tạo tác vụ và hoàn lại đầy đủ nếu tác vụ thất
        bại. Đơn nạp tiền được duyệt sau khi đối soát chuyển khoản; vui lòng nhập
        đúng nội dung chuyển khoản.
      </p>
    </section>

    <section class="space-y-2">
      <h2 class="font-semibold text-cyber-text">5. Khóa tài khoản</h2>
      <p>
        Chúng tôi có quyền khóa tài khoản vi phạm Điều khoản hoặc có dấu hiệu
        gian lận.
      </p>
    </section>
  </article>
</template>
