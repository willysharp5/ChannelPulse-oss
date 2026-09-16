#[cfg(target_os = "macos")]
use tauri::LogicalPosition;
use std::collections::BTreeMap;
use std::sync::Mutex;
use tauri::{App, AppHandle, Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

/// Tracks which parts of the transparent floating overlay should capture the
/// mouse. Everywhere else, cursor events pass straight through to the app
/// behind us. `regions` are logical rects (x, y, w, h) relative to the window's
/// top-left corner; `force_all` makes the entire window interactive (used when
/// the chat/details panel is open).
#[derive(Default)]
pub struct OverlayHit {
    pub regions: Mutex<Vec<(f64, f64, f64, f64)>>,
    pub force_all: Mutex<bool>,
    /// The currently-applied ignore state, so we only toggle on change.
    pub ignoring: Mutex<bool>,
}

/// Frontend reports the interactive regions (and whether the whole window is
/// interactive) whenever the overlay layout changes.
#[tauri::command]
pub fn set_overlay_hit_regions(
    state: tauri::State<'_, OverlayHit>,
    regions: Vec<[f64; 4]>,
    force_all: bool,
) -> Result<(), String> {
    if let Ok(mut r) = state.regions.lock() {
        *r = regions
            .into_iter()
            .map(|a| (a[0], a[1], a[2], a[3]))
            .collect();
    }
    if let Ok(mut f) = state.force_all.lock() {
        *f = force_all;
    }
    Ok(())
}

/// Polls the global cursor position and toggles click-through on the main
/// overlay window so it only intercepts the mouse over the visible controls.
pub fn spawn_overlay_click_through<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        // Re-assert the ignore state on the cursor at least this often, even
        // when our cached flag says nothing changed. The change-only path below
        // desyncs if the panel's real ignore state is altered out from under us
        // (moving across Spaces/monitors, the NSPanel being re-shown), which
        // could leave the overlay permanently dead (stuck click-through) or
        // stuck opaque. Every ~480ms we force the current desired state so any
        // desync self-heals; setting `ignoresMouseEvents` to its current value
        // is a no-op in AppKit, so this can't cause flicker.
        let mut reassert_ticks: u32 = 0;
        const REASSERT_EVERY: u32 = 12; // 12 * 40ms ≈ 480ms

        loop {
            tokio::time::sleep(std::time::Duration::from_millis(40)).await;
            reassert_ticks = reassert_ticks.wrapping_add(1);

            let window = match handle.get_webview_window("main") {
                Some(w) => w,
                None => continue,
            };
            let state = handle.state::<OverlayHit>();

            let force_all = state.force_all.lock().map(|g| *g).unwrap_or(false);

            let interactive = if force_all {
                true
            } else {
                let cursor = match window.cursor_position() {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let pos = match window.outer_position() {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                // `cursor_position()` (tao) is always converted to physical px
                // using the PRIMARY monitor's scale, while `scale_factor()` /
                // `outer_position()` use the WINDOW's current monitor scale. On
                // the primary display these match, but on a second display with
                // a different scale, `(cursor - pos) / scale` mixes unit systems
                // and the pill's hit region lands in the wrong place — the
                // overlay stays visible but can't be clicked. Convert each side
                // to logical points with its OWN scale before subtracting.
                let win_scale = window.scale_factor().unwrap_or(1.0);
                let primary_scale = window
                    .primary_monitor()
                    .ok()
                    .flatten()
                    .map(|m| m.scale_factor())
                    .unwrap_or(win_scale);
                let lx = cursor.x / primary_scale - pos.x as f64 / win_scale;
                let ly = cursor.y / primary_scale - pos.y as f64 / win_scale;

                let regions = state
                    .regions
                    .lock()
                    .map(|g| g.clone())
                    .unwrap_or_default();
                regions
                    .iter()
                    .any(|(x, y, w, h)| lx >= *x && lx <= x + w && ly >= *y && ly <= y + h)
            };

            let desired_ignore = !interactive;
            let changed = {
                let mut ig = match state.ignoring.lock() {
                    Ok(g) => g,
                    Err(p) => p.into_inner(),
                };
                if *ig != desired_ignore {
                    *ig = desired_ignore;
                    true
                } else {
                    false
                }
            };
            let reassert = reassert_ticks % REASSERT_EVERY == 0;
            if changed || reassert {
                let _ = window.set_ignore_cursor_events(desired_ignore);
            }
        }
    });
}

// The offset from the top of the screen to the window
const TOP_OFFSET: i32 = 54;

