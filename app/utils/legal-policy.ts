export const TERMS_VERSION = '2026-07-25'
export const PRIVACY_VERSION = '2026-07-25'

export function signupConsents(source: 'password-signup' | 'connected-signup') {
	return [
		{ document: 'terms', version: TERMS_VERSION, source },
		{ document: 'privacy', version: PRIVACY_VERSION, source },
	] as const
}
