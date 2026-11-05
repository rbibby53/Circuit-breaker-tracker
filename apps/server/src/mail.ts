// Sending email: invite links, password reset links, and a test message. Settings are read on
// every send, so changes on the Settings page apply straight away.

import nodemailer from 'nodemailer';
import type { Config } from './config';
import { logger } from './log';

export interface EmailStatus {
  /** Email can be sent. */
  enabled: boolean;
  /** Why not, when an admin has started setting it up; null when it is on or simply unused. */
  problem: string | null;
}

/** "breakers@example.com" or "Breaker Tracker <breakers@example.com>". */
const FROM = /^(?:[^<>]*<\s*([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)\s*>|([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+))$/;

export function emailStatus(config: Config): EmailStatus {
  const s = config.settings;
  if (!s.get('smtpHost')) return { enabled: false, problem: null };
  if (!s.get('smtpFrom')) return { enabled: false, problem: 'Fill in "Send as": the address emails come from.' };
  if (!FROM.test(s.get('smtpFrom'))) {
    return { enabled: false, problem: '"Send as" must be an email address, e.g. breakers@example.com.' };
  }
  // Links in emails are opened on other devices, so they cannot use whatever address the
  // sender's browser had; and an unauthenticated "forgot password" must never take the
  // address from the request, which anyone can set.
  if (!config.appUrl)
    return { enabled: false, problem: 'Set the public address under General: links in emails need it.' };
  return { enabled: true, problem: null };
}

/** Whether "Forgot your password?" is offered on the sign-in page. */
export const selfServiceResetOn = (config: Config) =>
  config.settings.get('selfServiceReset') && emailStatus(config).enabled;

/** One line for the start-up log. */
export function describeEmail(config: Config): string {
  const s = config.settings;
  const status = emailStatus(config);
  if (!s.get('smtpHost')) return 'Email: off (invite and reset links are copied and sent by hand)';
  if (!status.enabled) return `Email: not working yet. ${status.problem}`;
  const security = { starttls: 'STARTTLS', tls: 'TLS', none: 'no encryption' }[s.get('smtpSecurity')];
  return (
    `Email: via ${s.get('smtpHost')}:${s.get('smtpPort')} (${security}) as ${s.get('smtpFrom')}` +
    (s.get('selfServiceReset') ? ' · people can reset their own password' : '')
  );
}

export interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function transport(config: Config) {
  const s = config.settings;
  const security = s.get('smtpSecurity');
  const user = s.get('smtpUsername');
  return nodemailer.createTransport({
    host: s.get('smtpHost'),
    port: s.get('smtpPort'),
    secure: security === 'tls',
    requireTLS: security === 'starttls',
    ignoreTLS: security === 'none',
    auth: user ? { user, pass: s.get('smtpPassword') } : undefined,
    // Introduce ourselves by the public host name: a container's own name means nothing to a
    // mail server, and some relays refuse it.
    name: config.appUrl ? new URL(config.appUrl).hostname : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/** Send one message. Throws an Error with a message fit to show an admin. */
export async function sendMail(config: Config, message: Message, what: string): Promise<void> {
  const status = emailStatus(config);
  if (!status.enabled) throw new Error(status.problem ?? 'Email is not set up. An admin can set it up under Settings.');
  try {
    await transport(config).sendMail({ from: config.settings.get('smtpFrom'), ...message });
    logger()?.info(`Emailed ${what} to ${message.to}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger()?.warn(`Could not email ${what} to ${message.to}: ${reason}`);
    throw new Error(`The mail server said: ${reason}`, { cause: err });
  }
}

// ---- Messages -----------------------------------------------------------------------------

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** When a link stops working, in the server's time zone (TZ), e.g. "Nov 7, 2026, 1:15 PM EST". */
export function expiryText(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

/** A short message with one button: the same words in plain text and in HTML. */
function compose(
  to: string,
  subject: string,
  paragraphs: string[],
  button: { label: string; url: string } | null,
  footer: string,
): Message {
  const text = [...paragraphs, ...(button ? [`${button.label}: ${button.url}`] : []), footer].join('\n\n') + '\n';
  const p = (t: string) => `<p style="margin:0 0 16px">${escape(t)}</p>`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#18181b;font-size:15px;line-height:1.5">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px">
${paragraphs.map(p).join('\n')}
${
  button
    ? `<p style="margin:24px 0"><a href="${escape(button.url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${escape(button.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#52525b">Or open this address: <a href="${escape(button.url)}" style="color:#52525b;word-break:break-all">${escape(button.url)}</a></p>`
    : ''
}
<p style="margin:24px 0 0;font-size:13px;color:#71717a">${escape(footer)}</p>
</div></body></html>
`;
  return { to, subject, text, html };
}

export function inviteMessage(
  config: Config,
  to: string,
  invite: { url: string; expiresAt: string; invitedBy: string; locationPath: string; roleLabel: string },
): Message {
  const app = config.settings.get('appName');
  return compose(
    to,
    `${invite.invitedBy} invited you to ${app}`,
    [
      `${invite.invitedBy} invited you to ${app}, as ${/^[AEIOU]/.test(invite.roleLabel) ? 'an' : 'a'} ${invite.roleLabel} for ${invite.locationPath}.`,
      'Open the link to create your account, or sign in if you already have one.',
    ],
    { label: 'Accept the invite', url: invite.url },
    `The link works once and expires ${expiryText(invite.expiresAt)}. If you weren't expecting this, you can ignore it.`,
  );
}

export function resetMessage(
  config: Config,
  to: string,
  reset: { url: string; expiresAt: string; displayName: string; username: string; requestedBy: string | null },
): Message {
  const app = config.settings.get('appName');
  return compose(
    to,
    `Reset your ${app} password`,
    [
      `Hi ${reset.displayName},`,
      reset.requestedBy
        ? `${reset.requestedBy} sent you a link to set a new password for your ${app} account (${reset.username}).`
        : `Someone, hopefully you, asked to reset the password for your ${app} account (${reset.username}).`,
    ],
    { label: 'Set a new password', url: reset.url },
    `The link works once and expires ${expiryText(reset.expiresAt)}. ` +
      (reset.requestedBy
        ? 'Your current password keeps working until you set a new one.'
        : "If you didn't ask for this, ignore it: your password stays as it is."),
  );
}

export function testMessage(config: Config, to: string, sentBy: string): Message {
  const app = config.settings.get('appName');
  return compose(
    to,
    `Test email from ${app}`,
    [`${sentBy} sent this from the Settings page to check that ${app} can send email.`, 'It works.'],
    null,
    `Sent through ${config.settings.get('smtpHost')}.`,
  );
}
