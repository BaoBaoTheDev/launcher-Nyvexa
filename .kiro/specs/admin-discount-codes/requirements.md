# Requirements Document

Tài liệu Yêu cầu — Quản lý Mã Giảm Giá (Admin)

## Introduction

Bổ sung phần **Quản lý mã giảm giá** vào trang admin dashboard của launcher (Tauri + React + Supabase). Backend (bảng `discount_codes`, `discount_code_redemptions`, các Tauri command `discount_*` và `admin_discount_*`) đã được hiện thực ở `supabase/65_discount_codes.sql` và `launcher-tauri/src-tauri/src/commands/discount.rs`. Tính năng còn thiếu là **giao diện admin** để admin tạo, liệt kê, sửa và vô hiệu hoá mã giảm giá, cùng với việc đảm bảo các quy tắc nghiệp vụ (giới hạn lượt dùng, hạn dùng, khoảng giá game áp dụng, danh sách game được phép, có cho dùng với game đang sale hay không) được thực thi nhất quán cả phía UI lẫn phía backend.

Phạm vi tính năng gồm 3 loại mã (theo yêu cầu người dùng):

1. **Mã giảm theo phần trăm khi mua game/DLC** — ánh xạ tới `type = 'percent'`.
2. **Mã giảm số tiền cố định khi mua game/DLC** — ánh xạ tới `type = 'fixed'`.
3. **Mã giảm số tiền cố định khi nạp tiền vào ví** — ánh xạ tới `type = 'deposit_fixed'`.

Schema sẵn có cũng định nghĩa `type = 'deposit_percent'`; UI sẽ chấp nhận và hiển thị nếu dữ liệu tồn tại, nhưng việc tạo loại này không nằm trong phạm vi tính năng lần này.

## Glossary

- **Admin_UI**: Tab "Mã giảm giá" trong `AdminPage.tsx` của ứng dụng launcher, chỉ truy cập được khi `profiles.role = 'admin'`.
- **Discount_Manager**: Tập các Tauri command quản trị mã giảm giá (`admin_discount_list`, `admin_discount_create`, `admin_discount_update`, `admin_discount_delete`) thực thi qua `service_key` của Supabase.
- **Discount_Validator**: Các Tauri command xác thực mã ở phía user (`discount_validate`, `discount_validate_deposit`, `discount_list_available`).
- **Game_Purchase_Flow**: Luồng mua game hoặc DLC, hiện thực ở `purchase_game` và `dlc_purchase` (`store.rs`), gọi `apply_discount_for_purchase` để áp mã.
- **Wallet_Deposit_Flow**: Luồng nạp tiền qua SePay, hiện thực ở `wallet_create_payment` (`wallet.rs`).
- **Discount_Code**: Một bản ghi trong bảng `public.discount_codes`.
- **Discount_Redemption**: Một bản ghi trong bảng `public.discount_code_redemptions` ghi nhận một lần sử dụng mã.
- **Sale_Game**: Một game được coi là đang sale khi `games.original_price > games.price` và thời điểm hiện tại nằm trong `[games.sale_start_at, games.sale_end_at]` (nếu các trường này có giá trị); với DLC, áp dụng theo `dlcs.original_price > dlcs.price` và `dlcs.sale_end_at`.
- **Game_Whitelist**: Danh sách `applicable_game_ids` của một mã giảm giá khi `applies_to_all = false`.
- **Min_Price / Max_Price**: Giá trị `discount_codes.min_price` và `discount_codes.max_price` (tính trên giá game/DLC trước khi áp mã, đơn vị VND).
- **Code_String**: Chuỗi `discount_codes.code`, lưu ở dạng chữ in hoa, là mã user nhập khi thanh toán.
- **Active_Code**: Một `Discount_Code` thoả mãn đồng thời `is_active = true`, `expires_at IS NULL OR expires_at > now()`, và `(max_uses IS NULL OR current_uses < max_uses)`.

## Requirements

### Requirement 1: Truy cập tab quản lý mã giảm giá

**User Story:** Là admin, tôi muốn có một tab "Mã giảm giá" trong dashboard, để tôi có thể quản lý toàn bộ mã giảm giá ở một nơi.

#### Acceptance Criteria