/// Sets up the main window with custom positioning
pub fn setup_main_window(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    // Try different possible window labels
    let window = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("channelpulse"))
        .or_else(|| {
            // Get the first window if specific labels don't work
            app.webview_windows().values().next().cloned()
        })
        .ok_or("No window found")?;

    position_window_top_center(&window, TOP_OFFSET)?;

    // Set window as non-focusable on Windows
    // #[cfg(target_os = "windows")]
    // {
    //     let _ = window.set_focusable(false);
    // }

    Ok(())
}

/// The display the user is actually working on — the one under the mouse
/// cursor — falling back to the window's own monitor and then the primary.
///
/// `primary_monitor()` is NOT good enough here: with an external display the
/// primary is whichever the OS says, so the overlay would land on the laptop
/// screen while the user is on the big monitor (or vice versa) and read as "it's
/// off somewhere I can't reach it".
fn active_monitor<R: Runtime>(window: &WebviewWindow<R>) -> Option<tauri::Monitor> {
    if let Ok(cursor) = window.cursor_position() {
        if let Ok(Some(monitor)) = window.monitor_from_point(cursor.x, cursor.y) {
            return Some(monitor);
        }
    }
    window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
}

/// Positions a window at the top center of the active display, `y_offset`
/// physical pixels below the top of that display's usable area.
///
/// Everything here is in PHYSICAL pixels and every coordinate is relative to the
/// chosen monitor's own origin. Both matter: a secondary display's origin is
/// nonzero (this machine's sits at x=1512), so centering with a bare
/// `(monitor_width - window_width) / 2` puts the window on the *primary* display
/// no matter which one the user is looking at.
pub fn position_window_top_center<R: Runtime>(
    window: &WebviewWindow<R>,
    y_offset: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(monitor) = active_monitor(window) {
        // Work area, not full size — it excludes the menu bar / taskbar, so the
        // overlay can't be tucked underneath them.
        let area = monitor.work_area();
        let window_size = window.outer_size()?;

        let x = area.position.x + (area.size.width as i32 - window_size.width as i32) / 2;

        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: x.max(area.position.x),
            y: area.position.y + y_offset,
        }))?;
    }

    Ok(())
}

/// Re-centers the floating overlay on the display the user is working on.
///
/// The escape hatch for "the overlay is off the side of the screen and I can't
/// grab its drag handle to pull it back". Also what a fresh launch uses, so the
/// overlay never starts somewhere unreachable.
#[tauri::command]
pub fn center_overlay(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Overlay window not found".to_string())?;
    position_window_top_center(&window, TOP_OFFSET).map_err(|e| e.to_string())
}

/// Nudges a window back onto its display if it is hanging off an edge.
///
/// Called after every programmatic resize: the OS keeps the top-left corner
/// fixed when a window grows, so opening the chat rail or the reference rail on
/// an overlay that already sits right of centre pushed its right-hand side
/// (and, once wide enough, the drag handle) off the screen. Only ever moves a
/// window that is genuinely off-screen, so it never fights a position the user
/// chose by dragging.
fn nudge_onscreen<R: Runtime>(window: &WebviewWindow<R>) {
    let Some(monitor) = active_monitor(window) else {
        return;
    };
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };
    let area = monitor.work_area();

    let min_x = area.position.x;
    let max_x = area.position.x + area.size.width as i32 - size.width as i32;
    let min_y = area.position.y;
    let max_y = area.position.y + area.size.height as i32 - size.height as i32;

    // A window wider or taller than the display gives max < min; pin it to the
    // top-left in that case rather than flipping it off the other edge.
    let x = pos.x.min(max_x.max(min_x)).max(min_x);
    let y = pos.y.min(max_y.max(min_y)).max(min_y);

    if x != pos.x || y != pos.y {
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
    }
}

/// Future function for centering window completely (both X and Y)
#[allow(dead_code)]
pub fn center_window_completely(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(monitor) = window.primary_monitor()? {
        let monitor_size = monitor.size();
        let window_size = window.outer_size()?;

        let center_x = (monitor_size.width as i32 - window_size.width as i32) / 2;
        let center_y = (monitor_size.height as i32 - window_size.height as i32) / 2;

        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: center_x,
            y: center_y,
        }))?;
    }

    Ok(())
}

// Default size of the collapsed floating bar. Scaled with the app's type scale
// (src/global.css sets a 112.5% root font-size, so the bar's contents are ~1.125x
// their old size) — keep these three in step with hooks/useWindow.ts.
const BAR_WIDTH: f64 = 675.0;
const BAR_HEIGHT: f64 = 99.0;
/// Height of the expanded overlay panel. Mirrors `PANEL_HEIGHT` in hooks/useWindow.ts.
const PANEL_HEIGHT: f64 = 675.0;

