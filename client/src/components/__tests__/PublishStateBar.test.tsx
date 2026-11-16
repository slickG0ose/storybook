import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

  describe('owner, public', () => {
    it('offers "Make private" and keeps the consequence copy out of the DOM until asked', () => {
      renderBar()

      expect(screen.getByText('Public')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Make private/ })).toBeInTheDocument()
      expect(screen.queryByTestId('withdraw-confirm')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Make it private' })).not.toBeInTheDocument()
    })

    it('says anyone who visits can find it, and that editing means making it private', () => {
      renderBar()

      expect(screen.getByTestId('publish-state-bar')).toHaveTextContent(
        'Anyone who visits StoryBook can find and buy this book. To edit it, make it private first.',
      )
    })

    it('expands the confirm in place without withdrawing anything', async () => {
      renderBar()

      await userEvent.click(screen.getByRole('button', { name: /Make private/ }))

      const confirm = screen.getByTestId('withdraw-confirm')
      expect(confirm).toHaveTextContent(
        /Making The Brave Little Toaster private takes it out of the catalog, so only you can see it, and you can edit it again\./,
      )
      expect(confirm).toHaveTextContent(/Anyone who already bought it keeps their receipt\./)
      expect(onWithdraw).not.toHaveBeenCalled()
    })

    it('collapses on Cancel, still without withdrawing', async () => {
      renderBar()

      await userEvent.click(screen.getByRole('button', { name: /Make private/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByTestId('withdraw-confirm')).not.toBeInTheDocument()
      expect(onWithdraw).not.toHaveBeenCalled()
    })

    it('withdraws exactly once when confirmed', async () => {
      renderBar()

      await userEvent.click(screen.getByRole('button', { name: /Make private/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Make it private' }))

      expect(onWithdraw).toHaveBeenCalledTimes(1)
      expect(onPublish).not.toHaveBeenCalled()
    })
  })

  describe('owner, private', () => {
    it('banners the private state and omits the illustration clause when nothing is missing', () => {
      renderBar({ isDraft: true, pageCount: 5, unillustratedCount: 0 })

      expect(screen.getByText('Private')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Make public/ })).toBeInTheDocument()
      expect(screen.getByText('Only you can see this book · 5 pages')).toBeInTheDocument()
      expect(screen.queryByText(/without an illustration/)).not.toBeInTheDocument()
    })

    it('summarises the unillustrated pages when some are missing', () => {
      renderBar({ isDraft: true, pageCount: 5, unillustratedCount: 3 })

      expect(screen.getByText('Only you can see this book · 5 pages · 3 without an illustration')).toBeInTheDocument()
    })

    // Public means anyone who visits, signed in or not, so it never happens in one tap.
    it('asks before making a fully illustrated book public', async () => {
      renderBar({ isDraft: true, pageCount: 5, unillustratedCount: 0 })

      await userEvent.click(screen.getByRole('button', { name: /Make public/ }))

      const confirm = screen.getByTestId('publish-confirm')
      expect(confirm).toHaveTextContent(
        'Anyone who visits StoryBook will be able to find and buy The Brave Little Toaster, without signing in.',
      )
      expect(confirm).not.toHaveTextContent(/no illustration/)
      expect(onPublish).not.toHaveBeenCalled()

      await userEvent.click(screen.getByRole('button', { name: 'Make it public' }))
      expect(onPublish).toHaveBeenCalledTimes(1)
      expect(onWithdraw).not.toHaveBeenCalled()
    })

    it('adds the unillustrated count to the confirm for a part-illustrated book', async () => {
      renderBar({ isDraft: true, pageCount: 5, unillustratedCount: 3 })

      await userEvent.click(screen.getByRole('button', { name: /Make public/ }))

      expect(screen.getByTestId('publish-confirm')).toHaveTextContent('3 of 5 pages have no illustration yet.')
      expect(onPublish).not.toHaveBeenCalled()
    })

    it('cancels the confirm without making anything public', async () => {
      renderBar({ isDraft: true, pageCount: 5, unillustratedCount: 3 })

      await userEvent.click(screen.getByRole('button', { name: /Make public/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByTestId('publish-confirm')).not.toBeInTheDocument()
      expect(onPublish).not.toHaveBeenCalled()
    })
  })

  describe('busy and error', () => {
    it.each([
      ['public', false, 0, /Make private/] as const,
      ['private', true, 3, /Make public/] as const,
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

  // Tester build (spec: `.code-captain/specs/tester-commerce-off/spec.md`): nothing is for
  // sale, so the author copy must not promise buyers or receipts.
  describe('commerce off', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_COMMERCE_ENABLED', 'false')
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('describes the public state without mentioning buying', () => {
      renderBar()

      const bar = screen.getByTestId('publish-state-bar')
      expect(bar).toHaveTextContent('Anyone who visits StoryBook can find and read this book. To edit it, make it private first.')
      expect(bar).not.toHaveTextContent(/buy/i)
    })

    it('drops the purchase and receipt wording from the make-private confirm', async () => {
      renderBar()

      await userEvent.click(screen.getByRole('button', { name: /Make private/ }))

      const confirm = screen.getByTestId('withdraw-confirm')
      expect(confirm).toHaveTextContent(
        'Making The Brave Little Toaster private takes it out of the catalog, so only you can see it, and you can edit it again.',
      )
      expect(confirm).not.toHaveTextContent(/buy|bought|receipt/i)
    })

    it('drops the purchase wording from the make-public confirm', async () => {
      renderBar({ isDraft: true })

      await userEvent.click(screen.getByRole('button', { name: /Make public/ }))

      const confirm = screen.getByTestId('publish-confirm')
      expect(confirm).toHaveTextContent('will be able to find and read The Brave Little Toaster, without signing in.')
      expect(confirm).not.toHaveTextContent(/buy/i)
    })
  })
})
