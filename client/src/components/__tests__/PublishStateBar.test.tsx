import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PublishStateBar, { type PublishStateBarProps } from '../PublishStateBar'

const onWithdraw = vi.fn().mockResolvedValue(undefined)
const onPublish = vi.fn().mockResolvedValue(undefined)

function renderBar(overrides: Partial<PublishStateBarProps> = {}) {
  const props: PublishStateBarProps = {
    isOwner: true,
    isDraft: false,
    title: 'The Brave Little Toaster',
    pageCount: 5,
    unillustratedCount: 0,
    onWithdraw,
    onPublish,
    ...overrides,
  }
  return render(<PublishStateBar {...props} />)
}

describe('PublishStateBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('a reader', () => {
    it.each([true, false])('is told nothing about publish state (isDraft: %s)', (isDraft) => {
      const { container } = renderBar({ isOwner: false, isDraft })
      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('owner, published', () => {
    it('offers "Edit this book" and keeps the consequence copy out of the DOM until asked', () => {
      renderBar()

      expect(screen.getByRole('button', { name: /Edit this book/ })).toBeInTheDocument()
      expect(screen.queryByTestId('withdraw-confirm')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Take it out and edit' })).not.toBeInTheDocument()
    })

    it('expands the confirm in place without withdrawing anything', async () => {
      renderBar()

      await userEvent.click(screen.getByRole('button', { name: /Edit this book/ }))

      const confirm = screen.getByTestId('withdraw-confirm')
      expect(confirm).toHaveTextContent(/Editing takes The Brave Little Toaster out of the catalog while you work\./)
      expect(confirm).toHaveTextContent(/Anyone who already bought it keeps their receipt\./)
      expect(onWithdraw).not.toHaveBeenCalled()
    })

    it('collapses on Cancel, still without withdrawing', async () => {
      renderBar()

      await userEvent.click(screen.getByRole('button', { name: /Edit this book/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByTestId('withdraw-confirm')).not.toBeInTheDocument()
      expect(onWithdraw).not.toHaveBeenCalled()
    })

    it('withdraws exactly once when confirmed', async () => {
      renderBar()

      await userEvent.click(screen.getByRole('button', { name: /Edit this book/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Take it out and edit' }))

      expect(onWithdraw).toHaveBeenCalledTimes(1)
      expect(onPublish).not.toHaveBeenCalled()
    })
  })

  describe('owner, draft', () => {
    it('banners the out-of-catalog state and omits the illustration clause when nothing is missing', () => {
      renderBar({ isDraft: true, pageCount: 5, unillustratedCount: 0 })

      expect(screen.getByText('Out of the catalog while you edit')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Publish changes/ })).toBeInTheDocument()
      expect(screen.getByText('5 pages')).toBeInTheDocument()
      expect(screen.queryByText(/without an illustration/)).not.toBeInTheDocument()
    })

    it('summarises the unillustrated pages when some are missing', () => {
      renderBar({ isDraft: true, pageCount: 5, unillustratedCount: 3 })

      expect(screen.getByText('5 pages · 3 without an illustration')).toBeInTheDocument()
    })

    it('publishes straight away when every page is illustrated', async () => {
      renderBar({ isDraft: true, pageCount: 5, unillustratedCount: 0 })

      await userEvent.click(screen.getByRole('button', { name: /Publish changes/ }))

      expect(screen.queryByTestId('publish-confirm')).not.toBeInTheDocument()
      expect(onPublish).toHaveBeenCalledTimes(1)
    })

    it('asks a second time before publishing a part-illustrated book', async () => {
      renderBar({ isDraft: true, pageCount: 5, unillustratedCount: 3 })

      await userEvent.click(screen.getByRole('button', { name: /Publish changes/ }))

      expect(screen.getByTestId('publish-confirm')).toHaveTextContent(
        '3 of 5 pages have no illustration yet. Publish anyway?',
      )
      expect(onPublish).not.toHaveBeenCalled()

      await userEvent.click(screen.getByRole('button', { name: 'Publish anyway' }))
      expect(onPublish).toHaveBeenCalledTimes(1)
      expect(onWithdraw).not.toHaveBeenCalled()
    })

    it('cancels the unillustrated confirm without publishing', async () => {
      renderBar({ isDraft: true, pageCount: 5, unillustratedCount: 3 })

      await userEvent.click(screen.getByRole('button', { name: /Publish changes/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByTestId('publish-confirm')).not.toBeInTheDocument()
      expect(onPublish).not.toHaveBeenCalled()
    })
  })

  describe('busy and error', () => {
    it.each([
      ['published', false, 0, /Edit this book/] as const,
      ['draft', true, 3, /Publish changes/] as const,
    ])('disables every control while busy (%s)', async (_label, isDraft, unillustratedCount, trigger) => {
      // Open the confirm first, then re-render busy, so the confirm's own buttons are on
      // screen and covered by the assertion too.
      const props: PublishStateBarProps = {
        isOwner: true,
        isDraft,
        title: 'The Brave Little Toaster',
        pageCount: 5,
        unillustratedCount,
        onWithdraw,
        onPublish,
      }
      const { rerender } = render(<PublishStateBar {...props} />)
      await userEvent.click(screen.getByRole('button', { name: trigger }))

      rerender(<PublishStateBar {...props} busy />)

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(1)
      for (const button of buttons) expect(button).toBeDisabled()
    })

    it('renders an error message', () => {
      renderBar({ error: "Couldn't take that book out of the catalog. Try again." })

      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't take that book out of the catalog. Try again.",
      )
    })
  })
})
