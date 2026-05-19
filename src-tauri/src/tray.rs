// 系统托盘（方案 B：popup webview window）
//
// 设计：
//   - setup 阶段创建一个 hidden、无边框、always-on-top、跳过任务栏的小窗口
//     window label = "tray-popup"，url = "index.html?win=tray-popup"
//     前端在 main.tsx 里看到 ?win=tray-popup 时只挂 <TrayPopup>
//   - 点击托盘图标：show + 把窗口位置定位到托盘图标下方 + focus
//   - 窗口失焦自动 hide（"点击屏幕别处就消失"的桌面菜单语义）
//   - 右键托盘：兜底打开主窗口

use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Runtime, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};

const TRAY_ID: &str = "main-tray";
const POPUP_LABEL: &str = "tray-popup";
const POPUP_W: f64 = 360.0;
const POPUP_H: f64 = 520.0;
const EDITOR_LABEL: &str = "task-editor";
const EDITOR_W: f64 = 720.0;
const EDITOR_H: f64 = 760.0;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskEditorTarget {
    task_id: Option<String>,
    default_date: Option<String>,
}

/// 创建托盘 + 注册事件 + 预先创建 hidden popup 窗口。
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // 预先创建 hidden popup window —— 切莫真显示，等托盘点击再 show
    create_popup_window(app)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("持续任务")
        // 不挂 menu：左键点击直接弹我们自己的 popup webview
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            handle_tray_event(tray.app_handle(), &event);
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    } else {
        builder = builder.icon(fallback_icon());
    }

    builder.build(app)?;
    Ok(())
}

fn fallback_icon() -> Image<'static> {
    const W: u32 = 16;
    const H: u32 = 16;
    let rgba: Vec<u8> = (0..(W * H)).flat_map(|_| [0u8, 0, 0, 255]).collect();
    Image::new_owned(rgba, W, H)
}

fn create_popup_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if app.get_webview_window(POPUP_LABEL).is_some() {
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(
        app,
        POPUP_LABEL,
        WebviewUrl::App("index.html?win=tray-popup".into()),
    )
    .title("持续任务 · 托盘")
    .inner_size(POPUP_W, POPUP_H)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .focused(false)
    .build()?;

    // 失焦自动 hide：实现"点别处就消失"的桌面菜单语义
    let app_clone = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            if let Some(w) = app_clone.get_webview_window(POPUP_LABEL) {
                let _ = w.hide();
            }
        }
    });

    // 强制再保险一次大小（部分平台 inner_size 之后还会被系统调整）
    let _ = window.set_size(LogicalSize::new(POPUP_W, POPUP_H));
    Ok(())
}

/// 前端 invoke：打开 / 切换完整任务编辑器独立窗口。
///
/// 窗口归属设计（modeless child）：
///   - parent = main → 跟随主窗口的 z 序，不会浮在其他 App 之上；
///     macOS 上是 child window；Windows 上是 owner-window 关系。
///   - 不设 always_on_top → 切到其它 App 时自然沉到下面。
///   - skip_taskbar 保留：弹窗不出现在 Dock / 任务栏，避免和主窗口重复。
///
/// 位置策略：以主窗口的几何中心为基准居中弹窗。这样在多屏 / 多 Space
/// 场景下，弹窗总会出现在主窗口所在屏幕，与主窗口视觉绑定。主窗口若
/// 被最小化，先 unminimize + show + focus 让它"亮起来"，再算位置。
#[tauri::command]
pub fn open_task_editor<R: Runtime>(
    app: AppHandle<R>,
    task_id: Option<String>,
    default_date: Option<String>,
) -> Result<(), String> {
    let target = TaskEditorTarget {
        task_id,
        default_date,
    };

    // 主窗口若处于最小化，先恢复（满足"详情依附主窗口"的视觉契约）
    if let Some(main) = app.get_webview_window("main") {
        if main.is_minimized().unwrap_or(false) {
            let _ = main.unminimize();
        }
        let _ = main.show();
        let _ = main.set_focus();
    }

    if let Some(w) = app.get_webview_window(EDITOR_LABEL) {
        // 复用现有窗口：重新定位到当前主窗口中心，再 show + focus
        if let Some(pos) = compute_editor_center(&app) {
            let _ = w.set_position(pos);
        }
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to(EDITOR_LABEL, "task-editor:target", target);
        return Ok(());
    }

    let url = task_editor_url(&target);
    let mut builder = WebviewWindowBuilder::new(
        &app,
        EDITOR_LABEL,
        WebviewUrl::App(url.into()),
    )
    .title("任务编辑")
    .inner_size(EDITOR_W, EDITOR_H)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(true)
    .skip_taskbar(true)
    .visible(true)
    .focused(true);

    // 主窗口可用 → 以其中心定位弹窗；否则 fallback 到屏幕居中。
    let manual_pos = compute_editor_center(&app);
    if manual_pos.is_none() {
        builder = builder.center();
    }

    // 把 main 设为 parent。失败（main 不存在）时退化为无 parent 的普通窗口。
    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main).map_err(|e| e.to_string())?;
    }

    let window = builder.build().map_err(|e| e.to_string())?;

    let _ = window.set_size(LogicalSize::new(EDITOR_W, EDITOR_H));
    if let Some(pos) = manual_pos {
        let _ = window.set_position(pos);
    }
    Ok(())
}

