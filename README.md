# 🚀 Codex-Pro v7.2 — "Project-Aware Brain"

> Bộ công cụ quản lý đa tài khoản OpenAI Codex CLI, tích hợp **xoay vòng tự động**, **proxy tàng hình**, **toàn quyền sandbox**, và **context thông minh**.

---

## 📋 Mục lục

- [Cài đặt](#-cài-đặt)
- [Phím tắt](#-phím-tắt-shortcuts)
- [Lệnh chính](#-lệnh-chính)
- [Chế độ Chat](#-chế-độ-chat)
- [Kiến trúc Module](#-kiến-trúc-module)
- [Bảo mật](#-bảo-mật)
- [Quy trình vận hành](#-quy-trình-vận-hành)
- [Cấu hình nâng cao](#-cấu-hình-nâng-cao)

---

## 🛠 Cài đặt

**Yêu cầu:** Node.js >= 18, OpenAI Codex CLI (`codex`) đã cài đặt.

```bash
# 1. Clone hoặc copy thư mục Tool về máy
# 2. Kích hoạt alias (đã thiết lập sẵn trong .zshrc)
source ~/.zshrc
```

Không cần `npm install` — dự án **Zero-Dep**, chỉ dùng module Node.js built-in.

---

## ⌨️ Phím tắt (Shortcuts)

| Phím tắt | Lệnh đầy đủ | Chức năng |
|----------|-------------|-----------|
| `cx` | `codex-pro` | Mở Menu mặc định |
| `cxm` / `cpm` | `codex-pro menu` | Bảng điều khiển trung tâm |
| `cxc` | `codex-pro chat` | Chat trực tiếp (Full-Access) |
| `cxh` | `codex-pro health` | Kiểm tra sức khỏe toàn bộ tài khoản |
| `cpl` | `codex-pro login` | Đăng nhập tài khoản mới |

---

## 📖 Lệnh chính

### 🗂 Quản lý Profile

```bash
# Mở bảng điều khiển (TUI menu)
cx                    # hoặc cpm, cxm
# Menu sẽ hiển thị quota còn lại theo snapshot gần nhất của từng profile

# Đăng nhập & lưu tài khoản mới
cpl

# Xóa profile (qua menu, nhấn 'd')
```

### 💬 Chat & Thực thi

```bash
# Mở chat tương tác (mặc định: Full-Access + Write)
cxc

# Chạy lệnh trực tiếp (tự động Full-Access)
cx run "tạo file hello.txt với nội dung Hello World"

# Chạy với focus vào thư mục cụ thể
cx run --focus src "refactor hàm login"
```

### 🛡️ Stealth & Proxy

```bash
# Gán proxy cho tài khoản
cx set-proxy <tên_acc> http://user:pass@ip:port

# Kiểm tra IP hiện tại
cx check-ip

# Kiểm tra sức khỏe tất cả tài khoản
cxh

# Kiểm tra 1 tài khoản cụ thể
cx health <tên_acc>
```

### 🧠 Memory & Project Map

```bash
# Xem lịch sử hội thoại
cx memory

# Xóa lịch sử
cx memory --clear

# Khởi tạo lại Project Map
cx init
```

---

## 💬 Chế độ Chat

Khi vào chat (`cxc`), Codex chạy với **toàn quyền** mặc định:

```
Chat [longphat200205] [Full Scan] [Free] [Write] >
```

| Badge | Ý nghĩa |
|-------|---------|
| `[Full Scan]` | Quét toàn bộ project (dùng `/focus` để giới hạn) |
| `[Free]` | Chế độ tự do, không giới hạn rules |
| `[Write]` | Quyền ghi file + chạy lệnh hệ thống |

### Lệnh trong Chat

| Lệnh | Chức năng |
|------|-----------|
| `/focus <keyword>` | Giới hạn context vào thư mục/file chứa keyword |
| `/focus src,api` | Focus nhiều path cùng lúc |
| `/no-map` | Bật/tắt Project Map |
| `/no-memory` | Bật/tắt lịch sử hội thoại |
| `/help` | Hiển thị danh sách lệnh |
| `/exit` hoặc `q` | Thoát chat |

---

## 🧩 Kiến trúc Module

```
Tool/
├── codex-pro.js        # 🧠 Core: CLI entry, menu TUI, chat, profile manager
├── behavior.js         # ⏱️ Delay engine: mô phỏng hành vi người dùng (2-15s)
├── cryptoHelper.js     # 🔐 Mã hóa AES-256-GCM cho metadata & memory
├── fingerprint.js      # 🎭 Tạo User-Agent & headers ngẫu nhiên
├── healthCheck.js      # 🏥 Phát hiện shadow ban, rate limit, session hết hạn
├── memoryManager.js    # 💾 Lưu trữ 5 hội thoại gần nhất (mã hóa)
├── projectMap.js       # 🗺️ Quét & tạo cây thư mục project cho context
├── proxyManager.js     # 🌐 Quản lý pool proxy (random/round-robin)
├── rules.js            # 📏 System prompt tùy chỉnh cho AI
├── proxies.txt         # 📝 Danh sách proxy (1 proxy/dòng)
├── .env                # 🔑 Biến môi trường (CODEX_KEY, etc.)
└── .codex_profiles/    # 👤 Thư mục chứa tất cả profile tài khoản
    ├── longphat200205/
    │   ├── auth.json
    │   └── metadata.json (encrypted)
    └── .../
```

### Chi tiết từng Module

| Module | Chức năng chính |
|--------|----------------|
| **behavior.js** | Tạo delay ngẫu nhiên theo phân phối chuẩn (2-15s) giữa các request. Hỗ trợ xoay vòng dựa trên ngưỡng sử dụng (5-12 lần). |
| **cryptoHelper.js** | Mã hóa/giải mã AES-256-GCM. Key lấy từ `CODEX_KEY` env hoặc dùng key mặc định. |
| **fingerprint.js** | Pool 10+ User-Agent thực (Chrome, Firefox, Safari, Edge, Opera). Tự tạo headers `Sec-CH-UA` phù hợp. |
| **healthCheck.js** | Gửi test query, phân tích response để phát hiện: rate limit, unauthorized, shadow ban, latency cao. |
| **memoryManager.js** | Lưu 5 exchanges gần nhất, inject 3 exchanges cuối vào prompt. Dữ liệu mã hóa trên disk. |
| **projectMap.js** | Quét cây thư mục (depth 1), lọc `node_modules`, `dist`, `.DS_Store`... Hỗ trợ focus filter theo keyword. |
| **proxyManager.js** | Đọc `proxies.txt`, hỗ trợ strategy `random` hoặc `round-robin`. Kiểm tra proxy sống bằng `curl ifconfig.me`. |
| **rules.js** | System prompt mặc định: ưu tiên intent người dùng, phản hồi như một kỹ sư thực dụng, bám root-cause và trade-off. |

---

## 🔐 Bảo mật

| Tính năng | Chi tiết |
|-----------|---------|
| **Mã hóa dữ liệu** | AES-256-GCM cho metadata profile và lịch sử chat |
| **Custom Key** | Set `CODEX_KEY` trong `.env` để dùng key riêng |
| **Fingerprint** | User-Agent + Sec-CH-UA ngẫu nhiên mỗi request |
| **Proxy** | Hỗ trợ HTTP proxy riêng cho từng profile |
| **Auto-Rotation** | Tự chuyển profile khi gặp lỗi (rate limit, ban) |
| **Behavior Engine** | Delay ngẫu nhiên giữa các request, tránh bị phát hiện bot |

---

## 🔄 Quy trình vận hành

### A. Thêm tài khoản mới

```bash
# 1. Đăng nhập
cpl
# 2. Làm theo hướng dẫn trên trình duyệt
# 3. Đặt tên profile khi hoàn tất
# 4. (Tùy chọn) Gán proxy
cx set-proxy <tên> http://user:pass@ip:port
# 5. Kiểm tra IP
cx check-ip
```

### B. Làm việc hàng ngày

```bash
# 1. Chọn profile
cpm           # Dùng phím ↑↓ và Enter

# 2. Mở chat (recommended)
cxc           # Full-Access, tự động ghi file

# 3. Hoặc chạy lệnh trực tiếp
cx run "tạo component Button bằng React"
```

### C. Bảo trì

```bash
# Kiểm tra sức khỏe toàn bộ
cxh

# Xóa memory nếu bị lỗi context
cx memory --clear

# Tái tạo project map
cx init
```

---

## ⚙️ Cấu hình nâng cao

### Biến môi trường (`.env`)

```env
# Key mã hóa tùy chỉnh (tối thiểu 32 ký tự)
CODEX_KEY=your-secret-key-here-32-chars-min
```

### Proxy Pool (`proxies.txt`)

```text
# Mỗi dòng 1 proxy, hỗ trợ comment (#)
http://user1:pass1@proxy1.com:8080
http://user2:pass2@proxy2.com:3128
```

### Sandbox & Quyền

Codex-Pro v7.2 mặc định chạy với:

| Config | Giá trị | Ý nghĩa |
|--------|---------|---------|
| `sandbox_mode` | `danger-full-access` | Toàn quyền đọc/ghi file + chạy lệnh hệ thống |
| `approval_policy` | `never` | Tự động thực thi, không cần xác nhận |
| `--skip-git-repo-check` | Luôn bật | Hoạt động ở mọi thư mục, không cần git repo |

### Xoay vòng tự động (Auto-Rotation)

Khi một profile gặp lỗi (exit code ≠ 0 và ≠ 130):
1. Tool tự động chuyển sang profile tiếp theo
2. Delay ngẫu nhiên 2-15s trước khi retry
3. Lặp lại cho đến khi hết profile hoặc thành công

### Token Optimization

| Thành phần | Giới hạn token |
|-----------|---------------|
| History (chat cũ) | ~1,000 tokens |
| Project Map | ~1,000 tokens |
| User Prompt | ~4,000 tokens |
| Tổng prompt tối đa | 64KB |

---

## 📊 Menu TUI

Giao diện dạng terminal (Text UI) với navigation bằng phím:

```
--- Codex-Pro v7.2 (Project-Aware Brain) ---
Arrows: Move | Enter: Select | q: Quit

   Profile          Usage    Proxy
 > longphat200205   12       No    (Active)
   longphat12022002 8        Yes
   longphat12022903 3        No

c) Chat  i) Check IP  d) Delete  q) Quit
```

---

## 📝 Changelog

### v7.2 "Project-Aware Brain" (Latest)
- ✅ **Full-Access mặc định**: Không cần gõ `/write`, Codex có toàn quyền ngay khi mở chat
- ✅ **Skip Git Repo Check**: Hoạt động ở mọi thư mục
- ✅ **Giao diện đơn giản**: Loại bỏ các toggle không cần thiết, giữ lại `/focus`, `/no-map`, `/no-memory`
- ✅ **CLI run Full-Access**: `cx run` luôn chạy với quyền ghi

### v7.1 "Stealth Edition"
- 🛡️ Mã hóa AES-256 cho metadata
- 🌐 Xoay vòng Proxy pool
- 🤖 Behavior Engine (delay ngẫu nhiên)
- 🎭 Fingerprint đa lớp (10+ User-Agent)
- 🚀 Zero-Dep architecture
