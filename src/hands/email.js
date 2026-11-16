import nodemailer from 'nodemailer';
import path from 'node:path';

/** Turns a spoken name ("Ahmed") or a plain address into an email address. */
export function resolveRecipient(to, contacts = {}) {
  const value = String(to || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value;
  const hit = Object.entries(contacts).find(([name]) => name.toLowerCase() === value.toLowerCase());
  if (!hit) throw new Error(`I don't have an email address for "${value}".`);
  return hit[1];
}

/**
 * Sends an email through Gmail.
 * `credentials` = { user, appPassword }; the app password is a 16-character
 * code the user creates in their Google account, not their normal password.
 * `transport` can be injected for tests.
 */
export async function sendEmail({ to, subject, body, attachments = [] }, credentials, transport) {
  if (!transport) {
    if (!credentials?.user || !credentials?.appPassword) {
      throw new Error('Gmail is not connected yet. Add the Gmail app password in Jarvis settings.');
    }
    transport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: credentials.user, pass: credentials.appPassword },
    });
  }
  const info = await transport.sendMail({
    from: credentials?.user,
    to,
    subject,
    text: body,
    attachments: attachments.map((file) => ({ filename: path.basename(file), path: file })),
  });
  return { ok: true, to, messageId: info.messageId };
}
