// VisiCheck → ConvertCore lead relay.
// Keeps the CRM API key server-side (env var), out of the public repo/client.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { email, website, score, scores, language } = body || {};
  if (!email || !/.+@.+\..+/.test(String(email))) { res.status(400).json({ error: 'invalid email' }); return; }

  const key = process.env.CONVERTCORE_API_KEY;
  const endpoint = process.env.CONVERTCORE_ENDPOINT ||
    'https://convertcoreai.com/api/webhooks/visicheck/form-submission';
  if (!key) { res.status(500).json({ error: 'lead relay not configured' }); return; }

  const s = scores || {};
  const message = 'VisiCheck scan · site: ' + (website || 'n/a') +
    ' · overall: ' + (score ?? 'n/a') +
    (scores ? (' · SEO ' + s.SEO + ' / AEO ' + s.AEO + ' / GEO ' + s.GEO + ' / AIO ' + s.AIO + ' / SXO ' + s.SXO) : '') +
    ' · lang: ' + (language || 'en');

  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        name: String(email).split('@')[0],
        email: String(email),
        service: 'VisiCheck monitoring',
        message,
        source: 'visicheck'
      })
    });
    if (r.ok) { res.status(200).json({ ok: true }); }
    else {
      let detail = null; try { detail = await r.text(); } catch (e) {}
      res.status(502).json({ ok: false, status: r.status, detail: detail ? detail.slice(0, 300) : null });
    }
  } catch (e) {
    res.status(502).json({ ok: false, error: 'relay failed' });
  }
}
