# Codex-Pro v7.4

Wrapper nhiều profile cho Codex CLI. Mục tiêu hiện tại là đơn giản:
- `cxc` mở native Codex CLI với profile đang active và tự rotate khi quota/rate-limit
- `cx run ...` chạy non-interactive với auto-rotate khi lỗi
- `cx` hoặc `cxm` mở menu chọn profile

## Yêu cầu

- Node.js >= 18
- `codex` CLI đã cài và dùng được

## Lệnh chính

```bash
# Mở menu
cx

# Mở native Codex CLI với profile đang active
cxc

# Chạy một prompt non-interactive
cx run "fix login flow"

# Chạy với focus
cx run --focus src "refactor auth service"

# Xem quota profile đang active
cx quota

# Xem quota tất cả profile
cx quota --all

# Đăng nhập và lưu profile mới
cpl
```

## Chat và Run

`cxc`:
- mở thẳng native Codex CLI
- giữ giao diện và luồng chat của Codex CLI
- nếu process thoát với dấu hiệu quota/rate-limit từ output của Codex, wrapper sẽ tự chuyển sang profile kế tiếp và mở lại `codex`

`cx run ...`:
- gọi `codex exec`
- tự thêm context từ rules, project map, memory
- tự rotate sang profile khác khi request lỗi
- chạy với `danger-full-access` và `approval_policy="never"`

## Profile và proxy

```bash
# cập nhật proxy cho profile
cx set-proxy <profile> http://user:pass@host:port

# kiểm tra IP của profile đang active
cx check-ip

# kiểm tra health
cx health
cx health <profile>
```

## Tiện ích khác

```bash
# khởi tạo lại project map
cx init

# xem memory
cx memory

# xóa memory
cx memory --clear

# dọn backup profile cũ
cx clean-backups
```

## Ghi chú

- `chat` và `run` là hai mode khác nhau có chủ đích
- `chat` ưu tiên giữ cảm giác native Codex CLI, nhưng có supervisor để rotate account khi quota/rate-limit
- `run` ưu tiên tự động hóa và uptime nhiều account
- locale UTF-8 được ép khi cần để giảm lỗi nhập tiếng Việt
