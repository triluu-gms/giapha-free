import type { EmailMessage } from './mailer';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, paragraphs: string[], button: { label: string; url: string }, footer: string) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join('');
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f6f3;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1f2328">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2ded6;border-radius:12px;padding:28px">
    <h1 style="font-size:20px;margin:0 0 16px">🌳 ${title}</h1>
    ${body}
    <p style="margin:24px 0"><a href="${button.url}" style="background:#2f7d5b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">${button.label}</a></p>
    <p style="margin:0 0 8px;font-size:12px;color:#6b6f76">Or paste this link into your browser:<br><a href="${button.url}" style="color:#2f7d5b;word-break:break-all">${button.url}</a></p>
    <p style="margin:16px 0 0;font-size:12px;color:#6b6f76">${footer}</p>
  </div>
</body></html>`;
}

export function verificationEmail(to: string, name: string | null, url: string): EmailMessage {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,';
  return {
    to,
    subject: 'Verify your email for Family Tree',
    html: layout(
      'Confirm your email',
      [greeting, 'Thanks for registering! Please confirm your email address to start building your family tree.'],
      { label: 'Verify email', url },
      "This link expires in 24 hours. If you didn't create an account, you can ignore this email.",
    ),
    text: `${name ? `Hi ${name},` : 'Hi,'}\n\nThanks for registering! Confirm your email address here:\n${url}\n\nThis link expires in 24 hours. If you didn't create an account, ignore this email.`,
  };
}

export function passwordResetEmail(to: string, name: string | null, url: string): EmailMessage {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,';
  return {
    to,
    subject: 'Reset your Family Tree password',
    html: layout(
      'Reset your password',
      [greeting, 'Someone (hopefully you) asked to reset the password for your Family Tree account. Click below to choose a new one.'],
      { label: 'Choose a new password', url },
      "This link expires in 1 hour and can be used once. If you didn't ask for it, you can ignore this email; your password won't change.",
    ),
    text: `${name ? `Hi ${name},` : 'Hi,'}\n\nSomeone (hopefully you) asked to reset the password for your Family Tree account. Choose a new one here:\n${url}\n\nThis link expires in 1 hour. If you didn't ask for it, ignore this email; your password won't change.`,
  };
}

/** To the new address: the link that makes it the account's email. */
export function emailChangeEmail(to: string, name: string | null, url: string): EmailMessage {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,';
  return {
    to,
    subject: 'Confirm your new email for Family Tree',
    html: layout(
      'Confirm your new email',
      [greeting, `Someone (hopefully you) asked to use <strong>${escapeHtml(to)}</strong> for their Family Tree account. Click below to confirm.`],
      { label: 'Confirm new email', url },
      "This link expires in 24 hours. Until it's confirmed, the account keeps its old email. If you didn't ask for this, you can ignore this email.",
    ),
    text: `${name ? `Hi ${name},` : 'Hi,'}\n\nSomeone (hopefully you) asked to use ${to} for their Family Tree account. Confirm it here:\n${url}\n\nThis link expires in 24 hours. If you didn't ask for this, ignore this email.`,
  };
}

/** To the old address: a heads-up, so a change nobody asked for doesn't go unnoticed. */
export function emailChangeNoticeEmail(to: string, name: string | null, newEmail: string, accountUrl: string): EmailMessage {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,';
  const what = `Someone asked to change the email of your Family Tree account to <strong>${escapeHtml(newEmail)}</strong>. It changes only once that address confirms it.`;
  return {
    to,
    subject: 'Your Family Tree email is being changed',
    html: layout(
      'Email change requested',
      [greeting, what, "If this was you, there's nothing to do. If it wasn't, sign in, cancel the change on My account and change your password."],
      { label: 'Open My account', url: accountUrl },
      'You get this email because it is the address on the account right now.',
    ),
    text: `${name ? `Hi ${name},` : 'Hi,'}\n\nSomeone asked to change the email of your Family Tree account to ${newEmail}. It changes only once that address confirms it.\n\nIf it wasn't you, sign in, cancel the change on My account and change your password:\n${accountUrl}`,
  };
}

/**
 * To an address that already has an account, when someone asked to move another
 * account to it. Nothing changed; the person asking isn't told the address is in use.
 */