#[tauri::command]
pub fn set_window_height(
    window: tauri::WebviewWindow,
    height: u32,
    reset_width: Option<bool>,
) -> Result<(), String> {
    use tauri::{LogicalSize, Size};

    // Preserve the current width unless explicitly asked to reset back to the
    // bar width. This keeps a manually expanded (maximized) window from being
    // snapped back to 600px by the frequent height-only resizes that happen
    // while listening/transcribing.
    let width = if reset_width.unwrap_or(false) {
        BAR_WIDTH
    } else {
        let scale = window.scale_factor().unwrap_or(1.0);
        window
            .inner_size()
            .map(|s| (s.width as f64 / scale).max(BAR_WIDTH))
            .unwrap_or(BAR_WIDTH)
    };

    let new_size = LogicalSize::new(width, height as f64);
    window
        .set_size(Size::Logical(new_size))
        .map_err(|e| format!("Failed to resize window: {}", e))?;

    // Keep `set_window_size`'s dedupe cache honest. This command also changes the
    // window size, so record what we applied here. Otherwise, after a collapse
    // shrinks the window through this path, a later `set_window_size` asking to
    // restore the previous expanded footprint could equal a now-stale cache
    // entry and get skipped — leaving the panel stuck at the bar height.
    if let Ok(mut last) = LAST_APPLIED_SIZE.lock() {
        last.insert(window.label().to_string(), (width.round() as u32, height));
    }

    // Growing keeps the top-left pinned, so a taller panel can run off the
    // bottom of the display.
    nudge_onscreen(&window);

    Ok(())
}

/// The size each window was last given through `set_window_size`, keyed by window
/// label. See the dedupe in `set_window_size` below.
static LAST_APPLIED_SIZE: Mutex<BTreeMap<String, (u32, u32)>> = Mutex::new(BTreeMap::new());

/// Sets both the width and height of the window (logical pixels). Used by the
/// overlay's expand/shrink toggle to widen the chat area.
///
/// The request is snapped up to the overlay's own sizes and capped to what the
/// display can show. The floor matters because the panel still asks for the
/// pre-scale 600x88 / 600-tall sizes; honouring those literally clips the (now
/// 1.125x larger) controls — and it used to be masked by the per-token resize
/// that `useWindow.ts` no longer sends, so it has to be handled here.
///
/// A request identical to the one we last applied to this window is skipped.
/// Callers re-assert the panel's *current* state on unrelated actions — clicking
/// a chat suggestion runs the chat-open sizing again on every click — which
/// snapped the window back and undid a size the user had dragged. A genuine
/// state change (maximize, narrow the chat, collapse) always asks for a
/// different size, so it still gets through. `useWindow.ts` protects the
/// `set_window_height` path the same way, via `userHeight`.
#[tauri::command]
pub fn set_window_size(window: tauri::WebviewWindow, width: u32, height: u32) -> Result<(), String> {
    use tauri::{LogicalSize, Size};

    let label = window.label().to_string();
    {
        let mut last = match LAST_APPLIED_SIZE.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        if last.get(&label) == Some(&(width, height)) {
            return Ok(());
        }
        last.insert(label.clone(), (width, height));
    }

    // Anything taller than the bar is a request for the expanded panel, so give
    // it at least the panel's height rather than a stale 600.
    let height = if height as f64 > BAR_HEIGHT {
        (height as f64).max(PANEL_HEIGHT)
    } else {
        BAR_HEIGHT
    };

    let (width, height) = clamp_to_monitor(
        window.current_monitor().ok().flatten(),
        (width as f64).max(BAR_WIDTH),
        height,
    );

    let new_size = LogicalSize::new(width, height);
    if let Err(e) = window.set_size(Size::Logical(new_size)) {
        // Forget the request so a retry isn't swallowed by the dedupe above.
        if let Ok(mut last) = LAST_APPLIED_SIZE.lock() {
            last.remove(&label);
        }
        return Err(format!("Failed to resize window: {}", e));
    }

    // Opening a rail widens the window to the RIGHT (the OS pins the top-left),
    // so without this the panel — and eventually the pill with the drag handle —
    // walks off the right-hand edge of the display and can't be dragged back.
    nudge_onscreen(&window);

    Ok(())
}

#[tauri::command]
pub fn open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    show_dashboard_window(&app)
}

#[tauri::command]
pub fn toggle_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(dashboard_window) = app.get_webview_window("dashboard") {
        match dashboard_window.is_visible() {
            Ok(true) => {
                // Window is visible, hide it
                dashboard_window
                    .hide()
                    .map_err(|e| format!("Failed to hide dashboard window: {}", e))?;
            }
            Ok(false) => {
                // Window is hidden, show and focus it
                dashboard_window
                    .show()
                    .map_err(|e| format!("Failed to show dashboard window: {}", e))?;
                dashboard_window
                    .set_focus()
                    .map_err(|e| format!("Failed to focus dashboard window: {}", e))?;
            }
            Err(e) => {
                return Err(format!("Failed to check dashboard visibility: {}", e));
            }
        }
    } else {
        // Window doesn't exist, create and show it
        show_dashboard_window(&app)?;
    }

    Ok(())
}

