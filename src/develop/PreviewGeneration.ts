/** Invalidates asynchronous preview work whenever the document or settings change. */
export class PreviewGeneration {
 private generation=0;
 begin(){const generation=++this.generation;return ()=>generation===this.generation;}
 cancel(){++this.generation;}
}
