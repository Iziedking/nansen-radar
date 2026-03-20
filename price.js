// CoinGecko chain ID mapping (nansen chain name → CoinGecko platform ID)
const CHAIN_MAP = {
  ethereum:  'ethereum',
  base:      'base',
  bnb:       'binance-smart-chain',
  polygon:   'polygon-pos',
  arbitrum:  'arbitrum-one',
  optimism:  'optimistic-ethereum',
  avalanche: 'avalanche',
  solana:    'solana',
  linea:     'linea',
  scroll:    'scroll',
  mantle:    'mantle',
  ronin:     'ronin',
  sei:       'sei-network',
  sonic:     'sonic',
};

export async function fetchTokenPrice(chain, address) {
  if (!chain || !address) return null;

  const platformId = CHAIN_MAP[chain.toLowerCase()];
  if (!platformId) return null;

  try {
    const apiKey = process.env.COINGECKO_API_KEY || '';
    const keyParam = apiKey ? `&x_cg_demo_api_key=${apiKey}` : '';
    const url = `https://api.coingecko.com/api/v3/simple/token_price/${platformId}` +
      `?contract_addresses=${address}&vs_currencies=usd&include_24hr_change=true${keyParam}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;

    const data = await res.json();
    const tokenData = data[address.toLowerCase()];
    if (!tokenData) return null;

    return {
      price: tokenData.usd ?? null,
      change24h: tokenData.usd_24h_change ?? null,
      source: 'coingecko',
    };
  } catch {
    return null;
  }
}

export function formatPriceAlert(priceInfo, threshold, lastPrice) {
  if (!priceInfo?.price) return null;
  if (lastPrice == null) return null;

  const changePct = ((priceInfo.price - lastPrice) / lastPrice) * 100;
  if (Math.abs(changePct) < threshold) return null;

  const dir = changePct > 0 ? '📈 UP' : '📉 DOWN';
  const sign = changePct > 0 ? '+' : '';
  return `🚨 PRICE ALERT: ${dir} ${sign}${changePct.toFixed(1)}% → $${priceInfo.price.toFixed(6)}`;
}