#[tauri::command]
pub fn move_window(app: tauri::AppHandle, direction: String, step: i32) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let current_pos = window
            .outer_position()
            .map_err(|e| format!("Failed to get window position: {}", e))?;

        let (new_x, new_y) = match direction.as_str() {
            "up" => (current_pos.x, current_pos.y - step),
            "down" => (current_pos.x, current_pos.y + step),
            "left" => (current_pos.x - step, current_pos.y),
            "right" => (current_pos.x + step, current_pos.y),
            _ => return Err(format!("Invalid direction: {}", direction)),
        };

        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: new_x,
                y: new_y,
            }))
            .map_err(|e| format!("Failed to set window position: {}", e))?;
    } else {
        return Err("Main window not found".to_string());
    }

    Ok(())
}

/// Shared dashboard size for macOS and Windows (logical px). Scaled by 1.125
/// alongside the app's root font-size (src/global.css) so the roomier text and
/// controls get the same amount of window to sit in; mirrored in
/// components/Sidebar.tsx.
const DASHBOARD_WIDTH: f64 = 1350.0;
const DASHBOARD_HEIGHT: f64 = 1010.0;
const DASHBOARD_MIN_WIDTH: f64 = 900.0;
const DASHBOARD_MIN_HEIGHT: f64 = 675.0;

/// Shrink a desired window size to fit the display it will open on, leaving room
/// for the menu bar / taskbar. Without this the scaled-up dashboard would hang
/// off the bottom of a 13" laptop screen (~1470x956 logical). Never returns less
/// than the dashboard minimums — a tiny display is better served by a window it
/// can't quite fit than by an unusably small one.
fn clamp_to_monitor(
    monitor: Option<tauri::Monitor>,
    width: f64,
    height: f64,
) -> (f64, f64) {
    let Some(monitor) = monitor else {
        return (width, height);
    };
    let scale = monitor.scale_factor();
    let size = monitor.size();
    let max_w = (size.width as f64 / scale - 40.0).max(DASHBOARD_MIN_WIDTH);
    let max_h = (size.height as f64 / scale - 100.0).max(DASHBOARD_MIN_HEIGHT);
    (width.min(max_w), height.min(max_h))
}

pub fn create_dashboard_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebviewWindow<R>, tauri::Error> {
    let (width, height) = clamp_to_monitor(
        app.primary_monitor().ok().flatten(),
        DASHBOARD_WIDTH,
        DASHBOARD_HEIGHT,
    );

    let base_builder =
        WebviewWindowBuilder::new(app, "dashboard", tauri::WebviewUrl::App("/chats".into()))
            .title("ChannelPulse OSS - Dashboard")
            .center()
            .decorations(true)
            .inner_size(width, height)
            .min_inner_size(DASHBOARD_MIN_WIDTH, DASHBOARD_MIN_HEIGHT)
            .content_protected(false);

    // macOS (incl. Apple Silicon / Intel): overlay title bar + traffic lights.
    #[cfg(target_os = "macos")]
    let base_builder = base_builder
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .visible(true)
        .traffic_light_position(LogicalPosition::new(14.0, 18.0));

    // Windows: same size as macOS; start hidden until show_dashboard_window.
    #[cfg(windows)]
    let base_builder = base_builder.visible(false);

    let window = base_builder.build()?;

    // Set up close event handler - hide window instead of destroying it
    setup_dashboard_close_handler(&window);

    Ok(window)
}

/// Sets up the close event handler for the dashboard window
fn setup_dashboard_close_handler<R: Runtime>(window: &WebviewWindow<R>) {
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Prevent the window from being destroyed
            api.prevent_close();
            // Hide the window instead
            if let Err(e) = window_clone.hide() {
                eprintln!("Failed to hide dashboard window on close: {}", e);
            }
        }
    });
}

/// Shows the dashboard window and brings it to focus
pub fn show_dashboard_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(dashboard_window) = app.get_webview_window("dashboard") {
        // Window exists, show and focus it
        dashboard_window
            .show()
            .map_err(|e| format!("Failed to show dashboard window: {}", e))?;
        dashboard_window
            .set_focus()
            .map_err(|e| format!("Failed to focus dashboard window: {}", e))?;
    } else {
        // Window doesn't exist, create it and then show it
        let window = create_dashboard_window(app)
            .map_err(|e| format!("Failed to create dashboard window: {}", e))?;
        window
            .show()
            .map_err(|e| format!("Failed to show new dashboard window: {}", e))?;
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus new dashboard window: {}", e))?;
    }
    Ok(())
}

