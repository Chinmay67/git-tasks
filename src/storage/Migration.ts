// Schema version tracking. Future migrations are added here.
export const CURRENT_SCHEMA_VERSION = 1;

export function runMigrations(_data: Record<string, unknown>, _fromVersion: number): Record<string, unknown> {
  // V1 → V2 migrations will be added here when needed
  return _data;
}
