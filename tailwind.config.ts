import { type Config } from 'tailwindcss'
import animatePlugin from 'tailwindcss-animate'
import radixPlugin from 'tailwindcss-radix'
import { homePreset } from './app/routes/_home+/tailwind-preset.ts'
import { extendedTheme } from './app/utils/extended-theme.ts'

export default {
	content: ['./app/**/*.{js,jsx,ts,tsx}'],
	mode: 'jit',
	darkMode: 'class',
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px',
			},
		},
		extend: extendedTheme,
	},
	presets: [homePreset],
	plugins: [animatePlugin, radixPlugin],
} satisfies Config
