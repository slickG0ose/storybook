import { describe, it, expect } from 'vitest'
import {
  PER_IMAGE_COST_USD,
  quickModeCostLabel,
  coverModeCostLabel,
  fullModeCostLabel,
  laterClickCostNote,
} from '../CreateBook'

describe('CreateBook — cost copy', () => {
  it('quick mode reports zero image AI cost', () => {
    expect(quickModeCostLabel()).toBe('$0 — no image AI calls')
  })

  it('cover mode reports a single image at the per-image cost', () => {
    expect(coverModeCostLabel()).toBe(`~$${PER_IMAGE_COST_USD.toFixed(2)} — 1 image AI call`)
  })

  it('full mode cost scales with pageCount (cover + every page) from the per-image constant', () => {
    // 5 pages -> 6 images (cover + 5 pages) -> 6 * PER_IMAGE_COST_USD
    const fiveImages = (5 + 1) * PER_IMAGE_COST_USD
    expect(fullModeCostLabel(5)).toBe(`~$${fiveImages.toFixed(2)} — 6 image AI calls`)

    // 10 pages -> 11 images
    const elevenImages = (10 + 1) * PER_IMAGE_COST_USD
    expect(fullModeCostLabel(10)).toBe(`~$${elevenImages.toFixed(2)} — 11 image AI calls`)

    // The displayed figure is derived from the constant, not a hard-coded literal:
    // bumping pageCount by 1 adds exactly one PER_IMAGE_COST_USD.
    const a = parseFloat(fullModeCostLabel(7).match(/\$([\d.]+)/)![1])
    const b = parseFloat(fullModeCostLabel(8).match(/\$([\d.]+)/)![1])
    expect(b - a).toBeCloseTo(PER_IMAGE_COST_USD, 5)
  })

  it('later-click note quotes the per-image constant', () => {
    expect(laterClickCostNote()).toContain(`~$${PER_IMAGE_COST_USD.toFixed(2)}`)
  })
})
