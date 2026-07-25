import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link, type MetaFunction } from 'react-router'
import {
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: '/support', priority: 0.2 }],
}

export const meta: MetaFunction = () => [
	{ title: 'Support | Veud' },
	{
		name: 'description',
		content: 'Help with Veud accounts, service issues, and account reviews.',
	},
]

export default function SupportRoute() {
	return (
		<VeudPage width="narrow">
			<VeudPageHeader
				eyebrow="Help"
				title="Support"
				description="Find the right place for account and service help."
			/>

			<div className="grid gap-4 sm:grid-cols-2">
				<VeudPanel className="flex h-full flex-col gap-3">
					<h2 className="text-xl font-black text-veud-cream">Account access</h2>
					<p className="text-sm leading-6 text-veud-copy">
						Reset a forgotten password or request a private review of an account
						suspension.
					</p>
					<div className="mt-auto flex flex-wrap gap-3 pt-2">
						<Link className="font-black text-veud-mint" to="/forgot-password">
							Reset password
						</Link>
						<Link className="font-black text-veud-mint" to="/appeal">
							Appeal a suspension
						</Link>
					</div>
				</VeudPanel>

				<VeudPanel className="flex h-full flex-col gap-3">
					<h2 className="text-xl font-black text-veud-cream">Service help</h2>
					<p className="text-sm leading-6 text-veud-copy">
						Check current availability before troubleshooting an unexpected
						service issue.
					</p>
					<div className="mt-auto pt-2">
						<Link className="font-black text-veud-mint" to="/status">
							View service status
						</Link>
					</div>
				</VeudPanel>
			</div>
		</VeudPage>
	)
}
