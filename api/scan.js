// api/scan.js
// ENV REQUIRED: GEMINI_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  const { front, back, type } = req.body;
  if (!front) return res.status(400).json({ error: 'Front image required' });

  const hasBoth = type === 'both' && !!back;

  try {
    // ── STEP 1: Identify item with Gemini Vision ──
    const identifyPrompt = hasBoth
      ? `You are a physical media expert. Analyze image 1 (FRONT cover) and image 2 (BACK cover).

From the back extract: catalog number, matrix/runout text, label info, country, OBI strip presence, pressing plant codes.

Respond with ONLY valid JSON, no markdown:
{
  "identified": true,
  "type": "VHS|VINYL|CD|CASSETTE|BETAMAX|LASERDISC|8TRACK",
  "title": "exact title",
  "artist": "artist or null",
  "year": "year string",
  "label": "label name",
  "country": "pressing country",
  "catalog_number": "exact as printed",
  "matrix": "matrix code or null",
  "pressing_notes": "concise pressing description",
  "obi_strip": false,
  "is_first_press": null,
  "condition_flags": [],
  "confidence": 0.95,
  "ebay_search_query": "best eBay sold listings search string for this exact item",
  "discogs_search": { "catno": "...", "artist": "...", "title": "..." }
}`
      : `You are a physical media expert. Analyze this FRONT cover image.

Respond with ONLY valid JSON, no markdown:
{
  "identified": true,
  "type": "VHS|VINYL|CD|CASSETTE|BETAMAX|LASERDISC|8TRACK",
  "title": "exact title",
  "artist": "artist or null",
  "year": "year string or null",
  "label": "label or null",
  "country": null,
  "catalog_number": null,
  "matrix": null,
  "pressing_notes": "what front cover reveals",
  "obi_strip": false,
  "is_first_press": null,
  "condition_flags": [],
  "confidence": 0.75,
  "ebay_search_query": "best eBay sold listings search string",
  "discogs_search": { "catno": null, "artist": "...", "title": "..." }
}`;

    const parts = [
      { inline_data: { mime_type: 'image/jpeg', data: front.replace(/^data:image\/\w+;base64,/, '') } }
    ];
    if (hasBoth) {
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: back.replace(/^data:image\/\w+;base64,/, '') } });
    }
    parts.push({ text: identifyPrompt });

    const visionRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024, responseMimeType: 'application/json' }
        })
      }
    );

    if (!visionRes.ok) {
      const err = await visionRes.text();
      return res.status(502).json({ error: 'Gemini Vision failed', detail: err });
    }

    const visionData = await visionRes.json();
    const rawText = visionData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let item;
    try {
      item = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      return res.status(502).json({ error: 'Could not parse Gemini response', raw: rawText });
    }

    // ── STEP 2: Get pricing via Gemini ──
    const pricing = await fetchPricing(item, GEMINI_API_KEY);

    return res.status(200).json({ item, pricing, deep_scan: hasBoth });

  } catch (err) {
    console.error('scan error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function fetchPricing(item, apiKey) {
  const q = item.ebay_search_query || `${item.title} ${item.type}`;
  const prompt = `Physical media pricing expert. Provide accurate current eBay sold listing prices for:

"${q}"
${item.catalog_number ? `Catalog: ${item.catalog_number}` : ''}${item.country ? `\nCountry: ${item.country}` : ''}${item.obi_strip ? '\nHas OBI strip (significant value add)' : ''}${item.is_first_press ? '\nFirst pressing' : ''}

Be accurate and realistic. Base on actual market data you know.

Respond with ONLY valid JSON:
{
  "avg_sold": 0.00,
  "low_sold": 0.00,
  "high_sold": 0.00,
  "recent_sales_count": 0,
  "price_trend": "rising|stable|falling",
  "condition_notes": "what affects price most",
  "best_platform": "eBay|Discogs|Depop|Facebook",
  "days_to_sell_avg": 0
}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 512, responseMimeType: 'application/json' }
        })
      }
    );
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.error('pricing error:', e);
    return null;
  }
}
