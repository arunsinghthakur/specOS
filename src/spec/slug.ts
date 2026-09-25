/** Lowercases, replaces runs of non-alphanumeric characters with a single hyphen, and trims leading/trailing hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
