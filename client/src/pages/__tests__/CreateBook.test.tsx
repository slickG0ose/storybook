import { describe, it, expect } from 'vitest'
import { PER_IMAGE_COST_USD, portraitStepCostNote } from '../../lib/cost'
import {
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
    const a = parseFloat(fullModeCostLabel(7).match(/\$([\d.]+)/)![1]!)
    const b = parseFloat(fullModeCostLabel(8).match(/\$([\d.]+)/)![1]!)
    expect(b - a).toBeCloseTo(PER_IMAGE_COST_USD, 5)
  })

  it('later-click note quotes the per-image constant', () => {
    expect(laterClickCostNote()).toContain(`~$${PER_IMAGE_COST_USD.toFixed(2)}`)
  })

  it('portrait-step note scales with required-character count from the per-image constant', () => {
    // 1 required character -> 1 * PER_IMAGE_COST_USD; 3 required -> 3 * ...
    expect(portraitStepCostNote(1)).toContain(`~$${(1 * PER_IMAGE_COST_USD).toFixed(2)} to generate`)
    expect(portraitStepCostNote(3)).toContain(`~$${(3 * PER_IMAGE_COST_USD).toFixed(2)} to generate`)

    // The total figure is derived from the constant, not a literal: bumping the
    // required count by 1 adds exactly one PER_IMAGE_COST_USD.
    const a = parseFloat(portraitStepCostNote(2).match(/~\$([\d.]+) to generate/)![1]!)
    const b = parseFloat(portraitStepCostNote(3).match(/~\$([\d.]+) to generate/)![1]!)
    expect(b - a).toBeCloseTo(PER_IMAGE_COST_USD, 5)

    // Regenerate price is the single per-image constant, not a second figure.
    expect(portraitStepCostNote(2)).toContain(`Each regenerate is ~$${PER_IMAGE_COST_USD.toFixed(2)}`)
  })
})