1. WHEN user mở `AdminPage` với `profiles.role = 'admin'`, THE Admin_UI SHALL hiển thị tab "Mã giảm giá" trong danh sách `TABS` của sidebar.
2. WHEN admin chọn tab "Mã giảm giá", THE Admin_UI SHALL render danh sách mã giảm giá lấy từ `tauriAPI.discount.adminList()`.
3. IF `profiles.role` của user hiện tại khác `'admin'`, THEN THE Admin_UI SHALL không hiển thị tab "Mã giảm giá" và không gọi bất kỳ command `admin_discount_*` nào.
4. IF `tauriAPI.discount.adminList()` trả về lỗi, THEN THE Admin_UI SHALL hiển thị thông báo lỗi cho admin và một nút "Thử lại".

### Requirement 2: Tạo mã giảm giá phần trăm cho mua game

**User Story:** Là admin, tôi muốn tạo mã giảm theo phần trăm áp dụng khi mua game, để chạy chương trình khuyến mãi theo tỉ lệ %.

#### Acceptance Criteria

1. WHEN admin submit form tạo mã với `type = 'percent'`, THE Discount_Manager SHALL gọi `admin_discount_create` với payload chứa `code`, `type = 'percent'`, `value` là số phần trăm.
2. THE Admin_UI SHALL chuẩn hoá `code` về dạng chữ in hoa (uppercase) và loại bỏ khoảng trắng đầu/cuối trước khi gửi xuống Discount_Manager.
3. IF `value` không nằm trong khoảng `(0, 100]`, THEN THE Admin_UI SHALL chặn submit và hiển thị thông báo "Phần trăm giảm phải lớn hơn 0 và nhỏ hơn hoặc bằng 100".
4. WHEN tạo mã `percent` thành công, THE Admin_UI SHALL refresh danh sách mã và hiển thị mã mới ở đầu danh sách.

### Requirement 3: Tạo mã giảm số tiền cố định cho mua game

**User Story:** Là admin, tôi muốn tạo mã giảm một số tiền VND cố định khi mua game, để khuyến mãi theo mệnh giá tiền.

#### Acceptance Criteria

1. WHEN admin submit form tạo mã với `type = 'fixed'`, THE Discount_Manager SHALL gọi `admin_discount_create` với payload chứa `code`, `type = 'fixed'`, `value` là số VND giảm trừ.
2. IF `value` nhỏ hơn hoặc bằng 0, THEN THE Admin_UI SHALL chặn submit và hiển thị thông báo "Số tiền giảm phải lớn hơn 0".
3. WHERE admin nhập `min_price` và `max_price` cùng lúc, THE Admin_UI SHALL chặn submit nếu `max_price < min_price` và hiển thị thông báo "Giá tối đa phải lớn hơn hoặc bằng giá tối thiểu".
4. WHEN tạo mã `fixed` thành công, THE Admin_UI SHALL refresh danh sách mã và hiển thị mã mới ở đầu danh sách.

### Requirement 4: Tạo mã giảm số tiền cố định khi nạp tiền

**User Story:** Là admin, tôi muốn tạo mã giảm số tiền cố định cho lượt nạp tiền vào ví, để khuyến khích người dùng nạp tiền.

#### Acceptance Criteria

1. WHEN admin submit form tạo mã với `type = 'deposit_fixed'`, THE Discount_Manager SHALL gọi `admin_discount_create` với payload chứa `code`, `type = 'deposit_fixed'`, `value` là số VND giảm trên số tiền user phải trả.
2. IF `value` nhỏ hơn hoặc bằng 0, THEN THE Admin_UI SHALL chặn submit và hiển thị thông báo "Số tiền giảm phải lớn hơn 0".
3. WHERE `type = 'deposit_fixed'`, THE Admin_UI SHALL ẩn các trường `applies_to_sale`, `applies_to_all`, `applicable_game_ids`, `min_price`, `max_price` vì các trường này không áp dụng cho luồng nạp tiền.
4. WHEN admin tạo mã `deposit_fixed` thành công, THE Admin_UI SHALL hiển thị mã mới trong danh sách với nhãn "Áp dụng cho nạp tiền".

### Requirement 5: Cấu hình giới hạn số lần dùng

**User Story:** Là admin, tôi muốn đặt số lượt sử dụng tối đa cho một mã, để kiểm soát chi phí khuyến mãi.

#### Acceptance Criteria

