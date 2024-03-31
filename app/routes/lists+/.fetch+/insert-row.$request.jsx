import { prisma } from '#app/utils/db.server.ts'

export function bulkUpdate(tableName, entries) {
  if (entries.length === 0) return prisma.$executeRawUnsafe(`SELECT 1;`);

  const fields = Object.keys(entries[0]).filter((key) => key !== 'id');
  const setSql = fields
    .map((field) => `"${field}" = data."${field}"`)
    .join(', ');

  const valuesSql = entries
    .map((entry) => {
      const values = fields.map((field) => {
        const value = entry[field];
        if (typeof value === 'string') {
          // Handle strings and escape single quotes
          return `'${value.replace(/'/g, "''")}'`;
        } else if (value instanceof Date) {
          // Convert Date to ISO 8601 string format
          return `'${value.toISOString()}'`;
        } else if (value == null) {
          return `NULL`
        }
        // Numbers and booleans are used as-is
        return value;
      });

      return `('${entry.id}', ${values.join(', ')})`;
    })
    .join(', ');

  const sql = `
    UPDATE "${tableName}"
    SET ${setSql}
    FROM (VALUES ${valuesSql}) AS data(id, ${fields
    .map((field) => `"${field}"`)
    .join(', ')})
    WHERE "${tableName}".id::text = data.id;
  `;

  return prisma.$executeRawUnsafe(sql);
}

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    const entries = await prisma.LiveActionEntry.findMany({
      where: {
        watchlistId: searchParams.get('watchlistId'),
      },
    });

    let newRowPosition = (searchParams.get('position') + searchParams.get('change'))
    let emptyRow = {id: "", watchlistId: searchParams.get('watchlistId'), position: newRowPosition, thumbnail: null, title: " ", type: null, airYear: null, length: null, rating: null, finishedDate: 0, genres: null, language: null, story: 0, character: 0, presentation: 0, sound: 0, performance: 0, enjoyment: 0, averaged: 0, personal: 0, differencePersonal: 0, tmdbScore: 0, differenceObjective: 0, description: null};
    entries.splice(newRowPosition - 1, 0, emptyRow);

    for (let entry of entries) {
      if (entry.position > newRowPosition)
        entry.position++
    }

    return await bulkUpdate("LiveActionEntry", entries)
  }
  catch(e) {
    return e
  }
};
