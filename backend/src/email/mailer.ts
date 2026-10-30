import { config } from '../config';
import { gmailConfigured, sendWithGmail } from './gmail';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends with EMAIL_PROVIDER: Gmail (gmail.ts), or Resend's HTTP API (no SDK needed).
 * Without RESEND_API_KEY, Resend's messages are printed to the console instead,
 * which keeps local development working.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  if (config.email.provider === 'gmail') {
    if (!gmailConfigured()) throw new Error('Sending with Gmail needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
    await sendWithGmail(message);
    return;
  }
  if (!config.email.resendApiKey) {
    console.log(
      `\n──── email (RESEND_API_KEY not set, not sent) ────\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n──────────────────────────────────────────────\n`,
    );
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.email.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend rejected the email (${res.status}): ${await res.text().catch(() => '')}`);
  }
}
