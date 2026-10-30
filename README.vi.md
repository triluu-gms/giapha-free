# Gia phả MIỄN PHÍ và mã nguồn mở

[English](README.md) | **Tiếng Việt**

Ứng dụng cây gia phả dùng cơ sở dữ liệu đồ thị.

- Ai cũng đăng ký được, bằng email và mật khẩu (xác nhận qua email xác minh) hoặc bằng Google, GitHub.
- Mỗi tài khoản có một cây gia phả riêng và là một vùng tách biệt: chỉ quản lý cây của mình và chỉ thấy những cây mình được mời. Không có quản trị viên toàn ứng dụng, nên không tài khoản nào xem hay quản lý được tài khoản khác.
- Mỗi người dùng có thể mời người khác qua email để xem, chỉnh sửa hoặc cùng quản lý (quản trị viên) cây của mình, và có thể chuyển quyền sở hữu cây cho một thành viên khác.
- Người được mời chuyển qua lại giữa cây của mình và các cây được chia sẻ.
- Ai cũng tạo thêm được cây mới (**+ Cây mới…** trong ô chọn cây, tối đa 20 cây làm chủ mỗi tài khoản) và chia sẻ từng cây riêng. Chủ sở hữu xóa được cây ở trang **Cài đặt** sau khi gõ đúng tên cây để xác nhận. Thao tác này xóa người, ảnh, lời mời và quyền truy cập của mọi thành viên. Nếu đó là cây cuối cùng, họ sẽ nhận một cây mới, trống.
- Cây mới, trống có nút **Thêm gia đình mẫu**: 24 người Việt qua năm đời, để thử ứng dụng trước khi nhập gia đình mình.

