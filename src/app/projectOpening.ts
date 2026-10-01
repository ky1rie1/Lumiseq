import type { IDocumentManager } from '../types/document';

function comparablePath(path: string): string {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
    ? path.replace(/\//g, '\\').toLocaleLowerCase()
    : path;
}

/** A local project may be open only once; otherwise two tabs silently overwrite one file. */
export function findOpenProjectDocumentId(
  path: string,
  documentPaths: ReadonlyMap<string, string>,
  documents: Pick<IDocumentManager, 'getDocument'>,
): string | null {
  const key = comparablePath(path);
  for (const [id, savedPath] of documentPaths) {
    if (comparablePath(savedPath) === key && documents.getDocument(id)) return id;
  }
  return null;
}
