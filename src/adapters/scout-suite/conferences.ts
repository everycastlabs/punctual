/**
 * Scout Suite meeting rooms for bookings whose event type's location is `scout_suite`.
 *
 * Talks to the Scout Suite API with an API key bound to one org (the org whose meetings these
 * become, and where the recordings and transcripts land):
 *   POST   /api/orgs/{org}/meetings              create (idempotent on externalRef)
 *   PATCH  /api/orgs/{org}/meetings/{meetingId}  reschedule / rename
 *   DELETE /api/orgs/{org}/meetings/{meetingId}  cancel
 *
 * Rooms are created with autoRecord so every call is recorded and transcribed without anyone
 * having to press record. The join link is `{app}/meet/{meetingId}`; guests need no account.
 */
import type { ConferenceProvider } from '../../ports.js'

export interface ScoutSuiteConferenceConfig {
  /** e.g. https://api.scoutsuite.app */
  apiUrl: string
  apiKey: string
  orgId: string
  fetchImpl?: typeof fetch
}

/** The meeting id is the last path segment of the /meet/{id} join link. */
export function scoutSuiteMeetingId(url: string): string | null {
  const match = /\/meet\/([^/?#]+)\/?(?:[?#].*)?$/.exec(url)
  return match ? decodeURIComponent(match[1]!) : null
}

export function createScoutSuiteConferences(config: ScoutSuiteConferenceConfig): ConferenceProvider {
  const doFetch = config.fetchImpl ?? fetch
  const base = `${config.apiUrl.replace(/\/$/, '')}/api/orgs/${encodeURIComponent(config.orgId)}/meetings`
  const headers = { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '')
      throw new Error(`Scout Suite ${method} ${path || '/'} failed: ${res.status} ${text.slice(0, 200)}`)
    }
    return res
  }

  return {
    async create({ externalRef, title, start }) {
      const res = await call('POST', '', {
        title,
        meetingType: 'online',
        meetingDate: new Date(start).toISOString(),
        externalRef,
        autoRecord: true,
      })
      const body = (await res.json()) as { data?: { joinUrl?: string | null } }
      const url = body.data?.joinUrl
      if (!url) throw new Error('Scout Suite created a meeting without a join link')
      return { url }
    },

    async update(url, { title, start }) {
      const id = scoutSuiteMeetingId(url)
      if (!id) return
      await call('PATCH', `/${encodeURIComponent(id)}`, { title, meetingDate: new Date(start).toISOString() })
    },

    async cancel(url) {
      const id = scoutSuiteMeetingId(url)
      if (!id) return
      // 404 is fine: already gone.
      await call('DELETE', `/${encodeURIComponent(id)}`)
    },
  }
}
