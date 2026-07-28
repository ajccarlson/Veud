if (process.env.NODE_ENV === 'production') {
	await import('../index.js')
} else {
	await import('../server/dev-server.js')
}
