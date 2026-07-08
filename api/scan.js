// VisiCheck fetcher — serverless function (Vercel). Reads a public site's HTML like a browser and returns it with CORS headers.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');
  const url = (req.query.url || '').toString();
  if (!/^https?:\/\/[^/]+\./i.test(url)) return res.status(400).json({ error: 'invalid url' });
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes('[')) return res.status(400).json({ error: 'blocked host' });
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 VisiCheck/1.0 (+https://getvisicheck.com)', 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9,es;q=0.8' }, signal: AbortSignal.timeout(15000) });
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('html') && !ct.includes('text')) return res.status(415).json({ error: 'not html', contentType: ct });
    const html = (await r.text()).slice(0, 900000);
    return res.status(200).json({ status: r.status, finalUrl: r.url, html });
  } catch (e) {
    return res.status(502).json({ error: 'fetch failed' });
  }
}
