import type {
  CreateCalendarInput,
  CreateEventInput,
  DeleteEventInput,
  ShareCalendarInput,
  UpdateEventInput,
} from '@yourcal/shared'
import type { FastifyInstance } from 'fastify'
import { assertHrefSameHost } from '../dav/hostAllowlist.js'
import { shareCalendar, ShareFailedError } from '../dav/sharing.js'
import * as editScope from '../ical/editScope.js'
import { splitImportIcs } from '../ical/importIcs.js'
import { calendarObjectToIcs } from '../ical/mapper.js'
import { eventFieldsError } from '../ical/validate.js'
import { decodeId } from '../store/idCodec.js'
import { EtagConflictError } from '../store/errors.js'
import { store } from '../store/index.js'
import { requireSession } from './requireSession.js'

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return

    const calendars = await store.discoverCalendars(dav)
    return reply.send(calendars)
  })

  app.post<{ Body: CreateCalendarInput }>('/', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return

    if (!req.body?.displayName?.trim()) {
      return reply.code(400).send({ error: 'bad_request', message: 'displayName is required' })
    }

    const created = await store.createCalendar(dav, req.body)
    return reply.code(201).send(created)
  })

  app.post<{ Params: { id: string }; Body: ShareCalendarInput }>('/:id/share', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return

    if (!req.body?.recipient?.trim() || (req.body.permission !== 'read' && req.body.permission !== 'readwrite')) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'recipient and a valid permission are required' })
    }

    const calendarUrl = decodeId(req.params.id)
    assertHrefSameHost(dav.baseUrl, calendarUrl)

    try {
      const result = await shareCalendar(dav, calendarUrl, req.body)
      return reply.send(result)
    } catch (err) {
      if (err instanceof ShareFailedError) {
        return reply.code(422).send({ error: 'share_failed', message: err.message })
      }
      throw err
    }
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return

    try {
      await store.deleteCalendar(dav, req.params.id)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof ShareFailedError) {
        return reply.code(422).send({ error: 'delete_failed', message: err.message })
      }
      throw err
    }
  })

  app.post<{ Params: { id: string } }>('/:id/unsubscribe', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return

    try {
      const result = await store.unsubscribeCalendar(dav, req.params.id)
      return reply.send(result)
    } catch (err) {
      if (err instanceof ShareFailedError) {
        return reply.code(422).send({ error: 'unsubscribe_failed', message: err.message })
      }
      throw err
    }
  })

  app.get<{ Params: { id: string }; Querystring: { start?: string; end?: string } }>(
    '/:id/events',
    async (req, reply) => {
      const dav = requireSession(req, reply)
      if (!dav) return

      const { start, end } = req.query
      if (!start || !end) {
        return reply.code(400).send({ error: 'bad_request', message: 'start and end query params are required' })
      }

      const events = await store.getEvents(dav, req.params.id, { start, end })
      return reply.send(events)
    },
  )

  app.post<{ Params: { id: string }; Body: CreateEventInput }>('/:id/events', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return

    const fieldsError = eventFieldsError(req.body)
    if (fieldsError) {
      return reply.code(400).send({ error: 'bad_request', message: fieldsError })
    }

    const uid = crypto.randomUUID()
    const ics = calendarObjectToIcs(uid, req.body)
    const created = await store.createObject(dav, req.params.id, ics)
    return reply.code(201).send(created)
  })

  app.post<{ Params: { id: string }; Body: { ics: string } }>('/:id/import', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return

    if (!req.body?.ics) {
      return reply.code(400).send({ error: 'bad_request', message: 'ics is required' })
    }

    let icsGroups: string[]
    try {
      icsGroups = splitImportIcs(req.body.ics)
    } catch {
      return reply.code(400).send({ error: 'bad_request', message: 'Could not parse ICS file' })
    }
    if (icsGroups.length === 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'No events found in file' })
    }

    let imported = 0
    for (const ics of icsGroups) {
      try {
        await store.createObject(dav, req.params.id, ics)
        imported++
      } catch (err) {
        req.log.warn({ err }, 'Failed to import one event from ICS file; continuing with the rest')
      }
    }
    return reply.send({ imported, total: icsGroups.length })
  })

  app.put<{ Params: { id: string; uid: string }; Body: UpdateEventInput }>(
    '/:id/events/:uid',
    async (req, reply) => {
      const dav = requireSession(req, reply)
      if (!dav) return

      if (!req.body || typeof req.body.href !== 'string' || typeof req.body.etag !== 'string') {
        return reply.code(400).send({ error: 'bad_request', message: 'href and etag are required' })
      }
      const { href, etag, fields, scope, recurrenceId } = req.body
      const calendarId = req.params.id
      const uid = req.params.uid

      const fieldsError = eventFieldsError(fields)
      if (fieldsError) {
        return reply.code(400).send({ error: 'bad_request', message: fieldsError })
      }

      try {
        if (scope === 'this' || scope === 'thisAndFuture') {
          if (!recurrenceId) {
            return reply
              .code(400)
              .send({ error: 'bad_request', message: 'recurrenceId is required for this scope' })
          }

          const raw = await store.getRawObject(dav, href)

          if (scope === 'this') {
            const newIcs = editScope.applyThisOccurrence(raw.ics, recurrenceId, fields)
            const updated = await store.updateObject(dav, { calendarId, uid, href, etag }, newIcs)
            return reply.send(updated)
          }

          const split = editScope.applyThisAndFuture(raw.ics, recurrenceId, fields)
          const updated = await store.updateObject(dav, { calendarId, uid, href, etag }, split.updatedIcs)
          const newSeries = await store.createObject(dav, calendarId, split.newSeriesIcs)
          return reply.send({ updatedSeries: updated, newSeries })
        }

        // scope === 'all'
        const raw = await store.getRawObject(dav, href)
        const newIcs = editScope.applyAll(raw.ics, fields)
        const updated = await store.updateObject(dav, { calendarId, uid, href, etag }, newIcs)
        return reply.send(updated)
      } catch (err) {
        if (err instanceof EtagConflictError) {
          return reply.code(412).send({ error: 'conflict', message: err.message })
        }
        throw err
      }
    },
  )

  app.delete<{ Params: { id: string; uid: string }; Body: DeleteEventInput }>(
    '/:id/events/:uid',
    async (req, reply) => {
      const dav = requireSession(req, reply)
      if (!dav) return

      if (!req.body || typeof req.body.href !== 'string' || typeof req.body.etag !== 'string') {
        return reply.code(400).send({ error: 'bad_request', message: 'href and etag are required' })
      }
      const { href, etag, scope, recurrenceId } = req.body
      const calendarId = req.params.id
      const uid = req.params.uid

      try {
        if (scope === 'all' || !recurrenceId) {
          await store.deleteObject(dav, { calendarId, uid, href, etag })
          return reply.code(204).send()
        }

        const raw = await store.getRawObject(dav, href)
        const newIcs =
          scope === 'this'
            ? editScope.deleteThisOccurrence(raw.ics, recurrenceId)
            : editScope.deleteThisAndFuture(raw.ics, recurrenceId)
        const updated = await store.updateObject(dav, { calendarId, uid, href, etag }, newIcs)
        return reply.send(updated)
      } catch (err) {
        if (err instanceof EtagConflictError) {
          return reply.code(412).send({ error: 'conflict', message: err.message })
        }
        throw err
      }
    },
  )
}
