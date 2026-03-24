# 🛡️ Codex-Pro v7.1 "Stealth Edition" - Cheat Sheet & Guide

Bộ công cụ giúp quản lý nhiều tài khoản OpenAI, hỗ trợ xoay vòng tài khoản (auto-rotation) và bảo mật IP (Stealth & Proxy).

================================================================

## 1. Cài đặt và Thiết lập (Setup)

**1.1. Kích hoạt Alias**
Các phím tắt đã được cài đặt sẵn trong file `.zshrc`. Nếu bạn vừa mới cài đặt hoặc thấy lệnh không nhận, hãy chạy:
```bash
source ~/.zshrc
```

**1.2. Danh sách phím tắt (Shortcuts):**
Dùng bộ lệnh siêu ngắn **`cx`** để đạt hiệu quả cao nhất:
- `cx`: Mở Menu quản lý (mặc định mở menu nếu không kèm lệnh).
- `cxm` hoặc `cpm`: Mở Menu profiles.
- `cxc`: Vào thẳng Chat tàng hình (UA ngẫu nhiên + Proxy + Delay).
- `cxh`: Kiểm tra sức khỏe toàn bộ tài khoản (Shadow ban & Quota).

================================================================

## 2. Các nhóm lệnh chính

**2.1. 📁 Nhóm Quản lý (Management)**
- `codex-pro menu` (hoặc `cpm`): Bảng điều khiển trung tâm để chọn account, check IP, mở Web.
- `codex-pro login` (hoặc `cpl`): Đăng nhập tài khoản mới qua trình duyệt và lưu vào Profile.

**2.2. 🛡️ Nhóm Stealth & Proxy**
- `codex-pro set-proxy <tên_acc> <url_proxy>`: Gán Proxy riêng cho từng tài khoản.
  - Hỗ trợ định dạng: `http://user:pass@ip:port`
- `codex-pro check-ip` (hoặc `cpi`): Kiểm tra độ ẩn danh, xem IP của Proxy hiện tại.
- `codex-pro run "<lệnh>"`: Chạy code thông minh, tự động xoay vòng tài khoản nếu gặp lỗi hoặc hết hạn mức (Quota).

**2.3. 💬 Nhóm Tương tác**
- `codex-pro chat` (hoặc `cpc`): Chat trực tiếp với Codex trong Terminal.

================================================================

## 💡 Quy trình vận hành "Chuẩn Engineer"

**A. Thêm tài khoản mới (Via):**
1. Gõ `cpl` để đăng nhập.
2. Làm theo hướng dẫn trên trình duyệt và đặt tên cho Profile khi hoàn tất.
3. Gán Proxy (nếu có): `codex-pro set-proxy <tên_vừa_đặt> http://....`
4. Gõ `cpi` để kiểm tra IP xem đã "bay" sang nước ngoài chưa.

**B. Làm việc hàng ngày:**
1. Gõ `cpm` để chọn tài khoản muốn dùng (Dùng phím mũi tên và Enter trong bản v6.4).
2. Gõ `codex-pro run "tạo mã hiệu ứng nút bấm bằng css"` để Tool tự động làm việc.
3. Nếu tài khoản hiện tại báo hết lượt, Tool sẽ tự động xoay sang tài khoản tiếp theo trong danh sách.

================================================================

**Phiên bản v7.1 "Stealth Edition"** là bản nâng cấp tối thượng với:
- 🛡️ **Mã hóa AES-256**: Bảo mật metadata tuyệt đối.
- 🌐 **Xoay vòng Proxy**: Tàng hình dải IP chỉ với `proxies.txt`.
- 🤖 **Behavior Engine**: Delay ngẫu nhiên Distribution-based.
- 🎭 **Fingerprint đa lớp**: Giả mạo hàng trăm User-Agent thật.
- 🚀 **Zero-Dep**: Không cần internet vẫn chạy cực ổn định! ⚙️🔥
