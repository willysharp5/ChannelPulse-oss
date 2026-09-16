// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod activate;
mod api;
mod capture;
mod db;
mod files;
mod shortcuts;
#[cfg(windows)]
mod virtual_desktop;
mod window;
mod whisper;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, WebviewWindow};
use tokio::task::JoinHandle;
mod speaker;
use capture::CaptureState;
use speaker::VadConfig;

#[cfg(target_os = "macos")]
#[allow(deprecated)]
use tauri_nspanel::{cocoa::appkit::NSWindowCollectionBehavior, panel_delegate, WebviewWindowExt};

#[derive(Default)]
pub struct AudioState {
    stream_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    vad_config: Arc<Mutex<VadConfig>>,
    is_capturing: Arc<Mutex<bool>>,
    // Native microphone capture task (macOS). Independent of `stream_task` so
    // system audio and the mic can run concurrently. See speaker::start_mic_capture.
    mic_stream_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    // Set for the whole of `start_mic_capture`, because `mic_stream_task` alone
    // could not make it exclusive: that lock is taken to check the slot, then
    // released while the CoreAudio stream is opened, and only re-taken to store
    // the handle. Two concurrent starts (React StrictMode double-invokes the
    // MicListener effect, so both async `setup()` calls are in flight at once)
    // therefore both saw an empty slot, both opened a stream, and the second
    // overwrote the first's handle — orphaning a live capture task that nothing
    // could ever stop. See speaker::start_mic_capture.
    mic_starting: Arc<std::sync::atomic::AtomicBool>,
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Install a tracing subscriber so the crate's `error!`/`warn!`/`info!` calls
/// actually go somewhere.
///
/// They didn't before: `tracing` without a subscriber discards everything, so
/// all 50 log statements in this crate — including every failure in the audio
/// capture path — had never emitted a single line. A microphone that captured
/// nothing was therefore indistinguishable from a microphone that captured
/// fine, from outside the app, which is the worst possible property for the
/// one subsystem users can't inspect themselves.
///
/// Default is `info`, which is quiet: the audio loops log per-utterance, not
/// per-sample. Override with `RUST_LOG=channelpulse=debug` for the per-segment
/// detail. Errors from the subscriber's own setup are ignored on purpose — a
/// second call (or a host that already installed one) must not abort startup.
fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = fmt().with_env_filter(filter).with_target(true).try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    // ChannelPulse OSS ships NO analytics or telemetry — the PostHog plugin and
    // its hard-coded project token have been removed from this build entirely.
    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:channelpulse.db", db::migrations())
                .build(),
        )
        .manage(AudioState::default())
        .manage(CaptureState::default())
        .manage(shortcuts::WindowVisibility {
            is_hidden: Mutex::new(false),
        })
        .manage(shortcuts::RegisteredShortcuts::default())
        .manage(shortcuts::LicenseState::default())
        .manage(shortcuts::MoveWindowState::default())
        .manage(window::OverlayHit::default())
        .plugin(tauri_plugin_opener::init())
        // ChannelPulse OSS ships no auto-updater (no hosted release feed / signing key).
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_keychain::init())
        .plugin(tauri_plugin_shell::init()) // Add shell plugin
        .plugin(tauri_plugin_dialog::init()) // File picker for local file context
        .plugin(tauri_plugin_machine_uid::init());
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }
    let mut builder = builder
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            whisper::transcribe_wav,
            whisper::whisper_models_dir,
            window::set_window_height,
            window::set_window_size,
            window::set_overlay_hit_regions,
            window::open_dashboard,
            window::toggle_dashboard,
            window::move_window,
            window::center_overlay,
            files::read_file_text,
            files::write_file_bytes,
            capture::capture_to_base64,
            capture::start_screen_capture,
            capture::capture_selected_area,
            capture::close_overlay_window,
            capture::set_window_content_protected,
            capture::capture_bug_report_screenshot,
            shortcuts::check_shortcuts_registered,
            shortcuts::get_registered_shortcuts,
            shortcuts::update_shortcuts,
            shortcuts::validate_shortcut_key,
            shortcuts::set_license_status,
            shortcuts::set_app_icon_visibility,
            shortcuts::set_always_on_top,
            shortcuts::exit_app,
            activate::activate_license_api,
            activate::deactivate_license_api,
            activate::validate_license_api,
            activate::mask_license_key_cmd,
            activate::get_machine_id,
            activate::get_checkout_url,
            activate::secure_storage_save,
            activate::secure_storage_get,
            activate::secure_storage_remove,
            api::transcribe_audio,
            api::chat_stream_response,
            api::fetch_models,
            api::fetch_prompts,
            api::create_system_prompt,
            api::check_license_status,
            api::get_activity,
            speaker::start_system_audio_capture,
            speaker::stop_system_audio_capture,
            speaker::start_mic_capture,
            speaker::stop_mic_capture,
            speaker::manual_stop_continuous,
            speaker::check_system_audio_access,
            speaker::request_system_audio_access,
            speaker::get_vad_config,
            speaker::update_vad_config,
            speaker::get_capture_status,
            speaker::get_audio_sample_rate,
            speaker::get_input_devices,
            speaker::get_output_devices,
            speaker::open_sound_settings,
        ])
        .setup(|app| {
            // Setup main window positioning
            window::setup_main_window(app).expect("Failed to setup main window");
            // Make the transparent overlay click-through except over its controls.
            window::spawn_overlay_click_through(app.handle());
            #[cfg(target_os = "macos")]
            init(app.app_handle());
            // Windows has no equivalent of macOS's CanJoinAllSpaces — the
            // `visibleOnAllWorkspaces` flag in tauri.conf.json is a silent no-op
            // there — so the overlay has to follow the active virtual desktop
            // itself. See src-tauri/src/virtual_desktop.rs.
            #[cfg(windows)]
            virtual_desktop::spawn_follow_active_desktop(app.handle());
            let app_handle = app.handle();
            if app_handle.get_webview_window("dashboard").is_none() {
                if let Err(e) = window::create_dashboard_window(&app_handle) {
                    eprintln!("Failed to pre-create dashboard window on startup: {}", e);
                }
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;

                #[allow(deprecated, unexpected_cfgs)]
                if let Err(e) = app.handle().plugin(tauri_plugin_autostart::init(
                    MacosLauncher::LaunchAgent,
                    Some(vec![]),
                )) {
                    eprintln!("Failed to initialize autostart plugin: {}", e);
                }
            }

            // Initialize global shortcut plugin with centralized handler
            app.handle()
                .plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

                            let action_id = {
                                let state = app.state::<shortcuts::RegisteredShortcuts>();
                                let registered = match state.shortcuts.lock() {
                                    Ok(guard) => guard,
                                    Err(poisoned) => {
                                        eprintln!("Mutex poisoned in handler, recovering...");
                                        poisoned.into_inner()
                                    }
                                };

                                registered.iter().find_map(|(action_id, shortcut_str)| {
                                    if let Ok(s) = shortcut_str.parse::<Shortcut>() {
                                        if &s == shortcut {
                                            return Some(action_id.clone());
                                        }
                                    }
                                    None
                                })
                            };

                            if let Some(action_id) = action_id {
                                match event.state() {
                                    ShortcutState::Pressed => {
                                        if let Some(direction) =
                                            action_id.strip_prefix("move_window_")
                                        {
                                            shortcuts::start_move_window(app, direction);
                                        } else {
                                            eprintln!("Shortcut triggered: {}", action_id);
                                            shortcuts::handle_shortcut_action(app, &action_id);
                                        }
                                    }
                                    ShortcutState::Released => {
                                        if let Some(direction) =
                                            action_id.strip_prefix("move_window_")
                                        {
                                            shortcuts::stop_move_window(app, direction);
                                        }
                                    }
                                }
                            }
                        })
                        .build(),
                )
                .expect("Failed to initialize global shortcut plugin");
            if let Err(e) = shortcuts::setup_global_shortcuts(app.handle()) {
                eprintln!("Failed to setup global shortcuts: {}", e);
            }
            Ok(())
        });

    // Add macOS-specific permissions plugin
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_plugin_macos_permissions::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
#[allow(deprecated, unexpected_cfgs)]
fn init(app_handle: &AppHandle) {
    let window: WebviewWindow = app_handle.get_webview_window("main").unwrap();

    let panel = window.to_panel().unwrap();

    let delegate = panel_delegate!(MyPanelDelegate {
        window_did_become_key,
        window_did_resign_key
    });

    let handle = app_handle.to_owned();

    delegate.set_listener(Box::new(move |delegate_name: String| {
        match delegate_name.as_str() {
            "window_did_become_key" => {
                let app_name = handle.package_info().name.to_owned();

                println!("[info]: {:?} panel becomes key window!", app_name);
            }
            "window_did_resign_key" => {
                println!("[info]: panel resigned from key window!");
            }
            _ => (),
        }
    }));

    // Set the window to float level
    #[allow(non_upper_case_globals)]
    const NSFloatWindowLevel: i32 = 4;
    panel.set_level(NSFloatWindowLevel);

    #[allow(non_upper_case_globals)]
    const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
    // Include the resizable bit so the frontend corner handle can drag-resize
    // the panel; without it AppKit ignores startResizeDragging on the panel.
    #[allow(non_upper_case_globals)]
    const NSWindowStyleMaskResizable: i32 = 1 << 3;
    panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel | NSWindowStyleMaskResizable);

    // Always float over other apps' full-screen mode and follow across every
    // Space — this is core to the overlay's job (it must stay visible no
    // matter which desktop/Space or fullscreen app the user is in during a
    // call) and is unrelated to Privacy Mode, which only gates content
    // protection (see `capture::set_window_content_protected`). A previous
    // version incorrectly tied this to the Privacy Mode toggle (defaulting it
    // off, since Privacy Mode defaults off), which pinned the panel to a
    // single Space — regression, fixed 2026-08-07.
    #[allow(deprecated)]
    panel.set_collection_behaviour(
        NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces,
    );

    panel.set_delegate(delegate);
}
