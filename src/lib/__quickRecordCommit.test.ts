// 用法：npx tsx src/lib/__quickRecordCommit.test.ts
//
// AI 快速录入：commit 计划编排（纯函数）
import { planCommit } from "./quickRecordCommit";
import type { QuickRecordCommitDraft } from "./quickRecordBridge";

let fail = 0;
function eq<T>(label: string, got: T, expect: T) {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) {
    console.log("  got:   ", got);
    console.log("  expect:", expect);
    fail++;
  }
}

function makeMintId(prefix = "tag-new-"): () => string {
  let i = 0;
  return () => `${prefix}${++i}`;
}

const baseDraft: Omit<QuickRecordCommitDraft, "title"> = {
  description: "",
  priority: "p2",
  scheduledDates: [],
  matchedTagIds: [],
  selectedNewTagNames: [],
};

// ── 用例 1：matched 标签直接透传到 tagIds ──
{
  const plan = planCommit(
    [{ ...baseDraft, title: "甲", matchedTagIds: ["tag-existing"] }],
    [{ id: "tag-existing", name: "已有" }],
    makeMintId()
  );
  eq("matched 透传", plan.tasks[0].tagIds, ["tag-existing"]);
  eq("无新建标签", plan.newTags, []);
}

// ── 用例 2：多卡片命中同一新标签名 → 只建一次，多卡复用同 id ──
{
  const drafts: QuickRecordCommitDraft[] = [
    { ...baseDraft, title: "甲", selectedNewTagNames: ["调研"] },
    { ...baseDraft, title: "乙", selectedNewTagNames: ["调研"] },
    { ...baseDraft, title: "丙", selectedNewTagNames: ["调研", "竞品"] },
  ];
  const plan = planCommit(drafts, [], makeMintId());
  eq("新建 2 个标签（去重）", plan.newTags.length, 2);
  eq("第 1 个标签 = 调研", plan.newTags[0].name, "调研");
  eq("第 2 个标签 = 竞品", plan.newTags[1].name, "竞品");
  // 三张卡片都引用同一 id
  eq("甲 引用调研", plan.tasks[0].tagIds, [plan.newTags[0].id]);
  eq("乙 引用调研", plan.tasks[1].tagIds, [plan.newTags[0].id]);
  eq("丙 引用调研+竞品", plan.tasks[2].tagIds, [
    plan.newTags[0].id,
    plan.newTags[1].id,
  ]);
}

// ── 用例 3：新标签名命中已有同名标签 → 复用，不重复建 ──
{
  const drafts: QuickRecordCommitDraft[] = [
    {
      ...baseDraft,
      title: "甲",
      selectedNewTagNames: ["产品规划", "全新"],
    },
  ];
  const plan = planCommit(
    drafts,
    [{ id: "tag-plan", name: "产品规划" }],
    makeMintId()
  );
  eq("仅 1 个真新建", plan.newTags.length, 1);
  eq("新建的是「全新」", plan.newTags[0].name, "全新");
  eq("产品规划复用已有 id 在前", plan.tasks[0].tagIds, [
    "tag-plan",
    plan.newTags[0].id,
  ]);
}

// ── 用例 4：大小写/空白不敏感（命中已有 + 自己批内去重）──
{
  const drafts: QuickRecordCommitDraft[] = [
    { ...baseDraft, title: "甲", selectedNewTagNames: ["  Research "] },
    { ...baseDraft, title: "乙", selectedNewTagNames: ["research"] },
    { ...baseDraft, title: "丙", selectedNewTagNames: ["RESEARCH"] },
  ];
  const plan = planCommit(
    drafts,
    [{ id: "tag-r", name: "Research" }],
    makeMintId()
  );
  eq("全部命中已有 → 0 新建", plan.newTags, []);
  eq("甲 复用", plan.tasks[0].tagIds, ["tag-r"]);
  eq("乙 复用", plan.tasks[1].tagIds, ["tag-r"]);
  eq("丙 复用", plan.tasks[2].tagIds, ["tag-r"]);
}

// ── 用例 5：matched + selectedNew 合并到同一卡片 tagIds ──
{
  const plan = planCommit(
    [
      {
        ...baseDraft,
        title: "甲",
        matchedTagIds: ["tag-a"],
        selectedNewTagNames: ["B"],
      },
    ],
    [{ id: "tag-a", name: "A" }],
    makeMintId()
  );
  eq("先 matched 后 new", plan.tasks[0].tagIds, [
    "tag-a",
    plan.newTags[0].id,
  ]);
}

// ── 用例 6：空白标签名被忽略 ──
{
  const plan = planCommit(
    [{ ...baseDraft, title: "甲", selectedNewTagNames: ["", "  ", "有效"] }],
    [],
    makeMintId()
  );
  eq("仅 1 个新建", plan.newTags.length, 1);
  eq("新建是「有效」", plan.newTags[0].name, "有效");
}

console.log(fail === 0 ? "\nAll OK" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
