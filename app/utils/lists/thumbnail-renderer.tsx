import { type CustomCellRendererProps } from "@ag-grid-community/react";

export default (params: CustomCellRendererProps) => (
    <a href="http://www.google.com/">
        <span>
            { params.value && (
            <img
                alt={`Thumbnail`}
                src={`https://m.media-amazon.com/images/M/MV5BMTQ1MjAwNTM5Ml5BMl5BanBnXkFtZTYwNDM0MTc3._V1_FMjpg_UX485_.jpg`}
            />
            ) }
        </span>
    </a>
)
