import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AdminFeedbackTab, { type AdminFeedbackTabProps } from '../AdminFeedbackTab'
import type { AdminFeedbackItem } from '../../types'

const item: AdminFeedbackItem = {
  id: 'fb-1',
  user_id: 'u-7',
  user_email: 'tester@example.com',
  user_name: 'Tess Tester',
  session_id: 'abcdef12-3456-7890-abcd-ef1234567890',
  category: 'bug',
  message: 'The next button\ndid nothing.',
  route: '/book/b-42?view=reader',
  book_id: 'b-42',
  book_title: 'The Sleepy Fox',
  user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  viewport_width: 393,
  viewport_height: 852,
  theme: 'dark',
  client_build: '0123456789abcdef',
  server_build: 'fedcba9876543210',
  recent_errors: ['TypeError: x is undefined', 'Unhandled rejection: boom'],
  status: 'new',
  created_at: '2026-11-08T10:00:00.000Z',
  updated_at: '2026-11-08T10:00:00.000Z',
}

function renderTab(overrides: Partial<AdminFeedbackTabProps> = {}) {
  const props: AdminFeedbackTabProps = {
    items: [item],
    loading: false,
    error: null,
    statusFilter: 'new',
    onStatusFilter: vi.fn(),
    userFilter: null,
    onUserFilter: vi.fn(),
    onStatusChange: vi.fn(),
    savingIds: {},
    onRetry: vi.fn(),
    ...overrides,
  }
  render(
    <MemoryRouter>
      <AdminFeedbackTab {...props} />
    </MemoryRouter>,
  )
  return props
}

describe('AdminFeedbackTab', () => {
  it('renders every listed field for one item', () => {
    renderTab()
    const card = within(screen.getByTestId('feedback-card'))

    expect(card.getByText(new Date(item.created_at).toLocaleString())).toBeInTheDocument()
    expect(card.getByText('Bug')).toBeInTheDocument()
    expect(card.getByRole('combobox', { name: 'Status for feedback from tester@example.com' })).toHaveValue('new')
    expect(card.getByText('tester@example.com')).toBeInTheDocument()
    expect(card.getByText('(Tess Tester)')).toBeInTheDocument()
    expect(card.getByText(/The next button\s+did nothing\./)).toBeInTheDocument()
    expect(card.getByText('The Sleepy Fox')).toBeInTheDocument()
    expect(card.getByText('dark · 393×852 · client 0123456 · server fedcba9')).toBeInTheDocument()
    const ua = card.getByText(item.user_agent!)
    expect(ua).toHaveAttribute('title', item.user_agent)
    expect(card.getByText('abcdef12')).toBeInTheDocument()
  })

  it('shows dev / — when the build ids are null', () => {
    renderTab({ items: [{ ...item, client_build: null, server_build: null, theme: 'light' }] })
    expect(screen.getByText('light · 393×852 · client dev · server —')).toBeInTheDocument()
  })

  it('renders the route as an in-app link with the right href', () => {
    renderTab()
    expect(screen.getByRole('link', { name: item.route })).toHaveAttribute('href', item.route)
  })

  it('shows recent errors collapsed behind a count, and hides the block when there are none', () => {
    renderTab()
    const summary = screen.getByText('2 recent errors')
    const details = summary.closest('details')!
    expect(details).not.toHaveAttribute('open')
    expect(within(details).getByText('TypeError: x is undefined')).toBeInTheDocument()
  })

  it('omits the recent-errors block when the list is empty', () => {
    renderTab({ items: [{ ...item, recent_errors: [] }] })
    expect(screen.queryByText(/recent error/)).not.toBeInTheDocument()
  })

  it('changing the status select calls onStatusChange', () => {
    const props = renderTab()
    fireEvent.change(screen.getByRole('combobox', { name: /Status for feedback from tester@example.com/ }), {
      target: { value: 'triaged' },
    })
    expect(props.onStatusChange).toHaveBeenCalledWith('fb-1', 'triaged')
  })

  it('disables the select while that item is saving', () => {
    renderTab({ savingIds: { 'fb-1': true } })
    expect(screen.getByRole('combobox', { name: /Status for feedback/ })).toBeDisabled()
  })

  it('clicking the email calls onUserFilter with the user', () => {
    const props = renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Show only feedback from tester@example.com' }))
    expect(props.onUserFilter).toHaveBeenCalledWith({ id: 'u-7', email: 'tester@example.com' })
  })

  it('shows the active user filter as a chip that clears', () => {
    const props = renderTab({ userFilter: { id: 'u-7', email: 'tester@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter for tester@example.com' }))
    expect(props.onUserFilter).toHaveBeenCalledWith(null)
  })

  it('status filter buttons report the chosen filter', () => {
    const props = renderTab()
    expect(screen.getByRole('button', { name: 'New' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(props.onStatusFilter).toHaveBeenCalledWith('all')
  })

  it('shows an empty state per filter', () => {
    renderTab({ items: [], statusFilter: 'new' })
    expect(screen.getByText(/No new feedback/)).toBeInTheDocument()
  })

  it('shows the done empty state when filtered to done', () => {
    renderTab({ items: [], statusFilter: 'done' })
    expect(screen.getByText(/No feedback marked done yet/)).toBeInTheDocument()
  })

  it('shows an error with a retry', () => {
    const props = renderTab({ items: [], error: 'Failed to load feedback' })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(props.onRetry).toHaveBeenCalled()
  })
})
