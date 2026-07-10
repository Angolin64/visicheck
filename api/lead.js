// VisiCheck → ConvertCore lead relay, and → SpokAra auto-provisioning for
// "Fix it for me" leads. Keeps both API keys server-side (env vars), out of
// the public repo/client.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { email, website, score, scores, language, plan } = body || {};
  if (!email || !/.+@.+\..+/.test(String(email))) { res.status(400).json({ error: 'invalid email' }); return; }

  const key = process.env.CONVERTCORE_API_KEY;
  const endpoint = process.env.CONVERTCORE_ENDPOINT ||
    'https://convertcoreai.com/api/webhooks/visicheck/form-submission';
  if (!key) { res.status(500).json({ error: 'lead relay not configured' }); return; }

  const s = scores || {};
  const planTag = plan ? String(plan).slice(0, 40) : '';
  const message = (planTag ? '[' + planTag + '] · ' : '') + 'VisiCheck scan · site: ' + (website || 'n/a') +
    ' · overall: ' + (score ?? 'n/a') +
    (scores ? (' · SEO ' + s.SEO + ' / AEO ' + s.AEO + ' / GEO ' + s.GEO + ' / AIO ' + s.AIO + ' / SXO ' + s.SXO) : '') +
    ' · lang: ' + (language || 'en');

  const convertcorePromise = fetch(endpoint, {
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

  // "Fix it for me" leads also auto-provision a SpokAra AI-visibility project —
  // closes the GEO/AEO/AIO pillars automatically, before a human ever follows up.
  // Runs alongside the ConvertCore relay (awaited so Vercel doesn't kill it as
  // soon as the response goes out); a SpokAra hiccup never blocks or fails the
  // lead capture response below — that's still driven by ConvertCore alone.
  const spokaraPromise = (planTag === 'FIX-IT-FOR-ME' && website)
    ? provisionSpokara(email, website)
    : Promise.resolve(null);

  const [convertcoreResult, spokaraResult] = await Promise.allSettled([convertcorePromise, spokaraPromise]);

  if (spokaraResult.status === 'rejected') {
    console.error('SpokAra auto-provision failed:', spokaraResult.reason);
  }

  if (convertcoreResult.status === 'fulfilled' && convertcoreResult.value.ok) {
    res.status(200).json({ ok: true });
    return;
  }

  if (convertcoreResult.status === 'fulfilled') {
    const r = convertcoreResult.value;
    let detail = null; try { detail = await r.text(); } catch (e) {}
    res.status(502).json({ ok: false, status: r.status, detail: detail ? detail.slice(0, 300) : null });
    return;
  }

  res.status(502).json({ ok: false, error: 'relay failed' });
}

// Best-effort business name from the analyzed URL — SpokAra just needs a label
// for the tenant/project; Angel can rename it later from the lead's real name.
function businessNameFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const base = host.split('.')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch (e) {
    return 'VisiCheck Lead';
  }
}

async function provisionSpokara(email, website) {
  const partnerKey = process.env.SPOKARA_PARTNER_KEY;
  if (!partnerKey) return null; // not configured yet — silently skip

  const base = process.env.SPOKARA_API_BASE || 'https://api.spokara.com';

  const r = await fetch(base + '/partners/visicheck/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Partner-Key': partnerKey },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      business_name: businessNameFromUrl(website),
      url: website,
      email: String(email)
    })
  });

  if (!r.ok) {
    let detail = null; try { detail = await r.text(); } catch (e) {}
    throw new Error('SpokAra provision failed: ' + r.status + ' ' + (detail || ''));
  }

  return r.json();
}
