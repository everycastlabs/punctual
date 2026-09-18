/**
 * A host manually creating a booking overrides the event type's own
 * availability rules — schedule windows, notice, horizon, daily cap, and
 * round-robin's own auto-pick all stop applying — but a real conflict with
 * an existing confirmed booking (a busy interval on the host) is never
 * optional, whatever the scheduling type. Pure, at commit time
 * (`prepareBooking`); the HTTP route that builds this request is exercised
 * end-to-end in test/workers/manual-booking.test.ts.
 */

import { describe, expect, it } from 'vitest'

import { prepareBooking } from '../../src/core/domain/booking-service.js'
import type { EventType } from '../../src/core/domain/types.js'
import type { HostAvailabilityInput } from '../../src/core/slots/engine.js'
import { localTimeToInstant } from '../../src/core/time/zone.js'

const TZ = 'UTC'
const HOUR = 3_600_000

function eventType(over: Partial<EventType> = {}): EventType {
  return {
    id: 'et_override',
    ownerUserId: 'alice',
    ownerTeamId: null,
    schedulingType: 'personal',
    slug: 'chat',
    title: 'Chat',
    description: '',
    durationMinutes: 30,
    slotIntervalMinutes: null,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    // Deliberately restrictive — proof the override actually bypasses these,
    // not just a slot that would have passed anyway.
    minNoticeMinutes: 24 * 60,
    maxHorizonDays: 1,
    maxPerDay: 0,
    locationType: 'phone',
    locationValue: null,
    questions: [],
    active: true,
    createdAt: 0,
    scheduleId: null,
    ...over,
  }
}

function host(id: string, busy: Array<{ start: number; end: number }> = []): HostAvailabilityInput {
  // No weekly availability at all — every window check would fail this host
  // even without the notice/horizon/cap settings above.
  return {
    hostUserId: id,
    availability: { userId: id, timezone: TZ, weekly: [[], [], [], [], [], [], []], overrides: [] },
    busy,
  }
}

// Off the 5-minute grid on purpose (:07, not :00/:05) — the grid-alignment
// check is one of the ones override must also bypass.
const START = localTimeToInstant('2026-06-15', 20 * 60 + 7, TZ)
const NOW = START - HOUR

function attempt(
  hosts: HostAvailabilityInput[],
  over: { et?: Partial<EventType>; expectedHostCount?: number; override?: boolean } = {},
) {
  return prepareBooking({
    eventType: eventType(over.et),
    hosts,
    ...(over.expectedHostCount === undefined ? {} : { expectedHostCount: over.expectedHostCount }),
    overrideAvailability: over.override ?? true,
    start: START,
    guestName: 'Guest',
    guestEmail: 'guest@example.com',
    guestTimezone: TZ,
    answers: {},
    now: NOW,
    bookingId: 'bk_override',
    manageTokenHash: 'hash',
  })
}

describe('override: bypasses every availability rule, for any scheduling type', () => {
  it('personal: books an off-grid, out-of-hours, no-notice slot the schedule would otherwise refuse', () => {
    const result = attempt([host('alice')])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.booking.hostUserIds).toEqual(['alice'])
    expect(result.booking.startUtc).toBe(START)
  })

  it('collective: every explicitly-chosen host participates, no required/optional split', () => {
    const result = attempt([host('alice'), host('bob')], { et: { schedulingType: 'collective', ownerUserId: null, ownerTeamId: 'team_1' } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.booking.hostUserIds).toEqual(['alice', 'bob'])
  })

  it('round_robin: both chosen hosts participate — no auto-pick narrows it to one', () => {
    const result = attempt([host('alice'), host('bob')], { et: { schedulingType: 'round_robin', ownerUserId: null, ownerTeamId: 'team_1' } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.booking.hostUserIds).toEqual(['alice', 'bob'])
  })

  it('still refuses a time that collides with an existing confirmed booking for that host', () => {
    const busy = [{ start: START, end: START + HOUR }]
    const result = attempt([host('alice', busy)])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('slot_taken')
    expect(result.detail).toBe('alice')
  })

  it('in a multi-host override, one conflicting host fails the whole booking', () => {
    const busy = [{ start: START, end: START + HOUR }]
    const result = attempt([host('alice'), host('bob', busy)], {
      et: { schedulingType: 'collective', ownerUserId: null, ownerTeamId: 'team_1' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('slot_taken')
    expect(result.detail).toBe('bob')
  })

  it('a chosen host that silently failed to resolve still fails the booking loudly', () => {
    // The caller asked for two hosts; only one came back.
    const result = attempt([host('alice')], { expectedHostCount: 2 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no_eligible_host')
  })

  it('an inactive event type still refuses, override or not', () => {
    const result = attempt([host('alice')], { et: { active: false } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('policy')
  })
})
