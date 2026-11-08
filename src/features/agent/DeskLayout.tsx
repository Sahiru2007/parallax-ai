import { useRef, type PointerEvent } from 'react'

export function DeskDivider({
  label,
  value,
  min,
  max,
  onChange,
  reverse = false,
  orientation = 'vertical',
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  reverse?: boolean
  orientation?: 'vertical' | 'horizontal'
}) {
  const drag = useRef<{ coordinate: number; value: number; size: number } | null>(null)
  const horizontal = orientation === 'horizontal'
  const change = (next: number) => onChange(Math.min(max, Math.max(min, next)))
  function move(event: PointerEvent<HTMLDivElement>) {
    if (drag.current)
      change(
        drag.current.value +
          ((horizontal ? event.clientY : event.clientX) - drag.current.coordinate) *
            (horizontal ? 100 / drag.current.size : 1) *
            (reverse ? -1 : 1),
      )
  }
  return (
    <div
      className={`desk-divider ${horizontal ? 'horizontal' : ''}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-valuetext={
        horizontal ? `${Math.round(value)}% preferred browser share` : `${Math.round(value)} pixels`
      }
      onPointerDown={(event) => {
        if (event.button !== 0) return
        drag.current = {
          coordinate: horizontal ? event.clientY : event.clientX,
          value,
          size: event.currentTarget.parentElement?.clientHeight || 1,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={move}
      onPointerUp={() => {
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
      onKeyDown={(event) => {
        const step = horizontal ? (event.shiftKey ? 5 : 2) : event.shiftKey ? 40 : 16
        const next =
          event.key === (horizontal ? 'ArrowUp' : 'ArrowLeft')
            ? value - step
            : event.key === (horizontal ? 'ArrowDown' : 'ArrowRight')
              ? value + step
              : event.key === 'Home'
                ? min
                : event.key === 'End'
                  ? max
                  : null
        if (next !== null) {
          event.preventDefault()
          change(next)
        }
      }}
    >
      <span />
    </div>
  )
}
