// Vercel's Node runtime hands handlers (req, res); the existing functions were
// written for Netlify's Web-standard (Request) -> Response signature. Rather
// than fork every function, adapt between the two so one implementation serves
// both hosts while the migration is in flight.

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
