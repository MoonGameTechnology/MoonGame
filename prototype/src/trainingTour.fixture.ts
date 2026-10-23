import type { TrainingTourUi } from './trainingTour';
/** Explicit UI fixture: none of the controls have been used. */
export const trainingUiFixture = (mobile = false): TrainingTourUi => ({
  mobile,
  visible: () => false,
  selectedWorld: () => null,
  selectedFleet: () => null,
  intent: () => false,
  anchor: () => null,
  fleetSelector: () => null,
  show: () => {},
});
