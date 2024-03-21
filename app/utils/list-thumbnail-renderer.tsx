import { type CustomCellRendererProps } from "@ag-grid-community/react";
import { type LinksFunction } from '@remix-run/node'
import watchlistStyleSheetUrl from '../styles/watchlist.scss?url'

export default (params: CustomCellRendererProps) => (
    <a
        href="http://www.google.com/"
    >
        <span
            className="imgSpan"
        >
            {params.value && (
            <img
                alt={`Thumbnail`}
                src={`https://m.media-amazon.com/images/M/MV5BMTQ1MjAwNTM5Ml5BMl5BanBnXkFtZTYwNDM0MTc3._V1_FMjpg_UX485_.jpg`}
                className="logo"
            />
            )}
        </span>
    </a>
)

export const links: LinksFunction = () => {
	return [
		{ rel: 'stylesheet', href: watchlistStyleSheetUrl },
	].filter(Boolean)
}