1. WHEN admin nhập giá trị `max_uses` lớn hơn 0, THE Discount_Manager SHALL lưu giá trị đó vào trường `discount_codes.max_uses`.
2. WHEN admin để trống `max_uses`, THE Discount_Manager SHALL lưu `max_uses = NULL` để biểu thị không giới hạn lượt dùng.
3. IF admin nhập `max_uses` nhỏ hơn 0 hoặc không phải số nguyên, THEN THE Admin_UI SHALL chặn submit và hiển thị thông báo "Số lượt dùng phải là số nguyên không âm hoặc để trống".
4. THE Admin_UI SHALL hiển thị `current_uses / max_uses` cho mỗi mã trong bảng danh sách (hiển thị `current_uses / ∞` khi `max_uses` rỗng).
5. WHEN một redemption mới được ghi nhận thành công bởi Game_Purchase_Flow hoặc Wallet_Deposit_Flow, THE Discount_Validator SHALL tăng `discount_codes.current_uses` lên 1.
6. IF `max_uses IS NOT NULL AND current_uses >= max_uses` tại thời điểm validate, THEN THE Discount_Validator SHALL trả về `success = false` với message "Mã đã hết lượt sử dụng".

### Requirement 6: Cấu hình thời hạn sử dụng mã

**User Story:** Là admin, tôi muốn đặt mốc hết hạn cho mã, để mã tự động ngừng hoạt động sau ngày giờ đã định.

#### Acceptance Criteria

1. WHEN admin chọn `expires_at`, THE Admin_UI SHALL gửi giá trị thời gian theo ISO 8601 (UTC) xuống Discount_Manager.
2. WHEN admin để trống `expires_at`, THE Discount_Manager SHALL lưu `expires_at = NULL` để biểu thị mã không có hạn cuối.
3. IF `expires_at` được cấu hình ở thời điểm trong quá khứ tại lúc submit, THEN THE Admin_UI SHALL chặn submit và hiển thị thông báo "Thời điểm hết hạn phải ở tương lai".
4. WHEN Discount_Validator nhận yêu cầu validate một mã có `expires_at IS NOT NULL AND expires_at <= now()`, THE Discount_Validator SHALL trả về `success = false` với message "Mã đã hết hạn".
5. THE Admin_UI SHALL hiển thị thời điểm hết hạn theo múi giờ Việt Nam (Asia/Ho_Chi_Minh) trong bảng danh sách.

### Requirement 7: Cấu hình khoảng giá game áp dụng (min/max price)

**User Story:** Là admin, tôi muốn giới hạn mã chỉ áp dụng cho game trong khoảng giá xác định, để kiểm soát biên lợi nhuận.

#### Acceptance Criteria

1. WHERE `type` thuộc `{'percent', 'fixed'}`, THE Admin_UI SHALL cho phép admin nhập `min_price` và `max_price` (đơn vị VND).
2. WHEN admin để trống `min_price`, THE Discount_Manager SHALL lưu `min_price = NULL` (không có chặn dưới).
3. WHEN admin để trống `max_price`, THE Discount_Manager SHALL lưu `max_price = NULL` (không có chặn trên).
4. WHEN Discount_Validator nhận yêu cầu validate cho một game có giá `P` (giá hiển thị `games.price` hoặc `dlcs.price` tại thời điểm mua), THE Discount_Validator SHALL từ chối mã với message "Giá game không nằm trong khoảng áp dụng" nếu `(min_price IS NOT NULL AND P < min_price) OR (max_price IS NOT NULL AND P > max_price)`.
5. IF `min_price` hoặc `max_price` được nhập nhỏ hơn 0, THEN THE Admin_UI SHALL chặn submit và hiển thị thông báo "Giá phải lớn hơn hoặc bằng 0".

### Requirement 8: Cấu hình danh sách game áp dụng

**User Story:** Là admin, tôi muốn chọn cụ thể những game/DLC mà mã được phép dùng, để giới hạn khuyến mãi cho một số tựa nhất định.

#### Acceptance Criteria

