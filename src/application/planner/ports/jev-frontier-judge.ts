/**
 * Infrastructure-facing shadow port: transport projection and answer validation
 * only. The adapter cannot import counterfactual policy, audit orchestration,
 * frontier selection, or any canonical scoring/role function through this seam.
 */
export {
  JEV_FRONTIER_NONE,
  projectJevFrontierTransportState,
  validateJevFrontierJudgment,
  type JevFrontierJudge,
  type JevFrontierJudgeInput,
  type JevFrontierJudgeResult,
} from "../jev-frontier-shadow";
