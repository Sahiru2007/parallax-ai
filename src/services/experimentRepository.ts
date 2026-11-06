import { demoExperiment } from '../mocks/experiment'
import type { Experiment } from '../types/experiment'

/** Read boundary for a future backend. No agent execution lives in the UI. */
export interface ExperimentRepository {
  getExperiment(): Promise<Experiment>
}

export const experimentRepository: ExperimentRepository = {
  async getExperiment() {
    return structuredClone(demoExperiment)
  },
}