1. WHERE `type` thuộc `{'percent', 'fixed'}`, THE Admin_UI SHALL hiển thị toggle "Áp dụng cho mọi game/DLC" tương ứng với `applies_to_all`.
2. WHEN admin tắt toggle "Áp dụng cho mọi game/DLC", THE Admin_UI SHALL hiển thị một bộ chọn (multi-select có ô tìm kiếm) cho phép chọn nhiều game/DLC từ danh sách hiện có và lưu danh sách `id` vào `applicable_game_ids`.
3. WHEN admin bật lại toggle "Áp dụng cho mọi game/DLC", THE Discount_Manager SHALL lưu `applies_to_all = true` và `applicable_game_ids = NULL` (hoặc mảng rỗng) cho mã đang sửa.
4. IF `applies_to_all = false AND (applicable_game_ids IS NULL OR length(applicable_game_ids) = 0)`, THEN THE Admin_UI SHALL chặn submit và hiển thị thông báo "Phải chọn ít nhất 1 game khi không áp dụng cho mọi game".
5. WHEN Discount_Validator nhận yêu cầu validate cho một order có `game_id = G` và mã có `applies_to_all = false`, THE Discount_Validator SHALL từ chối mã với message "Mã không áp dụng cho game này" nếu `G` không nằm trong `applicable_game_ids`.

### Requirement 9: Cấu hình quy tắc với game đang sale

**User Story:** Là admin, tôi muốn quyết định mã có dùng được cho game đang sale hay không, để tránh chồng giảm giá.

#### Acceptance Criteria

1. WHERE `type` thuộc `{'percent', 'fixed'}`, THE Admin_UI SHALL hiển thị toggle "Áp dụng cho game đang sale" tương ứng với `applies_to_sale`.
2. WHEN admin tắt toggle "Áp dụng cho game đang sale", THE Discount_Manager SHALL lưu `applies_to_sale = false`.
3. WHEN Discount_Validator nhận yêu cầu validate cho một order có `game_id = G` và mã có `applies_to_sale = false`, THE Discount_Validator SHALL từ chối mã với message "Mã không áp dụng cho game đang sale" nếu `G` là một Sale_Game tại thời điểm validate.
4. WHEN `applies_to_sale = true`, THE Discount_Validator SHALL không từ chối mã chỉ vì lý do game đang sale.

### Requirement 10: Liệt kê và tìm kiếm mã giảm giá

**User Story:** Là admin, tôi muốn xem toàn bộ mã đã tạo và lọc nhanh theo trạng thái/loại, để quản lý hiệu quả khi có nhiều mã.

#### Acceptance Criteria

1. THE Admin_UI SHALL hiển thị bảng mã giảm giá với các cột: `code`, `type`, `value`, `current_uses / max_uses`, `expires_at`, `is_active`, hành động (Sửa, Bật/Tắt, Xoá).
2. THE Admin_UI SHALL cung cấp ô tìm kiếm theo `code` (so khớp không phân biệt hoa thường) và bộ lọc theo `type` với các giá trị `'all', 'percent', 'fixed', 'deposit_fixed', 'deposit_percent'`.
3. THE Admin_UI SHALL cung cấp bộ lọc trạng thái với các giá trị `'all', 'active', 'inactive', 'expired', 'used_up'`, trong đó:
   - `'active'` = `is_active = true AND (expires_at IS NULL OR expires_at > now()) AND (max_uses IS NULL OR current_uses < max_uses)`.
   - `'inactive'` = `is_active = false`.
   - `'expired'` = `expires_at IS NOT NULL AND expires_at <= now()`.
   - `'used_up'` = `max_uses IS NOT NULL AND current_uses >= max_uses`.
4. THE Admin_UI SHALL sắp xếp mặc định danh sách theo `created_at` giảm dần (mã mới nhất ở đầu).

### Requirement 11: Sửa mã giảm giá

**User Story:** Là admin, tôi muốn sửa cấu hình của một mã đã tạo, để điều chỉnh khuyến mãi mà không cần xoá rồi tạo lại.

#### Acceptance Criteria

1. WHEN admin mở form sửa cho một mã, THE Admin_UI SHALL điền sẵn toàn bộ trường hiện tại của mã từ kết quả `admin_discount_list`.
2. WHEN admin lưu thay đổi, THE Discount_Manager SHALL gọi `admin_discount_update` với `id` và `patch` chỉ chứa các trường đã thay đổi.
3. THE Admin_UI SHALL không cho phép sửa giá trị của trường `code` sau khi mã đã tồn tại; trường `code` hiển thị ở dạng chỉ đọc khi sửa.
4. THE Admin_UI SHALL không cho phép sửa giá trị của trường `type` sau khi mã đã tồn tại; trường `type` hiển thị ở dạng chỉ đọc khi sửa.
5. WHEN admin lưu sửa thành công, THE Admin_UI SHALL refresh danh sách mã và đóng form.
6. IF `admin_discount_update` trả về lỗi, THEN THE Admin_UI SHALL giữ form mở và hiển thị thông điệp lỗi từ backend.

