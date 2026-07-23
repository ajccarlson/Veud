import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	data as json,
	Form,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	useActionData,
	useLoaderData,
} from 'react-router'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { getHints } from '#app/utils/client-hints.tsx'
import {
	getNotificationPreferences,
	saveNotificationPreferences,
} from '#app/utils/notification-preferences.server.ts'
import {
	isValidTimeZone,
	nextNotificationDigestAt,
	notificationDigestFrequencies,
} from '#app/utils/notification-preferences.ts'

export const handle: SEOHandle & { breadcrumb: React.ReactNode } = {
	breadcrumb: <Icon name="envelope-closed">Notifications</Icon>,
	getSitemapEntries: () => null,
}

const PreferenceSchema = z.object({
	inAppSocial: z.boolean(),
	inAppReleases: z.boolean(),
	emailSocial: z.boolean(),
	emailReleases: z.boolean(),
	digestFrequency: z.enum(notificationDigestFrequencies),
	digestHour: z.coerce.number().int().min(0).max(23),
	digestWeekday: z.coerce.number().int().min(0).max(6),
	timeZone: z.string().refine(isValidTimeZone, 'Invalid time zone'),
})

function checked(formData: FormData, key: string) {
	return formData.get(key) === 'on'
}

export async function loader({ request, url }: LoaderFunctionArgs) {
	const ownerId = await requireUserId(request, { url })
	const preferences = await getNotificationPreferences(
		ownerId,
		getHints(request).timeZone,
	)
	return json({ preferences })
}

export async function action({ request, url }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request, { url })
	const formData = await request.formData()
	const parsed = PreferenceSchema.safeParse({
		inAppSocial: checked(formData, 'inAppSocial'),
		inAppReleases: checked(formData, 'inAppReleases'),
		emailSocial: checked(formData, 'emailSocial'),
		emailReleases: checked(formData, 'emailReleases'),
		digestFrequency: formData.get('digestFrequency'),
		digestHour: formData.get('digestHour'),
		digestWeekday: formData.get('digestWeekday'),
		timeZone: formData.get('timeZone'),
	})
	if (!parsed.success) {
		return json(
			{ ok: false as const, error: 'Choose valid notification settings.' },
			{ status: 400 },
		)
	}
	const config = {
		...parsed.data,
		nextDigestAt: nextNotificationDigestAt(parsed.data),
	}
	await saveNotificationPreferences(ownerId, config)
	return json({ ok: true as const, preferences: config })
}

const weekdays = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
]

export default function NotificationSettingsRoute() {
	const data = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const preferences =
		actionData?.ok === true ? actionData.preferences : data.preferences

	return (
		<div className="space-y-8">
			<header className="space-y-2">
				<p className="text-xs font-black uppercase tracking-[0.18em] text-veud-mint">
					Delivery
				</p>
				<h2 className="text-2xl font-black text-veud-cream">
					Notification preferences
				</h2>
				<p className="text-sm text-veud-copy">
					Choose what appears in your Veud inbox and whether new activity is
					summarized by email.
				</p>
			</header>
			<Form method="post" className="space-y-8">
				<fieldset className="space-y-4">
					<legend className="font-black text-veud-cream">Veud inbox</legend>
					<PreferenceCheckbox
						name="inAppSocial"
						defaultChecked={preferences.inAppSocial}
						title="Social activity"
						description="Review and collection likes, comments, and replies."
					/>
					<PreferenceCheckbox
						name="inAppReleases"
						defaultChecked={preferences.inAppReleases}
						title="Release reminders"
						description="Due reminders for titles you explicitly follow."
					/>
				</fieldset>

				<fieldset className="space-y-4 border-t border-veud-border pt-6">
					<legend className="font-black text-veud-cream">Email summary</legend>
					<p className="text-sm text-veud-copy">
						Email is off by default. Security and account-verification messages
						are always sent separately.
					</p>
					<PreferenceCheckbox
						name="emailSocial"
						defaultChecked={preferences.emailSocial}
						title="Include social activity"
						description="Summarize new review and collection engagement."
					/>
					<PreferenceCheckbox
						name="emailReleases"
						defaultChecked={preferences.emailReleases}
						title="Include release reminders"
						description="Summarize release reminders that became due."
					/>
					<div className="grid gap-4 sm:grid-cols-3">
						<label className="space-y-2 text-sm font-bold text-veud-copy">
							<span>Frequency</span>
							<select
								name="digestFrequency"
								defaultValue={preferences.digestFrequency}
								className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground"
							>
								<option value="off">Off</option>
								<option value="daily">Daily</option>
								<option value="weekly">Weekly</option>
							</select>
						</label>
						<label className="space-y-2 text-sm font-bold text-veud-copy">
							<span>Delivery time</span>
							<select
								name="digestHour"
								defaultValue={preferences.digestHour}
								className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground"
							>
								{Array.from({ length: 24 }, (_, hour) => (
									<option key={hour} value={hour}>
										{new Date(Date.UTC(2026, 0, 1, hour)).toLocaleTimeString(
											'en-US',
											{ hour: 'numeric', timeZone: 'UTC' },
										)}
									</option>
								))}
							</select>
						</label>
						<label className="space-y-2 text-sm font-bold text-veud-copy">
							<span>Weekly day</span>
							<select
								name="digestWeekday"
								defaultValue={preferences.digestWeekday}
								className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground"
							>
								{weekdays.map((weekday, index) => (
									<option key={weekday} value={index}>
										{weekday}
									</option>
								))}
							</select>
						</label>
					</div>
					<input type="hidden" name="timeZone" value={preferences.timeZone} />
					<p className="text-xs text-veud-muted">
						Schedule time zone: {preferences.timeZone}
					</p>
				</fieldset>

				{actionData?.ok === false ? (
					<p role="alert" className="text-sm font-bold text-destructive">
						{actionData.error}
					</p>
				) : actionData?.ok ? (
					<p role="status" className="text-sm font-bold text-veud-mint">
						Notification preferences saved.
					</p>
				) : null}
				<Button type="submit">Save notification preferences</Button>
			</Form>
		</div>
	)
}

function PreferenceCheckbox({
	name,
	defaultChecked,
	title,
	description,
}: {
	name: string
	defaultChecked: boolean
	title: string
	description: string
}) {
	return (
		<label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border border-veud-border bg-veud-surface-soft p-4">
			<input
				type="checkbox"
				name={name}
				aria-label={title}
				defaultChecked={defaultChecked}
				className="mt-1 h-5 w-5"
			/>
			<span>
				<strong className="block text-veud-cream">{title}</strong>
				<small className="text-sm text-veud-copy">{description}</small>
			</span>
		</label>
	)
}
