Thư mục này chứa file tĩnh được bundle vào launcher và tự động cài vào Steam khi user bấm "Chơi ngay":
  - xinput1_4.dll   (xinput redirect)
  - dwmapi.dll      (DWM hook)
  - steam.cfg       (Goldberg config)

steam_api64.dll KHÔNG nằm ở đây — Steam tự quản lý file đó.

Khi user bấm "Chơi ngay" lần ĐẦU (hoặc thiếu file):
  1. Launcher tự copy 3 file từ đây vào Steam root (ẩn hidden+system)
  2. Tải file lua từ server
  3. Restart Steam → steam://run/{appId}

Khi user bấm "Chơi ngay" lần SAU (đã đủ file):
  → Chỉ gọi steam://run thẳng, không tải lại lua, không restart Steam

Khi quit launcher (từ tray): 3 file bị xóa và Steam tự khởi động lại.