### Requirement 12: Bật/tắt và xoá mã giảm giá

**User Story:** Là admin, tôi muốn bật/tắt nhanh hoặc xoá mã, để dừng khuyến mãi mà không phải mở form sửa.

#### Acceptance Criteria

1. WHEN admin click hành động "Bật" trên một mã có `is_active = false`, THE Discount_Manager SHALL gọi `admin_discount_update` với `patch = { is_active: true }`.
2. WHEN admin click hành động "Tắt" trên một mã có `is_active = true`, THE Discount_Manager SHALL gọi `admin_discount_update` với `patch = { is_active: false }`.
3. WHEN admin click hành động "Xoá", THE Admin_UI SHALL hiển thị hộp thoại xác nhận trước khi gọi `admin_discount_delete`.
4. WHEN admin xác nhận xoá, THE Discount_Manager SHALL gọi `admin_discount_delete` với `id` của mã.
5. WHEN xoá thành công, THE Admin_UI SHALL refresh danh sách mã và hiển thị toast "Đã xoá mã".
6. IF mã đã có ít nhất 1 redemption (`current_uses > 0`), THEN THE Admin_UI SHALL khuyến cáo trong hộp thoại xác nhận rằng "Mã này đã được sử dụng — nên cân nhắc Tắt thay vì Xoá để giữ lịch sử redemption".

### Requirement 13: Áp dụng mã khi mua game/DLC

**User Story:** Là user, tôi muốn nhập mã giảm giá khi mua game/DLC, để được giảm giá theo cấu hình của admin.

#### Acceptance Criteria

1. WHEN user gọi `purchase_game` hoặc `dlc_purchase` với một `discount_code` không rỗng, THE Game_Purchase_Flow SHALL gọi `apply_discount_for_purchase` để xác thực mã trước khi trừ tiền.
2. IF `discount_code` không tồn tại trong `discount_codes` hoặc không phải Active_Code, THEN THE Discount_Validator SHALL trả về `success = false` với message tương ứng và Game_Purchase_Flow SHALL không trừ tiền user.
3. IF `discount_code.type` thuộc `{'deposit_fixed', 'deposit_percent'}`, THEN THE Discount_Validator SHALL từ chối mã trong Game_Purchase_Flow với message "Mã giảm giá này chỉ áp dụng cho nạp tiền".
4. WHEN mã hợp lệ và `type = 'percent'`, THE Discount_Validator SHALL tính `discount_amount = round(price × value / 100)` với `value` ∈ (0, 100], và cap `discount_amount` tại `price` (không vượt quá giá game).
5. WHEN mã hợp lệ và `type = 'fixed'`, THE Discount_Validator SHALL tính `discount_amount = min(value, price)` để đảm bảo không âm.
6. WHEN mã hợp lệ, THE Game_Purchase_Flow SHALL trừ ví user theo `final_price = price - discount_amount`, ghi lịch sử mua, và insert một redemption với `order_type` ∈ `{'game', 'dlc'}`, `order_amount = price`, `discount_amount`.
7. THE Game_Purchase_Flow SHALL trả về cho frontend các trường `price` (giá gốc tại thời điểm mua), `final_price`, `discount.code`, `discount.discount_amount`, `discount.final_amount`, và `new_balance`.

### Requirement 14: Áp dụng mã khi nạp tiền

**User Story:** Là user, tôi muốn nhập mã giảm giá khi nạp tiền, để được giảm số tiền phải trả qua SePay.

#### Acceptance Criteria

