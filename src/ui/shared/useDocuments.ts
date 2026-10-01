import { useEffect, useReducer } from 'react';
import { defaultDocumentManager } from '../../document/DocumentManager';

export function useDocuments() {
  const [, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => defaultDocumentManager.subscribe(() => refresh()), []);
  return {
    documents: defaultDocumentManager.getOpenDocuments(),
    activeDocument: defaultDocumentManager.getActiveDocument(),
  };
}
