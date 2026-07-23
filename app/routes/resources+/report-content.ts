import { data as json, type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { createModerationReport } from '#app/utils/moderation.server.ts'
import {
	reportableModerationReasons,
	moderationTargetTypes,
} from '#app/utils/moderation.ts'
import { requireUserWithPermission } from '#app/utils/permissions.server.ts'

const ReportSchema = z.object({
	targetType: z.enum(moderationTargetTypes),
	targetId: z.string().trim().min(1).max(100),
	reasonCategory: z.enum(reportableModerationReasons),
	details: z.string().trim().max(1_000).default(''),
})

export async function action({ request, url }: ActionFunctionArgs) {
	const reporterId = await requireUserWithPermission(
		request,
		'create:report:own',
		{ url },
	)
	const parsed = ReportSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success) {
		return json(
			{ ok: false as const, error: 'Choose a valid reason and try again.' },
			{ status: 400 },
		)
	}
	const report = await prisma.$transaction(tx =>
		createModerationReport(tx, { reporterId, ...parsed.data }),
	)
	return json({
		ok: true as const,
		reportId: report.id,
		duplicate: report.duplicate,
	})
}
