//! Keep the overlay visible no matter which **Windows virtual desktop** the user
//! is on.
//!
//! # Why this file exists
//!
//! `tauri.conf.json` sets `"visibleOnAllWorkspaces": true` on the `main` window,
//! and on macOS that genuinely works — it maps to
//! `NSWindowCollectionBehaviorCanJoinAllSpaces` (and `lib.rs::init` sets that
//! behaviour explicitly as well, alongside `FullScreenAuxiliary`).
//!
//! On **Windows it is a silent no-op.** `tao` only implements
//! `set_visible_on_all_workspaces` for macOS and Linux — there is no Windows
//! branch at all, so the flag is accepted, ignored, and the overlay stays pinned
//! to whichever virtual desktop it happened to be created on. Switch desktops
//! mid-call and the copilot vanishes, which defeats the entire point of it.
//!
//! Windows has no public "pin this window to every desktop" API (the shell's own
//! *Show this window on all desktops* goes through the undocumented
//! `IVirtualDesktopManagerInternal`, whose vtable layout changes between Windows
//! builds — not something worth shipping). What Windows *does* document is
//! [`IVirtualDesktopManager`], which can tell us whether a window is on the
//! active desktop and move it to a given one. So instead of pinning, we
//! **follow**: notice when the overlay has been left behind and bring it to the
//! desktop the user is actually looking at.
//!
//! The user-visible result is the same as macOS ("the overlay is always there").
//! The mechanical difference: the overlay exists on exactly one desktop at a time
//! rather than all of them simultaneously. That is invisible to a single user and
//! is the reason this is a polling loop instead of a one-shot flag.
//!
//! # Failure policy
//!
//! Every step degrades to "do nothing". A missing COM class (Windows Server /
//! stripped images), a denied `MoveWindowToDesktop`, a closed window — all of it
//! just means the overlay behaves the way it did before this file existed. This
//! must never panic and never surface an error to the user: an overlay that
//! doesn't follow you is a nuisance, an overlay that crashes the app is broken.
//!
//! [`IVirtualDesktopManager`]: https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ivirtualdesktopmanager

use std::ffi::c_void;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};
use windows::core::GUID;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{IVirtualDesktopManager, VirtualDesktopManager};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

/// How often to check whether the overlay got left behind on another desktop.
///
/// This is one in-process COM call per tick, so the cost is negligible, but the
/// interval is still the visible latency of the overlay "catching up" after a
/// desktop switch. 400ms reads as immediate without busy-looping.
const POLL_INTERVAL: Duration = Duration::from_millis(400);

/// Tauri and this crate may resolve *different* versions of the `windows` crate,
/// and `HWND`'s inner type changed from `isize` to `*mut c_void` across those
/// versions. Going through `isize` is the one conversion that compiles against
/// either, so the raw handle is passed around as `isize` and only rebuilt into
/// an `HWND` at the call site.
fn overlay_handle<R: Runtime>(app: &AppHandle<R>) -> Option<isize> {
    let window = app.get_webview_window("main")?;
    let hwnd = window.hwnd().ok()?;
    Some(hwnd.0 as isize)
}

/// Move `overlay` to whichever desktop is currently active, if it isn't already
/// there. Returns `None` on any COM failure so the caller can simply ignore it.
///
/// The active desktop is identified indirectly: `IVirtualDesktopManager` has no
/// "get the current desktop id" call, but the foreground window is by definition
/// on the desktop the user is looking at, so its desktop id *is* the answer.
unsafe fn follow_active_desktop(
    manager: &IVirtualDesktopManager,
    overlay: HWND,
) -> Option<()> {
    // Already where the user is — nothing to do. This is the overwhelmingly
    // common case, and it's why the poll is cheap.
    if manager.IsWindowOnCurrentVirtualDesktop(overlay).ok()?.as_bool() {
        return Some(());
    }

    let foreground = GetForegroundWindow();
    if foreground.0.is_null() {
        return None;
    }
    // If our own overlay is somehow the foreground window, its desktop id is the
    // stale one we're trying to move away from — asking would just move it to
    // where it already is.
    if foreground.0 == overlay.0 {
        return None;
    }

    let target: GUID = manager.GetWindowDesktopId(foreground).ok()?;
    manager.MoveWindowToDesktop(overlay, &target).ok()?;
    Some(())
}

/// Start the follow loop. Call once from `setup`.
///
/// Runs on its own thread because COM is initialized per-thread and we do not
/// want an apartment on Tauri's main thread; the thread lives for the life of the
/// app and exits on its own if the overlay window is gone for good.
pub fn spawn_follow_active_desktop<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        // Errors here (including RPC_E_CHANGED_MODE if something already
        // initialized this thread's apartment differently) are not actionable —
        // CoCreateInstance below will simply fail and we'll bail out.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }

        let manager: IVirtualDesktopManager =
            match unsafe { CoCreateInstance(&VirtualDesktopManager, None, CLSCTX_ALL) } {
                Ok(manager) => manager,
                Err(e) => {
                    // Expected on Windows images without the virtual-desktop
                    // shell component. The overlay still works, it just won't
                    // follow across desktops.
                    eprintln!("[virtual-desktop] unavailable, overlay will not follow desktops: {e}");
                    return;
                }
            };

        // The window can be missing briefly during startup/teardown; only give
        // up after it has been gone long enough to mean "the app is closing".
        let mut consecutive_missing = 0u32;
        loop {
            std::thread::sleep(POLL_INTERVAL);

            match overlay_handle(&app) {
                Some(raw) => {
                    consecutive_missing = 0;
                    let overlay = HWND(raw as *mut c_void);
                    unsafe {
                        // Result deliberately dropped: see the failure policy in
                        // the module docs.
                        let _ = follow_active_desktop(&manager, overlay);
                    }
                }
                None => {
                    consecutive_missing += 1;
                    if consecutive_missing > 25 {
                        return;
                    }
                }
            }
        }
    });
}
