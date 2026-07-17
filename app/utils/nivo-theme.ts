/**
 * JS mirror of the `--veud-*` palette defined in app/styles/user-landing.scss.
 * The @nivo charts compute their SVG fills (and derived border/label shades) in JS via
 * chroma, so they can't consume CSS custom properties — the concrete hex values live here
 * instead. Keep these in sync with the SCSS tokens.
 */

export const veudChartColors = [
  '#54806C', // teal
  '#FF9900', // amber
  '#A2FFD5', // mint
  '#FF4200', // orange
  '#8CA99D', // sage (control-hover)
  '#dbffcc', // mint-text
  '#66563d', // bronze
  '#FFEFCC', // cream
]

export const veudNivoTheme = {
  background: 'transparent',
  text: {
    fontSize: 12,
    fill: '#FFEFCC', // cream
  },
  axis: {
    domain: { line: { stroke: '#6F6F6F', strokeWidth: 1 } },
    ticks: {
      line: { stroke: '#6F6F6F', strokeWidth: 1 },
      text: { fill: '#FFEFCC' },
    },
    legend: { text: { fill: '#dbffcc', fontSize: 13 } }, // mint-text
  },
  grid: { line: { stroke: 'rgba(255, 255, 255, 0.08)', strokeWidth: 1 } },
  legends: { text: { fill: '#FFEFCC' } },
  labels: { text: { fill: '#2e2f2b' } }, // dark bg — labels sit on light-coloured marks
  tooltip: {
    container: {
      background: '#383040', // surface
      color: '#FFEFCC',
      fontSize: 12,
      borderRadius: '0.4rem',
    },
  },
}
