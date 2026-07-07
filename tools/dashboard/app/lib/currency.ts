import fs from 'node:fs'
import path from 'node:path'

const toolsRoot = path.resolve(process.cwd(), '..')
const cacheFile = path.join(toolsRoot, 'logs', 'exchange-rate.json')
const envFile = path.join(toolsRoot, '.env.tools')
const fallbackRates = { CAD: 1.36, GTQ: 7.8 }
const maxAgeMs = 7 * 24 * 60 * 60 * 1000

export type CostDisplayCurrency = 'usd' | 'cad' | 'gtq'

export type ExchangeRateInfo = {
  rate: number
  rates: {
    CAD: number
    GTQ: number
  }
  updatedAt: string
  source: string
}

function parseEnv() {
  if (!fs.existsSync(envFile)) return {}
  return Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((line) => line.includes('=')).map((line) => {
    const index = line.indexOf('=')
    return [line.slice(0, index), line.slice(index + 1)]
  }))
}

function fresh(updatedAt?: string) {
  if (!updatedAt) return false
  const time = Date.parse(updatedAt)
  return Number.isFinite(time) && Date.now() - time < maxAgeMs
}

function readCache() {
  if (!fs.existsSync(cacheFile)) return null
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as Partial<ExchangeRateInfo>
    return {
      rate: Number(cached.rate ?? cached.rates?.CAD ?? fallbackRates.CAD),
      rates: {
        CAD: Number(cached.rates?.CAD ?? cached.rate ?? fallbackRates.CAD),
        GTQ: Number(cached.rates?.GTQ ?? fallbackRates.GTQ)
      },
      updatedAt: cached.updatedAt ?? new Date(0).toISOString(),
      source: cached.source ?? 'fallback'
    } satisfies ExchangeRateInfo
  } catch {
    return null
  }
}

function writeCache(rates: ExchangeRateInfo['rates'], source: string) {
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
  const data = { rate: rates.CAD, rates, updatedAt: new Date().toISOString(), source }
  fs.writeFileSync(cacheFile, `${JSON.stringify(data, null, 2)}\n`)
  return data
}

export function costDisplayCurrency(): CostDisplayCurrency {
  const value = (parseEnv().COST_DISPLAY_CURRENCY || 'usd').toLowerCase()
  if (value === 'cad' || value === 'gtq') return value
  return 'usd'
}

export async function getUsdToCad(force = false): Promise<ExchangeRateInfo> {
  const cached = readCache()
  if (!force && cached && fresh(cached.updatedAt)) return cached

  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(5000) })
    const data = await response.json() as { rates?: { CAD?: number; GTQ?: number } }
    const cad = Number(data.rates?.CAD)
    const gtq = Number(data.rates?.GTQ)
    if (Number.isFinite(cad) && cad > 0 && Number.isFinite(gtq) && gtq > 0) {
      return writeCache({ CAD: cad, GTQ: gtq }, 'open.er-api.com')
    }
  } catch {
    // Use cache or fallback below.
  }

  return cached ?? writeCache(fallbackRates, 'fallback')
}

function rateForCurrency(exchange: ExchangeRateInfo | number, display: CostDisplayCurrency) {
  if (typeof exchange === 'number') return exchange
  if (display === 'gtq') return exchange.rates.GTQ
  return exchange.rates.CAD
}

export function toCad(usd: number, exchange: ExchangeRateInfo | number) {
  const rate = typeof exchange === 'number' ? exchange : exchange.rates.CAD
  return Math.round(usd * rate * 100) / 100
}

export function formatCost(usd: number, exchange: ExchangeRateInfo | number, display: CostDisplayCurrency = costDisplayCurrency(), decimals = 2) {
  if (display === 'usd') return `USD $${usd.toFixed(decimals)}`
  const converted = Math.round(usd * rateForCurrency(exchange, display) * 100) / 100
  if (display === 'cad') return `CAD $${converted.toFixed(decimals)}`
  if (display === 'gtq') return `GTQ Q${converted.toFixed(decimals)}`
  return `USD $${usd.toFixed(decimals)}`
}
