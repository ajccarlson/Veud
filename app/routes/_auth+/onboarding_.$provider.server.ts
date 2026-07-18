import { invariant } from '@epic-web/invariant'
import { redirect } from 'react-router'
import { ProviderNameSchema } from '#app/utils/connections.tsx'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { onboardingEmailSessionKey } from './onboarding.tsx'
import { providerNameKey } from './onboarding_.$provider.tsx'
import { type VerifyFunctionArgs } from './verify.server.ts'

export async function handleVerification({
	request,
	submission,
}: VerifyFunctionArgs) {
	invariant(
		submission.status === 'success',
		'Submission should be successful by now',
	)
	const verifySession = await verifySessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const providerName = ProviderNameSchema.parse(
		verifySession.get(providerNameKey),
	)
	verifySession.set(onboardingEmailSessionKey, submission.value.target)
	return redirect(`/onboarding/${providerName}`, {
		headers: {
			'set-cookie': await verifySessionStorage.commitSession(verifySession),
		},
	})
}