/// 计算弹窗居中位置（物理坐标）：以主窗口几何中心为基准，减去
/// 弹窗一半（按主窗口 monitor 的 scale_factor 把逻辑像素转物理像素）。
/// 主窗口不存在 / 取不到几何信息时返回 None，调用方退到默认 center()。
fn compute_editor_center<R: Runtime>(app: &AppHandle<R>) -> Option<PhysicalPosition<i32>> {
    let main = app.get_webview_window("main")?;
    let pos = main.outer_position().ok()?;
    let size = main.outer_size().ok()?;
    let scale = main
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let popup_w_px = (EDITOR_W * scale) as i32;
    let popup_h_px = (EDITOR_H * scale) as i32;
    let cx = pos.x + (size.width as i32) / 2;
    let cy = pos.y + (size.height as i32) / 2;
    Some(PhysicalPosition::new(cx - popup_w_px / 2, cy - popup_h_px / 2))
}

fn task_editor_url(target: &TaskEditorTarget) -> String {
    let mut parts = vec!["win=task-editor".to_string()];
    if let Some(task_id) = &target.task_id {
        parts.push(format!("taskId={}", task_id));
    }
    if let Some(default_date) = &target.default_date {
        parts.push(format!("defaultDate={}", default_date));
    }
    format!("index.html?{}", parts.join("&"))
}

fn handle_tray_event<R: Runtime>(app: &AppHandle<R>, event: &TrayIconEvent) {
    match event {
        // 左键松开 → 切换 popup 显示
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            rect,
            ..
        } => {
            // rect.position 是 tauri::Position，要先转 Physical 取实际像素
            let (ax, ay) = match rect.position {
                tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
                tauri::Position::Logical(p) => (p.x, p.y),
            };
            toggle_popup(app, ax, ay);
        }
        // 右键 → 兜底打开主窗口
        TrayIconEvent::Click {
            button: MouseButton::Right,
            button_state: MouseButtonState::Up,
            ..
        } => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        _ => {}
    }
}

fn toggle_popup<R: Runtime>(app: &AppHandle<R>, anchor_x: f64, anchor_y: f64) {
    let Some(window) = app.get_webview_window(POPUP_LABEL) else {
        return;
    };
    let is_visible = window.is_visible().unwrap_or(false);
    if is_visible {
        let _ = window.hide();
        return;
    }

    // 用「点击的 tray icon 物理坐标」去查 monitor —— 这是跟随点击屏幕的关键。
    // 之所以不用 window.current_monitor()：popup 是预创建的隐藏窗口，
    // current_monitor 返回它"被创建那一瞬间"的屏幕，跨屏后会错位。
    // anchor_* 已经是物理坐标（macOS 顶部状态栏 icon 区左上角）。
    let target_monitor = app
        .monitor_from_point(anchor_x, anchor_y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());

    let scale_factor = target_monitor
        .as_ref()
        .map(|m| m.scale_factor())
        .unwrap_or(2.0);

    // 计算 popup 位置：以 icon 中心点为锚，水平居中，垂直紧贴 icon 下沿。
    // popup 物理坐标 = anchor - popup_w/2 + icon_w/2，icon 高约 22 逻辑像素。
    let popup_w_px = POPUP_W * scale_factor;
    let icon_w_px = 22.0 * scale_factor;
    let icon_h_px = 22.0 * scale_factor;
    let gap_px = 4.0 * scale_factor;

    let mut x = anchor_x + icon_w_px / 2.0 - popup_w_px / 2.0;
    let mut y = anchor_y + icon_h_px + gap_px;

    // 屏幕边界保护：用刚才查到的 monitor 的几何（而不是 popup 当前所在屏），
    // 保证跨屏切换时边界判断也跟着切换。
    if let Some(monitor) = target_monitor.as_ref() {
        let mon_size = monitor.size();
        let mon_pos = monitor.position();
        let max_x = (mon_pos.x as f64) + (mon_size.width as f64) - popup_w_px - 8.0 * scale_factor;
        let min_x = (mon_pos.x as f64) + 8.0 * scale_factor;
        if x > max_x {
            x = max_x;
        }
        if x < min_x {
            x = min_x;
        }
        if y < (mon_pos.y as f64) {
            y = mon_pos.y as f64;
        }
    }

    // 先定位再显示：macOS 在跨屏移动可见 window 时偶尔会闪一下旧位置。
    // 实测序列 set_position → show 比 show → set_position 更稳。
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.show();
    let _ = window.set_focus();
}
