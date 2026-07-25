import { type MetaFunction } from 'react-router'
import {
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'
import { PRIVACY_VERSION } from '#app/utils/legal-policy.ts'

export const meta: MetaFunction = () => [
	{ title: 'Privacy Policy | Veud' },
	{
		name: 'description',
		content: 'How Veud collects, uses, and retains account data.',
	},
]

export default function PrivacyRoute() {
	return (
		<VeudPage width="narrow" className="space-y-6">
			<VeudPageHeader
				eyebrow={`Effective ${PRIVACY_VERSION}`}
				title="Privacy Policy"
				description={
					<p>How Veud handles information associated with your use.</p>
				}
			/>

			<VeudPanel className="space-y-6 p-6 leading-7 text-veud-copy">
				<section>
					<h2 className="text-xl font-black text-veud-cream">
						Information Veud stores
					</h2>
					<p>
						Veud stores account credentials, profile settings, library activity,
						lists, ratings, reviews, social activity, imports, security records,
						and service diagnostics needed to operate and protect the site.
					</p>
				</section>
				<section>
					<h2 className="text-xl font-black text-veud-cream">
						How information is used
					</h2>
					<p>
						Information is used to provide tracking, discovery, recommendations,
						notifications, imports, moderation, account security, diagnostics,
						and the privacy controls you select.
					</p>
				</section>
				<section>
					<h2 className="text-xl font-black text-veud-cream">
						Providers and optional AI
					</h2>
					<p>
						Veud retrieves catalog metadata from the providers named on the data
						sources page. Optional AI features send only the input needed for
						the selected feature. MyAnimeList-derived content is excluded from
						external AI processing. Veud does not use your prompts to train its
						own model.
					</p>
				</section>
				<section>
					<h2 className="text-xl font-black text-veud-cream">
						Visibility and sharing
					</h2>
					<p>
						Public profiles, lists, reviews, collections, and activity can be
						seen by other visitors. Private lists and account-only settings are
						restricted according to their controls. Veud does not sell personal
						information.
					</p>
				</section>
				<section>
					<h2 className="text-xl font-black text-veud-cream">
						Retention and deletion
					</h2>
					<p>
						You can export or delete your account from settings. Active account
						data is deleted with the account unless limited records must be
						retained for security or moderation. Backup copies expire through
						the backup retention cycle and are used only for recovery.
					</p>
				</section>
				<section>
					<h2 className="text-xl font-black text-veud-cream">
						Security and choices
					</h2>
					<p>
						Veud uses access controls, encrypted transport, secure sessions,
						two-factor authentication, monitoring, and tested backups. Settings
						let you manage visibility, notifications, connections, exports, and
						account deletion.
					</p>
				</section>
			</VeudPanel>
		</VeudPage>
	)
}
