import type { Locale } from './i18n';

/**
 * Version of the personal data agreement. Must equal PRIVACY_VERSION in
 * backend/src/auth/privacy.ts. Bump both when the text below changes
 * materially: every user is then asked to accept it again.
 */
export const PRIVACY_VERSION = '2026-10-14';

/** Who runs this deployment, shown as the data controller. Set at build time. */
const CONTROLLER = process.env.NEXT_PUBLIC_PRIVACY_CONTROLLER?.trim();
const CONTACT = process.env.NEXT_PUBLIC_PRIVACY_CONTACT?.trim();

/** A paragraph, or a bulleted list. */
export type AgreementBlock = string | { list: string[] };

export interface AgreementSection {
  title: string;
  blocks: AgreementBlock[];
}

export interface Agreement {
  title: string;
  /** Shown under the title: version and legal basis. */
  subtitle: string;
  /** Present on translations: the Vietnamese text is the one that applies. */
  translationNote?: string;
  sections: AgreementSection[];
  /** The two checkboxes on the consent screen. */
  confirmRead: string;
  confirmOthers: string;
}

function vi(): Agreement {
  const controller = CONTROLLER || 'Người hoặc tổ chức vận hành trang web này (chưa cấu hình tên)';
  const contact = CONTACT || '(chưa cấu hình địa chỉ liên hệ)';
  return {
    title: 'Thỏa thuận chia sẻ và xử lý dữ liệu cá nhân',
    subtitle: `Phiên bản ${PRIVACY_VERSION} · Theo Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15`,
    confirmRead:
      'Tôi đã đọc, hiểu và đồng ý cho xử lý dữ liệu cá nhân của tôi theo các mục đích 1, 2 và 3 của Thỏa thuận này.',
    confirmOthers:
      'Tôi cam kết chỉ nhập và chia sẻ dữ liệu cá nhân của người khác khi có cơ sở hợp pháp, như nêu tại mục 7.',
    sections: [
      {
        title: '1. Căn cứ và phạm vi',
        blocks: [
          'Thỏa thuận này được lập theo Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 (Quốc hội thông qua ngày 26/6/2025, có hiệu lực từ ngày 01/01/2026) và các văn bản hướng dẫn thi hành. Thỏa thuận áp dụng cho mọi dữ liệu cá nhân được xử lý khi bạn dùng ứng dụng Gia phả này: dữ liệu về chính bạn và dữ liệu về người thân mà bạn hoặc thành viên khác nhập vào cây gia phả.',
          'Bạn cần đồng ý với Thỏa thuận này trước khi dùng cây gia phả. Sự im lặng hoặc không phản hồi không được coi là đồng ý.',
        ],
      },
      {
        title: '2. Bên kiểm soát và xử lý dữ liệu',
        blocks: [
          `Bên kiểm soát và xử lý dữ liệu cá nhân: ${controller}.`,
          `Liên hệ về dữ liệu cá nhân: ${contact}.`,
          'Mỗi chủ sở hữu cây gia phả quyết định ai được xem, sửa cây của mình và chịu trách nhiệm về dữ liệu người thân mà họ đưa vào cây (xem mục 7).',
        ],
      },
      {
        title: '3. Dữ liệu được xử lý',
        blocks: [
          'Dữ liệu về bạn (tài khoản):',
          {
            list: [
              'Họ tên hiển thị, địa chỉ email, mật khẩu (chỉ lưu dạng băm, không ai đọc được mật khẩu gốc).',
              'Khi đăng nhập bằng Google hoặc GitHub: mã tài khoản, tên, email và ảnh đại diện do nhà cung cấp gửi.',
              'Thời điểm tạo tài khoản, đăng nhập gần nhất, ngôn ngữ, tùy chọn nhắc ngày giỗ, và thời điểm bạn đồng ý Thỏa thuận này.',
              'Địa chỉ IP, chỉ dùng tạm thời để chặn đoán mật khẩu và trong nhật ký kỹ thuật của nhà cung cấp máy chủ.',
            ],
          },
          'Dữ liệu về người trong cây gia phả: họ tên, giới tính, ngày sinh, ngày mất, nơi sinh, địa chỉ, ảnh, tiểu sử và quan hệ cha mẹ, con, vợ chồng.',
          'Ứng dụng không yêu cầu dữ liệu cá nhân nhạy cảm (như tình trạng sức khỏe, tôn giáo, quan điểm chính trị, dữ liệu sinh trắc học, tài chính). Bạn không nên ghi những thông tin này vào tiểu sử hay các ô khác.',
        ],
      },
      {
        title: '4. Mục đích xử lý',
        blocks: [
          'Dữ liệu chỉ được xử lý cho các mục đích sau:',
          {
            list: [
              'Mục đích 1: tạo, quản lý và bảo vệ tài khoản (đăng ký, đăng nhập, xác minh email, đặt lại mật khẩu, chống truy cập trái phép).',
              'Mục đích 2: lưu trữ, hiển thị, tìm kiếm, nhập và xuất cây gia phả, cho bạn và những người được chủ cây mời.',
              'Mục đích 3: gửi email cần thiết cho dịch vụ: xác minh, đặt lại mật khẩu, lời mời tham gia cây, xác nhận đổi email.',
              'Mục đích 4 (tùy chọn): gửi email nhắc ngày giỗ. Mục đích này chỉ được thực hiện khi bạn tự bật trong trang Tài khoản của tôi và có thể tắt bất cứ lúc nào; không đồng ý mục đích này không ảnh hưởng đến các mục đích khác.',
            ],
          },
          'Dữ liệu không được dùng để quảng cáo, không bị bán, không dùng để lập hồ sơ hay đánh giá cá nhân, và không được cung cấp cho bên thứ ba ngoài những bên nêu tại mục 5, trừ khi pháp luật yêu cầu.',
        ],
      },
      {
        title: '5. Ai được tiếp cận dữ liệu và chuyển dữ liệu ra nước ngoài',
        blocks: [
          {
            list: [
              'Cây gia phả chỉ hiển thị cho các thành viên được chủ cây hoặc quản trị viên mời, theo vai trò: chủ sở hữu, quản trị viên, người được chỉnh sửa, người chỉ xem. Không có trang nào công khai cây hay danh sách tài khoản.',
              'Ảnh tải lên được lưu ở chế độ riêng tư và chỉ thành viên của cây mới xem được.',
              'Chủ sở hữu và quản trị viên của cây có thể tải dữ liệu của cây về máy, hoặc bật sao lưu tự động vào Google Drive của chính họ. Bản sao lưu nằm trong tài khoản Google của người đó và họ chịu trách nhiệm bảo quản theo mục 7.',
              'Các nhà cung cấp dịch vụ xử lý dữ liệu thay mặt bên kiểm soát: Neo4j Aura (cơ sở dữ liệu), Vercel (máy chủ ứng dụng), Resend (gửi email), và nơi lưu ảnh nếu được bật (dịch vụ tương thích Amazon S3 hoặc Google Drive). Khi bạn đăng nhập bằng Google hoặc GitHub, các nhà cung cấp này xử lý việc đăng nhập theo chính sách riêng của họ.',
              'Máy chủ của các nhà cung cấp trên có thể đặt ngoài lãnh thổ Việt Nam. Khi đồng ý Thỏa thuận này, bạn đồng ý việc chuyển dữ liệu cá nhân ra nước ngoài cho các mục đích tại mục 4. Bên kiểm soát thực hiện các nghĩa vụ về chuyển dữ liệu xuyên biên giới theo quy định của pháp luật.',
            ],
          },
        ],
      },
      {
        title: '6. Thời gian lưu trữ và xóa dữ liệu',
        blocks: [
          {
            list: [
              'Dữ liệu được lưu cho đến khi bạn hoặc chủ cây xóa. Xóa một người, một cây hoặc tài khoản sẽ xóa dữ liệu tương ứng khỏi cơ sở dữ liệu ngay lập tức; ảnh không còn ai dùng cũng bị xóa khỏi nơi lưu trữ.',
              'Xóa tài khoản sẽ xóa mọi cây bạn làm chủ. Muốn giữ cây cho người thân, hãy chuyển quyền sở hữu trước.',
              'Bản sao lưu kỹ thuật của nhà cung cấp dịch vụ có thể còn tồn tại thêm một thời gian ngắn theo chính sách của họ rồi tự động bị xóa.',
              'Dữ liệu mà thành viên khác đã tải về hoặc chụp lại (ảnh, PDF của cây) nằm ngoài hệ thống và không thể bị xóa từ ứng dụng.',
            ],
          },
        ],
      },
      {
        title: '7. Trách nhiệm khi nhập dữ liệu của người khác',
        blocks: [
          'Cây gia phả chứa dữ liệu của nhiều người, không chỉ của bạn. Theo Điều 4 của Luật, mỗi người có nghĩa vụ tôn trọng và bảo vệ dữ liệu cá nhân của người khác. Khi nhập hoặc chia sẻ dữ liệu người thân, bạn cam kết:',
          {
            list: [
              'Với người còn sống: chỉ nhập khi người đó đã được thông báo và đồng ý, nhất là trước khi chia sẻ cây với người khác. Nên hạn chế thông tin như địa chỉ chi tiết.',
              'Với trẻ em: việc xử lý dữ liệu của trẻ cần có sự đồng ý của người đại diện theo pháp luật; với trẻ từ đủ 07 tuổi trở lên cần có thêm sự đồng ý của chính trẻ theo quy định của pháp luật (Điều 24).',
              'Với người đã mất: nhập thông tin một cách tôn trọng, phù hợp với phong tục và pháp luật; nên trao đổi với thân nhân gần nhất của người đã mất.',
              'Khi một người yêu cầu sửa hoặc xóa dữ liệu của họ, bạn thực hiện ngay nếu có quyền sửa cây, hoặc chuyển yêu cầu đến chủ cây hay bên kiểm soát (mục 2).',
              'Chỉ mời những người đáng tin cậy, và không tải về, sao chép hay công bố dữ liệu trong cây cho mục đích khác ngoài việc gia đình.',
              'Chịu trách nhiệm trước pháp luật về tính hợp pháp của dữ liệu do bạn nhập.',
            ],
          },
        ],
      },
      {
        title: '8. Quyền của bạn và cách thực hiện',
        blocks: [
          'Theo Điều 4 của Luật, bạn (và mọi người có dữ liệu trong cây) có quyền:',
          {
            list: [
              'Được biết về hoạt động xử lý dữ liệu: qua Thỏa thuận này, luôn xem lại được ở trang Thỏa thuận dữ liệu cá nhân.',
              'Đồng ý hoặc không đồng ý, và rút lại sự đồng ý: trong trang Tài khoản của tôi. Việc rút lại không ảnh hưởng đến việc xử lý đã thực hiện trước đó (Điều 10).',
              'Xem, chỉnh sửa hoặc yêu cầu chỉnh sửa dữ liệu: sửa trực tiếp trong trang Tài khoản của tôi và trên cây, hoặc yêu cầu chủ cây.',
              'Yêu cầu cung cấp, xóa, hạn chế xử lý dữ liệu và phản đối xử lý: tải cây về, xóa người, xóa cây, xóa tài khoản ngay trong ứng dụng, hoặc gửi yêu cầu bằng văn bản (kể cả email) tới địa chỉ liên hệ tại mục 2.',
              'Khiếu nại, tố cáo, khởi kiện và yêu cầu bồi thường thiệt hại theo quy định của pháp luật.',
            ],
          },
          'Yêu cầu gửi tới bên kiểm soát sẽ được tiếp nhận và giải quyết trong thời hạn theo quy định của pháp luật.',
        ],
      },
      {
        title: '9. Biện pháp bảo vệ dữ liệu',
        blocks: [
          {
            list: [
              'Kết nối được mã hóa (HTTPS); mật khẩu chỉ lưu dạng băm scrypt; phiên đăng nhập dùng cookie HttpOnly mà mã trên trang không đọc được.',
              'Mọi truy cập cây đều kiểm tra quyền thành viên; người ngoài không biết được cây có tồn tại.',
              'Khi phát hiện vi phạm bảo vệ dữ liệu cá nhân, bên kiểm soát thông báo cho cơ quan chuyên trách trong thời hạn luật định (chậm nhất 72 giờ, Điều 23) và thông báo cho người bị ảnh hưởng khi cần thiết.',
            ],
          },
          'Bạn cũng có trách nhiệm tự bảo vệ dữ liệu của mình: dùng mật khẩu mạnh, không chia sẻ tài khoản, và đăng xuất trên máy dùng chung.',
        ],
      },
      {
        title: '10. Hậu quả, thiệt hại không mong muốn có thể xảy ra',
        blocks: [
          'Thành viên được mời có thể ghi lại hoặc tải về nội dung cây và chia sẻ ra ngoài; tài khoản có mật khẩu yếu có thể bị chiếm; thông tin như ngày sinh, địa chỉ có thể bị lợi dụng nếu lộ ra ngoài. Hãy cân nhắc trước khi mời người khác và trước khi nhập các thông tin này.',
        ],
      },
      {
        title: '11. Thay đổi Thỏa thuận',
        blocks: [
          'Khi Thỏa thuận thay đổi nội dung quan trọng, phiên bản mới sẽ được hiển thị và bạn cần đồng ý lại trước khi tiếp tục dùng cây gia phả. Phiên bản bạn đã đồng ý và thời điểm đồng ý được ghi lại trong tài khoản.',
        ],
      },
      {
        title: '12. Xác nhận đồng ý',
        blocks: [
          'Bằng việc đánh dấu các ô xác nhận và bấm "Đồng ý", bạn xác nhận đã đọc, hiểu và tự nguyện đồng ý với Thỏa thuận này. Nếu không đồng ý, bạn có thể đăng xuất, hoặc xóa tài khoản trong trang Tài khoản của tôi.',
        ],
      },
    ],
  };
}