> **Không rành kỹ thuật?** Chúng tôi có thể cài đặt giúp bạn một bản riêng trên hosting miễn phí, trọn gói **390.000 VNĐ** một lần. Xem [Dịch vụ cài đặt](#dịch-vụ-cài-đặt-390000-vnd).

| Phần | Công nghệ | Triển khai lên |
| --- | --- | --- |
| [`backend/`](backend) | Node.js, Express 5, TypeScript, `neo4j-driver`, Zod, JWT | Vercel (serverless function) hoặc máy chủ Node bất kỳ |
| [`frontend/`](frontend) | Next.js (App Router), React, React Flow với bộ dàn trang cây gia phả riêng ([`treeLayout.ts`](frontend/src/lib/treeLayout.ts)) | Vercel |
| Cơ sở dữ liệu | Neo4j AuraDB | Neo4j Aura (đám mây) |
| Email | HTTP API của [Resend](https://resend.com) (không dùng SDK) | — |

```
Browser ──► frontend (Next.js) ──/api/* rewrite──► backend (Express) ──► AuraDB
                                                         └──────────────► Resend (emails)
```

Trình duyệt chỉ nói chuyện với tên miền của frontend. Next.js chuyển tiếp `/api/*` tới backend, nên API cùng nguồn gốc (same-origin). Nhờ vậy cookie phiên HttpOnly là cookie của bên thứ nhất, và API không cần CORS.

## Mô hình dữ liệu

```
(:User {id, email, emailVerified, name, avatarUrl, passwordHash?, role, createdAt, lastLoginAt,
        verifyTokenHash?, verifyTokenExpiresAt?, resetTokenHash?, resetTokenExpiresAt?, passwordChangedAt?,
        remindersEnabled?, reminderDaysBefore?, locale?,    // locale: ngôn ngữ của email nhắc ngày giỗ
        privacyVersion?, privacyAcceptedAt?, privacyWithdrawnAt?,    // thỏa thuận dữ liệu cá nhân đã đồng ý
        driveRefreshToken?, driveEmail?, driveConnectedAt?})         // Google Drive của họ, để sao lưu (token đã mã hóa)
(:User)-[:HAS_ACCOUNT]->(:Account {provider, providerAccountId})        // mỗi đăng nhập mạng xã hội đã liên kết một node
(:User)-[:REMINDS {since, lastSentFor?}]->(:Person)   // gửi email cho tôi trước ngày giỗ của người này

(:Tree {id, name, createdAt, bulkDelete?, birthCalendar?, deathCalendar?,
        backupFrequency?, backupKeep?, backupUserId?, backupLocale?, backupFolderId?, backupFolderUrl?,
        backupLastRunAt?, backupLastStatus?, backupLastError?,
        accessLinkHash?, accessLinkToken?, accessLinkCreatedBy?, accessLinkCreatedAt?, accessLinkExpiresAt?,
        accessRequestsNotifiedAt?})
    // cài đặt riêng từng cây; thiếu = bật xóa nhiều, 'solar' (thuộc tính cũ `calendar` là giá trị dự phòng cho cả hai)
    // backup*: lịch sao lưu lên Google Drive (thiếu = tắt)
    // accessLink*: liên kết xin quyền truy cập (token được băm để tra cứu, và mã hóa để quản trị viên sao chép lại)
(:User)-[:REQUESTS_ACCESS {message?, locale, createdAt}]->(:Tree)   // một yêu cầu đang chờ từ liên kết đó
(:User)-[:MEMBER_OF {role: 'owner' | 'admin' | 'editor' | 'viewer', since, personId?, scopeRootId?, scopeDepth?}]->(:Tree)
    // personId: "Đây là tôi"; scopeRootId/scopeDepth: người chỉnh sửa giới hạn trong một nhánh (thiếu = cả cây)

(:Person {id, treeId, firstName, lastName, gender, birthDate, deathDate, birthPlace, address, photoUrl, bio,
          createdAt, updatedAt})
(:Person)-[:PARENT_OF]->(:Person)     // có hướng: cha mẹ -> con
(:Person)-[:SPOUSE_OF]-(:Person)      // coi như vô hướng

(:Photo {id, treeId, storage, storageRef, contentType, size, uploadedBy, createdAt})   // một ảnh đã tải lên

(:Invitation {id, treeId, email, role, invitedBy, scopeRootId?, scopeDepth?, tokenHash, createdAt, expiresAt})

(:Keepalive {id, pingedAt, count})    // một node, được ghi mỗi ngày để AuraDB Free không bao giờ tạm dừng
```

- **Cây:** mỗi tài khoản được tạo kèm một cây riêng mà nó **làm chủ**, và có thể là thành viên của bao nhiêu cây khác cũng được.
- **Phạm vi:** mỗi người thuộc đúng một cây (`treeId`). Mọi truy vấn về người và quan hệ đều đi qua `/api/trees/:treeId/...` và kiểm tra quyền thành viên của người gọi trước. Người không phải thành viên nhận `404`, nên API thậm chí không để lộ là cây đó tồn tại.
- **Ngày tháng:** nhận `YYYY`, `YYYY-MM` hoặc `YYYY-MM-DD`, vì ngày tháng trong gia phả thường không đầy đủ. API từ chối liên kết `PARENT_OF` nếu nó khiến một người trở thành tổ tiên của chính mình.
- **Tuổi cha mẹ:** cha mẹ phải hơn con ít nhất 16 tuổi (`MIN_PARENT_AGE` trong [`backend/src/trees/rules.ts`](backend/src/trees/rules.ts)). Quy tắc được kiểm tra khi biết cả hai ngày sinh, ở độ chính xác chung của chúng (`1990` so với `2006-03-01` thì so năm), khi nối người, khi nhập dữ liệu và khi đổi ngày sinh. Ô chọn người làm mờ những người không thỏa điều kiện.

## Ngôn ngữ (English / Tiếng Việt)

Ô chọn ngôn ngữ (🌐) trên thanh trên cùng chuyển giao diện giữa tiếng Anh và tiếng Việt.

- **Lưu trữ:** lựa chọn được lưu trong cookie `lang`. Máy chủ đọc nó khi dựng trang, nên trang mở thẳng bằng ngôn ngữ đã chọn, và tiêu đề trang cùng `<html lang>` cũng theo đó.
- **Lần đầu truy cập:** khách có trình duyệt ưu tiên tiếng Việt sẽ thấy tiếng Việt.
- **Tên người:** trong tiếng Việt, họ đứng trước (*Nguyễn Văn An*), và biểu mẫu hỏi *Họ* trước *Tên*.
- **Bản dịch:** toàn bộ chữ trên giao diện nằm trong [`frontend/src/lib/i18n.ts`](frontend/src/lib/i18n.ts). Tiếng Anh là bản gốc, và TypeScript báo lỗi khi build nếu một ngôn ngữ khác thiếu khóa nào. Muốn thêm ngôn ngữ, thêm mã của nó vào `locales` và một từ điển có cùng các khóa.
- **Lỗi từ API:** một lỗi có thể kèm `code` bên cạnh chữ `error` tiếng Anh, ví dụ `{ "error": "A parent must be…", "code": "parentTooYoung" }`. Giao diện hiện bản dịch `error.<code>` của mình, và dùng chữ tiếng Anh với những mã nó không biết. Muốn dịch thêm một lỗi, truyền mã làm tham số thứ ba của `HttpError` và thêm `error.<code>` vào cả hai từ điển.
- **Chưa dịch:** phần lớn các lỗi API khác (kiểm tra dữ liệu, "Invalid email or password"…) và các email xác minh, đặt lại mật khẩu, lời mời vẫn bằng tiếng Anh.

## Nhập từ CSV hoặc Excel

Người chỉnh sửa và chủ sở hữu có thể thêm nhiều người một lúc ở trang **Nhập dữ liệu** (`/import`):

1. **Tải tệp mẫu.** Tệp mẫu có dạng Excel (`.xlsx`, kèm trang *Hướng dẫn*) hoặc CSV (UTF-8 có BOM, để Excel hiện đúng tiếng Việt). Tiêu đề cột theo ngôn ngữ giao diện, và các dòng ví dụ là một gia đình nhỏ.
2. **Điền thông tin.** Mỗi dòng một người. Chỉ cột **Tên** là bắt buộc. Đặt cho mỗi dòng một **ID** (mã bất kỳ, không trùng trong tệp), rồi nối người với nhau bằng **ID cha**, **ID mẹ** và **ID vợ/chồng** (cách nhau bằng `;`). Ngày tháng nhận `YYYY`, `YYYY-MM`, `YYYY-MM-DD` hoặc `DD/MM/YYYY`, cũng như ô ngày thật của Excel. Giới tính nhận Male/Female/Other, Nam/Nữ hoặc M/F.
3. **Tải lên** tệp `.csv`, `.xlsx` hoặc `.xls`. Trình duyệt đọc tệp bằng [SheetJS](https://sheetjs.com) và nhờ API kiểm tra (`dryRun`). Trang sau đó hiện bản xem trước và mọi lỗi kèm số dòng trong bảng tính.
4. **Khớp với người đã có trong cây.** Những dòng có thể là người đã có trong cây được liệt kê ở mục *Có thể đã có trong cây*. Với mỗi dòng, chọn *Người mới* hoặc *Chính là …* (xem bên dưới).
5. **Nhập.** Không có gì được ghi cho đến khi cả tệp hợp lệ, và khi đó mọi thứ được ghi trong một giao dịch (transaction).

### Nhập nhiều tệp, và người đã có trong cây

- **Có thể trùng:** bước kiểm tra so từng dòng với người trong cây. Một dòng khớp với một người khi có cùng các chữ trong tên, không tính dấu, hoa thường, thứ tự các chữ và cách chia tên giữa cột *Họ* và *Tên*, và năm sinh không khác nhau khi biết cả hai. Trùng cả năm sinh thì được đánh dấu ✓ và mặc định chọn *Chính là …*. Chỉ trùng tên thì mặc định là *Người mới*.
- **"Chính là …":** dòng đó không được tạo mới; nó đại diện cho người đã có. Các liên kết tới dòng đó trong tệp (*ID cha*, *ID mẹ*, *ID vợ/chồng*) sẽ nối vào người đó. Nhờ vậy tệp thứ hai có thể thêm một nhánh dưới những người đã có trong cây: thêm một dòng cho người tổ tiên đã có, khớp nó, rồi trỏ *ID cha* của các dòng mới vào đó. Thông tin của người đã có được giữ nguyên.
- **Kiểm tra với cây:** khi có dòng được khớp, bước kiểm tra vòng lặp tổ tiên tính cả các liên kết cha mẹ sẵn có trong cây, và quy tắc tuổi cha mẹ dùng ngày sinh trong cây của những người được khớp. Mỗi người trong cây chỉ khớp được với một dòng. Liên kết đã có không bị nhân đôi (`MERGE`).
- **Người bị trùng sẵn trong cây:** dùng **Gộp với…** (bên dưới).

Chi tiết:

- **Tiêu đề cột:** được so khớp lỏng, không tính hoa thường, dấu và ký tự đặc biệt, bằng tiếng Anh hoặc tiếng Việt (`First name`, `first_name`, `Tên`…). Bộ đọc lấy trang tính đầu tiên có cột "Tên" trong 10 dòng đầu. Cột nào không nhận ra sẽ được liệt kê và bỏ qua.
- **Người đã có:** ID chỉ nối các dòng trong cùng một tệp. Một dòng chỉ nối tới người đã có trong cây qua việc khớp (ở trên), và việc nhập không bao giờ thay đổi người đã có.
- **Các kiểm tra:** ID trùng (không phân biệt hoa thường), liên kết tới ID không tồn tại, tự liên kết với chính mình, cha trùng mẹ, ngày mất trước ngày sinh, và liên kết cha mẹ khiến một người thành tổ tiên của chính mình.
- **Giới hạn:** tối đa 2000 người mỗi tệp (yêu cầu 2 MB).
- **SheetJS:** được cài từ gói tarball trên CDN của SheetJS (`xlsx-0.20.3`), vì gói `xlsx` trên npm dừng ở bản 0.18.5 có lỗ hổng đã biết. Thư viện chỉ được tải ở trang nhập dữ liệu.

## Gộp người bị trùng

Khi một người có mặt hai lần trong cây (do nhập hai lần, hoặc thêm tay hai lần), người chỉnh sửa toàn cây mở một trong hai bản ghi và bấm **Gộp với…**:

1. **Chọn bản ghi kia.** Ô tìm kiếm điền sẵn tên người này. Cha mẹ, con và vợ chồng của chính họ không được đưa ra để chọn.
2. **So sánh.** Hai bản ghi hiện cạnh nhau. Ở chỗ cả hai có giá trị khác nhau (tên, ngày tháng, nơi chốn, ảnh, tiểu sử…), chọn giữ giá trị nào. Giá trị chỉ một bên có được giữ tự động.
3. **Gộp.** Trong một giao dịch, cha mẹ, con và vợ chồng của bản ghi kia chuyển sang người này (liên kết chung không bị nhân đôi). Cũng chuyển theo: nhắc ngày giỗ, liên kết *Đây là tôi* của các thành viên (trừ khi đã có thành viên khác liên kết với người này), và nhánh của người chỉnh sửa bắt đầu từ bản ghi kia. Sau đó bản ghi kia bị xóa, cùng ảnh đã tải lên mà không còn ai dùng.

Việc gộp bị từ chối, và không có gì thay đổi, khi hai người là cha mẹ, con hoặc vợ chồng của nhau (`409`, `mergeRelated`), khi một người là tổ tiên xa hơn của người kia nên kết quả sẽ là tổ tiên của chính mình (`mergeCycle`), hoặc khi kết quả vi phạm quy tắc tuổi cha mẹ. Người chỉnh sửa bị giới hạn trong một nhánh không gộp được, vì gộp có thể chuyển liên kết tới bất kỳ đâu trong cây.

## Ảnh của từng người

Ảnh của một người là một đường dẫn (`https://…`) hoặc ảnh tải lên từ biểu mẫu. Chức năng tải ảnh lên có khi đặt `PHOTO_STORAGE` (xem bước 4 bên dưới); trước đó biểu mẫu chỉ có ô đường dẫn.

1. **Chụp hoặc chọn ảnh.** Trên máy tính, nút ảnh mở hộp chọn tệp (JPEG, PNG, WebP hoặc GIF). Trên điện thoại và máy tính bảng, nút có **Chụp ảnh**, mở camera sau vì thường dùng để chụp lại ảnh in cũ, hoặc **Chọn ảnh có sẵn** từ thư viện.
2. **Chỉnh ảnh.** Ảnh mở trong trình chỉnh ảnh ([`PhotoEditor.tsx`](frontend/src/components/PhotoEditor.tsx)):
   - **Di chuyển và phóng to:** kéo để di chuyển; chụm hai ngón, cuộn chuột hoặc dùng thanh trượt để phóng to (tới 4×).
   - **Xoay và chỉnh nghiêng:** xoay từng góc vuông, cộng thanh trượt *Chỉnh nghiêng* (±20°) cho ảnh in chụp bị nghiêng.
   - **Khung:** *Vuông*, *Chân dung* (3:4) hoặc *Cả ảnh*. Một vòng tròn cho thấy phần ảnh đại diện tròn sẽ hiện.
   - **Thấy gì lưu nấy:** bản xem trước và ảnh được lưu được vẽ bằng cùng một đoạn mã ([`photoCrop.ts`](frontend/src/lib/photoCrop.ts)), và ảnh luôn phủ kín khung. Kết quả tối đa 1200 px và không bao giờ phóng to vượt độ phân giải của ảnh gốc. Biểu mẫu hiện bản xem trước nhưng chưa tải lên gì, nên *Hủy* không để lại gì.
3. **Lưu.** Trình duyệt thu nhỏ ảnh còn tối đa 1200 px và mã hóa lại thành WebP, hoặc JPEG với trình duyệt không mã hóa được WebP (Safari). Tệp dưới 200 KB đã đủ nhỏ thì giữ nguyên. Sau đó trình duyệt gửi dữ liệu tới `POST /api/trees/:treeId/photos`, và lưu đường dẫn trả về làm `photoUrl` của người đó.
4. **Lưu trữ.** API kiểm tra các byte đầu của tệp (SVG và mọi thứ khác bị từ chối với `415`), lưu nó vào S3 hoặc Google Drive, và ghi một node `:Photo`.
5. **Xem.** `photoUrl` có dạng `/api/trees/:treeId/photos/:id`. API kiểm tra quyền thành viên của cây rồi truyền tệp về. Bucket hay thư mục Drive không bao giờ cần công khai, và một ảnh chỉ thành viên của cây đó mới xem được.

Thay hoặc gỡ ảnh, xóa người, hoặc xóa tài khoản làm chủ cây sẽ xóa tệp đã lưu, trừ khi còn người khác trong cây dùng nó.

## Bố cục cây

Gia đình lớn (hàng trăm người) vẽ mỗi đời một hàng sẽ trở nên cực kỳ rộng: với một mẫu 237 người, 6 đời, chiều rộng gấp khoảng 32 lần chiều cao. Nút **Bố cục** trên thanh công cụ của cây có một lựa chọn hướng và ba tùy chọn để cây vừa màn hình:

| Tùy chọn | Tác dụng |
| --- | --- |
| Hướng | *Từ trên xuống* (mỗi đời một hàng) hoặc *Từ trái sang phải* (mỗi đời một cột, nên trên điện thoại chủ yếu cuộn xuống) |
| Vợ chồng xếp trên dưới | Vợ/chồng nằm dưới người trong họ, nên mỗi cặp chỉ rộng bằng một thẻ. Bố cục từ trái sang phải luôn xếp vợ chồng theo cách này |
| Xếp cột anh chị em chưa có con | Anh chị em chưa có con trong cây xếp thành cột ngắn (tối đa 4 người) treo từ một đường nối, sau những anh chị em đã có con. Thứ tự sinh được giữ trong từng nhóm |
| Xếp các chi thành nhiều hàng | Mỗi người con của cụ tổ mở một chi, vẽ trong khung riêng có nhãn (*Chi 2 · Nguyễn Văn Bình*). Các khung xuống dòng thành nhiều hàng gần với tỉ lệ màn hình, nối với cụ tổ bằng một đường dọc theo mép trái |

**Mặc định:** máy tính và máy tính bảng bắt đầu với *Từ trên xuống* và bật cả ba tùy chọn (mẫu ở trên còn khoảng 1,4 : 1). Điện thoại, tức màn hình hẹp hơn 768 px, bắt đầu với *Từ trái sang phải* và xếp cột anh chị em. Lựa chọn được ghi nhớ trong trình duyệt, riêng cho điện thoại và màn hình lớn, và *Về mặc định cho màn hình này* hoàn tác nó. Khi tắt hết tùy chọn và chọn *Từ trên xuống*, cây được vẽ theo kiểu cổ điển.

Bố cục hoàn toàn là mã trong [`frontend/src/lib/treeLayout.ts`](frontend/src/lib/treeLayout.ts). Nó tính vị trí của mọi thẻ và đường đi của mọi đường nối (kể cả các cột xếp chồng và đường trục của các hàng chi), và màn hình cây vẽ đúng các đường đó.

## Tải cây về (PNG hoặc PDF)

Các nút **Tải về: Ảnh / PDF** ở góc trên bên phải của cây lưu toàn bộ cây đang hiển thị: tất cả mọi người, hoặc nhánh bạn đang xem quanh. Không phụ thuộc bạn đã phóng to hay cuộn tới đâu.

- **Nội dung:** một tiêu đề (tên cây, cộng người đang xem quanh nếu có) và một dòng ghi số người và ngày hôm nay, rồi đến cây đúng như trên màn hình, gồm cả nhãn xưng hô và người đang chọn. Màu sắc theo giao diện sáng hoặc tối hiện tại.
- **Trong trình duyệt:** mọi việc diễn ra trên thiết bị của bạn, không gửi gì lên máy chủ. [`html-to-image`](https://github.com/bubkoo/html-to-image) vẽ sơ đồ, theo cách xuất ảnh mà React Flow hướng dẫn. [jsPDF](https://github.com/parallax/jsPDF) đóng gói nó thành PDF. Cả hai chỉ được tải khi bạn bấm.
- **Chữ tiếng Việt:** tiêu đề được vẽ bằng phông chữ của trình duyệt và nhúng vào ảnh, vì phông có sẵn của jsPDF không hiện được dấu tiếng Việt.
- **PDF:** một trang có kích thước bằng cây. Phóng to trên màn hình, hoặc in với "vừa trang".
- **Cây lớn:** ảnh bị giới hạn khoảng 16 triệu điểm ảnh để trình duyệt nào (kể cả Safari) cũng tạo được. Vì vậy cây rất lớn sẽ bị thu nhỏ; hãy xem quanh một nhánh để rõ hơn.

## Sao lưu lên Google Drive và xuất dữ liệu

Ở trang **Cài đặt**, chủ sở hữu và quản trị viên của cây có thể lấy dữ liệu của cây ra, và tự động lưu vào Google Drive theo lịch:

- **Tải về:** *Tải về CSV* và *Tải về JSON* (`GET /api/trees/:treeId/export?format=csv|json`).
  - **CSV:** đúng [mẫu nhập dữ liệu](#nhập-từ-csv-hoặc-excel) theo ngôn ngữ giao diện, UTF-8 có BOM. Mỗi người có một mã ngắn, được dùng trong các cột *Mã cha*, *Mã mẹ* và *Mã vợ/chồng*, nên tệp nhập lại được vào chính cây đó hoặc một cây mới. Ảnh tải lên trở thành đường dẫn đầy đủ, mở được với thành viên của cây.
  - **JSON:** mọi thứ, kèm mã gốc của ứng dụng (người với mọi trường, `parentOf`, `spouseOf`, cài đặt của cây).
- **Kết nối Google Drive:** mỗi quản trị viên kết nối **tài khoản Google của chính mình** (`/api/drive/connect`). Ứng dụng chỉ xin quyền `drive.file`, nên chỉ thấy và sửa được thư mục, tệp do nó tạo ra, không bao giờ đụng tới phần còn lại của Drive. Refresh token được lưu trên người dùng, mã hóa AES-256-GCM bằng khóa suy ra từ `JWT_SECRET`. *Ngắt kết nối* sẽ thu hồi token ở phía Google.
- **Lịch:** *Tắt*, *Chỉ khi tôi bấm "Sao lưu ngay"*, *Hằng ngày*, *Hằng tuần* hoặc *Hằng tháng*, và số bản giữ lại (1–100, mặc định 10). Mỗi lần sao lưu đặt một tệp CSV và một tệp JSON vào thư mục do ứng dụng tạo, *Sao lưu gia phả – {tên cây}* (hoặc *Family tree backups – {tree}*), rồi xóa các bản cũ nhất vượt quá số bản giữ lại. Tệp được nhận diện bằng dấu `appProperties`, nên việc dọn dẹp không bao giờ đụng tới tệp khác.
- **Drive của ai:** bản sao lưu vào Drive của quản trị viên đã lưu lịch. Nếu một quản trị viên khác lưu lịch, các lần sau sẽ vào Drive của người đó, trong một thư mục mới. Sao lưu không thành công, và *Cài đặt* ghi rõ lý do, khi người đó không còn là chủ sở hữu hay quản trị viên (`backupNotManager`), đã ngắt kết nối (`driveNotConnected`), hoặc đã thu hồi quyền ở Google (`driveAccessLost`).
- **Khi nào:** các bản sao lưu tới hạn được chạy bởi tác vụ cron giữ AuraDB hoạt động hằng ngày (03:00 UTC, tức 10:00 giờ Việt Nam), vì gói Hobby của Vercel chỉ cho hai cron job. Hằng ngày nghĩa là tối đa một lần mỗi ngày, hằng tuần là mỗi 7 ngày, hằng tháng là mỗi 30 ngày. *Sao lưu ngay* chạy ngay một lần (tối đa mỗi phút một lần).

Mã nguồn: [`backend/src/backups/`](backend/src/backups). Phần cài đặt Google xem ở [bước 3](#3-tạo-ứng-dụng-oauth-tùy-chọn).

## "Đây là tôi" và cách xem mặc định

Mọi thành viên của cây (chủ sở hữu, người chỉnh sửa hay người xem) đều có thể chọn một người và bấm **Đây là tôi**. Việc này liên kết tài khoản của họ với người đó trong cây đó. Nó chỉ thay đổi tư cách thành viên của chính họ (`MEMBER_OF.personId`), không thay đổi cây, nên bạn có thể là một người khác nhau trong mỗi cây mình tham gia. Bấm lại để bỏ liên kết.

- **Mở nhanh lần đầu:** cây mà bạn đã liên kết sẽ mở **quanh bạn, sâu 3 bước quan hệ** (`GET /graph?rootId=<you>&depth=3`). Tức là bạn, cha mẹ lên tới cụ, con cháu xuống tới chắt, anh chị em, cô dì chú bác, và vợ chồng, thay vì tải tất cả mọi người. Bạn được chọn sẵn, nên nhãn xưng hô tính theo bạn, và thẻ của bạn có nhãn **Bạn**.
- **Đi lại trong cây:** thanh công cụ hiện "*12 trên 240 người*" khi đang xem quanh. **Hiện tất cả** tải toàn bộ cây, ô chọn số đời mở rộng phạm vi xem, và **Quanh tôi** quay về bạn. Mở một người từ trang **Thành viên** sẽ đưa cây về quanh người đó.
- **Cây chưa liên kết** vẫn tải tất cả mọi người như trước.
- **Quy tắc:** mỗi người chỉ liên kết được với tối đa một thành viên của cây (`409`, `code: "personTaken"`). Nếu người đó bị xóa, liên kết đơn giản là không còn tác dụng. Ở trang **Chia sẻ**, chủ sở hữu thấy mỗi thành viên là người nào trong cây.

## Nhắc ngày giỗ

Mọi thành viên của cây, kể cả người chỉ xem, đều có thể nhận email trước ngày giỗ của một người.

1. **Chọn người.** Mở một người có ngày mất đầy đủ (năm, tháng và ngày) và bấm **🔔 Nhắc tôi ngày giỗ**. Việc này chỉ áp dụng cho bạn (`(:User)-[:REMINDS]->(:Person)`). Bấm lại để thôi nhắc.
2. **Bật nhắc nhở.** Ở trang **Tài khoản của tôi** (`/account`), mục *Nhắc ngày giỗ*, đánh dấu *Gửi email nhắc trước ngày giỗ* và chọn báo trước bao nhiêu ngày (0–30, mặc định 3). Cùng mục này liệt kê mọi người bạn được nhắc, mỗi người có nút *Thôi nhắc*.
3. **Nhận email.** Một tác vụ hằng ngày lúc khoảng 07:00 giờ Việt Nam gửi **mỗi người dùng một email** liệt kê mọi ngày giỗ còn đúng số ngày đó. Email được viết bằng ngôn ngữ bạn dùng ứng dụng gần nhất.

**Cách tính ngày giỗ:** theo lịch của cây cho ngày mất (xem phần Cài đặt).
- **Dương lịch:** cùng ngày và tháng. Người mất ngày 29 tháng 2 được nhớ vào ngày 28 tháng 2 những năm khác.
- **Âm lịch:** cùng ngày và tháng âm lịch mỗi năm, email ghi kèm ngày dương lịch và năm can chi. Theo lệ thường, người mất trong tháng nhuận được giỗ vào tháng thường cùng số, và người mất ngày 30 được giỗ ngày 29 khi tháng đó chỉ có 29 ngày. Giỗ đầu có thể rơi vào cùng năm dương lịch với ngày mất (ví dụ mất vào đầu tháng Một).

**Chi tiết:**
- Mỗi lời nhắc nhớ ngày giỗ gần nhất đã gửi, nên tác vụ không bao giờ gửi trùng.
- Rời khỏi hoặc bị gỡ khỏi một cây sẽ xóa các lời nhắc của bạn cho người trong cây đó, và xóa một người sẽ xóa các lời nhắc cho người đó. Ngày mất chỉ có năm hoặc năm–tháng thì không đặt nhắc được (`400`, `code: "reminderNeedsFullDate"`).
- Quy tắc tính ngày giỗ nằm trong [`backend/src/reminders/anniversary.ts`](backend/src/reminders/anniversary.ts), và backend có bản sao riêng của phần chuyển đổi âm lịch ([`backend/src/lib/lunar.ts`](backend/src/lib/lunar.ts)).

## Cách xưng hô

Chọn một người trên cây sẽ gắn nhãn cho mọi người liên quan theo cách người được chọn gọi họ. Có thể tắt bằng ô **Xưng hô** trên thanh công cụ. Cách xưng hô được tính trong trình duyệt ([`frontend/src/lib/kinship.ts`](frontend/src/lib/kinship.ts)) từ đường quan hệ ngắn nhất, ưu tiên quan hệ huyết thống hơn hôn nhân. Cách gọi theo thói quen phổ biến ở miền Bắc:

| Quan hệ | Cách gọi |
| --- | --- |
| Tổ tiên | Bố, Mẹ · Ông/Bà nội/ngoại · Cụ · Kỵ |
| Con cháu | Con trai/gái · Cháu nội/ngoại · Chắt · Chút · Chít |
| Anh chị em | Anh trai, Chị gái, Em trai/gái |
| Anh chị em của cha mẹ | Bác (lớn tuổi hơn cha/mẹ); bên nội: Chú, Cô; bên ngoại: Cậu, Dì |
| Vợ/chồng của họ | Bác, Thím, Dượng, Mợ |
| Anh chị em của ông bà | Ông bác, Ông chú, Bà cô, Ông cậu, Bà dì… |
| Anh chị em họ | Anh/Chị họ hoặc Em họ, theo vai vế của **cha mẹ** (con bác là anh/chị) |
| Cháu và các đời dưới | Cháu, Cháu họ, Chắt… |
| Hôn nhân | Vợ/Chồng · Con dâu/rể · Chị dâu, Anh rể, Em dâu/rể · Bố/Mẹ vợ/chồng · Anh/Chị/Em vợ/chồng · Thông gia · Bố dượng/Mẹ kế |

Vai vế (bác hay chú, anh hay em) dựa vào **ngày sinh**. Khi thiếu ngày sinh, cả hai cách gọi được hiện (ví dụ *Chú/Bác*), nên thêm năm sinh sẽ làm nhãn chính xác. Cách gọi miền Nam khác; ví dụ Dì và Cậu được dùng bất kể lớn hay nhỏ tuổi. Có thể chỉnh quy tắc trong `elderTerm`.

## Tài khoản và đăng nhập

### Email và mật khẩu, có xác minh

1. `POST /api/auth/register { name, email, password }` tạo tài khoản, đăng nhập, và gửi email chứa liên kết xác minh tới `<PUBLIC_APP_URL>/verify-email?token=…`. Liên kết có hạn 24 giờ.
2. Cho tới khi bấm vào liên kết, ứng dụng hiện màn hình **"Kiểm tra hộp thư của bạn"** có nút *Gửi lại* (`POST /api/auth/resend-verification`, tối đa mỗi phút một lần). Các API về cây và lời mời trả về `403`.
3. Mở liên kết sẽ gọi `POST /api/auth/verify-email { token }`, đánh dấu email đã xác minh.

Chi tiết:

- **Mật khẩu:** được băm bằng **scrypt** (`crypto` có sẵn của Node, với salt ngẫu nhiên cho từng người dùng). Mật khẩu dài 8–128 ký tự.
- **Thời gian đăng nhập:** đăng nhập luôn chạy một lần so sánh băm, kể cả với email không tồn tại, nên thời gian phản hồi không để lộ email nào đã có tài khoản.
- **Chống dò mật khẩu:** sau 10 lần đăng nhập sai với cùng IP và email, đăng nhập bị chặn 15 phút. Bộ đếm nằm trong bộ nhớ, nên trên máy chủ serverless nó chỉ áp dụng cho từng instance đang chạy.
- **Token trong liên kết:** liên kết xác minh và lời mời chứa token ngẫu nhiên 256 bit. Chỉ lưu giá trị băm SHA-256 của chúng, và mỗi liên kết chỉ dùng được một lần.
- **Địa chỉ bị chiếm trước:** nếu ai đó đăng ký một địa chỉ không phải của mình và không bao giờ xác minh, chủ thật của địa chỉ có thể đăng ký nó khi liên kết hết hạn (24 giờ), miễn là tài khoản kia vẫn trống.
- **Chống chiếm tài khoản:** nếu chủ của địa chỉ đăng nhập bằng Google hoặc GitHub trước, mật khẩu chưa xác minh bị gỡ và đăng nhập mạng xã hội được liên kết vào tài khoản đó.

### Quên và đổi mật khẩu

- **Quên mật khẩu:** *Quên mật khẩu?* trên màn hình đăng nhập mở `/forgot-password`. `POST /api/auth/forgot-password { email }` gửi email liên kết tới `<PUBLIC_APP_URL>/reset-password?token=…`, có hạn 1 giờ và dùng được một lần. Câu trả lời như nhau dù tài khoản có tồn tại hay không, và mỗi địa chỉ nhận tối đa một email mỗi phút.
- **Đặt lại:** `POST /api/auth/reset-password { token, password }` đặt mật khẩu mới và đăng nhập. Liên kết chứng minh người dùng kiểm soát hộp thư, nên nó cũng xác minh email. Tài khoản chỉ dùng Google/GitHub có thể dùng nó để thêm mật khẩu.
- **Đổi mật khẩu:** bấm vào tên của bạn trên thanh trên cùng để mở **Tài khoản của tôi** (`/account`). `POST /api/auth/change-password { currentPassword, newPassword }` cần mật khẩu hiện tại (sai 10 lần thì bị chặn 15 phút).
- **Các phiên khác:** đặt lại hoặc đổi mật khẩu sẽ lưu `passwordChangedAt`, và các phiên được cấp trước thời điểm đó nhận `401`. Trình duyệt thực hiện việc đổi nhận cookie mới và vẫn đăng nhập.

### Đổi email và xóa tài khoản

Cả hai đều ở **Tài khoản của tôi** (`/account`), và tài khoản có mật khẩu phải nhập lại mật khẩu để xác nhận (nhập sai được tính chung vào giới hạn với đăng nhập).

- **Đổi email:** `POST /api/auth/email { email, password? }` lưu địa chỉ mới ở trạng thái *chờ xác nhận* và gửi email liên kết tới địa chỉ đó: `<PUBLIC_APP_URL>/confirm-email?token=…`, có hạn 24 giờ. Địa chỉ cũ nhận một email thông báo, để phiên đăng nhập bị đánh cắp không thể lặng lẽ chuyển hướng tài khoản. Bấm vào liên kết (`POST /api/auth/email/confirm { token }`, không cần phiên đăng nhập) biến nó thành email đã xác minh của tài khoản. Trước đó, email cũ vẫn dùng được và `GET /api/auth/me` có `pendingEmail`. `DELETE /api/auth/email` hủy việc đổi. Nếu địa chỉ đã thuộc tài khoản khác, câu trả lời vẫn như bình thường nhưng địa chỉ đó nhận một email thông báo thay vì liên kết, để form không bị dùng để dò xem ai có tài khoản. Mỗi phút chỉ yêu cầu được một liên kết mới. Đổi hoặc đặt lại mật khẩu sẽ hủy yêu cầu đổi email đang chờ, và xác nhận địa chỉ mới sẽ hủy liên kết đặt lại mật khẩu đã gửi tới địa chỉ cũ. Cây gia phả, quyền thành viên, nhắc ngày giỗ và đăng nhập Google/GitHub gắn với tài khoản chứ không gắn với địa chỉ email, nên đều đi theo.
- **Xóa tài khoản:** `POST /api/auth/delete-account` với `{ password }`, hoặc `{ confirm: "<email của tài khoản>" }` với tài khoản chỉ dùng Google/GitHub. Thao tác này xóa tài khoản, các liên kết đăng nhập của nó và mọi cây nó làm chủ (người, ảnh, lời mời), gỡ nó khỏi các cây khác và xóa các lời nhắc của nó, rồi đăng xuất. Trang liệt kê những cây làm chủ mà người khác đang dùng, và gợi ý chuyển giao chúng bằng **Chuyển quyền sở hữu** trước.

### Thỏa thuận dữ liệu cá nhân (Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15)

Luật Bảo vệ dữ liệu cá nhân (hiệu lực từ 01/01/2026) yêu cầu sự đồng ý tự nguyện, rõ ràng, có thể rút lại. Ứng dụng xin sự đồng ý trước khi ai đó dùng cây gia phả:

- **Thỏa thuận:** trang `/privacy`, ai cũng đọc được. Bản tiếng Việt là bản áp dụng, kèm bản dịch tiếng Anh để tham khảo. Thỏa thuận nêu bên kiểm soát dữ liệu, dữ liệu được xử lý, bốn mục đích riêng biệt (email nhắc ngày giỗ là tùy chọn và được bật riêng), các nhà cung cấp dịch vụ và việc chuyển dữ liệu ra nước ngoài, thời gian lưu trữ, trách nhiệm của người dùng khi nhập dữ liệu người thân (người còn sống, trẻ em theo Điều 24, người đã mất), các quyền theo Điều 4 và cách thực hiện trong ứng dụng, và việc thông báo vi phạm. Nội dung nằm trong [`frontend/src/lib/privacyAgreement.ts`](frontend/src/lib/privacyAgreement.ts).
- **Người vận hành trang:** đặt `NEXT_PUBLIC_PRIVACY_CONTROLLER` (tên) và `NEXT_PUBLIC_PRIVACY_CONTACT` (email nhận yêu cầu về dữ liệu) trong project frontend. Khi chưa đặt, trang ghi là chưa cấu hình.
- **Lần đăng nhập đầu tiên:** đăng ký bằng email và mật khẩu phải đánh dấu một ô (mặc định không đánh dấu) có liên kết tới Thỏa thuận. Tài khoản Google/GitHub và tài khoản tạo trước khi có Thỏa thuận sẽ thấy Thỏa thuận toàn màn hình với hai ô xác nhận ở lần đăng nhập đầu. *Đồng ý và tiếp tục* gọi `POST /api/auth/privacy { version }`. *Tôi không đồng ý, đăng xuất* đăng xuất; tài khoản vẫn xóa được ở **Tài khoản của tôi**.
- **Thực thi:** khi chưa đồng ý phiên bản hiện hành, `/api/trees/*` và các endpoint lời mời trả `403` (`code: "consentRequired"`), và không có email nhắc ngày giỗ nào được gửi. Trang **Tài khoản của tôi** vẫn mở, để người dùng đọc Thỏa thuận, đồng ý, hoặc xóa tài khoản.
- **Lưu vết và rút lại:** phiên bản đã đồng ý và thời điểm đồng ý được lưu trên người dùng (`privacyVersion`, `privacyAcceptedAt`). *Rút lại sự đồng ý* ở **Tài khoản của tôi** (`DELETE /api/auth/privacy`) xóa hai giá trị đó và ghi `privacyWithdrawnAt`, nên cây, lời mời và email nhắc lại bị tạm dừng. Dữ liệu vẫn được giữ cho tới khi người dùng xóa.
- **Phiên bản mới:** sửa nội dung, rồi tăng `PRIVACY_VERSION` ở cả `frontend/src/lib/privacyAgreement.ts` và `backend/src/auth/privacy.ts`. Mọi người sẽ được hỏi lại, kèm thông báo là Thỏa thuận đã thay đổi. Trình duyệt còn hiển thị phiên bản cũ nhận `409` (`privacyOutdated`).

Thỏa thuận là bản khởi đầu viết cho ứng dụng này, không phải tư vấn pháp lý. Hãy nhờ người có chuyên môn rà soát cho trường hợp của bạn. Luật còn đặt cho bên kiểm soát các nghĩa vụ nằm ngoài ứng dụng, như hồ sơ đánh giá tác động xử lý và chuyển dữ liệu ra nước ngoài (Điều 20–21).

### Google và GitHub

Backend tự chạy luồng OAuth, nên không cần dịch vụ xác thực bên thứ ba. Email đã được nhà cung cấp xác minh thì coi như đã xác minh. Đăng nhập và đăng ký là cùng một luồng.

1. Frontend chuyển trình duyệt tới `/api/auth/:provider/login?next=/people`.
2. Backend lưu một cookie `state` có chữ ký, sống ngắn (cộng một PKCE verifier với Google) và chuyển hướng tới nhà cung cấp.
3. Nhà cung cấp quay về `<frontend>/api/auth/:provider/callback`, được chuyển tiếp tới backend. Backend kiểm tra state, lấy hồ sơ, rồi tạo hoặc cập nhật `User`.
4. Backend đặt cookie phiên và chuyển hướng tới `next`. Chỉ chấp nhận đường dẫn trong cùng trang web.

Nếu một người đăng nhập bằng cả Google và GitHub với cùng một email đã xác minh, cả hai được liên kết vào một người dùng.

### Phiên đăng nhập và CSRF

- **Cookie phiên:** `ft_session` chứa một JWT có chữ ký. Cookie là `HttpOnly`, `SameSite=Lax`, `Secure` khi dùng HTTPS, và tồn tại trong `JWT_EXPIRES_IN`. `POST /api/auth/logout` xóa nó.
- **CSRF:** mọi yêu cầu POST, PATCH hoặc DELETE cũng phải có header `X-Requested-With: fetch`. Trang web khác không thêm được header này nếu không qua CORS preflight, mà API không bao giờ chấp thuận.

## Chia sẻ cây bằng lời mời

### Vai trò

Vai trò chỉ tồn tại theo từng cây. Tài khoản không có vai trò: mọi tài khoản ngang nhau và là chủ sở hữu cây của chính mình.

| Vai trò | Được làm |
| --- | --- |
| `owner` (chủ sở hữu) | Toàn quyền với cây: mọi việc quản trị viên làm được, cộng thêm bổ nhiệm và gỡ quản trị viên, thêm gia đình mẫu, và chuyển giao cây (**Chuyển quyền sở hữu**). Mỗi cây có đúng một chủ sở hữu |
| `admin` (quản trị viên) | Sửa toàn cây, đổi tên cây, mời người và quản lý người chỉnh sửa, người xem (**Chia sẻ**), và đổi **Cài đặt** của cây (`/settings`). Quản trị viên không đổi hay gỡ được quản trị viên khác hoặc chủ sở hữu, và không đụng tới lời mời quản trị viên mới |
| `editor` (được chỉnh sửa) | Xem cây, và thêm, sửa, xóa người và quan hệ (ở mọi chỗ, hoặc chỉ trong một nhánh; xem bên dưới) |
| `viewer` (chỉ xem) | Chỉ xem cây và danh sách người |

### Giới hạn người chỉnh sửa trong một nhánh

Khi mời người chỉnh sửa (hoặc sau đó, bằng nút *Đổi* cạnh người chỉnh sửa ở trang **Chia sẻ**), chủ sở hữu có thể chọn **Chỉ một nhánh** thay vì **Toàn bộ cây**. Họ chọn người bắt đầu nhánh và nhánh gồm bao nhiêu đời, tính người đó là đời thứ nhất: *1 đời* chỉ là người đó, *2 đời* tới các con, *3 đời* tới các cháu, cho tới *11 đời*, hoặc *Tất cả các đời*, giới hạn ở 20 đời bên dưới người đó. API lưu số đời *bên dưới* người đó (`depth`, 0–20), nên `depth` = số đời − 1. Nhánh khi đó gồm:

- người đó,
- con cháu của họ (theo `PARENT_OF` đi xuống) tới đời đã chọn, và
- vợ chồng của tất cả những người trên.

Người chỉnh sửa vẫn **xem** được toàn cây. Họ chỉ **thay đổi** được người trong nhánh:

- **Sửa người:** bất kỳ ai trong nhánh.
- **Xóa người:** bất kỳ ai trong nhánh trừ người đầu nhánh, vì xóa người đó sẽ mất cả nhánh.
- **Thêm người mới:** chỉ dưới dạng con (trong giới hạn số đời) hoặc vợ/chồng của một người trong nhánh. Người không liên kết và cha mẹ mới sẽ nằm ngoài nhánh, nên thanh công cụ không có nút *+ Thêm người* và không dùng được **Nhập dữ liệu**.
- **Thêm hoặc gỡ quan hệ:** chỉ giữa hai người trong nhánh, và không bao giờ thêm cha mẹ cho người đầu nhánh. Một liên kết cha mẹ mới bị hủy nếu nó kéo những người vốn ở ngoài vào trong nhánh, ví dụ bằng cách rút ngắn đường xuống tới một người trước đó ở quá nhiều đời bên dưới.

API thực thi toàn bộ những điều này (`trees/branch.ts`, `403` với `code: "outsideBranch"`). Giao diện chỉ đưa ra những gì được phép. Nếu người đầu nhánh bị xóa, người chỉnh sửa đó không thay đổi được ai cho tới khi chủ sở hữu chọn nhánh mới. Khi chấp nhận lời mời, quyền rộng hơn được giữ: chủ sở hữu, rồi chỉnh sửa toàn cây, rồi chỉnh sửa một nhánh, rồi chỉ xem. Nếu cả quyền hiện tại và lời mời đều là một nhánh, nhánh của lời mời được dùng.

- Các tài khoản chỉ gặp nhau qua lời mời: chủ sở hữu mời một người, và chỉ khi đó người ấy mới thấy cây (và chủ sở hữu thấy họ là thành viên ở trang **Chia sẻ**).
- Không có trang hay API nào liệt kê tài khoản. Vận hành ứng dụng (truy cập cơ sở dữ liệu, cấu hình triển khai) là cấp "quản trị" duy nhất, và nó nằm ngoài ứng dụng.

### Luồng mời

1. **Gửi.** Chủ sở hữu cây (bất kỳ người dùng nào, với cây của mình) mở **Chia sẻ** (`/share`) khi đang xem cây đó, nhập địa chỉ email và chọn **Chỉ xem** (`viewer`) hoặc **Được chỉnh sửa** (`editor`). Người được mời nhận email có liên kết tới `<PUBLIC_APP_URL>/invite?token=…`, có hạn 7 ngày. Mời lại cùng địa chỉ sẽ thay liên kết cũ. Vì ai cũng đăng ký được, mỗi tài khoản chỉ gửi được tối đa 20 email mời (kể cả gửi lại) trong 24 giờ. Bộ đếm lưu trên node `User` của họ, nên vẫn đúng trên máy chủ serverless.
2. **Mở liên kết.** Trang đích cho biết ai mời họ vào cây nào.
   - **Chưa có tài khoản:** *Tạo tài khoản & tham gia* mở trang đăng ký với email điền sẵn. Đăng ký bằng đúng địa chỉ được mời sẽ tự động xác minh nó, vì liên kết chứng minh người đó kiểm soát hộp thư, và tham gia cây ngay. Đăng nhập Google hoặc GitHub cũng được.
   - **Đã có tài khoản:** đăng nhập, rồi bấm *Tham gia*. Chấp nhận qua liên kết cũng xác minh email nếu chưa xác minh.
3. **Dùng cây được chia sẻ.** **Ô chọn cây** trên thanh trên cùng liệt kê *Các cây của tôi* và *Được chia sẻ với tôi* (kèm quyền truy cập của từng cây). Người xem thấy giao diện chỉ đọc, và API cũng thực thi đúng quy tắc đó.
4. **Lời mời đang chờ** gửi tới email đã xác minh của người dùng cũng hiện thành dải thông báo trên trang cây, với *Đồng ý* và *Từ chối*. Hữu ích khi email bị thất lạc.

Lời mời chỉ có tác dụng với tài khoản có email **đã xác minh** trùng với địa chỉ được mời, nên liên kết bị chuyển tiếp hay lộ ra ngoài cũng vô dụng với người khác.

Ở trang **Chia sẻ**, chủ sở hữu và quản trị viên cũng có thể đổi vai trò thành viên, gỡ quyền truy cập, và gửi lại hoặc thu hồi lời mời đang chờ, trong phạm vi vai trò mình quản lý (xem bảng ở trên). Thành viên, kể cả quản trị viên, có thể rời khỏi cây được chia sẻ từ trang cây.

### Liên kết xin quyền truy cập

Ngoài lời mời qua email, chủ sở hữu hoặc quản trị viên có thể tạo một liên kết chia sẻ cho mỗi cây ở trang **Chia sẻ** (*Liên kết xin quyền truy cập*), dùng được 7 ngày, 30 ngày, hoặc đến khi tắt. Cách này hợp với nhóm chat gia đình, khi bạn không biết email của từng người.

1. **Chia sẻ ở bất cứ đâu.** `https://<trang>/join/<token>` chỉ hiện tên cây và người đã chia sẻ.
2. **Xin quyền.** Người nhận đăng nhập hoặc đăng ký (vẫn phải đồng ý Thỏa thuận dữ liệu cá nhân và xác minh email như thường lệ), có thể thêm lời nhắn ("Con là con trai bác Hai ở Đà Nẵng"), rồi bấm *Xin quyền truy cập*. Mỗi người chỉ có một yêu cầu đang chờ cho mỗi cây; một người chờ tối đa 10 cây, và một cây nhận tối đa 200 yêu cầu đang chờ. Người xin quyền có thể rút lại yêu cầu ngay trên trang đó.
3. **Thông báo.** Chủ sở hữu và quản trị viên nhận email liệt kê các yêu cầu đang chờ, tối đa một email mỗi giờ cho mỗi cây, để liên kết được chia sẻ rộng không làm ngập hộp thư. Mục **Chia sẻ** trên thanh trên cùng hiện số yêu cầu đang chờ.
4. **Quyết định.** Ở mục *Yêu cầu truy cập* trên trang **Chia sẻ**, chủ sở hữu hoặc quản trị viên chọn quyền (chỉ chủ sở hữu mới cấp được quyền quản trị viên) rồi bấm *Duyệt*, hoặc *Từ chối*. Duyệt hoạt động như chấp nhận lời mời: nếu người đó đã có quyền rộng hơn thì vẫn giữ. Người xin quyền nhận email trong cả hai trường hợp, bằng ngôn ngữ của họ.

Bản thân liên kết không cấp quyền gì, nên liên kết bị lộ ra ngoài chỉ cho phép người lạ *xin* quyền. Việc tra cứu chỉ dùng giá trị băm của token. Token còn được lưu dạng mã hóa (khóa suy ra từ `JWT_SECRET`), để quản trị viên sao chép lại liên kết về sau. *Tạo liên kết mới* và *Tắt liên kết* làm liên kết cũ ngừng hoạt động, còn các yêu cầu đã gửi vẫn ở lại để trả lời. Yêu cầu là quan hệ `(:User)-[:REQUESTS_ACCESS]->(:Tree)`, nên tự mất đi cùng tài khoản hoặc cây. Mã nguồn: [`backend/src/trees/accessRequests.ts`](backend/src/trees/accessRequests.ts).

### Chuyển giao cây

Chủ sở hữu có thể bấm **Chuyển quyền sở hữu** cạnh bất kỳ thành viên nào ở trang **Chia sẻ**. Sau khi xác nhận, thành viên đó trở thành chủ sở hữu và chủ cũ ở lại với vai trò quản trị viên. Cả hai thay đổi diễn ra trong một câu lệnh cơ sở dữ liệu, nên cây luôn có đúng một chủ sở hữu. Chỉ chủ mới có thể chuyển lại hoặc gỡ chủ cũ.

Chủ cũ khi đó không còn làm chủ cây nào, nên lần tới khi danh sách cây được tải họ nhận một cây riêng mới, trống (cùng bước cấp cây riêng cho mọi tài khoản). Chủ mới có thể làm chủ nhiều cây, tất cả nằm trong *Các cây của tôi*. Xóa một tài khoản chỉ xóa những cây nó đang làm chủ lúc đó, nên chuyển giao cây trước sẽ giữ được cây.

### Cài đặt (`/settings`)

- **Tài khoản của bạn:** mọi người dùng đổi được tên của mình, tên này hiện trên thanh trên cùng và với những người họ chia sẻ.
- **Cây gia phả này:** chủ sở hữu và quản trị viên có thể đổi tên cây (thành viên thấy tên mới) và đổi cài đặt của nó: xóa nhiều người cùng lúc và lịch. Chỉ cây đó bị ảnh hưởng.
- **Lịch (Dương lịch / Âm lịch):** ngày sinh và ngày mất có lịch riêng, *Dương lịch* (mặc định) hoặc *Âm lịch* Việt Nam. Nhiều gia đình ghi ngày sinh theo dương lịch và ngày mất (để tính ngày giỗ) theo âm lịch. Với mỗi loại ngày ghi theo âm lịch:
  - **Hiển thị:** ngày đầy đủ hiện theo âm lịch, ví dụ *Ngày 15 tháng 8 năm Giáp Thìn (1964) âm lịch* kèm ngày dương lịch bên dưới, và *15/8/1964 ÂL* ở trang Thành viên. Trên cây hiện năm âm lịch.
  - **Nhập ngày:** biểu mẫu thêm và sửa nhận ngày âm lịch (`YYYY-MM-DD` cộng ô *Tháng nhuận*), hiện ngày dương lịch tương ứng, và từ chối ngày âm lịch không có thật, như ngày 30 của tháng 29 ngày hay tháng nhuận mà năm đó không có.
  - **Lưu trữ:** ngày luôn được lưu là đúng ngày dương lịch tương ứng. Một ngày âm lịch đầy đủ ứng với đúng một ngày dương lịch và ngược lại, nên ngày mất gõ theo âm lịch luôn đọc lại đúng ngày âm lịch đó. Đổi lịch không thay đổi gì trong dữ liệu. Nhập dữ liệu, kiểm tra tuổi và API dùng ngày dương lịch.
  - **Ngày chỉ có năm và năm–tháng:** năm đơn lẻ được giữ như đã gõ. Năm và tháng thì không chuyển đổi được, vì một tháng có thể rơi vào trước hoặc sau Tết, nên với âm lịch biểu mẫu yêu cầu ngày đầy đủ hoặc chỉ năm.
  - **Chuyển đổi:** `frontend/src/lib/lunar.ts` dùng thuật toán của Hồ Ngọc Đức cho múi giờ Việt Nam (UTC+7), nên theo đúng lịch Việt Nam ở những chỗ khác lịch Trung Quốc (ví dụ Tết 1985 ở Việt Nam là ngày 21 tháng 1).
- **Tên cây mặc định:** cây của tài khoản mới được đặt tên theo ngôn ngữ người dùng đăng ký: *Gia phả của {tên}* bằng tiếng Việt, *{name}'s family tree* bằng tiếng Anh. API đọc từ cookie `lang` của ứng dụng, hoặc ngôn ngữ của trình duyệt. Chủ sở hữu đổi được thành tên bất kỳ, ví dụ *Gia phả họ Nguyễn*.

## API

Công khai (không cần phiên đăng nhập):

| Phương thức | Đường dẫn | Mô tả |
| --- | --- | --- |
| GET | `/api/health` | Kiểm tra API và kết nối AuraDB |
| GET | `/api/features` | `{ photoUploads }`: đã cấu hình nơi lưu ảnh hay chưa |
| GET | `/api/auth/providers` | Các nhà cung cấp đăng nhập đã cấu hình |
| GET | `/api/auth/:provider/login?next=` | Bắt đầu đăng nhập hoặc đăng ký bằng mạng xã hội |
| GET | `/api/auth/:provider/callback` | OAuth callback |
| POST | `/api/auth/register` | `{ name, email, password, inviteToken?, privacyVersion }`. `privacyVersion` là phiên bản Thỏa thuận dữ liệu cá nhân mà người dùng đã đánh dấu đồng ý. Tạo tài khoản, đăng nhập, và gửi email xác minh (hoặc tham gia cây được mời) |
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/verify-email` | `{ token }` từ liên kết xác minh |
| POST | `/api/auth/forgot-password` | `{ email }`. Gửi email liên kết đặt lại mật khẩu nếu tài khoản tồn tại |
| POST | `/api/auth/reset-password` | `{ token, password }`. Đặt mật khẩu mới, đăng xuất các phiên khác, và đăng nhập |
| POST | `/api/auth/logout` | Xóa cookie phiên |
| POST | `/api/invitations/preview` `{ token }` | Người mời, cây, email và vai trò cho trang đích của lời mời |
| POST | `/api/join/preview` `{ token }` | Cho trang xin quyền truy cập: `{ treeName, sharedBy, expired, status }`, với `status` là `anonymous`, `none`, `pending` hoặc `member` (thành viên nhận thêm `treeId`) |

Đã đăng nhập:

| Phương thức | Đường dẫn | Yêu cầu | Mô tả |
| --- | --- | --- | --- |
| GET | `/api/auth/me` | — | Người dùng đang đăng nhập, gồm cả `verificationRequired`, `hasPassword` và `consentRequired` |
| PATCH | `/api/auth/me` | — | `{ name }`. Đổi tên hiển thị của mình |
| GET / PATCH | `/api/auth/reminders` | — | Tùy chọn nhắc ngày giỗ: `{ enabled, daysBefore, people }`. PATCH nhận `{ enabled?, daysBefore? }` (0–30) và ghi nhớ ngôn ngữ giao diện cho email |
| POST / DELETE | `/api/auth/privacy` | — | POST `{ version }`: đồng ý Thỏa thuận dữ liệu cá nhân (`409`, `privacyOutdated`, nếu là phiên bản cũ). DELETE rút lại sự đồng ý |
| POST | `/api/auth/change-password` | — | `{ currentPassword, newPassword }`. Đăng xuất các phiên khác |
| POST / DELETE | `/api/auth/email` | — | POST `{ email, password? }`: gửi email liên kết xác nhận tới địa chỉ mới (và thông báo tới địa chỉ cũ). DELETE hủy việc đổi đang chờ |
| POST | `/api/auth/email/confirm` | công khai | `{ token }` từ liên kết: địa chỉ mới trở thành email của tài khoản |
| POST | `/api/auth/delete-account` | — | `{ password }` hoặc, khi không có mật khẩu, `{ confirm: email }`. Xóa tài khoản và các cây nó làm chủ, rồi đăng xuất |
| POST | `/api/auth/resend-verification` | — | Gửi email liên kết xác minh mới |
| GET / DELETE | `/api/drive` | đã xác minh | Kết nối Google Drive của bạn để sao lưu: `{ configured, connection: { email, connectedAt } \| null }`. DELETE ngắt kết nối và thu hồi quyền |
| GET | `/api/drive/connect?next=` | đã xác minh | Bắt đầu kết nối Google Drive (chuyển trang). Google quay về callback đăng nhập `/api/auth/google/callback`, rồi về `next` kèm `?drive=connected` (hoặc `cancelled`, `noAccess`, `expired`, `failed`) |
| POST | `/api/invitations/accept` | — | `{ token }`. Chấp nhận từ liên kết trong email (cũng xác minh email chưa xác minh nếu trùng) |
| GET | `/api/invitations/mine` | đã xác minh | Các lời mời đang chờ gửi tới email của tôi |
| POST / DELETE | `/api/join/request` | đã xác minh | POST `{ token, message? }`: xin quyền truy cập qua liên kết của cây (`{ status: "pending" }`, hoặc `"member"` kèm `treeId`). DELETE `{ token }` rút lại yêu cầu. `404` `accessLinkInvalid`, `410` `accessLinkExpired`, `429` `accessRequestLimit` / `accessRequestsFull` |
| POST | `/api/invitations/:id/accept` / `decline` | đã xác minh | Trả lời từ dải thông báo trong ứng dụng |
| GET | `/api/trees` | đã xác minh | Các cây của tôi: `{ id, name, role, settings, myPersonId, ownerName, personCount, memberCount, accessRequestCount }` (`accessRequestCount` bằng 0 trừ khi bạn là chủ sở hữu hoặc quản trị viên) |
| POST | `/api/trees` | đã xác minh | `{ name }`. Tạo một cây mới, trống do bạn làm chủ và trả về tóm tắt của nó. `409` (`code: "treeLimit"`) khi bạn đã làm chủ 20 cây |
| PATCH | `/api/trees/:treeId` | admin | `{ name }`. Đổi tên |
| DELETE | `/api/trees/:treeId` | owner | Xóa cây cùng người, quan hệ, ảnh (cả trong nơi lưu trữ), lời mời và quyền thành viên |
| POST | `/api/trees/:treeId/transfer` | owner | `{ userId }`. Thành viên đó trở thành chủ sở hữu; bạn trở thành quản trị viên |
| GET | `/api/trees/:treeId/persons?search=&limit=` | viewer | Liệt kê hoặc tìm người |
| GET | `/api/trees/:treeId/persons/:id` | viewer | Một người với đầy đủ thông tin, cộng cha mẹ, con và vợ chồng của họ ở dạng tóm tắt (`id, firstName, lastName, gender, birthDate, deathDate`) |
| POST / PATCH / DELETE | `/api/trees/:treeId/persons[/:id]` | editor | Tạo, cập nhật một phần (`null` xóa trường) hoặc xóa một người. POST nhận thêm `link: { relation: "parent" \| "child" \| "spouse", personId }` tùy chọn để thêm người mới làm người thân đó trong cùng giao dịch (bắt buộc với người chỉnh sửa theo nhánh) |
| POST | `/api/trees/:treeId/persons/merge` | editor | `{ keepId, removeId, fields? }`. Gộp `removeId` vào `keepId` (xem *Gộp người bị trùng*) và trả về người được giữ. `fields` là các giá trị đặt cho người được giữ. Không dành cho người chỉnh sửa theo nhánh |
| POST | `/api/trees/:treeId/persons/delete` | editor | `{ ids }` (tối đa 1000). Xóa những người đó và quan hệ của họ, trả về `{ deleted }`. `403` (`code: "bulkDeleteDisabled"`) khi cây tắt chức năng xóa nhiều người |
| GET / PUT | `/api/trees/:treeId/backup` | admin | Lịch sao lưu lên Google Drive và kết quả lần gần nhất. PUT `{ frequency: "off" \| "manual" \| "daily" \| "weekly" \| "monthly", keep? }` gửi bản sao lưu vào Drive đã kết nối của người gọi (`400`, `driveNotConnected`, nếu chưa có) |
| POST | `/api/trees/:treeId/backup/run` | admin | Sao lưu ngay và trả về kết quả (`409` `backupOff`; `429` `backupTooSoon` nếu chưa đầy một phút từ lần trước) |
| GET | `/api/trees/:treeId/export?format=csv\|json` | admin | Tải cây về dưới dạng CSV mẫu nhập dữ liệu hoặc tệp JSON đầy đủ |
| GET | `/api/trees/:treeId/settings` | viewer | Cài đặt của cây: `{ bulkDelete, birthCalendar, deathCalendar }`, lịch là `"solar"` hoặc `"lunisolar"` (cũng có trong `GET /api/trees`) |
| PATCH | `/api/trees/:treeId/settings` | admin | Đổi cài đặt của cây, ví dụ `{ "deathCalendar": "lunisolar" }`. Các cây khác không bị ảnh hưởng |
| POST / DELETE | `/api/trees/:treeId/relationships` | editor | `{ type: "PARENT_OF" \| "SPOUSE_OF", fromId, toId }`. DELETE nhận các giá trị này qua query parameter |
| POST | `/api/trees/:treeId/photos` | editor | Nội dung: chính tệp ảnh (JPEG, PNG, WebP hoặc GIF, tối đa 4 MB). Trả về `{ id, url }`; lưu `url` làm `photoUrl` của một người |
| GET | `/api/trees/:treeId/photos/:id` | viewer | Ảnh đã tải lên |
| GET | `/api/trees/:treeId/graph?rootId=&depth=` | viewer | `{ nodes, edges }` cho toàn cây hoặc `depth` (1–8) bước quanh `rootId`, duyệt theo chiều rộng. Người ở dạng tóm tắt (`id, firstName, lastName, gender, birthDate, deathDate`): đủ cho thẻ, bố cục và xưng hô. Thông tin khác (tiểu sử, địa chỉ, nơi sinh, ảnh) được tải bằng `/persons/:id` cho người được bấm vào |
| POST | `/api/trees/:treeId/import` | editor | `{ people: [{ row, key, firstName, …, fatherKey?, motherKey?, spouseKeys? }], matches?: { [rowKey]: personId }, dryRun? }`. Với `dryRun`, trả về `{ valid, rowErrors, summary, candidates }`, trong đó `candidates` liệt kê, theo khóa dòng viết thường, những người trong cây có thể là dòng đó (`strong`: trùng năm sinh). Nếu không, nhập mọi dòng trong một giao dịch, hoặc trả `400` kèm `rowErrors`. Dòng được khớp không được tạo; liên kết tới chúng đi tới người được khớp |
| POST | `/api/trees/:treeId/sample` | owner | Thêm gia đình mẫu (24 người, năm đời) vào cây trống và trả về `{ people, parentLinks, spouseLinks }`. `409` nếu cây đã có người |
| PUT / DELETE | `/api/trees/:treeId/reminders/:personId` | viewer | Bật hoặc tắt nhắc ngày giỗ của riêng bạn cho người đó. PUT cần ngày mất đầy đủ (`400`, `reminderNeedsFullDate`) |
| PUT | `/api/trees/:treeId/me` | viewer | `{ personId }`. "Đây là tôi": liên kết tư cách thành viên của bạn với người đó. `409` (`personTaken`) nếu thành viên khác đã liên kết với họ |
| DELETE | `/api/trees/:treeId/me` | viewer | Bỏ liên kết "Đây là tôi" |
| DELETE | `/api/trees/:treeId/membership` | editor/viewer | Rời khỏi cây được chia sẻ |
| GET | `/api/trees/:treeId/members` | admin | Các thành viên và vai trò |
| PATCH / DELETE | `/api/trees/:treeId/members/:userId` | admin | `{ role: "admin" \| "editor" \| "viewer", scope?: { rootId, depth } \| null }`, hoặc gỡ quyền truy cập. `scope` giới hạn người chỉnh sửa trong một nhánh; bỏ trống hoặc null nghĩa là toàn cây. Quản trị viên chỉ đổi được người chỉnh sửa và người xem, và chỉ chủ sở hữu mới cấp được `admin` (`403`, `code: "ownerOnly"`) |
| GET / POST / DELETE | `/api/trees/:treeId/access-link` | admin | Liên kết xin quyền truy cập: `{ url, createdAt, createdByName, expiresAt, expired } \| null`. POST `{ expiresInDays: 7 \| 30 \| null }` tạo liên kết mới (liên kết cũ ngừng hoạt động); DELETE tắt liên kết |
| GET | `/api/trees/:treeId/access-requests` | admin | Các yêu cầu đang chờ: `[{ userId, name, email, message, createdAt }]` |
| POST | `/api/trees/:treeId/access-requests/:userId/approve` | admin | `{ role, scope? }` như với thành viên (chỉ chủ sở hữu cấp được `admin`). Cấp quyền và gửi email cho người xin |
| DELETE | `/api/trees/:treeId/access-requests/:userId` | admin | Từ chối và gửi email cho người xin |
| GET / POST | `/api/trees/:treeId/invitations` | admin | Liệt kê, hoặc tạo `{ email, role: "admin" \| "editor" \| "viewer", scope? }` (gửi email). Chỉ chủ sở hữu mới mời được quản trị viên |
| GET | `/api/trees/:treeId/branch` | viewer | `{ scope: null }`, hoặc với người chỉnh sửa theo nhánh `{ scope, people: [{ id, level }] }` (`level` là số đời bên dưới người đầu nhánh, `null` với vợ/chồng) |
| POST | `/api/trees/:treeId/invitations/:id/resend` | admin | Liên kết và hạn mới, gửi email lại (lời mời quản trị viên: chỉ chủ sở hữu) |
| DELETE | `/api/trees/:treeId/invitations/:id` | admin | Thu hồi (lời mời quản trị viên: chỉ chủ sở hữu) |

Mã lỗi:

- `400`: dữ liệu không hợp lệ, liên kết đặt lại không hợp lệ hoặc đã hết hạn, hoặc mật khẩu hiện tại sai.
- `401`: không có phiên, phiên có từ trước khi đổi mật khẩu, hoặc email hay mật khẩu sai.
- `403`: vai trò không đủ, chưa đồng ý Thỏa thuận dữ liệu cá nhân (`consentRequired`), email chưa xác minh, lời mời dành cho địa chỉ khác, hoặc thiếu header CSRF.
- `404`: không tìm thấy, hoặc không phải thành viên.
- `409`: email đã được đăng ký, hoặc người đó đã có quyền truy cập.
- `410`: lời mời đã hết hạn.
- `429`: đăng nhập hoặc đổi mật khẩu quá nhiều lần, hoặc gửi lại email xác minh quá nhanh.
- `502`: không gửi được email.

## Dịch vụ cài đặt (390.000 VND)

Các bước 1–6 bên dưới dành cho người quen dùng công cụ lập trình. Nếu bạn không rành kỹ thuật, chúng tôi có thể cài đặt toàn bộ giúp bạn, để gia đình bạn có một bản ứng dụng riêng, chạy trên hosting miễn phí.

**Giá:** **390.000 VND**, trả một lần, cho một môi trường mới (một trang web cho gia đình bạn).

**Bao gồm:**

- Tạo các tài khoản **đứng tên bạn**: Neo4j **AuraDB Free** (cơ sở dữ liệu), **Vercel Hobby** (hosting miễn phí cho trang web và API), và **Resend** (gói miễn phí để gửi email đăng ký, lời mời, nhắc ngày giỗ).
- Triển khai ứng dụng, kết nối cơ sở dữ liệu, và cài các tác vụ chạy hằng ngày (giữ cơ sở dữ liệu hoạt động và gửi email nhắc ngày giỗ).
- Điền thông tin của bạn vào [Thỏa thuận dữ liệu cá nhân](#thỏa-thuận-dữ-liệu-cá-nhân-luật-bảo-vệ-dữ-liệu-cá-nhân-912025qh15): tên bạn là người vận hành trang, và email liên hệ của bạn.
- Tùy chọn: đăng nhập bằng Google, lưu ảnh tải lên vào Google Drive của bạn, và tự động sao lưu cây gia phả lên Google Drive.
- Kiểm tra đăng ký, xác minh email, lời mời và cây gia phả đều hoạt động, rồi hướng dẫn ngắn cách dùng ứng dụng và mời người thân.

**Không bao gồm:**

- **Tên miền riêng:** địa chỉ như `giaphahonguyen.vn` tốn thêm phí và do bạn tự mua. Nếu không có, trang dùng địa chỉ miễn phí dạng `gia-dinh-ban.vercel.app`.
- Nhập dữ liệu gia đình, nâng cấp về sau và hỗ trợ lâu dài. Có thể thỏa thuận riêng.
- Các gói trả phí, nếu gia đình bạn dùng vượt mức miễn phí.

**Bạn cần chuẩn bị:** một địa chỉ email của bạn (Gmail là được), truy cập được email đó trong lúc cài đặt để xác nhận các tài khoản mới, và khoảng 30 phút cho buổi hướng dẫn.

**Lưu ý về các gói miễn phí** (tại thời điểm viết; nhà cung cấp có thể thay đổi):

- **AuraDB Free** dư sức cho một cây gia phả vài nghìn người. Tác vụ hằng ngày của ứng dụng giữ cho cơ sở dữ liệu không bị tạm dừng vì không hoạt động.
- **Vercel Hobby** dành cho mục đích cá nhân, phi thương mại, phù hợp với trang web gia đình.
- **Gói miễn phí của Resend** giới hạn số email mỗi ngày và mỗi tháng, đủ dùng cho một gia đình.

**Dữ liệu vẫn là của bạn.** Mọi tài khoản đều đứng tên bạn và được bàn giao cho bạn khi xong, kèm mật khẩu. Chúng tôi không giữ quyền truy cập sau đó. Bạn là người vận hành trang và là bên kiểm soát dữ liệu theo Luật 91/2025/QH15.

**Cách đặt dịch vụ:** [gửi yêu cầu trên GitHub](https://github.com/triluu-gms/giapha-free/issues/new?title=Setup%20service%20request) kèm tên của bạn, tên muốn đặt cho trang, và ngôn ngữ bạn muốn dùng (Tiếng Việt hoặc English). Chúng tôi sẽ trả lời kèm thông tin thanh toán và hẹn thời gian cài đặt.

## 1. Tạo instance AuraDB

1. Vào <https://console.neo4j.io> và tạo một instance. Gói **AuraDB Free** là đủ.
2. Tải tệp thông tin đăng nhập được đề nghị. Tệp chứa `NEO4J_URI`, `NEO4J_USERNAME` và `NEO4J_PASSWORD`, và mật khẩu chỉ hiện một lần.
3. Đợi tới khi trạng thái instance là **Running**.

## 2. Thiết lập gửi email (Resend)

Không có `RESEND_API_KEY`, backend **in email ra console** thay vì gửi. Khi chạy trên máy, bạn có thể chép liên kết xác minh hoặc lời mời từ terminal. Để gửi thật:

1. Tạo tài khoản ở <https://resend.com> và một API key trong **API Keys**. Đặt nó vào `RESEND_API_KEY`.
2. Trong **Domains**, thêm và xác minh một tên miền bạn sở hữu (vài bản ghi DNS). Sau đó đặt `EMAIL_FROM`, ví dụ `Gia phả <noreply@yourdomain.com>`.
   - Khi chưa xác minh tên miền, địa chỉ gửi thử `onboarding@resend.dev` của Resend chỉ gửi tới email của chính tài khoản Resend của bạn.

Muốn dùng nhà cung cấp khác (SES, SendGrid, SMTP), chỉ cần sửa [`backend/src/email/mailer.ts`](backend/src/email/mailer.ts).

## 3. Tạo ứng dụng OAuth (tùy chọn)

Đăng ký bằng email và mật khẩu vẫn hoạt động khi không có bước này. Callback URL trỏ tới URL của **frontend**, vì frontend chuyển tiếp `/api/*` tới backend.

**Google**: <https://console.cloud.google.com/apis/credentials>

1. Cấu hình OAuth consent screen (External; thêm chính bạn làm test user khi ứng dụng đang ở chế độ thử nghiệm).
2. Create credentials → OAuth client ID → **Web application**.
3. Trong Authorized redirect URIs, thêm:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://<frontend>.vercel.app/api/auth/google/callback`
4. Chép client ID và secret vào `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET`.
5. **Để sao lưu lên Google Drive** (tùy chọn; dùng chung client này):
   - Bật **Google Drive API** cho project (APIs & Services → Library).
   - Không cần thêm redirect URI: Google quay về callback đăng nhập ở trên (`/api/auth/google/callback`), và callback này chuyển tiếp việc kết nối Drive.
   - Trên consent screen, thêm scope `.../auth/drive.file`. Đây là scope không nhạy cảm. Khi ứng dụng chưa publish, chỉ test user kết nối được và quyền truy cập hết hạn sau 7 ngày. Hãy publish consent screen (**In production**) để kết nối không bị hết hạn. Google có thể hiện cảnh báo "ứng dụng chưa được xác minh" cho tới khi bạn xác minh ứng dụng.

**GitHub**: <https://github.com/settings/developers> → New OAuth App

1. Đặt callback URL là `http://localhost:3000/api/auth/github/callback`.
2. Ứng dụng GitHub chỉ cho một callback URL, nên tạo ứng dụng thứ hai cho môi trường production với `https://<frontend>.vercel.app/api/auth/github/callback`.
3. Chép các giá trị vào `GITHUB_CLIENT_ID` và `GITHUB_CLIENT_SECRET`.

Muốn thêm nhà cung cấp khác, thêm một mục trong [`backend/src/auth/providers.ts`](backend/src/auth/providers.ts).

## 4. Thiết lập nơi lưu ảnh (tùy chọn)

Không có `PHOTO_STORAGE`, ảnh của mọi người chỉ có thể là đường dẫn. Chọn một nơi lưu trữ:

**Tương thích S3** (`PHOTO_STORAGE=s3`): AWS S3, Cloudflare R2, MinIO, Backblaze B2, Wasabi…

1. Tạo một bucket **riêng tư**. Không cần quyền truy cập công khai hay CORS, vì chỉ backend làm việc với nó.
2. Tạo access key có quyền `PutObject`, `GetObject` và `DeleteObject` trên bucket đó.
3. Đặt `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` và `S3_REGION`. Với dịch vụ không phải AWS, đặt thêm `S3_ENDPOINT`. Ví dụ Cloudflare R2 dùng `https://<account-id>.r2.cloudflarestorage.com` với `S3_REGION=auto`.

**Google Drive** (`PHOTO_STORAGE=gdrive`):

1. Trong Google Cloud console, bật **Google Drive API** cho project của bạn.
2. Tạo một thư mục để chứa ảnh và chép id của nó (phần cuối URL) vào `GDRIVE_FOLDER_ID`.
3. Chọn cách backend đăng nhập:
   - **Service account** (Google Workspace): tạo service account và một khóa JSON, rồi đặt **toàn bộ nội dung** khóa vào `GDRIVE_SERVICE_ACCOUNT_JSON` (nguyên văn, hoặc mã hóa base64). Service account không có dung lượng lưu trữ riêng, nên thư mục phải nằm trong một **shared drive**, với email của service account được thêm với quyền *Content manager*.
   - **Tài khoản Google của bạn** (dùng được với tài khoản Gmail miễn phí): lấy refresh token với scope `https://www.googleapis.com/auth/drive`, ví dụ từ [OAuth Playground](https://developers.google.com/oauthplayground) bằng OAuth client của chính bạn. Đặt nó vào `GDRIVE_REFRESH_TOKEN`. Mặc định client là `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; đặt `GDRIVE_CLIENT_ID`/`GDRIVE_CLIENT_SECRET` để dùng client khác. Hãy publish OAuth consent screen (**In production**), vì refresh token cấp khi đang ở trạng thái *Testing* hết hạn sau 7 ngày.

Ảnh đã lưu vẫn ở nguyên chỗ cũ nếu sau này bạn đổi nơi lưu trữ, nhưng API chỉ đọc từ nơi đang cấu hình.

## 5. Chạy trên máy

Cần Node.js 20 trở lên.

```powershell
# Backend: http://localhost:4000
cd backend
npm install
copy .env.example .env      # điền AuraDB, JWT_SECRET, và nếu muốn thì Resend và OAuth
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # tạo giá trị cho JWT_SECRET
npm run db:init             # ràng buộc, chỉ mục và chuyển đổi dữ liệu (chạy lại nhiều lần vẫn an toàn)
npm run dev
```

```powershell
# Frontend: http://localhost:3000
cd frontend
npm install
copy .env.example .env.local   # API_URL=http://localhost:4000
npm run dev
```

Mở <http://localhost:3000> (không phải cổng 4000) và bấm **Đăng ký**. Nếu chưa cấu hình Resend, chép liên kết xác minh từ terminal của backend.

- **Dữ liệu mẫu:** để thêm gia đình mẫu người Việt 24 người, năm đời vào cây riêng của bạn, bấm **Thêm gia đình mẫu** trên cây trống, hoặc chạy `npm run db:seed` trong `backend/`. Dùng `-- --owner someone@example.com` cho cây của người dùng khác. Bản thân gia đình mẫu được định nghĩa trong [`backend/src/trees/sampleFamily.ts`](backend/src/trees/sampleFamily.ts).
- **Khởi động lại:** chạy lại `npm run dev` sau khi đổi `next.config.ts` hoặc `API_URL`.

**Nâng cấp từ phiên bản cũ:** chạy `npm run db:init` một lần. Lệnh này sẽ:

- Tạo cây riêng cho mỗi người dùng đã có và chuyển người của họ vào đó.
- Gỡ các vai trò tài khoản cũ (`admin`, `user`, …); chỉ còn vai trò theo từng cây.
- Đánh dấu email đăng nhập mạng xã hội đã có là đã xác minh.
- Thêm chỉ mục cho ảnh tải lên, cho việc đổi email và cho liên kết xin quyền truy cập.
- Gỡ node `(:Settings)` cũ dùng chung toàn ứng dụng; cài đặt giờ được lưu theo từng cây.

Tài khoản đăng ký trước đây bằng email và mật khẩu sẽ được yêu cầu xác minh email ở lần đăng nhập tới. Mọi tài khoản đã có sẽ được yêu cầu đồng ý Thỏa thuận dữ liệu cá nhân ở lần đăng nhập tới.

## 6. Triển khai lên Vercel

Tạo **hai project Vercel** từ cùng một Git repository, mỗi project một thư mục.

### Project backend

- **Root Directory:** `backend`
- **Framework Preset:** Other. `vercel.json` tự đặt giá trị này (`"framework": null`), nên vẫn áp dụng kể cả khi Vercel nhận diện project là Express.
- **Cách build:** Vercel chạy `npm run vercel-build`, lệnh này biên dịch TypeScript bằng `tsc` vào `dist/` và tạo `public/` (chỉ có `robots.txt`). `vercel.json` chuyển mọi yêu cầu tới `api/index.js`, một điểm vào bằng JavaScript thuần nạp ứng dụng Express đã biên dịch từ `dist/`. Vercel không bao giờ tự biên dịch TypeScript: với TypeScript 7, bước TypeScript riêng của nó thất bại (`TS2688: Cannot find type definition file for 'node'`, rồi "TypeScript did not emit an output").
- **Kiểm tra trên máy trước khi triển khai:** chạy `vercel pull --yes` một lần, rồi `vercel build --prod`. Kết quả phải có `.vercel/output/functions/api/index.func`.
- **Biến môi trường:**

| Biến | Giá trị |
| --- | --- |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | Từ tệp thông tin đăng nhập AuraDB |
| `JWT_SECRET` | Một chuỗi ngẫu nhiên dài. Dùng giá trị khác với môi trường phát triển trên máy |
| `PUBLIC_APP_URL` | `https://<frontend>.vercel.app`, URL của **frontend**. Dùng trong liên kết email và OAuth callback |
| `RESEND_API_KEY`, `EMAIL_FROM` | Từ Resend (xem bước 2) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Tùy chọn |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Tùy chọn, từ ứng dụng GitHub cho production |
| `CRON_SECRET` | Một chuỗi ngẫu nhiên dài. Bật tác vụ giữ AuraDB hoạt động hằng ngày và email nhắc ngày giỗ bên dưới |
| `PHOTO_STORAGE` và các thiết lập `S3_*` hoặc `GDRIVE_*` của nó | Tùy chọn, để tải ảnh lên (xem bước 4) |

### Giữ AuraDB Free luôn hoạt động

AuraDB Free tạm dừng instance không có thao tác ghi trong vài ngày, và xóa nó nếu cứ tạm dừng như vậy. Để tránh điều đó, `vercel.json` lên lịch một tác vụ **Vercel Cron** mỗi ngày lúc 03:00 UTC. Tác vụ gọi `GET /api/cron/keepalive`, ghi một node duy nhất `(:Keepalive {id: 'aura-free', pingedAt, count})`. Cùng tác vụ đó sau đó chạy các bản [sao lưu lên Google Drive](#sao-lưu-lên-google-drive-và-xuất-dữ-liệu) đã tới hạn, trong tối đa khoảng 40 giây; phần còn lại chạy vào ngày hôm sau.

- **Xác thực:** Vercel gửi `Authorization: Bearer <CRON_SECRET>` và endpoint từ chối mọi thứ khác. Không có `CRON_SECRET` thì nó trả `503` và không ghi gì.
- **Kiểm tra:** trong project backend, mở **Settings → Cron Jobs** để xem các lần chạy hoặc chạy thử bằng tay. Sau đó chạy `MATCH (k:Keepalive) RETURN k` trong Aura console.
- **Cron job** chỉ chạy trên bản triển khai production. Gói Hobby cho phép tác vụ hằng ngày, và phút chạy chính xác có thể xê dịch trong giờ đó.

### Email nhắc ngày giỗ

Một tác vụ Vercel Cron hằng ngày thứ hai, lúc 00:00 UTC (07:00 giờ Việt Nam), gọi `GET /api/cron/reminders` để gửi email nhắc các ngày giỗ đã tới hạn (xem [Nhắc ngày giỗ](#nhắc-ngày-giỗ)). Nó dùng cùng cách xác thực `CRON_SECRET` và cần `RESEND_API_KEY` để gửi thật. Nó trả về `{ date, emails, failed }` và chạy lại trong cùng ngày vẫn an toàn. Để thử trên máy, đặt `CRON_SECRET` trong `backend/.env` và chạy `curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:4000/api/cron/reminders`. Không có `RESEND_API_KEY` thì email được in ra console.

### Project frontend

- **Root Directory:** `frontend`
- **Framework Preset:** Next.js (tự nhận diện)
- **Biến môi trường:**
  - `API_URL=https://<backend>.vercel.app`. Quy tắc rewrite `/api/*` được tạo lúc build, nên hãy triển khai lại sau khi đổi giá trị này.
  - `NEXT_PUBLIC_PRIVACY_CONTROLLER` và `NEXT_PUBLIC_PRIVACY_CONTACT`: người vận hành trang và email nhận yêu cầu về dữ liệu cá nhân, hiển thị trong [Thỏa thuận dữ liệu cá nhân](#thỏa-thuận-dữ-liệu-cá-nhân-luật-bảo-vệ-dữ-liệu-cá-nhân-912025qh15). Cũng được đưa vào lúc build, nên hãy triển khai lại sau khi đổi.

Khi cả hai đã triển khai, mở `https://<frontend>.vercel.app/api/health`. Kết quả phải là `{"status":"ok"}`, cho thấy proxy đang hoạt động.

Đăng nhập, liên kết xác minh và liên kết mời đều dùng `PUBLIC_APP_URL`. Các bản triển khai preview ở URL khác cần đăng nhập riêng.

Cũng có thể triển khai bằng CLI: `npm i -g vercel`, rồi chạy `vercel` trong từng thư mục.

## Ghi chú bảo mật

- Token phiên chỉ nằm trong cookie HttpOnly. Script trên trang không đọc được nó, và nó không bao giờ xuất hiện trong URL hay `localStorage`. Cookie lưu token ở dạng mã hóa (AES-256-GCM, khóa suy ra từ `JWT_SECRET`), cookie trạng thái OAuth cũng vậy, nên không đọc được gì từ kho cookie của trình duyệt. Cookie phiên có từ trước thay đổi này vẫn được chấp nhận một lần rồi được ghi lại ở dạng mã hóa.
- Backend vẫn truy cập được qua URL `*.vercel.app` riêng của nó, nhưng cookie phiên thuộc tên miền của frontend và không bao giờ được gửi tới đó.
- Đổi `JWT_SECRET` sẽ đăng xuất mọi người ngay lập tức.
- Số yêu cầu được giới hạn theo IP của người dùng bằng [`express-rate-limit`](https://github.com/express-rate-limit/express-rate-limit) ([`auth/rateLimit.ts`](backend/src/auth/rateLimit.ts)): 300 yêu cầu mỗi phút cho toàn bộ API, 120 mỗi phút cho `/api/auth`, và 30 mỗi 15 phút cho đăng nhập, đăng ký, mật khẩu, email, xóa tài khoản và đăng nhập Google/GitHub. Vượt giới hạn, API trả `429` với `code: "rateLimited"`. Bộ đếm nằm trong bộ nhớ, nên trên máy chủ serverless mỗi instance đang chạy đếm riêng. Đăng nhập sai mật khẩu còn được đếm theo email (30 lần mỗi 15 phút), bất kể từ địa chỉ IP nào.
- IP của người dùng chỉ được lấy từ `X-Forwarded-For` khi proxy đáng tin đặt header đó: trên Vercel (`VERCEL=1`) là của nền tảng, nơi khác chỉ proxy trên cùng máy, trừ khi đặt `TRUST_PROXY` (số tầng proxy, `true`/`false`, hoặc danh sách địa chỉ). Tin vào header mà người dùng tự viết được sẽ cho phép ai cũng đặt lại được giới hạn.
- Trang web gửi các header bảo mật trên mọi trang ([`frontend/next.config.ts`](frontend/next.config.ts)): Content Security Policy (script, dữ liệu và khung chỉ từ chính trang; `frame-ancestors 'none'` chống clickjacking), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (token trong liên kết không lọt ra qua Referer), `nosniff`, Permissions-Policy và HSTS.
- Ảnh tải lên được xóa metadata (EXIF có vị trí GPS, XMP, IPTC, chữ) trước khi lưu ([`trees/imageMetadata.ts`](backend/src/trees/imageMetadata.ts)). Đường dẫn ảnh phải là `https://`.
- Token trong liên kết đặt lại mật khẩu, xác minh, đổi email và lời mời được xóa khỏi thanh địa chỉ sau khi đọc, và các yêu cầu xem trước gửi token trong body thay vì URL.
- Khi đăng nhập Google/GitHub tiếp quản một tài khoản đã được đăng ký bằng email đó nhưng chưa từng xác minh, mọi phiên đăng nhập cũ của tài khoản đó bị kết thúc, và yêu cầu đổi email cùng liên kết đặt lại mật khẩu đang chờ bị hủy.
- Đăng xuất xóa cookie trong trình duyệt đó. Đổi hoặc đặt lại mật khẩu đăng xuất tài khoản ở mọi nơi khác. Muốn cắt quyền của ai đó với cây của bạn, gỡ họ ở trang **Chia sẻ**.
- Neo4j driver là một singleton được các lần gọi serverless đang chạy dùng lại.
- `npm run build && npm start` trong `backend/` chạy API như một máy chủ Node bình thường, ví dụ trên Render, Railway hoặc Fly.io.
