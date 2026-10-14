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