function en(): Agreement {
  const controller = CONTROLLER || 'The person or organisation running this website (name not configured)';
  const contact = CONTACT || '(contact address not configured)';
  return {
    title: 'Personal data sharing and processing agreement',
    subtitle: `Version ${PRIVACY_VERSION} · Under Vietnam's Personal Data Protection Law No. 91/2025/QH15`,
    translationNote:
      'This English translation is for reference. The Vietnamese text (switch the language to Tiếng Việt) is the one that applies.',
    confirmRead:
      'I have read and understood this Agreement and consent to my personal data being processed for purposes 1, 2 and 3.',
    confirmOthers:
      'I will only enter and share other people’s personal data when I have a lawful basis to, as set out in section 7.',
    sections: [
      {
        title: '1. Legal basis and scope',
        blocks: [
          'This Agreement is made under the Personal Data Protection Law No. 91/2025/QH15 (passed by the National Assembly on 26 June 2025, in force since 1 January 2026) and its implementing regulations. It covers all personal data processed when you use this family tree app: data about you, and data about relatives that you or other members enter in a family tree.',
          'You must accept this Agreement before using family trees. Silence or not responding does not count as consent.',
        ],
      },
      {
        title: '2. Data controller and processor',
        blocks: [
          `Personal data controller and processor: ${controller}.`,
          `Contact for personal data matters: ${contact}.`,
          'Each tree owner decides who can view and edit their tree, and is responsible for the relatives’ data they put in it (see section 7).',
        ],
      },
      {
        title: '3. Data processed',
        blocks: [
          'Data about you (your account):',
          {
            list: [
              'Display name, email address, password (stored only as a hash; nobody can read the original).',
              'When signing in with Google or GitHub: the account id, name, email and avatar the provider sends.',
              'When the account was created and last used, your language, death anniversary reminder preferences, and when you accepted this Agreement.',
              'IP address, used only temporarily to block password guessing and in the hosting provider’s technical logs.',
            ],
          },
          'Data about people in family trees: name, gender, birth date, death date, birthplace, address, photo, biography, and parent, child and spouse relationships.',
          'The app does not ask for sensitive personal data (such as health, religion, political views, biometric or financial data). Please don’t write such information in biographies or other fields.',
        ],
      },
      {
        title: '4. Purposes of processing',
        blocks: [
          'Data is processed only for these purposes:',
          {
            list: [
              'Purpose 1: creating, managing and protecting accounts (registration, sign-in, email verification, password reset, preventing unauthorised access).',
              'Purpose 2: storing, showing, searching, importing and exporting family trees, for you and the people the tree owner invites.',
              'Purpose 3: sending emails the service needs: verification, password reset, tree invitations, email change confirmation.',
              'Purpose 4 (optional): death anniversary reminder emails. Only when you switch them on in My account, and you can switch them off at any time; declining this purpose does not affect the others.',
            ],
          },
          'Data is not used for advertising, not sold, not used for profiling or evaluating people, and not given to third parties other than those in section 5, unless the law requires it.',
        ],
      },
      {
        title: '5. Who can access the data, and transfers abroad',
        blocks: [
          {
            list: [
              'A family tree is shown only to members invited by its owner or admins, according to their role: owner, admin, editor, viewer. No page makes trees or the list of accounts public.',
              'Uploaded photos are stored privately and only the tree’s members can view them.',
              'A tree’s owner and admins can download its data, or turn on automatic backups to their own Google Drive. The backups are in that person’s Google account, and they are responsible for keeping them safe as set out in section 7.',
              'Service providers process data on the controller’s behalf: Neo4j Aura (database), Vercel (application hosting), Resend (email), and photo storage when enabled (an Amazon S3-compatible service or Google Drive). When you sign in with Google or GitHub, they handle the sign-in under their own policies.',
              'These providers’ servers may be outside Vietnam. By accepting this Agreement you consent to your personal data being transferred abroad for the purposes in section 4. The controller carries out its cross-border transfer obligations as the law requires.',
            ],
          },
        ],
      },
      {
        title: '6. Retention and deletion',
        blocks: [
          {
            list: [
              'Data is kept until you or the tree owner delete it. Deleting a person, a tree or an account removes the data from the database immediately; photos nobody uses any more are deleted from storage too.',
              'Deleting your account deletes every tree you own. To keep a tree for your relatives, hand it over first.',
              'Service providers’ technical backups may last a short while longer under their policies, then are deleted automatically.',
              'Copies that other members downloaded or captured (images, PDFs of a tree) are outside the system and can’t be deleted from the app.',
            ],
          },
        ],
      },
      {
        title: '7. Responsibility for other people’s data',
        blocks: [
          'A family tree holds data about many people, not just you. Under Article 4 of the Law, everyone must respect and protect other people’s personal data. When you enter or share relatives’ data, you agree:',
          {
            list: [
              'Living people: only enter their data once they have been told and agree, especially before sharing the tree with others. Keep details such as exact addresses to a minimum.',
              'Children: processing a child’s data needs the consent of their legal representative, and from the age of 7 also the child’s own consent, as the law provides (Article 24).',
              'Deceased people: enter information respectfully, in line with custom and the law; consider talking with their closest relatives.',
              'When someone asks for their data to be corrected or deleted, do it straight away if you can edit the tree, or pass the request to the tree owner or the controller (section 2).',
              'Only invite people you trust, and don’t download, copy or publish the tree’s data for purposes other than the family’s.',
              'You are legally responsible for the lawfulness of the data you enter.',
            ],
          },
        ],
      },
      {
        title: '8. Your rights and how to use them',
        blocks: [
          'Under Article 4 of the Law, you (and everyone whose data is in a tree) have the right to:',
          {
            list: [
              'Be informed about the processing: through this Agreement, always available on the Personal data agreement page.',
              'Consent or not, and withdraw consent: on My account. Withdrawing doesn’t affect processing done before it (Article 10).',
              'View and correct the data, or ask for it to be corrected: directly on My account and in the tree, or by asking the tree owner.',
              'Ask for the data, its deletion or restricted processing, and object to processing: download the tree, delete people, a tree or the account in the app, or send a written request (email counts) to the contact in section 2.',
              'Complain, report, sue and claim compensation as the law provides.',
            ],
          },
          'Requests sent to the controller are received and handled within the time limits set by law.',
        ],
      },
      {
        title: '9. How the data is protected',
        blocks: [
          {
            list: [
              'Encrypted connections (HTTPS); passwords stored only as scrypt hashes; sessions in an HttpOnly cookie that page scripts can’t read.',
              'Every access to a tree checks membership; outsiders can’t even tell that a tree exists.',
              'If a personal data breach is found, the controller notifies the competent authority within the legal time limit (at most 72 hours, Article 23) and informs the people affected when needed.',
            ],
          },
          'You also have to protect your own data: use a strong password, don’t share your account, and sign out on shared devices.',
        ],
      },
      {
        title: '10. Possible unwanted consequences',
        blocks: [
          'Invited members can record or download a tree and share it outside the app; accounts with weak passwords can be taken over; details such as birth dates and addresses can be misused if they leak. Think before inviting people and before entering such details.',
        ],
      },
      {
        title: '11. Changes to this Agreement',
        blocks: [
          'When the Agreement changes materially, the new version is shown and you must accept it again before continuing to use family trees. The version you accepted and when are recorded on your account.',
        ],
      },
      {
        title: '12. Giving consent',
        blocks: [
          'By ticking the confirmation boxes and clicking "Accept", you confirm that you have read and understood this Agreement and agree to it voluntarily. If you don’t agree, you can sign out, or delete your account on My account.',
        ],
      },
    ],
  };
}

export function privacyAgreement(locale: Locale): Agreement {
  return locale === 'vi' ? vi() : en();
}
