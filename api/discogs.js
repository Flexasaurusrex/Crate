// api/discogs.js
// ENV OPTIONAL: DISCOGS_TOKEN (increases rate limit from 25 to 60/min)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { catno, artist, title, release_id } = req.body;

  const headers = {
    'User-Agent': 'CrateApp/1.0 +https://crate.app',
    'Accept': 'application/vnd.discogs.v2.plaintext+json',
    ...(process.env.DISCOGS_TOKEN && {
      'Authorization': `Discogs token=${process.env.DISCOGS_TOKEN}`
    })
  };

  try {
    let releaseData = null;

    // Direct fetch by ID if we have it
    if (release_id) {
      const r = await fetch(`https://api.discogs.com/releases/${release_id}`, { headers });
      if (r.ok) releaseData = await r.json();
    }

    // Otherwise search - catalog number first (most precise), then artist/title
    if (!releaseData) {
      const params = new URLSearchParams({ type: 'release', per_page: '5' });
      if (catno)  params.append('catno', catno);
      if (artist) params.append('artist', artist);
      if (title)  params.append('release_title', title);

      const searchRes = await fetch(`https://api.discogs.com/database/search?${params}`, { headers });
      if (!searchRes.ok) return res.status(404).json({ error: 'Discogs search failed' });

      const searchData = await searchRes.json();
      const results = searchData.results || [];

      if (results.length === 0) return res.status(404).json({ error: 'Not found on Discogs', searched: { catno, artist, title } });

      // Fetch full release details for top result
      const topRes = await fetch(`https://api.discogs.com/releases/${results[0].id}`, { headers });
      if (topRes.ok) releaseData = await topRes.json();
    }

    if (!releaseData) return res.status(404).json({ error: 'Could not fetch release data' });

    // Marketplace stats
    let marketplace = null;
    const statsRes = await fetch(`https://api.discogs.com/marketplace/stats/${releaseData.id}`, { headers });
    if (statsRes.ok) {
      const s = await statsRes.json();
      marketplace = {
        lowest_price: s.lowest_price?.value || null,
        median_price: s.median_price?.value || null,
        num_for_sale: s.num_for_sale || 0
      };
    }

    // Community want/have ratio
    const have = releaseData.community?.have || 0;
    const want = releaseData.community?.want || 0;
    const ratio = have > 0 ? Math.round((want / have) * 10) / 10 : 0;
    const desirability = ratio > 2 ? 'Highly Sought After' : ratio > 1 ? 'In Demand' : ratio < 0.3 ? 'Common' : 'Standard';

    return res.status(200).json({
      release: {
        id: releaseData.id,
        title: releaseData.title,
        artists: releaseData.artists?.map(a => a.name).join(', '),
        year: releaseData.year,
        label: releaseData.labels?.[0]?.name,
        catalog_number: releaseData.labels?.[0]?.catno,
        country: releaseData.country,
        format: releaseData.formats?.[0]?.name,
        format_details: releaseData.formats?.[0]?.descriptions?.join(', '),
        genres: releaseData.genres,
        styles: releaseData.styles,
        community_rating: releaseData.community?.rating?.average,
        community_have: have,
        community_want: want,
        discogs_url: releaseData.uri,
        thumb: releaseData.thumb
      },
      marketplace,
      pressing: {
        summary: [
          releaseData.country && releaseData.year ? `${releaseData.country} pressing, ${releaseData.year}` : null,
          releaseData.formats?.[0]?.descriptions?.join(', '),
          releaseData.labels?.[0] ? `${releaseData.labels[0].name} ${releaseData.labels[0].catno || ''}`.trim() : null
        ].filter(Boolean).join(' · '),
        desirability,
        want_have_ratio: ratio,
        have_count: have,
        want_count: want
      }
    });

  } catch (err) {
    console.error('discogs error:', err);
    return res.status(500).json({ error: err.message });
  }
}
