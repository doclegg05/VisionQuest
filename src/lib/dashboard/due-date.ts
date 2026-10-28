const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// datetime-local values carry no zone, but the API requires one, so convert
// the browser-local wall time to an absolute ISO instant at submit time.
export function toIsoDueAt(value: string): string {
  if (!LOCAL_DATETIME.test(value)) return value;
  return new Date(value).toISOString();
}
