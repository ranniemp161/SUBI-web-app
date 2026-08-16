/**
 * Is this string a uuid?
 *
 * Pure and dependency free, like `styles.ts` and `emotions.ts`, because both
 * kinds of caller need it: a route handler checking a request body, and a server
 * action checking a form value.
 *
 * **It exists so a malformed id is a refusal rather than a database error.**
 * Every id in this app is a Postgres `uuid` column, so handing a query the
 * string "abc" raises inside the driver and surfaces as a 500 — an input problem
 * reported as a server fault, with the value in the error. Checking the shape
 * first turns that into the 422 it always was.
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
