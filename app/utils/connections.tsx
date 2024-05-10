import { Form } from '@remix-run/react'
import { z } from 'zod'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { useIsPending } from './misc.tsx'

export const GITHUB_PROVIDER_NAME = 'github'
export const MAL_PROVIDER_NAME = 'mal'
export const TRAKT_PROVIDER_NAME = 'trakt'
// to add another provider, set their name here and add it to the providerNames below

export const providerNames = [/*GITHUB_PROVIDER_NAME, */MAL_PROVIDER_NAME, TRAKT_PROVIDER_NAME] as const
export const ProviderNameSchema = z.enum(providerNames)
export type ProviderName = z.infer<typeof ProviderNameSchema>

export const providerLabels: Record<ProviderName, string> = {
	// [GITHUB_PROVIDER_NAME]: 'GitHub',
  [MAL_PROVIDER_NAME]: 'MyAnimeList',
  [TRAKT_PROVIDER_NAME]: 'Trakt',
} as const

export const providerIcons: Record<ProviderName, React.ReactNode> = {
	// [GITHUB_PROVIDER_NAME]: <Icon name="github-logo" />,
  [MAL_PROVIDER_NAME]: <Icon name="mal-logo" />,
  [TRAKT_PROVIDER_NAME]: <Icon name="trakt-logo" />,
} as const

export function ProviderConnectionForm({
	redirectTo,
	type,
	providerName,
}: {
	redirectTo?: string | null
	type: 'Connect' | 'Login' | 'Signup'
	providerName: ProviderName
}) {
	const label = providerLabels[providerName]
	const formAction = `/auth/${providerName}`
	const isPending = useIsPending({ formAction })
	return (
		<Form
			className="flex items-center justify-center gap-2"
			action={formAction}
			method="POST"
		>
			{redirectTo ? (
				<input type="hidden" name="redirectTo" value={redirectTo} />
			) : null}
			<StatusButton
				type="submit"
				className="w-full"
				status={isPending ? 'pending' : 'idle'}
			>
				<span className="inline-flex items-center gap-1.5">
					{providerIcons[providerName]}
					<span>
						{type} with {label}
					</span>
				</span>
			</StatusButton>
		</Form>
	)
}
