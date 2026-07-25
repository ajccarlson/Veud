import { type MetaFunction } from 'react-router'
import {
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'
import { TERMS_VERSION } from '#app/utils/legal-policy.ts'

export const meta: MetaFunction = () => [
	{ title: 'Terms of Service | Veud' },
	{
		name: 'description',
		content: 'The terms that apply when using Veud.',
	},
]

export default function TermsRoute() {
	return (
		<VeudPage width="narrow" className="space-y-6">
			<VeudPageHeader
				eyebrow={`Effective ${TERMS_VERSION}`}
				title="Terms of Service"
				description={
					<p>These terms apply when you create or use a Veud account.</p>
				}
			/>

			<VeudPanel className="space-y-6 p-6 leading-7 text-veud-copy">
				<section>
					<h2 className="text-xl font-black text-veud-cream">Your account</h2>
					<p>
						Provide accurate account information, protect your credentials, and
						use Veud only where you are legally permitted to do so. You are
						responsible for activity performed through your account.
					</p>
				</section>
				<section>
					<h2 className="text-xl font-black text-veud-cream">
						Content and conduct
					</h2>
					<p>
						You retain ownership of reviews, lists, notes, and other content you
						create. You grant Veud permission to store, process, and display
						that content as needed to provide the service. Do not post unlawful,
						abusive, deceptive, infringing, or privacy-invasive material.
					</p>
				</section>
				<section>
					<h2 className="text-xl font-black text-veud-cream">
						Catalog providers and AI
					</h2>
					<p>
						Media metadata comes from independent providers and may be delayed,
						incomplete, or corrected. Optional AI-assisted features may produce
						imperfect suggestions; you remain in control of changes to your
						library.
					</p>
				</section>
				<section>
					<h2 className="text-xl font-black text-veud-cream">Moderation</h2>
					<p>
						Veud may hide content, restrict features, suspend accounts, or
						remove accounts to protect members and the service. Available
						moderation decisions can be appealed through account settings or
						Support.
					</p>
				</section>
				<section>
					<h2 className="text-xl font-black text-veud-cream">
						Availability and changes
					</h2>
					<p>
						Veud is provided on an as-available basis and may change as the
						project evolves. Material changes to these terms will use a new
						version and will be presented for acceptance where required.
					</p>
				</section>
			</VeudPanel>
		</VeudPage>
	)
}
