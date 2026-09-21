/**
 * `EmailSender` adapters.
 *
 * Every booking email carries an .ics attachment, so attachment support is not
 * optional in either implementation — a sender that silently drops attachments
 * would produce confirmations that do not land in the guest's calendar.
 *
 * Delivery failures throw. The queue consumer (ADR-0006) is what retries, so
 * swallowing an error here would turn a transient provider blip into a
 * permanently missing confirmation.
 */

import { sanitizeHeader } from '../../core/email-templates.js'
import type { EmailMessage, EmailSender } from '../../ports.js'

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

export interface ResendOptions {
  apiKey: string
  from: string
  fromName?: string
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export function createResendSender(opts: ResendOptions): EmailSender {
  return {
    async send(message) {
      const body: Record<string, unknown> = {
        from: formatAddress(message.from ?? opts.from, message.fromName ?? opts.fromName),
        to: [formatAddress(message.to, message.toName)],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }
      // Snake case: the REST API's field names differ from the Node SDK's
      // camelCase wrappers.
      if (message.replyTo) body.reply_to = sanitizeHeader(message.replyTo)
      if (message.attachments?.length) {
        body.attachments = message.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          content_type: a.contentType,
        }))
      }

      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        // Status and body both, because Resend puts the actionable part
        // (unverified domain, invalid recipient) only in the body.
        const detail = await res.text().catch(() => '')
        throw new Error(`resend: ${res.status} ${res.statusText} ${detail}`.trim())
      }
    },
  }
}

/**
 * For local dev and for self-hosters who have not configured a provider yet.
 * Booking still works and nothing throws — the operator sees exactly what would
 * have been sent, rather than a broken flow they have to debug before their
 * first booking (spec §15).
 */
export function createConsoleSender(): EmailSender {
  return {
    async send(message: EmailMessage) {
      // Attachment bodies are base64 blobs; logging their names is useful,
      // logging their contents would bury the log.
      const attachments = (message.attachments ?? []).map((a) => `${a.filename} (${a.contentType})`)
      console.log('[email]', {
        ...(message.from ? { from: message.fromName ? `${message.fromName} <${message.from}>` : message.from } : {}),
        to: message.toName ? `${message.toName} <${message.to}>` : message.to,
        subject: message.subject,
        replyTo: message.replyTo,
        attachments,
        text: message.text,
      })
    },
  }
}

/**
 * `Name <addr>` when a display name exists; quoted so commas cannot split the
 * header.
 *
 * Both parts pass through `sanitizeHeader` first: `email`/`name` here are
 * frequently a guest-controlled `guestEmail`/`guestName` from an
 * unauthenticated booking form, and this string lands directly in a
 * provider-facing `from`/`to` field, so a CR/LF in either would otherwise let
 * a booking inject an extra header into every email we send.
 */
