import { defineSurvivalPolicy } from "../domain/match/survival.js";
import { defineVersusPolicy } from "../domain/match/versus.js";

export const CLASSIC_VERSUS_POLICY = defineVersusPolicy({
  id: "carvemino-classic-versus-v1",
  lineClearAttackRows: Object.freeze([0, 0, 1, 2, 4]),
  garbageWarningWorldTicks: 120,
  cancellation: true
});

export const CLASSIC_SURVIVAL_POLICY = defineSurvivalPolicy({
  id: "carvemino-classic-survival-v1",
  garbageWarningWorldTicks: 120,
  firstWaveMatchTick: 900,
  waveIntervalMatchTicks: 600,
  rowsPerWaveStepMatchTicks: 1800,
  maximumRowsPerWave: 5
});