export function emailInUseNoticeEmail(to: string, signInUrl: string): EmailMessage {
  const body =
    'Someone asked to change the email of a Family Tree account to this address. This address already belongs to an account, so nothing was changed.';
  return {
    to,
    subject: 'Someone tried to use your email on Family Tree',
    html: layout(
      'Nothing was changed',
      [body, 'If this was you, you already have an account with this address: sign in with it instead. Otherwise you can ignore this email.'],
      { label: 'Sign in', url: signInUrl },
      'You get this email because this address has a Family Tree account.',
    ),
    text: `${body}\n\nIf this was you, sign in with this address instead:\n${signInUrl}\n\nOtherwise you can ignore this email.`,
  };
}

export interface AnniversaryItem {
  personName: string;
  treeName: string;
  /** The anniversary's solar date, "YYYY-MM-DD". */
  date: string;
  /** Set when the tree keeps death dates in âm lịch. */
  lunar: { day: number; month: number; canChi: string } | null;
}

const dmy = (iso: string) => iso.split('-').reverse().join('/');

/**
 * One email per user and day, listing the death anniversaries (ngày giỗ) that are
 * `daysBefore` days away. In the user's language, unlike the other emails.
 */
export function anniversaryReminderEmail(
  to: string,
  locale: 'en' | 'vi',
  items: AnniversaryItem[],
  daysBefore: number,
  manageUrl: string,
): EmailMessage {
  const vi = locale === 'vi';
  const when = vi
    ? daysBefore === 0 ? 'hôm nay' : daysBefore === 1 ? 'ngày mai' : `còn ${daysBefore} ngày nữa`
    : daysBefore === 0 ? 'today' : daysBefore === 1 ? 'tomorrow' : `in ${daysBefore} days`;
  const line = (item: AnniversaryItem, html: boolean) => {
    const name = html ? `<strong>${escapeHtml(item.personName)}</strong>` : item.personName;
    const tree = html ? escapeHtml(item.treeName) : item.treeName;
    const lunar = item.lunar
      ? vi
        ? ` (ngày ${item.lunar.day} tháng ${item.lunar.month} năm ${item.lunar.canChi} âm lịch)`
        : ` (lunar ${item.lunar.day}/${item.lunar.month}, ${item.lunar.canChi} year)`
      : '';
    return vi ? `Giỗ ${name} (${tree}): ${dmy(item.date)}${lunar}` : `${name} (${tree}): ${dmy(item.date)}${lunar}`;
  };
  const subject = vi
    ? `Nhắc ngày giỗ: ${when}${items.length === 1 ? ` – ${items[0].personName}` : ` (${items.length} người)`}`
    : `Death anniversary ${when}${items.length === 1 ? `: ${items[0].personName}` : ` (${items.length} people)`}`;
  const intro = vi ? `Ngày giỗ sắp tới (${when}):` : `Coming up ${when}:`;
  const footer = vi
    ? 'Bạn nhận email này vì đã bật nhắc ngày giỗ. Có thể tắt hoặc đổi số ngày báo trước trong Tài khoản của tôi.'
    : 'You get this email because you turned on death anniversary reminders. Turn them off or change how early they come in My account.';
  return {
    to,
    subject,
    html: layout(
      vi ? 'Nhắc ngày giỗ' : 'Death anniversary reminder',
      [intro, items.map((item) => line(item, true)).join('<br>')],
      { label: vi ? 'Quản lý nhắc nhở' : 'Manage reminders', url: manageUrl },
      footer,
    ),
    text: `${intro}\n\n${items.map((item) => `- ${line(item, false)}`).join('\n')}\n\n${footer}\n${manageUrl}`,
  };
}

export interface AccessRequestItem {
  name: string;
  email: string | null;
  message: string | null;
}

/**
 * To a tree's owner and admins: people asked for access through its "request
 * access" link. Sent at most once an hour per tree, listing every pending request.
 */
