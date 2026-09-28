// Vercel's Node runtime hands handlers (req, res). The functions in ./_lib are
// written against the Web standard, (Request) -> Response.
//
// Netlify is gone, so the original reason for this adapter — one implementation
// serving two hosts — has gone with it. It stays because the Web signature is
// the portable one: Request and Response are the platform, `req`/`res` is
// Vercel's Node shim. Keeping the functions standard means the next host needs
// this file rewritten, not all nine functions.

export function toVercel(webHandler) {
  return async function handler(req, res) {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
    const proto = req.headers['x-forwarded-proto'] || 'https'
    const url = `${proto}://${host}${req.url}`

    // Vercel pre-parses JSON bodies; the Web handler expects to parse it itself.
    let body
    if (!['GET', 'HEAD'].includes(req.method)) {
      body = typeof req.body === 'string' ? req.body
           : req.body != null ? JSON.stringify(req.body)
           : undefined
    }

    const request = new Request(url, {
      method: req.method,
      headers: new Headers(req.headers),
      body,
    })

    const response = await webHandler(request)

    res.status(response.status)
    response.headers.forEach((value, key) => {
      // Let the platform own the framing headers
      if (!['content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
        res.setHeader(key, value)
      }
    })
    res.send(await response.text())
  }
}
