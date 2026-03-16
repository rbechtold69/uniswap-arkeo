import { useState, useEffect, useCallback } from 'react'
import { JsonRpcProvider, Contract } from 'ethers'
import './App.css'

// Arkeo-powered RPC
const CHAINS: Record<string, { name: string; rpc: string; arkeo: boolean; color: string; chainId: number }> = {
  base: {
    name: 'Base',
    rpc: 'https://arkeo-provider.liquify.com/base-mainnet-fullnode',
    arkeo: true,
    color: '#0052FF',
    chainId: 8453,
  },
  ethereum: {
    name: 'Ethereum',
    rpc: 'https://eth.llamarpc.com',
    arkeo: false,
    color: '#627EEA',
    chainId: 1,
  },
  polygon: {
    name: 'Polygon',
    rpc: 'https://arkeo-provider.liquify.com/polygon-mainnet-fullnode',
    arkeo: true,
    color: '#8247E5',
    chainId: 137,
  },
  bsc: {
    name: 'BNB Chain',
    rpc: 'https://arkeo-provider.liquify.com/bsc-mainnet-fullnode',
    arkeo: true,
    color: '#F0B90B',
    chainId: 56,
  },
}

// Uniswap V3 Factory addresses (same on all chains)
const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984'

// Popular tokens per chain
const TOKENS: Record<string, { symbol: string; address: string; decimals: number }[]> = {
  base: [
    { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    { symbol: 'USDbC', address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6 },
    { symbol: 'DAI', address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18 },
  ],
  ethereum: [
    { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
    { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
  ],
  polygon: [
    { symbol: 'WMATIC', address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals: 18 },
    { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    { symbol: 'WETH', address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18 },
    { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
  ],
  bsc: [
    { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
    { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    { symbol: 'BUSD', address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', decimals: 18 },
  ],
}

// ERC20 ABI (minimal)

// Uniswap V3 Pool ABI (minimal)
const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)',
  'function fee() view returns (uint24)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
]

const FACTORY_ABI = [
  'function getPool(address, address, uint24) view returns (address)',
]

interface PoolData {
  address: string
  token0Symbol: string
  token1Symbol: string
  fee: number
  liquidity: string
  sqrtPriceX96: string
  price: string
  tvlToken0: string
  tvlToken1: string
}

function App() {
  const [selectedChain, setSelectedChain] = useState('base')
  const [pools, setPools] = useState<PoolData[]>([])
  const [loading, setLoading] = useState(true)
  const [latency, setLatency] = useState<number | null>(null)
  const [blockNum, setBlockNum] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fromToken, setFromToken] = useState(0)
  const [toToken, setToToken] = useState(1)
  const [amount, setAmount] = useState('1')
  const [quote, setQuote] = useState<string | null>(null)

  const chain = CHAINS[selectedChain]
  const tokens = TOKENS[selectedChain] || []

  const fetchPools = useCallback(async () => {
    try {
      setError(null)
      const start = performance.now()
      const provider = new JsonRpcProvider(chain.rpc)
      const bn = await provider.getBlockNumber()
      setBlockNum(bn)
      setLatency(Math.round(performance.now() - start))

      const factory = new Contract(UNISWAP_V3_FACTORY, FACTORY_ABI, provider)
      const chainTokens = tokens
      const fees = [500, 3000, 10000] // 0.05%, 0.3%, 1%

      const poolPromises: Promise<PoolData | null>[] = []

      // Check pools for first few token pairs
      for (let i = 0; i < Math.min(chainTokens.length, 3); i++) {
        for (let j = i + 1; j < Math.min(chainTokens.length, 4); j++) {
          for (const fee of fees) {
            poolPromises.push(
              (async () => {
                try {
                  const poolAddr = await factory.getPool(chainTokens[i].address, chainTokens[j].address, fee)
                  if (poolAddr === '0x0000000000000000000000000000000000000000') return null

                  const pool = new Contract(poolAddr, POOL_ABI, provider)
                  const [slot0, liq] = await Promise.all([
                    pool.slot0(),
                    pool.liquidity(),
                  ])

                  // Calculate price from sqrtPriceX96
                  const sqrtPrice = Number(slot0[0]) / (2 ** 96)
                  const price = sqrtPrice * sqrtPrice
                  const adjustedPrice = price * (10 ** (chainTokens[i].decimals - chainTokens[j].decimals))

                  return {
                    address: poolAddr,
                    token0Symbol: chainTokens[i].symbol,
                    token1Symbol: chainTokens[j].symbol,
                    fee: fee / 10000,
                    liquidity: liq.toString(),
                    sqrtPriceX96: slot0[0].toString(),
                    price: adjustedPrice > 0.001 ? adjustedPrice.toFixed(6) : adjustedPrice.toExponential(4),
                    tvlToken0: '—',
                    tvlToken1: '—',
                  }
                } catch {
                  return null
                }
              })()
            )
          }
        }
      }

      const results = (await Promise.all(poolPromises)).filter(Boolean) as PoolData[]
      setPools(results)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || 'Failed to fetch pool data')
      setLoading(false)
    }
  }, [chain.rpc, tokens])

  useEffect(() => {
    setLoading(true)
    setPools([])
    setQuote(null)
    fetchPools()
  }, [selectedChain, fetchPools])

  const getQuote = async () => {
    if (!amount || isNaN(parseFloat(amount))) return
    try {
      const provider = new JsonRpcProvider(chain.rpc)
      const from = tokens[fromToken]
      const to = tokens[toToken]
      if (!from || !to || from.address === to.address) return

      // Try to find a pool and calculate price
      const factory = new Contract(UNISWAP_V3_FACTORY, FACTORY_ABI, provider)
      const fees = [500, 3000, 10000]
      
      for (const fee of fees) {
        try {
          const poolAddr = await factory.getPool(from.address, to.address, fee)
          if (poolAddr === '0x0000000000000000000000000000000000000000') continue

          const pool = new Contract(poolAddr, POOL_ABI, provider)
          const [slot0, token0Addr] = await Promise.all([pool.slot0(), pool.token0()])

          const sqrtPrice = Number(slot0[0]) / (2 ** 96)
          let price = sqrtPrice * sqrtPrice

          // Adjust for token order and decimals
          const isToken0 = from.address.toLowerCase() === token0Addr.toLowerCase()
          if (!isToken0) {
            price = 1 / price
          }
          price = price * (10 ** (from.decimals - to.decimals))

          const outputAmount = parseFloat(amount) * price
          setQuote(outputAmount.toFixed(6))
          return
        } catch {
          continue
        }
      }
      setQuote('No pool found')
    } catch (err: any) {
      setQuote('Error: ' + err.message)
    }
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">🦄</span>
            <span className="logo-text">Uniswap <span className="accent">via Arkeo</span></span>
          </div>
          <div className="header-right">
            <a href="https://rbechtold69.github.io/arkeo-data-engine-v2/" target="_blank" rel="noopener" className="marketplace-link">
              ← Marketplace
            </a>
            <div className={`provider-badge ${chain.arkeo ? 'arkeo' : 'fallback'}`}>
              {chain.arkeo ? '⚡ Arkeo Sentinel (Liquify)' : '↩ Public Fallback RPC'}
            </div>
          </div>
        </div>
      </header>

      {/* Chain Selector */}
      <div className="chain-selector">
        {Object.entries(CHAINS).map(([key, c]) => (
          <button
            key={key}
            className={`chain-btn ${selectedChain === key ? 'active' : ''}`}
            style={{ '--chain-color': c.color } as any}
            onClick={() => { setSelectedChain(key); setQuote(null) }}
          >
            {c.name}
            {c.arkeo ? <span className="arkeo-tag">⚡</span> : <span className="fallback-tag">↩</span>}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="stats-bar">
        <div className="stat">
          <span className="stat-label">Block</span>
          <span className="stat-value">{blockNum?.toLocaleString() || '...'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">RPC Latency</span>
          <span className="stat-value">{latency ? `${latency}ms` : '...'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Pools Found</span>
          <span className="stat-value">{pools.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Data Source</span>
          <span className="stat-value">{chain.arkeo ? '⚡ Arkeo' : '↩ Fallback'}</span>
        </div>
      </div>

      {error && <div className="error-banner">⚠️ {error}</div>}

      {/* Swap Interface */}
      <div className="swap-card">
        <h2>Swap</h2>
        <p className="swap-subtitle">Get live quotes from Uniswap V3 pools via {chain.arkeo ? 'Arkeo' : 'public'} RPC</p>
        
        <div className="swap-inputs">
          <div className="swap-row">
            <label>From</label>
            <div className="input-group">
              <select value={fromToken} onChange={(e) => { setFromToken(Number(e.target.value)); setQuote(null) }}>
                {tokens.map((t, i) => (
                  <option key={i} value={i}>{t.symbol}</option>
                ))}
              </select>
              <input
                type="number"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setQuote(null) }}
                placeholder="0.0"
              />
            </div>
          </div>

          <div className="swap-arrow" onClick={() => { 
            const tmp = fromToken; setFromToken(toToken); setToToken(tmp); setQuote(null)
          }}>↕</div>

          <div className="swap-row">
            <label>To</label>
            <div className="input-group">
              <select value={toToken} onChange={(e) => { setToToken(Number(e.target.value)); setQuote(null) }}>
                {tokens.map((t, i) => (
                  <option key={i} value={i}>{t.symbol}</option>
                ))}
              </select>
              <input
                type="text"
                value={quote || '—'}
                readOnly
                placeholder="0.0"
                className="quote-output"
              />
            </div>
          </div>
        </div>

        <button className="swap-btn" onClick={getQuote}>
          Get Quote via {chain.arkeo ? 'Arkeo' : 'Public'} RPC
        </button>
        
        <p className="swap-note">
          ⚡ This quote is fetched directly from Uniswap V3 smart contracts via {chain.arkeo ? 'Arkeo sentinel' : 'public RPC'}. No Uniswap API — just on-chain data.
        </p>
      </div>

      {/* Pools */}
      <div className="pools-section">
        <h2>📊 Uniswap V3 Pools on {chain.name}</h2>
        <p className="section-sub">Live pool data read directly from smart contracts via {chain.arkeo ? 'Arkeo' : 'public'} RPC</p>
        
        {loading ? (
          <div className="loading">Loading pool data from {chain.name}...</div>
        ) : pools.length === 0 ? (
          <div className="loading">No Uniswap V3 pools found on {chain.name} for these tokens</div>
        ) : (
          <div className="pool-grid">
            {pools.map((pool, i) => (
              <div key={i} className="pool-card">
                <div className="pool-pair">
                  {pool.token0Symbol}/{pool.token1Symbol}
                  <span className="pool-fee">{pool.fee}%</span>
                </div>
                <div className="pool-details">
                  <div className="pool-detail">
                    <span className="label">Price</span>
                    <span className="value">{pool.price}</span>
                  </div>
                  <div className="pool-detail">
                    <span className="label">Pool</span>
                    <span className="value mono">{pool.address.slice(0, 8)}...{pool.address.slice(-4)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* How It Works */}
      <div className="how-it-works">
        <h2>How This Works</h2>
        <div className="steps">
          <div className="step">
            <div className="step-num">1</div>
            <div>
              <strong>This frontend</strong> is hosted independently — not by Uniswap Labs
            </div>
          </div>
          <div className="step">
            <div className="step-num">2</div>
            <div>
              <strong>RPC calls</strong> go through Arkeo sentinel to decentralized providers
            </div>
          </div>
          <div className="step">
            <div className="step-num">3</div>
            <div>
              <strong>Smart contract data</strong> (prices, pools, liquidity) comes directly from the blockchain
            </div>
          </div>
          <div className="step">
            <div className="step-num">4</div>
            <div>
              <strong>No middleman</strong> — if this frontend goes down, others on the Arkeo marketplace serve the same data
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="footer">
        <p>
          Uniswap V3 pool data via{' '}
          <a href="https://rbechtold69.github.io/arkeo-data-engine-v2/" target="_blank" rel="noopener">Arkeo Network</a>
          {' '}— Decentralized marketplace for blockchain data and interaction
        </p>
        <p className="footer-sub">
          This is an independent frontend reading Uniswap smart contracts. Not affiliated with Uniswap Labs.
        </p>
      </footer>
    </div>
  )
}

export default App