export function accessRequestEmail(
  to: string,
  locale: 'en' | 'vi',
  treeName: string,
  requests: AccessRequestItem[],
  total: number,
  shareUrl: string,
): EmailMessage {
  const vi = locale === 'vi';
  const who = (r: AccessRequestItem, html: boolean) => {
    const name = html ? `<strong>${escapeHtml(r.name)}</strong>` : r.name;
    const email = r.email ? ` (${html ? escapeHtml(r.email) : r.email})` : '';
    const note = r.message ? `: “${html ? escapeHtml(r.message) : r.message}”` : '';
    return `${name}${email}${note}`;
  };
  const more = total > requests.length ? (vi ? `…và ${total - requests.length} người khác.` : `…and ${total - requests.length} more.`) : '';
  const tree = (html: boolean) => (html ? `<strong>${escapeHtml(treeName)}</strong>` : treeName);
  const intro = (html: boolean) =>
    vi
      ? `Có ${total} người đang xin quyền truy cập cây ${tree(html)}:`
      : `${total === 1 ? '1 person is' : `${total} people are`} asking for access to ${tree(html)}:`;
  const footer = vi
    ? 'Bạn nhận email này vì là chủ sở hữu hoặc quản trị viên của cây, và cây có liên kết xin quyền truy cập. Không ai xem được cây cho tới khi được duyệt.'
    : 'You get this email because you own or help manage this tree and it has a request-access link. Nobody sees the tree until a request is approved.';
  return {
    to,
    subject: vi ? `Yêu cầu truy cập cây "${treeName}" (${total})` : `Access requests for "${treeName}" (${total})`,
    html: layout(
      vi ? 'Yêu cầu truy cập' : 'Access requests',
      [intro(true), requests.map((r) => who(r, true)).join('<br>') + (more ? `<br>${more}` : '')],
      { label: vi ? 'Xem và duyệt' : 'Review requests', url: shareUrl },
      footer,
    ),
    text: `${intro(false)}\n\n${requests.map((r) => `- ${who(r, false)}`).join('\n')}${more ? `\n${more}` : ''}\n\n${shareUrl}\n\n${footer}`,
  };
}

/** To the person who asked: their request was approved (with what access) or declined. */
export function accessDecisionEmail(
  to: string,
  locale: 'en' | 'vi',
  treeName: string,
  decision: 'admin' | 'editor' | 'viewer' | 'declined',
  appUrl: string,
): EmailMessage {
  const vi = locale === 'vi';
  const tree = (html: boolean) => (html ? `<strong>${escapeHtml(treeName)}</strong>` : treeName);
  if (decision === 'declined') {
    const body = (html: boolean) =>
      vi
        ? `Yêu cầu truy cập cây ${tree(html)} của bạn chưa được chấp nhận. Nếu nghĩ là có nhầm lẫn, hãy liên hệ trực tiếp người đã gửi liên kết cho bạn.`
        : `Your request for access to ${tree(html)} was not accepted. If you think this is a mistake, contact the person who sent you the link.`;
    return {
      to,
      subject: vi ? `Yêu cầu truy cập "${treeName}"` : `Your access request for "${treeName}"`,
      html: layout(vi ? 'Yêu cầu chưa được chấp nhận' : 'Request not accepted', [body(true)], { label: vi ? 'Mở ứng dụng' : 'Open the app', url: appUrl }, ''),
      text: `${body(false)}\n\n${appUrl}`,
    };
  }
  const access = vi
    ? { admin: 'xem, chỉnh sửa và cùng quản lý', editor: 'xem và chỉnh sửa', viewer: 'xem' }[decision]
    : { admin: 'view, edit and help manage', editor: 'view and edit', viewer: 'view' }[decision];
  const body = (html: boolean) =>
    vi ? `Bạn đã được cấp quyền ${access} cây ${tree(html)}.` : `You can now ${access} ${tree(html)}.`;
  return {
    to,
    subject: vi ? `Bạn đã có quyền truy cập "${treeName}"` : `You now have access to "${treeName}"`,
    html: layout(
      vi ? 'Yêu cầu đã được duyệt' : 'Request approved',
      [body(true), vi ? 'Cây xuất hiện trong ô chọn cây, mục “Được chia sẻ với tôi”.' : 'The tree is in the tree switcher, under “Shared with me”.'],
      { label: vi ? 'Mở cây gia phả' : 'Open the family tree', url: appUrl },
      '',
    ),
    text: `${body(false)}\n\n${appUrl}`,
  };
}

export function invitationEmail(
  to: string,
  inviter: string,
  treeName: string,
  role: 'admin' | 'editor' | 'viewer',
  url: string,
): EmailMessage {
  const access = { admin: 'view, edit and help manage', editor: 'view and edit', viewer: 'view' }[role];
  return {
    to,
    subject: `${inviter} invited you to "${treeName}" on Family Tree`,
    html: layout(
      "You're invited",
      [
        `<strong>${escapeHtml(inviter)}</strong> invited you to <strong>${escapeHtml(treeName)}</strong>, where you'll be able to ${access} the family tree.`,
        "If you don't have an account yet, you can create one from the link below using this email address.",
      ],
      { label: 'Accept invitation', url },
      "This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.",
    ),
    text: `${inviter} invited you to "${treeName}" on Family Tree, where you'll be able to ${access} the family tree.\n\nAccept the invitation here:\n${url}\n\nThis invitation expires in 7 days.`,
  };
}
