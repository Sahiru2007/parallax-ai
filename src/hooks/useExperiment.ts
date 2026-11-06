import { useEffect, useState } from 'react'
import { experimentRepository } from '../services/experimentRepository'
import type { Experiment } from '../types/experiment'

export function useExperiment() {
  const [experiment, setExperiment] = useState<Experiment | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    experimentRepository.getExperiment().then(
      (data) => {
        if (active) setExperiment(data)
      },
      () => {
        if (active) setError('The experiment could not be loaded. Please reload PARALLAX.')
      },
    )
    return () => {
      active = false
    }
  }, [])
  return { experiment, error }
}
