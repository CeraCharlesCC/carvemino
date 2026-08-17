import { defineSurvivalPolicy } from "../domain/match/survival.js";
import { defineVersusPolicy } from "../domain/match/versus.js";

export const CARVER_VERSUS_POLICY = defineVersusPolicy({
  id: "carvemino-carver-versus-v1",
  lineClearAttackRows: Object.freeze([0, 0, 1, 2, 4, 6]),
  garbageWarningWorldTicks: 150,
  cancellation: true
});

export const CARVER_SURVIVAL_POLICY = defineSurvivalPolicy({
  id: "carvemino-carver-survival-v1",
  garbageWarningWorldTicks: 150,
  firstWaveMatchTick: 1200,
  waveIntervalMatchTicks: 720,
  rowsPerWaveStepMatchTicks: 1800,
  maximumRowsPerWave: 5
});
