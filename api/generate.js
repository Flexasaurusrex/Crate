// api/generate.js
// ENV REQUIRED: ANTHROPIC_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { item, pricing, pressing, platform = 'tiktok', style = 'edu' } = req.body;
  if (!item) return res.status(400).json({ error: 'Item data required' });

  // Build context string from all available data
  const ctx = [
    `TYPE: ${item.type || 'UNKNOWN'}`,
    `TITLE: ${item.title || 'Unknown'}`,
    item.artist          && `ARTIST: ${item.artist}`,
    item.year            && `YEAR: ${item.year}`,
    item.label           && `LABEL: ${item.label}`,
    item.country         && `COUNTRY: ${item.country}`,
    item.catalog_number  && `CATALOG NUMBER: ${item.catalog_number}`,
    item.matrix          && `MATRIX CODE: ${item.matrix}`,
    item.pressing_notes  && `PRESSING NOTES: ${item.pressing_notes}`,
    item.obi_strip       && `OBI STRIP: Yes`,
    item.is_first_press  && `FIRST PRESS: Confirmed`,
    item.condition_flags?.length && `CONDITION FLAGS: ${item.condition_flags.join(', ')}`,
    pricing && `\nPRICING:\nAvg sold: $${pricing.avg_sold}\nLow: $${pricing.low_sold}  High: $${pricing.high_sold}\nTrend: ${pricing.price_trend}\nBest platform: ${pricing.best_platform}\nDays to sell: ${pricing.days_to_sell_avg}\n${pricing.condition_notes ? `Condition notes: ${pricing.condition_notes}` : ''}`,
    pressing && `\nDISCOGS DATA:\n${pressing.summary}\nDesirability: ${pressing.desirability}\nWant/Have: ${pressing.want_count}/${pressing.have_count} (ratio ${pressing.want_have_ratio})`
  ].filter(Boolean).join('\n');

  const styleGuide = {
    edu:   'Educational. You know things most people don\'t. Share them like a secret worth keeping.',
    hype:  'High energy. The find of the day. You\'re genuinely excited because the numbers are wild.',
    story: 'Narrative-first. Tell the story of the object before you mention money. Make them care.',
    flip:  'Pure arbitrage. Efficient. Numbers first. The story is the profit margin.'
  };

  const systemPrompt = `You are the cultural intelligence engine for CRATE, a physical media intelligence platform.

Your voice: Confident. Dry. Genuinely knowledgeable. Slightly conspiratorial. Never trying hard. You're the person at the thrift store who quietly knows more than everyone else in the building.

You understand art history, music history, film history, and the economics of collector markets. You know why pre-algorithmic culture matters to younger generations and how to explain it in 15 seconds.

Style for this response: ${styleGuide[style] || styleGuide.edu}

NEVER use the word "unique". NEVER use "amazing" or "incredible". NEVER be sycophantic. Write like you mean it.

Respond with ONLY valid JSON. No markdown, no explanation.`;

  const userPrompt = `Generate a complete intelligence package for this physical media item:

${ctx}

Platform: ${platform}

Return ONLY this JSON structure:
{
  "verdict": "flip|hold|pass|watch",
  "verdict_word": "FLIP IT|HOLD|PASS|WATCH IT",
  "verdict_sub": "one punchy line max 8 words",
  "verdict_icon": "🔥|⏳|❌|👀",

  "culture": {
    "headline": "one punchy cultural fact, present tense, max 12 words",
    "body": "2-3 sentences of genuine cultural context. Art historical perspective. Why this object matters right now. Why someone pays for it today.",
    "deep_cut": "one expert-level detail only a serious collector would know"
  },

  "content": {
    "hook": "opening line max 12 words, creates immediate curiosity or surprise",
    "script": "full TikTok/Reels script 80-120 words. Conversational. Include [action cues in brackets]. Never name the app.",
    "caption": "Instagram caption 40-60 words. Key price discovery. Ends with a question.",
    "thread_opener": "Twitter/X thread opener under 280 chars"
  },

  "hashtags": {
    "primary": ["5-6 high-reach hashtags specific to this format and item"],
    "niche": ["4-5 collector community hashtags"],
    "brand": ["#Crate", "#CrateDigging", "#PhysicalMedia", "#ThriftFlip"]
  },

  "sell_tips": [
    "specific tip to maximize sale price for this exact item",
    "platform recommendation with concrete reason",
    "presentation or condition tip that adds value"
  ]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude error:', err);
      return res.status(502).json({ error: 'Generation failed', detail: err });
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '';

    let generated;
    try {
      generated = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      return res.status(502).json({ error: 'Could not parse Claude response', raw: rawText });
    }

    return res.status(200).json({ generated, model: data.model, tokens: data.usage?.output_tokens });

  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: err.message });
  }
}
