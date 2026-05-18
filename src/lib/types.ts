/**
 * 数据模型定义
 *
 * 这些类型同时被前端 Zustand store 和后续 Tauri 后端（serde）共同遵循。
 * 后端字段使用 snake_case，但通过 dataAdapter 在边界处转换为前端的 camelCase。
 */

/** 任务状态
 *  - todo: 待办（默认）
 *  - in_progress: 进行中
 *  - suspended: 挂起 — 暂时搁置，仍出现在「全部任务」但不出现在「今日」
 *  - done: 已完成 — 仍保留 scheduledDates，所以在原排期日历中可见，
 *           只是从「今日」主列表中过滤掉，并出现在「今日已完成」折叠区
 *  - archived: 已归档（保留以便未来使用）
 */
export type TaskStatus =
  | "todo"
  | "in_progress"
  | "suspended"
  | "done"
  | "archived";

/** 任务优先级
 *  - p0: 紧急（红）— 立即处理
 *  - p1: 重要（橙）— 优先处理
 *  - p2: 一般（灰）— 默认
 */
export type TaskPriority = "p0" | "p1" | "p2";

/** 次日处理动作 */
export type TaskReviewAction = "done" | "continue" | "suspend";

/** 单条次日处理日志（追加式） */
export interface TaskReviewEntry {
  /** 处理日期 yyyy-MM-dd */
  date: string;
  /** 处理动作 */
  action: TaskReviewAction;
  /** 用户填写的原因（非必填，"done" 永远不填） */
  reason?: string;
}

/** 任务关联的单个外部文档 */
export interface TaskDoc {
  id: string;
  title: string;
  url: string;
}

/** 任务 */
export interface Task {
  id: string;
  title: string;
  /** 任务简述（支持多行文本，markdown 渲染留待 v2）*/
  description: string;
  status: TaskStatus;
  /**
   * 优先级。
   * 字段可选：缺失视作 "p2"（一般）。这样老数据无需 migration。
   */
  priority?: TaskPriority;
  /**
   * 任务的「显示日期」列表（yyyy-MM-dd）。
   * 任务可以贯穿多日：在每个日期都会出现在「今日任务」中，
   * 直到被标记完成或从该日移除。
   *
   * 注意：标记 done 不会清空此字段，从而保留"这个任务原本横跨了哪些天"
   * 的历史信息；切回 todo 时跨天信息自然恢复。
   */
  scheduledDates: string[];
  /** 标签 id 列表 */
  tagIds: string[];
  /** 当日内的排序权重（数字越小越靠前），按 scheduledDates 中的某天排序使用 */
  order: number;
  /**
   * 任务自定义颜色（hex，如 #6366f1）。
   * 设置后会接管：TaskCard 左竖条、月视图色带、DayCell 摘要前缀点。
   * 未设（undefined）则视图按优先级 / 状态色降级，对老数据零回归。
   */
  color?: string;
  /**
   * 关联外部文档列表（钉钉文档 / 飞书 / 任意 URL）。
   * 旧数据可能只有 docUrl/docTitle —— hydrate 时会把它们迁移到 docs[0]。
   * 之后写入仍以 docs 为准；docUrl/docTitle 仅作向后兼容字段，新代码请勿直接写。
   */
  docs?: TaskDoc[];
  /** @deprecated 用 docs[0]，仅做老数据兼容 */
  docUrl?: string;
  /** @deprecated 用 docs[0]，仅做老数据兼容 */
  docTitle?: string;
  /** 完成时间（ISO 字符串）*/
  completedAt?: string;
  createdAt: string;
  /**
   * 次日处理日志（追加式）。
   * 缺失 / undefined 视为空数组。老数据无需 migration。
   */
  reviewLog?: TaskReviewEntry[];
  updatedAt: string;
}

/** 标签（树形结构）*/
export interface Tag {
  id: string;
  name: string;
  /** 父标签 id；为 null 表示根标签 */
  parentId: string | null;
  /** 颜色 hex，例如 #6366f1 */
  color: string;
  /** 同层级排序 */
  order: number;
}

/** 番茄钟会话类型 */
export type PomodoroType = "focus" | "short_break" | "long_break";

/** 番茄钟会话记录 */
export interface PomodoroSession {
  id: string;
  /** 关联任务（可空，纯计时也允许）*/
  taskId?: string;
  type: PomodoroType;
  /** 实际投入的秒数（中途中断时记录到此处）*/
  durationSec: number;
  /** 是否完成（达到目标时长）*/
  completed: boolean;
  startedAt: string;
  endedAt: string;
}

/** 树形标签节点（前端组装用）*/
export interface TagNode extends Tag {
  children: TagNode[];
}

/** 统计聚合结果 */
export interface DailyStat {
  date: string; // yyyy-MM-dd
  completedCount: number;
  totalCount: number;
  focusSec: number;
}

export interface TagStat {
  tagId: string;
  tagName: string;
  tagColor: string;
  taskCount: number;
  completedCount: number;
  focusSec: number;
}
