export interface StoreMeta {
  id: string
  name: string
  format: string
}

export interface SkuMeta {
  sku: string
  name: string
  category: string
  list_price: number
  unit_cost: number
  lead_time: number
  order_cost: number
  holding_rate: number
  case_pack: number
  review: number
}

export interface Series {
  store: string
  sku: string
  hist: number[]
  fc: number[]
  lo: number[]
  hi: number[]
  promoPlan: number[]
  sigma: number
  wape: number
  wapeNaive: number
  smape: number
  bias: number
  avgPrice: number
  unitCost: number
  listPrice: number
  annualUnits: number
  annualRevenue: number
  onHand: number
  onOrder: number
  leadTime: number
  orderCost: number
  holdingRate: number
  casePack: number
  reviewPeriod: number
}

export interface CategoryAccuracy {
  category: string
  wape: number
  wapeNaive: number
  bias: number
  units: number
}

export interface Dashboard {
  generatedAt: string
  horizon: number
  histTail: number
  backtest: string
  stores: StoreMeta[]
  skus: SkuMeta[]
  totals: { dates: string[]; units: number[]; revenue: number[]; margin: number[] }
  forecastDates: string[]
  networkForecast: { mean: number[]; lo: number[]; hi: number[] }
  accuracy: {
    wape: number
    wapeNaive: number
    liftVsNaive: number
    byCategory: CategoryAccuracy[]
  }
  series: Series[]
}