1. WHEN user submit form nạp tiền với một `discount_code` không rỗng, THE Wallet_Deposit_Flow SHALL gọi `discount_validate_deposit` với `code` và `deposit_amount` (số tiền user muốn nạp vào ví).
2. IF `discount_code.type` không thuộc `{'deposit_fixed', 'deposit_percent'}`, THEN THE Discount_Validator SHALL trả về `success = false` với message "Mã này không áp dụng cho nạp tiền".
3. WHEN mã hợp lệ và `type = 'deposit_fixed'`, THE Discount_Validator SHALL tính `discount_amount = min(value, deposit_amount)`.
4. WHEN mã hợp lệ và `type = 'deposit_percent'`, THE Discount_Validator SHALL tính `discount_amount = round(deposit_amount × value / 100)` với `value` ∈ (0, 100], và cap tại `deposit_amount`.
5. WHEN tạo deposit thành công với mã giảm giá, THE Wallet_Deposit_Flow SHALL tạo QR SePay với số tiền `pay_amount = deposit_amount - discount_amount` và ghi `deposit_amount` (số tiền sẽ cộng vào ví khi PAID) vào bản ghi `deposits`.
6. WHEN deposit chuyển sang trạng thái `PAID`, THE Wallet_Deposit_Flow SHALL insert một redemption với `order_type = 'deposit'`, `order_id = deposit.id`, `order_amount = deposit_amount`, `discount_amount` và tăng `current_uses` lên 1.
7. IF deposit chuyển sang `CANCELLED` hoặc `FAILED`, THEN THE Wallet_Deposit_Flow SHALL không insert redemption và không tăng `current_uses`.

### Requirement 15: Tránh đếm trùng và race condition khi tăng current_uses

**User Story:** Là admin, tôi muốn `current_uses` luôn phản ánh đúng số redemption thành công, để giới hạn `max_uses` không bị vượt quá do truy cập đồng thời.

#### Acceptance Criteria

1. WHEN Discount_Validator tăng `discount_codes.current_uses`, THE Discount_Validator SHALL thực hiện trong cùng một giao dịch (hoặc statement điều kiện) với việc kiểm tra `(max_uses IS NULL OR current_uses < max_uses)`.
2. IF việc tăng `current_uses` thất bại do điều kiện `current_uses < max_uses` không còn đúng, THEN THE Game_Purchase_Flow hoặc Wallet_Deposit_Flow SHALL không trừ tiền user (hoặc rollback) và trả về message "Mã đã hết lượt sử dụng".
3. THE Discount_Validator SHALL không tăng `current_uses` cho các trường hợp validate-only (preview giá trước khi user xác nhận thanh toán).

### Requirement 16: Phân quyền truy cập command quản trị

**User Story:** Là quản trị hệ thống, tôi muốn chỉ admin mới gọi được các command tạo/sửa/xoá mã, để chống lạm dụng.

#### Acceptance Criteria

1. WHEN một command thuộc tập `{admin_discount_list, admin_discount_create, admin_discount_update, admin_discount_delete}` được gọi, THE Discount_Manager SHALL xác minh role hiện tại của caller là `'admin'` thông qua `profiles.role` trước khi thực hiện thao tác trên Supabase.
2. IF caller không phải admin, THEN THE Discount_Manager SHALL trả về lỗi "Không có quyền truy cập" và không truy vấn vào bảng `discount_codes`.
3. WHEN Discount_Manager thực hiện thao tác ghi (`create`, `update`, `delete`), THE Discount_Manager SHALL dùng `service_key` của Supabase và không lộ key này về phía frontend.

### Requirement 17: Hiển thị thông tin mã cho user trong UI mua hàng

**User Story:** Là user, tôi muốn xem trước số tiền giảm trước khi xác nhận mua, để biết chính xác mình phải trả bao nhiêu.

#### Acceptance Criteria

1. WHEN user nhập mã trên màn mua game/DLC và bấm "Áp dụng", THE Admin_UI (phía store/checkout) SHALL gọi `tauriAPI.discount.validate({ code, orderType, gameId })` để preview kết quả.
2. WHEN preview thành công, THE checkout UI SHALL hiển thị `original_amount`, `discount_amount`, và `final_amount` trước khi user xác nhận thanh toán.
3. IF preview trả về `success = false`, THEN THE checkout UI SHALL hiển thị `message` từ Discount_Validator và không cho phép xác nhận thanh toán cho đến khi user xoá mã hoặc nhập mã khác.
4. WHEN user xác nhận thanh toán, THE Game_Purchase_Flow SHALL re-validate mã ở backend (không tin cậy preview) và áp dụng kết quả validate cuối cùng.
