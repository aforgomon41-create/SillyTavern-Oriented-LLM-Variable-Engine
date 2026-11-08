// A separate local API session; never reads browser cookies or credentials.
export async function liveHttp(origin = 'http://localhost:11451') {
  if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('仅允许本地验收');
  let cookie = '', csrf = '';
  const request = async (path, options = {}) => {
    const response = await fetch(origin + path, { ...options, headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) } });
    const cookies = response.headers.getSetCookie(); if (cookies.length) cookie = cookies.map(c => c.split(';')[0]).join('; ');
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response;
  };
  csrf = (await (await request('/csrf-token')).json()).token;
  const post = (path, body) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { request, post };
}
