import type { CanonicalToolSchema, JSONSchemaProperty } from '../types';
function valid(value: unknown, schema: JSONSchemaProperty): boolean {
    if (schema.enum && !schema.enum.includes(value as string | number))
        return false;
    switch (schema.type) {
        case 'number': return typeof value === 'number' && Number.isFinite(value);
        case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
        case 'boolean':
        case 'string': return typeof value === schema.type;
        case 'array': return Array.isArray(value) && (!schema.items || value.every(item => valid(item, schema.items!)));
        case 'object': {
            if (!value || typeof value !== 'object' || Array.isArray(value))
                return false;
            const object = value as Record<string, unknown>;
            if (schema.required?.some(key => !(key in object)))
                return false;
            return Object.entries(object).every(([key, item]) => !schema.properties || !!schema.properties[key] && valid(item, schema.properties[key]));
        }
    }
}
export function validToolArguments(args: unknown, schema: CanonicalToolSchema): boolean {
    return valid(args, { ...schema.parameters, description: '' });
}
