import { type ActionFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireEntryOwner } from '#app/utils/lists/authorization.server.ts'
import { syncTrackingStateForEntry } from '#app/utils/tracking-state.server.ts'

const categoryScoreFields = [
	'story',
	'character',
	'presentation',
	'sound',
	'performance',
	'enjoyment',
] as const

function parseScore(value: unknown, integer: boolean) {
	if (value === null || value === undefined || value === '') return null
	const score = Number(value)
	if (!Number.isFinite(score) || score < 1 || score > 10) {
		throw new Response('Scores must be between 1 and 10', { status: 400 })
	}
	if (integer && !Number.isInteger(score)) {
		throw new Response('Category scores must be whole numbers', { status: 400 })
	}
	return score
}

function parseDate(value: unknown) {
	if (value === null || value === undefined || value === '') return null
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Response('Invalid date', { status: 400 })
	}
	const date = new Date(`${value}T00:00:00.000Z`)
	if (
		Number.isNaN(date.getTime()) ||
		date.toISOString().slice(0, 10) !== value
	) {
		throw new Response('Invalid date', { status: 400 })
	}
	return date.toISOString()
}

function parseHistory(value: string | null) {
	try {
		const history = JSON.parse(value ?? '')
		if (history && typeof history === 'object' && !Array.isArray(history)) {
			return history as Record<string, unknown>
		}
	} catch {}
	return {
		added: Date.now(),
		started: null,
		finished: null,
		progress: null,
	}
}

export async function action({ request }: ActionFunctionArgs) {
	let entryId: unknown
	let fields: Record<string, unknown>
	try {
		const payload: unknown = await request.json()
		if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
			throw new Error('Invalid payload')
		}
		entryId = (payload as Record<string, unknown>).entryId
		const parsed = (payload as Record<string, unknown>).fields
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error('Invalid fields')
		}
		fields = parsed as Record<string, unknown>
	} catch {
		throw new Response('Invalid advanced edit payload', { status: 400 })
	}
	if (typeof entryId !== 'string') {
		throw new Response('Invalid advanced edit payload', { status: 400 })
	}
	const { entry, watchlist } = await requireEntryOwner(request, entryId)

	const data: Record<string, unknown> = {}
	for (const field of categoryScoreFields) {
		if (Object.hasOwn(fields, field)) {
			data[field] = parseScore(fields[field], true)
		}
	}
	if (Object.hasOwn(fields, 'personal')) {
		data.personal = parseScore(fields.personal, false)
	}
	if (Object.hasOwn(fields, 'priority')) {
		if (
			typeof fields.priority !== 'string' ||
			!['', 'Low', 'Medium', 'High'].includes(fields.priority)
		) {
			throw new Response('Invalid priority', { status: 400 })
		}
		data.priority = fields.priority.trim() || null
	}
	if (Object.hasOwn(fields, 'notes')) {
		if (typeof fields.notes !== 'string' || fields.notes.length > 5000) {
			throw new Response('Notes must be 5,000 characters or fewer', {
				status: 400,
			})
		}
		data.notes = fields.notes
	}

	if (Object.hasOwn(fields, 'started') || Object.hasOwn(fields, 'finished')) {
		const history = parseHistory(entry.history)
		if (Object.hasOwn(fields, 'started')) {
			history.started = parseDate(fields.started)
		}
		if (Object.hasOwn(fields, 'finished')) {
			history.finished = parseDate(fields.finished)
		}
		history.lastUpdated = Date.now()
		data.history = JSON.stringify(history)
	}

	if (!Object.keys(data).length) {
		throw new Response('No editable fields were provided', { status: 400 })
	}

	return prisma.$transaction(async tx => {
		const updated = await tx.entry.update({
			where: { id: entry.id },
			data: data as any,
		})
		await tx.watchlist.update({
			where: { id: watchlist.id },
			data: { updatedAt: new Date() },
		})
		await syncTrackingStateForEntry(tx, entry.id)
		return updated
	})
}
