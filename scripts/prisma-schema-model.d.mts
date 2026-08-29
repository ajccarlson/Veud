export type SchemaField = {
	name: string
	type: string
	kind: 'object' | 'scalar'
	isList: boolean
	isRequired: boolean
	isId: boolean
	relationName?: true
	relationFromFields: string[]
	relationOnDelete: string | null
}

export type SchemaModel = {
	name: string
	fields: SchemaField[]
}

export declare const defaultSchemaPath: string
export declare function parsePrismaSchema(schemaPath?: string): SchemaModel[]
export declare function classifyFields(models: SchemaModel[]): SchemaModel[]
export declare function schemaModels(schemaPath?: string): SchemaModel[]
export declare function schemaModel(
	name: string,
	schemaPath?: string,
): SchemaModel
export declare function listRelations(
	name: string,
	schemaPath?: string,
): string[]
