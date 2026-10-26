/** In-realm routing only; never sent as a header or treated as a security credential. */
export const engineRequest = Symbol.for('SOLVE.engineRequest');

export async function nativeSaveBody(input: RequestInfo | URL, init: RequestInit | undefined, url: URL): Promise<any> {
  const request = new Request(typeof input === 'object' && 'clone' in input ? input.clone() : url.href, init);
  let stream = request.body;
  if (stream && request.headers.get('Content-Encoding')?.toLowerCase() === 'gzip') stream = stream.pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
