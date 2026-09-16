//! Offline speech-to-text with whisper.cpp (via the `whisper-rs` crate).
//!
//! ChannelPulse OSS transcribes entirely on-device — no cloud, no API key. The
//! frontend records audio, normalizes it to 16 kHz mono 16-bit WAV, and hands
//! the bytes here as base64; we parse the WAV with `hound`, run whisper, and
//! return the text.
//!
//! The GGML model is NOT bundled or downloaded automatically. The user drops a
//! `ggml-*.bin` file into the app's models directory (see `whisper_models_dir`)
//! and the README explains where to get one. Resolution order:
//!   1. `CHANNELPULSE_WHISPER_MODEL` env var (absolute path to a .bin), else
//!   2. the first `*.bin` in `<app_data_dir>/models/` (alphabetical).

use std::io::Cursor;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Loaded model, cached across calls so we don't reload the (large) weights per
/// utterance. Keyed by path so swapping the model file takes effect on reload.
static MODEL: Lazy<Mutex<Option<(PathBuf, Arc<WhisperContext>)>>> =
    Lazy::new(|| Mutex::new(None));

#[derive(Serialize)]
pub struct TranscribeResult {
    pub transcript: String,
}

/// Absolute path to the directory the app looks in for `ggml-*.bin` models,
/// creating it if needed. Exposed as a command so the UI/README can point the
/// user at the exact folder.
fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create models dir: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn whisper_models_dir(app: AppHandle) -> Result<String, String> {
    Ok(models_dir(&app)?.to_string_lossy().to_string())
}

/// Resolve the model file to load, or a helpful error naming the folder the
/// user should drop a model into.
fn resolve_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("CHANNELPULSE_WHISPER_MODEL") {
        let p = PathBuf::from(explicit);
        if p.is_file() {
            return Ok(p);
        }
    }

    let dir = models_dir(app)?;
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Could not read models dir: {e}"))?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|e| e == "bin").unwrap_or(false))
        .collect();
    candidates.sort();

    candidates.into_iter().next().ok_or_else(|| {
        format!(
            "No speech-to-text model found. Download a whisper GGML model (e.g. \
             ggml-base.en.bin) and place it in:\n{}\nSee the README for details.",
            dir.to_string_lossy()
        )
    })
}

/// Load the model at `path`, reusing the cached context when the path is
/// unchanged.
fn get_or_load_model(path: &PathBuf) -> Result<Arc<WhisperContext>, String> {
    let mut guard = MODEL.lock().map_err(|_| "whisper model lock poisoned".to_string())?;
    if let Some((cached_path, ctx)) = guard.as_ref() {
        if cached_path == path {
            return Ok(ctx.clone());
        }
    }
    let ctx = WhisperContext::new_with_params(
        &path.to_string_lossy(),
        WhisperContextParameters::default(),
    )
    .map_err(|e| format!("Failed to load whisper model: {e}"))?;
    let ctx = Arc::new(ctx);
    *guard = Some((path.clone(), ctx.clone()));
    Ok(ctx)
}

/// Decode a 16 kHz mono 16-bit PCM WAV (as produced by the frontend) into the
/// f32 samples whisper expects.
fn wav_base64_to_samples(wav_base64: &str) -> Result<Vec<f32>, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(wav_base64.trim())
        .map_err(|e| format!("Invalid base64 audio: {e}"))?;

    let mut reader = hound::WavReader::new(Cursor::new(bytes))
        .map_err(|e| format!("Invalid WAV audio: {e}"))?;
    let spec = reader.spec();

    // Frontend normalizes to mono/16-bit/16 kHz; convert whatever we got to f32.
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let max = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / max).unwrap_or(0.0))
                .collect()
        }
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .map(|s| s.unwrap_or(0.0))
            .collect(),
    };

    // Downmix to mono if the frontend ever hands us multi-channel audio.
    if spec.channels > 1 {
        let ch = spec.channels as usize;
        let mono = samples
            .chunks(ch)
            .map(|frame| frame.iter().sum::<f32>() / ch as f32)
            .collect();
        Ok(mono)
    } else {
        Ok(samples)
    }
}

/// Transcribe a base64-encoded 16 kHz mono WAV clip fully offline.
#[tauri::command]
pub async fn transcribe_wav(
    app: AppHandle,
    wav_base64: String,
) -> Result<TranscribeResult, String> {
    let model_path = resolve_model_path(&app)?;
    let samples = wav_base64_to_samples(&wav_base64)?;

    if samples.is_empty() {
        return Ok(TranscribeResult {
            transcript: String::new(),
        });
    }

    // whisper's inference is CPU-heavy and blocking — keep it off the async
    // runtime so the UI's other IPC stays responsive.
    let transcript = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let ctx = get_or_load_model(&model_path)?;
        let mut state = ctx
            .create_state()
            .map_err(|e| format!("Failed to create whisper state: {e}"))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);

        state
            .full(params, &samples)
            .map_err(|e| format!("Transcription failed: {e}"))?;

        let n = state
            .full_n_segments()
            .map_err(|e| format!("Could not read segments: {e}"))?;
        let mut out = String::new();
        for i in 0..n {
            if let Ok(seg) = state.full_get_segment_text(i) {
                out.push_str(&seg);
            }
        }
        Ok(out.trim().to_string())
    })
    .await
    .map_err(|e| format!("Transcription task failed: {e}"))??;

    Ok(TranscribeResult { transcript })
}
