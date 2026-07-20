import { type HeadersFunction } from 'react-router'

/** Preserve parent timings while exposing the active profile loader phase. */
export const profileHeaders: HeadersFunction = ({
	parentHeaders,
	loaderHeaders,
}) => {
	const serverTiming = [
		parentHeaders.get('Server-Timing'),
		loaderHeaders.get('Server-Timing'),
	]
		.filter(Boolean)
		.join(',')
	const headers = new Headers()
	if (serverTiming) headers.set('Server-Timing', serverTiming)
	return headers
}
