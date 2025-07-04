import type { Knex } from 'knex';
import { DuplicateTableQueryAbstract } from './abstract';

export class DuplicateTableQuerySqlite extends DuplicateTableQueryAbstract {
  protected knex: Knex.Client;
  constructor(queryBuilder: Knex.QueryBuilder) {
    super(queryBuilder);
    this.knex = queryBuilder.client;
  }

  duplicateTableData(
    sourceTable: string,
    targetTable: string,
    newColumns: string[],
    oldColumns: string[],
    crossBaseLinkDbFieldNames: { dbFieldName: string; isMultipleCellValue: boolean }[]
  ) {
    const newColumnList = newColumns.map((col) => `"${col}"`).join(', ');
    const oldColumnList = oldColumns
      .map((col) => {
        if (col === '__version') {
          return '1 AS "__version"';
        }
        // cross base link field should transform to text from json
        if (crossBaseLinkDbFieldNames.map(({ dbFieldName }) => dbFieldName).includes(col)) {
          const isMultipleCellValue = crossBaseLinkDbFieldNames.find(
            ({ dbFieldName }) => dbFieldName === col
          )?.isMultipleCellValue;
          return !isMultipleCellValue
            ? `json_extract("${col}", '$.title') as "${col}"`
            : `CASE
              WHEN "${col}" IS NULL THEN NULL
              ELSE (
                SELECT group_concat(json_extract(value, '$.title'), ',')
                FROM json_each("${col}")
              )
            END as "${col}"`;
        }
        return `"${col}"`;
      })
      .join(', ');
    return this.knex.raw(
      `INSERT INTO ?? (${newColumnList}) SELECT ${oldColumnList} FROM ?? ORDER BY __auto_number`,
      [targetTable, sourceTable]
    );
  }
}
