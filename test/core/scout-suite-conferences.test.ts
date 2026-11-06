import { describe, expect, it, vi } from 'vitest'
import { createScoutSuiteConferences, scoutSuiteMeetingId } from '../../src/adapters/scout-suite/conferences.js'

function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => respond(String(url), init ?? {}))
}

const config = { apiUrl: 'https://api.scoutsuite.test/', apiKey: 'ss_at_key', orgId: 'org_hq' }

describe('Scout Suite conference adapter', () => {
  it('creates an online, auto-recorded meeting keyed on the booking and returns its join link', async () => {
    const f = fakeFetch(() => Response.json({ data: { joinUrl: 'https://scoutsuite.test/meet/m1' } }, { status: 201 }))
    const rooms = createScoutSuiteConferences({ ...config, fetchImpl: f as unknown as typeof fetch })
    const { url } = await rooms.create({ externalRef: 'bk_1', title: 'Demo', start: Date.UTC(2026, 9, 1, 14), end: Date.UTC(2026, 9, 1, 15) })

    expect(url).toBe('https://scoutsuite.test/meet/m1')
    const [calledUrl, init] = f.mock.calls[0]!
    expect(calledUrl).toBe('https://api.scoutsuite.test/api/orgs/org_hq/meetings')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer ss_at_key' })
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      title: 'Demo',
      meetingType: 'online',
      meetingDate: '2026-10-01T14:00:00.000Z',
      externalRef: 'bk_1',
      autoRecord: true,
    })
  })

  it('reschedules and cancels by the meeting id in the join link, and treats an already-gone room as done', async () => {
    const f = fakeFetch((_url, init) => new Response(null, { status: init.method === 'DELETE' ? 404 : 200 }))
    const rooms = createScoutSuiteConferences({ ...config, fetchImpl: f as unknown as typeof fetch })
    await rooms.update('https://scoutsuite.test/meet/m1', { title: 'Demo', start: Date.UTC(2026, 9, 2, 9), end: 0 })
    await rooms.cancel('https://scoutsuite.test/meet/m1')
    expect(f.mock.calls.map(([u, i]) => `${(i as RequestInit).method} ${u}`)).toEqual([
      'PATCH https://api.scoutsuite.test/api/orgs/org_hq/meetings/m1',
      'DELETE https://api.scoutsuite.test/api/orgs/org_hq/meetings/m1',
    ])
  })

  it('throws on a real failure so the queue retries', async () => {
    const f = fakeFetch(() => new Response('nope', { status: 500 }))
    const rooms = createScoutSuiteConferences({ ...config, fetchImpl: f as unknown as typeof fetch })
    await expect(rooms.create({ externalRef: 'bk', title: 't', start: 0, end: 0 })).rejects.toThrow(/500/)
  })

  it('only recognises /meet/{id} links', () => {
    expect(scoutSuiteMeetingId('https://scoutsuite.app/meet/abc_123')).toBe('abc_123')
    expect(scoutSuiteMeetingId('https://meet.google.com/abc-defg-hij')).toBeNull()
  })
})
