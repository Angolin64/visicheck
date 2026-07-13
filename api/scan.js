// VisiCheck fetcher — serverless function (Vercel).
// Reads a public site's HTML like a normal browser and returns it with CORS
// headers, so the front end can analyze sites that block public CORS proxies.
//
// SSRF hardening: the original version only rejected literal IP hostnames
// (e.g. "http://192.168.1.1") and followed redirects automatically via
// `redirect: 'follow'`. That leaves two real holes: (1) a public domain name
// that *resolves* to a private/internal IP (DNS rebinding), and (2) a public
// URL that 302-redirects to an internal address after the first check
// passes. Both are closed below by resolving DNS ourselves and re-validating
// every hop before following it.
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_REDIRECTS = 5;

function isPrivateOrReservedIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 127) return true;                      // loopback
    if (a === 10) return true;                        // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
    if (a === 169 && b === 254) return true;           // link-local incl. cloud metadata (169.254.169.254)
    if (a === 0) return true;                          // "this network"
    if (a >= 224) return true;                         // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true;                              // loopback
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
    if (lower.startsWith('fe80')) return true;                     // link-local
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.split(':').pop();
      if (net.isIPv4(v4)) return isPrivateOrReservedIp(v4);
    }
    return false;
  }
  return true; // unrecognized format — fail closed
}

async function assertPublicHost(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) {
    throw new Error('blocked host');
  }
  if (net.isIP(lower)) {
    if (isPrivateOrReservedIp(lower)) throw new Error('blocked host');
    return;
  }
  // Resolve DNS ourselves and check every returned address — a bare hostname
  // check can't catch a domain that resolves to an internal IP.
  let addresses;
  try {
    addresses = await dns.lookup(lower, { all: true });
  } catch (e) {
    throw new Error('dns resolution failed');
  }
  if (!addresses.length || addresses.some(a => isPrivateOrReservedIp(a.address))) {
    throw new Error('blocked host');
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  let currentUrl = (req.query.url || '').toString();
  if (!/^https?:\/\/[^/]+\./i.test(currentUrl)) {
    res.status(400).json({ error: 'invalid url' });
    return;
  }

  try {
    let response = null;

    // Follow redirects manually so every hop — not just the first URL — is
    // re-validated against private/internal hosts before we fetch it.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(currentUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        res.status(400).json({ error: 'invalid url' });
        return;
      }
      await assertPublicHost(parsed.hostname);

      response = await fetch(currentUrl, {
        redirect: 'manual',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 VisiCheck/1.0 (+https://getvisicheck.com)',
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,es;q=0.8'
        },
        signal: AbortSignal.timeout(15000)
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) break;
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      break;
    }

    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('html') && !ct.includes('text')) {
      res.status(415).json({ error: 'not html', contentType: ct });
      return;
    }
    const html = (await response.text()).slice(0, 900000); // cap ~900 KB
    res.status(200).json({ status: response.status, finalUrl: currentUrl, html });
  } catch (e) {
    if (e.message === 'blocked host' || e.message === 'dns resolution failed') {
      res.status(400).json({ error: 'blocked host' });
      return;
    }
    res.status(502).json({ error: 'fetch failed' });
  }
}
