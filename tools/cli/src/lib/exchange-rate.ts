import fs from 'node:fs'
import path from 'node:path'
import { logsDir } from './paths.js'

const cacheFile = path.join(logsDir, 'exchange-rate.json')
const fallbackRates = { CAD: 1.36, GTQ: 7.8 }
const maxAgeMs = 7 * 24 * 60 * 60 * 1000

export type CostDisplayCurrency = 'usd' | 'cad' | 'gtq'

type ExchangeCache = {
  rate: number
  rates: {
    CAD: number
    GTQ: number
  }
  updatedAt: string
  source: string
}

function fresh(updatedAt?: string) {
  if (!updatedAt) return false
  const time = Date.parse(updatedAt)
  return Number.isFinite(time) && Date.now() - time < maxAgeMs
}

function readCache() {
  if (!fs.existsSync(cacheFile)) return null
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as Partial<ExchangeCache>
    return {
      rate: Number(cached.rate ?? cached.rates?.CAD ?? fallbackRates.CAD),
      rates: {
        CAD: Number(cached.rates?.CAD ?? cached.rate ?? fallbackRates.CAD),
        GTQ: Number(cached.rates?.GTQ ?? fallbackRates.GTQ)
      },
      updatedAt: cached.updatedAt ?? new Date(0).toISOString(),
      source: cached.source ?? 'fallback'
    } satisfies ExchangeCache
  } catch {
    return null
  }
}

function writeCache(rates: ExchangeCache['rates'], source: string) {
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
  const data: ExchangeCache = { rate: rates.CAD, rates, updatedAt: new Date().toISOString(), source }
  fs.writeFileSync(cacheFile, `${JSON.stringify(data, null, 2)}\n`)
  return data
}

export function costDisplayCurrency(): CostDisplayCurrency {
  const value = (process.env.COST_DISPLAY_CURRENCY || 'usd').toLowerCase()
  if (value === 'cad' || value === 'gtq') return value
  return 'usd'
}

export async function getUsdToCad(force = false) {
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

function rateForCurrency(exchange: ExchangeCache | number, display: CostDisplayCurrency) {
  if (typeof exchange === 'number') return exchange
  if (display === 'gtq') return exchange.rates.GTQ
  return exchange.rates.CAD
}

export function toCad(usd: number, exchange: ExchangeCache | number) {
  const rate = typeof exchange === 'number' ? exchange : exchange.rates.CAD
  return Math.round(usd * rate * 100) / 100
}

export function formatCost(usd: number, exchange: ExchangeCache | number, display: CostDisplayCurrency = costDisplayCurrency()) {
  if (display === 'usd') return `USD $${usd.toFixed(2)}`
  const converted = Math.round(usd * rateForCurrency(exchange, display) * 100) / 100
  if (display === 'cad') return `CAD $${converted.toFixed(2)}`
  if (display === 'gtq') return `GTQ Q${converted.toFixed(2)}`
  return `USD $${usd.toFixed(2)}`
}
