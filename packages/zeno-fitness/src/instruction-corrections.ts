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
  // Primary-authored text: StrengthLog, Dumbbell Side Bend, technique steps (checked 2026-10-21).
  // https://www.strengthlog.com/dumbbell-side-bend/
  "0407": {
    englishName: "dumbbell side bend",
    steps: [
      "站稳，双脚分开与肩同宽，一手握住一只哑铃垂在身侧，另一手可轻扶髋部。",
      "保持骨盆稳定、目视前方，躯干缓慢向持哑铃的一侧侧屈，让哑铃沿同侧大腿外侧下降。",
      "在舒适范围内短暂停顿，避免向前俯身、向后仰或转动躯干。",
      "控制躯干沿原路回到直立位置，不借助摆动抬起重量。",
      "按计划重复后换手，练习另一侧。",
    ],
  },
  // Primary-authored text: Team Tiger Fitness, Close Grip EZ Curl, grip and upper-arm position (checked 2026-10-21).
  // https://tigerfitness.com/blogs/exercise-database/close-grip-ez-curl-ez-bar-curl
  "0446": {
    englishName: "ez barbell close-grip curl",
    steps: [
      "站稳，双脚约与肩同宽，反手握住 EZ 曲杆的内侧倾斜握段，双手间距窄于肩宽。",
      "将曲杆置于大腿前方，肘部靠近躯干，上臂保持固定，手腕与前臂自然对齐。",
      "缓慢屈肘，将曲杆弯举至肩前；保持躯干稳定，不后仰、不向前甩动上臂。",
      "短暂停顿后，控制曲杆沿原路缓慢下放，回到起始位置。",
      "按计划重复，全程保持窄握和稳定的上臂位置。",
    ],
  },
};
