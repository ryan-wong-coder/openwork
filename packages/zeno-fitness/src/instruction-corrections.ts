/** Original Chinese corrections; the fixed upstream migration snapshot stays intact.
 * Grip semantics: ACE Exercise Library, Hammer Curl, steps 1–3 (checked 2026-10-20).
 * https://www.acefitness.org/resources/everyone/exercise-library/10/hammer-curl/
 */
export const instructionCorrections: Readonly<Record<string, { englishName: string; steps: readonly string[] }>> = {
  "0313": {
    englishName: "dumbbell hammer curl",
    steps: [
      "站稳，双手各握一个哑铃置于身体两侧，掌心始终朝向身体，手腕保持平直。",
      "上臂贴近身体，保持躯干稳定，不借助摆动发力。",
      "缓慢屈肘，将哑铃举向肩前；全程保持中立握法，不旋转成掌心向上的弯举。",
      "短暂停顿后，控制哑铃缓慢下放，回到起始位置。",
      "按计划重复，保持肩部放松和手腕对齐。",
    ],
  },
};
