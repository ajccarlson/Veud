import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	data as json,
	redirect,
	type LoaderFunctionArgs,
	Link,
	useLoaderData,
} from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { VeudPanel } from '#app/components/ui/veud-layout.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'

export const RECOVERY_CODES_SESSION_KEY = 'two-factor-recovery-codes'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request, url }: LoaderFunctionArgs) {
	await requireUserId(request, { url })
	const session = await verifySessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const value = session.get(RECOVERY_CODES_SESSION_KEY)
	if (!Array.isArray(value) || !value.every(code => typeof code === 'string')) {
		return redirect('/settings/profile/two-factor')
	}
	return json(
		{ recoveryCodes: value },
		{
			headers: {
				'set-cookie': await verifySessionStorage.destroySession(session),
			},
		},
	)
}

export default function TwoFactorRecoveryRoute() {
	const { recoveryCodes } = useLoaderData<typeof loader>()
	return (
		<VeudPanel className="space-y-5 p-6">
			<div className="space-y-2">
				<h1 className="text-2xl font-black text-veud-cream">Recovery codes</h1>
				<p className="text-veud-copy">
					Store these somewhere safe. Each code can be used once when your
					authenticator is unavailable.
				</p>
			</div>
			<ul className="grid grid-cols-2 gap-2 font-mono text-veud-cream">
				{recoveryCodes.map(code => (
					<li key={code} className="rounded-lg bg-black/30 px-3 py-2">
						{code}
					</li>
				))}
			</ul>
			<p className="text-sm text-veud-copy">
				Leaving this page removes the visible copy. Generating another set
				invalidates every previous recovery code.
			</p>
			<Button asChild>
				<Link to="/settings/profile/two-factor">I saved these codes</Link>
			</Button>
		</VeudPanel>
	)
}