function formatAddress(email: string, name?: string): string {
  const safeEmail = sanitizeHeader(email)
  if (!name) return safeEmail
  const safeName = sanitizeHeader(name).replace(/"/g, '')
  return `"${safeName}" <${safeEmail}>`
}

// ---------------------------------------------------------------------------
// Brevo
// ---------------------------------------------------------------------------

export interface BrevoOptions {
  apiKey: string
  from: string
  fromName: string
  fetch?: typeof globalThis.fetch
}

/**
 * Brevo (formerly Sendinblue).
 *
 * A second provider exists because the `EmailSender` port is the whole reason
 * ADR-0003 lists it: a self-hoster brings whichever transactional provider
 * they already pay for, and forcing one choice would be a gate in disguise.
 *
 * Note the API shape differs from Resend in two ways that are easy to get
 * wrong: the key goes in `api-key`, not `Authorization`, and attachments are
 * `{name, content}` rather than `{filename, content}`.
 */
export function createBrevoSender(opts: BrevoOptions): EmailSender {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis)
  return {
    async send(message) {
      // sanitizeHeader on every guest-controlled field: Brevo turns
      // `sender`/`to`/`replyTo` into real SMTP headers on its side, so a
      // CR/LF smuggled through here becomes a header-injection vector at the
      // provider even though our own request body is well-formed JSON.
      const body: Record<string, unknown> = {
        sender: {
          email: sanitizeHeader(message.from ?? opts.from),
          name: sanitizeHeader(message.fromName ?? opts.fromName),
        },
        to: [
          {
            email: sanitizeHeader(message.to),
            ...(message.toName ? { name: sanitizeHeader(message.toName) } : {}),
          },
        ],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }
      if (message.replyTo) body['replyTo'] = { email: sanitizeHeader(message.replyTo) }
      if (message.attachments?.length) {
        body['attachment'] = message.attachments.map((a) => ({
          name: a.filename,
          content: a.content,
        }))
      }

      const res = await doFetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': opts.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        // Include the body: Brevo reports a wrong sender domain in it, and
        // that is the single most common reason a first send fails.
        const detail = await res.text().catch(() => '')
        throw new Error(`Brevo send failed: ${res.status} ${res.statusText} ${detail.slice(0, 300)}`)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Cloudflare Email Service
// ---------------------------------------------------------------------------

export interface CloudflareOptions {
  binding: SendEmail
  from: string
  fromName?: string
}

/**
 * Cloudflare Email Service, through the `send_email` Worker binding.
 *
 * The third provider, and the only one with no API key: the binding is
 * capability-scoped by wrangler.toml, so there is no secret to rotate, leak or
 * forget to set. That is the whole reason to prefer it on a Cloudflare-hosted
 * deployment — `EmailSender` exists (ADR-0003) so this is a choice, and this
 * one removes a credential rather than adding one.
 *
 * Two facts about the platform decide the shape of everything below:
 *
 *   1. **Arbitrary recipients require an onboarded sending domain.** Before
 *      the domain in `from` is onboarded to Email Service, the binding will
 *      only deliver to *verified destination addresses* in the account — i.e.
 *      to the operator, never to a guest. A deployment in that state looks
 *      healthy (no key missing, no warning banner) while every guest
 *      confirmation is rejected, which is the exact failure the console-sender
 *      banner exists to prevent. Hence the error wrapping below: the platform
 *      reports this as a specific, recognisable failure, and it must reach the
 *      operator's log saying what to do, not as a bare 500.
 *   2. **Attachment `content` accepts `string | ArrayBuffer | ArrayBufferView`,
 *      and a string is treated as RAW content, not base64** — the opposite of
 *      Resend/Brevo's REST APIs (and the opposite of what this binding's own
 *      `content` field name suggests). `EmailMessage.attachments[].content`
 *      arrives base64-encoded (see notify.ts's `base64()`, matching what the
 *      other two senders need), so it is decoded back to a UTF-8 string here
 *      — passing the base64 string through unchanged would attach the
 *      base64 text itself as the .ics, not the calendar invite it encodes.
 *
 * Delivery failures throw, like the other two senders, so the queue consumer
 * retries rather than a transient blip becoming a permanently missing
 * confirmation.
 */
export function createCloudflareSender(opts: CloudflareOptions): EmailSender {
  return {
    async send(message) {
      // sanitizeHeader for the same reason as Brevo: `to`/`toName`/`replyTo`
      // are frequently guest-controlled from an unauthenticated booking form.
      // The binding builds the MIME itself and rejects non-allowlisted
      // headers, so this is defence in depth rather than the only guard — but
      // a sender that behaves differently from its siblings on hostile input
      // is a bug waiting for the one deployment that switches providers.
      const to = sanitizeHeader(message.to)
      const toName = message.toName ? sanitizeHeader(message.toName) : undefined
      // Same fallback as Resend/Brevo: a queued message carries the brand
      // `from` it was composed with (`EmailMessage.from`). The queue
      // consumer's sender is built with no HTTP request, so `opts.from` is
      // the Worker default, not the brand the guest booked on. Sending
      // from that default against Cloudflare Email Service fails unless
      // that exact domain is onboarded — which a multi-brand deploy's
      // fallback address typically is not.
      const fromEmail = sanitizeHeader(message.from ?? opts.from)
      const fromNameRaw = message.fromName ?? opts.fromName
      const fromName = fromNameRaw ? sanitizeHeader(fromNameRaw) : undefined

      try {
        await opts.binding.send({
          from: fromName ? { email: fromEmail, name: fromName } : fromEmail,
          to: toName ? { email: to, name: toName } : to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { replyTo: sanitizeHeader(message.replyTo) } : {}),
          ...(message.attachments?.length
            ? {
                attachments: message.attachments.map((a) => ({
                  // Decoded back to raw text — see note 2 above.
                  content: base64ToUtf8(a.content),
                  filename: a.filename,
                  type: a.contentType,
                  disposition: 'attachment' as const,
                })),
              }
            : {}),
        })
      } catch (e) {
        // The platform throws an Error carrying a `code`. Both halves matter
        // and neither is useful alone: the code is what you search the docs
        // for, the message is what names the offending address.
        const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
        const detail = e instanceof Error ? e.message : String(e)
        // The one failure worth translating rather than echoing: it is
        // indistinguishable from "email works" until a guest tries to book.
        const hint = /verified destination|not onboarded|domain/i.test(`${code} ${detail}`)
          ? ' — is the sending domain onboarded to Email Service? Until it is, the binding only delivers to verified destination addresses in your own account, never to guests.'
          : ''
        throw new Error(`cloudflare email: ${code} ${detail}${hint}`.trim())
      }
    },
  }
}

/** Inverse of notify.ts's `base64()` — UTF-8 bytes back out, not code units. */
function base64ToUtf8(b64: string): string {
  const binary = atob(b64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
