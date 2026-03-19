import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'

import { cn } from '../lib/utils'
import { EmptyState } from './EmptyState'

export interface CommandPaletteItem {
  id: string
  title: string
  subtitle?: string
  icon?: ReactNode
  badge?: string
  shortcut?: string
  disabled?: boolean
  onSelect: () => void
}

export interface CommandPaletteSection {
  id: string
  title: string
  items: CommandPaletteItem[]
}

interface CommandPaletteProps {
  open: boolean
  query: string
  sections: CommandPaletteSection[]
  onClose: () => void
  onQueryChange: (value: string) => void
}

export function CommandPalette({
  open,
  query,
  sections,
  onClose,
  onQueryChange,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const flattenedItems = useMemo(
    () =>
      sections.flatMap((section) =>
        section.items.map((item) => ({ sectionId: section.id, item })),
      ),
    [sections],
  )
  const firstEnabledIndex = useMemo(
    () => flattenedItems.findIndex(({ item }) => !item.disabled),
    [flattenedItems],
  )
  const activeItemIndex =
    flattenedItems.length === 0
      ? 0
      : flattenedItems[activeIndex]?.item && !flattenedItems[activeIndex].item.disabled
        ? activeIndex
        : Math.max(firstEnabledIndex, 0)

  useEffect(() => {
    if (!open) {
      return
    }

    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    function moveSelection(direction: 1 | -1) {
      if (flattenedItems.length === 0) {
        return
      }

      let nextIndex = activeItemIndex
      for (let attempts = 0; attempts < flattenedItems.length; attempts += 1) {
        nextIndex =
          (nextIndex + direction + flattenedItems.length) % flattenedItems.length
        if (!flattenedItems[nextIndex]?.item.disabled) {
          setActiveIndex(nextIndex)
          return
        }
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveSelection(1)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveSelection(-1)
        return
      }

      if (event.key === 'Enter') {
        const activeItem = flattenedItems[activeItemIndex]?.item
        if (!activeItem || activeItem.disabled) {
          return
        }

        event.preventDefault()
        activeItem.onSelect()
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeItemIndex, flattenedItems, onClose, open])

  if (!open) {
    return null
  }

  let itemIndex = -1

  return (
    <div className="fixed inset-0 z-[80] bg-[#06070b]/72 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mx-auto flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/10 bg-background-dark shadow-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="border-b border-white/10 px-4 py-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input
              ref={inputRef}
              className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.03] pl-10 pr-4 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-primary/30"
              onChange={(event) => {
                setActiveIndex(0)
                onQueryChange(event.target.value)
              }}
              placeholder="Search commands, plugins, and navigation"
              value={query}
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {flattenedItems.length === 0 ? (
            <EmptyState
              className="border-none bg-transparent px-4 py-10"
              description="Try a different search term or switch back to catalog browsing."
              icon={<Search className="size-5" />}
              suggestions={['Try a broader search', 'Check spelling', 'Browse categories in the catalog']}
              title="No results found"
            />
          ) : (
            sections.map((section) =>
              section.items.length ? (
                <div className="px-2 py-2" key={section.id}>
                  <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {section.title}
                  </p>
                  <div className="mt-2 space-y-1">
                    {section.items.map((item) => {
                      itemIndex += 1
                      const isActive = itemIndex === activeItemIndex

                      return (
                        <button
                          className={cn(
                            'flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors',
                            isActive
                              ? 'border-primary/20 bg-primary/10'
                              : 'hover:border-white/10 hover:bg-white/[0.03]',
                            item.disabled ? 'cursor-not-allowed opacity-60' : '',
                          )}
                          disabled={item.disabled}
                          key={item.id}
                          onClick={() => {
                            item.onSelect()
                            onClose()
                          }}
                          type="button"
                        >
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-slate-300">
                            {item.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium text-white">
                                {item.title}
                              </p>
                              {item.badge ? (
                                <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                                  {item.badge}
                                </span>
                              ) : null}
                            </div>
                            {item.subtitle ? (
                              <p className="truncate text-xs text-slate-400">{item.subtitle}</p>
                            ) : null}
                          </div>
                          {item.shortcut ? (
                            <span className="shrink-0 text-[11px] text-slate-500">
                              {item.shortcut}
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null,
            )
          )}
        </div>
      </div>
    </div>
  )
}
