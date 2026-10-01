/** Yields complete SSE data lines even when transport chunks split a line. */
export async function* readSSEData(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trimEnd();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith('data:')) yield line.slice(5).trimStart();
      newline = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.startsWith('data:')) yield buffer.slice(5).trim();
}
