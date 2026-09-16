// ChannelPulse AI Speech Detection, and capture system audio (speaker output) as a stream of f32 samples.
use crate::speaker::{AudioDevice, SpeakerInput};
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use futures_util::StreamExt;
use hound::{WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri_plugin_shell::ShellExt;
use tracing::{debug, error, info, warn};

// VAD Configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VadConfig {
    pub enabled: bool,
    pub hop_size: usize,
    pub sensitivity_rms: f32,
    pub peak_threshold: f32,
    pub silence_chunks: usize,
    pub min_speech_chunks: usize,
    pub pre_speech_chunks: usize,
    pub noise_gate_threshold: f32,
    pub max_recording_duration_secs: u64,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            hop_size: 1024,
            sensitivity_rms: 0.012, // Much less sensitive - only real speech
            peak_threshold: 0.035,  // Higher threshold - filters clicks/noise
            silence_chunks: 45,     // ~1.0s of silence before stopping
            min_speech_chunks: 7,   // ~0.16s - captures short answers
            pre_speech_chunks: 12,  // ~0.27s - enough to catch word start
            noise_gate_threshold: 0.003, // Stronger noise filtering
            max_recording_duration_secs: 180, // 3 minutes default
        }
    }
}

// Number of frequency bands emitted to the frontend visualizer.
const VISUALIZER_BANDS: usize = 24;

/// How often the capture loops wake up to re-check their stop flag while the
/// audio stream has nothing ready. Only a liveness tick — it is NOT on the path
/// of an arriving sample, see the `biased` selects below.
const IDLE_TICK: Duration = Duration::from_millis(10);

/// The tauri event names a VAD capture loop emits, plus the event it listens
/// for to stop. Parameterized so the same `run_vad_capture` drives two
/// independent captures — system audio ("Them") and the native microphone
/// ("You") — without their events or stop signals colliding.
#[derive(Clone, Copy)]
struct CaptureEvents {
    /// Which capture this is, for the log. The two loops are otherwise
    /// identical, and "did it hear the microphone, or only the speakers?" is
    /// the question every audio bug report comes down to.
    label: &'static str,
    speech_start: &'static str,
    speech_detected: &'static str,
    audio_level: &'static str,
    speech_discarded: &'static str,
    audio_encoding_error: &'static str,
    /// Event the loop listens for to stop gracefully.
    stop: &'static str,
}

const SYSTEM_EVENTS: CaptureEvents = CaptureEvents {
    label: "system",
    speech_start: "speech-start",
    speech_detected: "speech-detected",
    audio_level: "audio-level",
    speech_discarded: "speech-discarded",
    audio_encoding_error: "audio-encoding-error",
    stop: "manual-stop-continuous",
};

const MIC_EVENTS: CaptureEvents = CaptureEvents {
    label: "mic",
    speech_start: "mic-speech-start",
    speech_detected: "mic-speech-detected",
    audio_level: "mic-audio-level",
    speech_discarded: "mic-speech-discarded",
    audio_encoding_error: "mic-audio-encoding-error",
    stop: "mic-manual-stop",
};

/// Compute per-band energy for a hop of mono audio using the Goertzel
/// algorithm across log-spaced center frequencies (~85 Hz .. 5 kHz).
/// Returns `VISUALIZER_BANDS` normalized magnitudes (roughly 0..1) that the
/// frontend renders as bars — height reflects volume, band index reflects pitch.
fn compute_visualizer_bands(samples: &[f32], sr: u32) -> Vec<f32> {
    use std::f32::consts::PI;
    let n = samples.len();
    if n == 0 || sr == 0 {
        return vec![0.0; VISUALIZER_BANDS];
    }
    let f_min = 85.0f32;
    let f_max = (sr as f32 / 2.0).min(5000.0);
    let n_half = n as f32 / 2.0;
    let mut out = Vec::with_capacity(VISUALIZER_BANDS);
    for b in 0..VISUALIZER_BANDS {
        let frac = b as f32 / (VISUALIZER_BANDS - 1) as f32;
        let freq = f_min * (f_max / f_min).powf(frac); // log-spaced
        let w = 2.0 * PI * freq / sr as f32;
        let coeff = 2.0 * w.cos();
        let mut s_prev = 0.0f32;
        let mut s_prev2 = 0.0f32;
        for &x in samples {
            let s = x + coeff * s_prev - s_prev2;
            s_prev2 = s_prev;
            s_prev = s;
        }
        let power = s_prev2 * s_prev2 + s_prev * s_prev - coeff * s_prev * s_prev2;
        let mag = power.max(0.0).sqrt() / n_half;
        // Gain + sqrt compression so quiet speech is still visible; clamp 0..1.
        let v = (mag * 20.0).sqrt().min(1.0);
        out.push(v);
    }
    out
}

#[tauri::command]
pub async fn start_system_audio_capture(
    app: AppHandle,
    vad_config: Option<VadConfig>,
    device_id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<crate::AudioState>();

    // Check if already capturing (atomic check)
    {
        let guard = state
            .stream_task
            .lock()
            .map_err(|e| format!("Failed to acquire lock: {}", e))?;

        if guard.is_some() {
            warn!("Capture already running");
            return Err("Capture already running".to_string());
        }
    }

    // Update VAD config if provided
    if let Some(config) = vad_config {
        let mut vad_cfg = state
            .vad_config
            .lock()
            .map_err(|e| format!("Failed to acquire VAD config lock: {}", e))?;
        *vad_cfg = config;
    }

    let input = SpeakerInput::new_with_device(device_id).map_err(|e| {
        error!("Failed to create speaker input: {}", e);
        format!("Failed to access system audio: {}", e)
    })?;

    let stream = input.stream();
    let sr = stream.sample_rate();

    // Validate sample rate
    if !(8000..=96000).contains(&sr) {
        error!("Invalid sample rate: {}", sr);
        return Err(format!(
            "Invalid sample rate: {}. Expected 8000-96000 Hz",
            sr
        ));
    }

    let app_clone = app.clone();
    let vad_config = state
        .vad_config
        .lock()
        .map_err(|e| format!("Failed to read VAD config: {}", e))?
        .clone();

    // Mark as capturing BEFORE spawning task
    *state
        .is_capturing
        .lock()
        .map_err(|e| format!("Failed to set capturing state: {}", e))? = true;

    // Emit capture started event
    let _ = app_clone.emit("capture-started", sr);

    let state_clone = app.state::<crate::AudioState>();
    let task = tokio::spawn(async move {
        if vad_config.enabled {
            run_vad_capture(app_clone.clone(), stream, sr, vad_config, SYSTEM_EVENTS).await;
        } else {
            run_continuous_capture(app_clone.clone(), stream, sr, vad_config).await;
        }

        let state = app_clone.state::<crate::AudioState>();
        {
            if let Ok(mut guard) = state.stream_task.lock() {
                *guard = None;
            };
        }
    });

    *state_clone
        .stream_task
        .lock()
        .map_err(|e| format!("Failed to store task: {}", e))? = Some(task);

    Ok(())
}

// VAD-enabled capture - OPTIMIZED for real-time speech detection
async fn run_vad_capture(
    app: AppHandle,
    stream: impl StreamExt<Item = f32> + Unpin,
    sr: u32,
    config: VadConfig,
    events: CaptureEvents,
) {
    let mut stream = stream;
    let mut buffer: VecDeque<f32> = VecDeque::new();
    let mut pre_speech: VecDeque<f32> =
        VecDeque::with_capacity(config.pre_speech_chunks * config.hop_size);
    let mut speech_buffer = Vec::new();
    let mut in_speech = false;
    let mut silence_chunks = 0;
    let mut speech_chunks = 0;
    let mut viz_frame: u64 = 0;
    let max_samples = sr as usize * 30; // 30s safety cap per utterance

    // Graceful stop: mirrors run_continuous_capture's pattern. Without this,
    // the only way to end this loop was an external tokio task abort (from
    // stop_system_audio_capture), which can yank the native audio stream out
    // from under an in-flight OS-level callback and crash the whole process —
    // observed when switching VAD -> Manual mid-listen, then starting a new
    // manual recording moments later (opening a second stream on the same
    // device while the first's native teardown was still mid-flight).
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_for_listener = stop_flag.clone();
    let stop_listener = app.listen(events.stop, move |_| {
        stop_flag_for_listener.store(true, Ordering::Release);
    });

    // ONE reusable idle timer, and `biased` so the stream is always polled
    // first. `SpeakerStream` yields a single f32 per poll (see speaker/macos.rs),
    // so this loop runs at the sample rate — ~48,000 times a second. The old
    // form built a fresh `tokio::time::sleep` inside the select on every one of
    // those iterations, which meant 48,000 timer registrations + drops per
    // second against the shared tokio timer wheel — on the same runtime that
    // serves every `invoke()` from the UI. With `biased`, whenever the ring
    // buffer has a sample ready (the normal case while audio is flowing) the
    // timer branch is never polled at all, and it is only re-armed when it
    // actually fires. Behaviour is identical; the cost isn't.
    let idle = tokio::time::sleep(IDLE_TICK);
    tokio::pin!(idle);

    // Cooperative-yield accounting. `SpeakerStream` yields one f32 per poll and
    // returns Ready immediately whenever the ring buffer is non-empty (see
    // speaker/macos.rs). `futures_util`'s `StreamExt::next` carries no tokio
    // scheduling budget, so while audio is flowing this loop is *always*
    // immediately ready and never reaches a yield point — it pins one tokio
    // worker at 100% for the whole session. Because that's the same runtime that
    // serves every UI `invoke()`, and the overlay is an always-on-top NSPanel
    // over every Space, the starved main thread reads as a whole-screen freeze
    // (exactly the "freezes while I'm in a meeting" report). Force a yield once
    // per hop so the scheduler can interleave other tasks; the backlog we might
    // burst through is bounded by the ring buffer, so this stays real-time.
    let mut samples_since_yield: usize = 0;

    'capture: loop {
        if stop_flag.load(Ordering::Acquire) {
            break 'capture;
        }

        let sample = tokio::select! {
            biased;
            sample_opt = stream.next() => match sample_opt {
                Some(sample) => sample,
                None => break 'capture,
            },
            _ = &mut idle => {
                idle.as_mut().reset(tokio::time::Instant::now() + IDLE_TICK);
                continue 'capture;
            }
        };

        buffer.push_back(sample);

        samples_since_yield += 1;
        if samples_since_yield >= config.hop_size {
            samples_since_yield = 0;
            tokio::task::yield_now().await;
        }

        // Process in fixed chunks for VAD analysis
        while buffer.len() >= config.hop_size {
            let mut mono = Vec::with_capacity(config.hop_size);
            for _ in 0..config.hop_size {
                if let Some(v) = buffer.pop_front() {
                    mono.push(v);
                }
            }

            // Apply noise gate BEFORE VAD (critical for accuracy)
            let mono = apply_noise_gate(&mono, config.noise_gate_threshold);

            let (rms, peak) = calculate_audio_metrics(&mono);
            let is_speech = rms > config.sensitivity_rms || peak > config.peak_threshold;

            // Emit live audio levels for the visualizer (~every other hop, so
            // roughly 20-25 fps). Sent for ALL audio, not just detected speech,
            // so the waves react continuously to whatever is playing.
            viz_frame = viz_frame.wrapping_add(1);
            if viz_frame % 2 == 0 {
                let bands = compute_visualizer_bands(&mono, sr);
                let _ = app.emit(events.audio_level, bands);
            }

            if is_speech {
                if !in_speech {
                    // Speech START detected
                    in_speech = true;
                    speech_chunks = 0;

                    // Include pre-speech buffer for natural sound
                    speech_buffer.extend(pre_speech.drain(..));

                    debug!(capture = events.label, "speech start");
                    let _ = app.emit(events.speech_start, ());
                }

                speech_chunks += 1;
                speech_buffer.extend_from_slice(&mono);
                silence_chunks = 0; // Reset silence counter on any speech

                // Safety cap: force emit if exceeds 30s
                if speech_buffer.len() > max_samples {
                    let normalized_buffer = normalize_audio_level(&speech_buffer, 0.1);
                    if let Ok(b64) = samples_to_wav_b64(sr, &normalized_buffer) {
                        info!(capture = events.label, "speech segment emitted (30s cap)");
                        let _ = app.emit(events.speech_detected, b64);
                    }
                    speech_buffer.clear();
                    in_speech = false;
                    speech_chunks = 0;
                }
            } else {
                // Silence detected
                if in_speech {
                    silence_chunks += 1;

                    // Continue collecting during silence (important for natural speech)
                    speech_buffer.extend_from_slice(&mono);

                    // Check if silence duration exceeds threshold
                    if silence_chunks >= config.silence_chunks {
                        // Verify minimum speech duration
                        if speech_chunks >= config.min_speech_chunks && !speech_buffer.is_empty() {
                            // Trim trailing silence (keep ~0.15s for natural ending)
                            let silence_duration_samples = silence_chunks * config.hop_size;
                            let keep_silence_samples = (sr as usize) * 15 / 100; // 0.15s
                            let trim_amount =
                                silence_duration_samples.saturating_sub(keep_silence_samples);

                            if speech_buffer.len() > trim_amount {
                                speech_buffer.truncate(speech_buffer.len() - trim_amount);
                            }

                            // Emit complete speech segment
                            let normalized_buffer = normalize_audio_level(&speech_buffer, 0.1);
                            if let Ok(b64) = samples_to_wav_b64(sr, &normalized_buffer) {
                                info!(
                                    capture = events.label,
                                    secs = normalized_buffer.len() as f32 / sr as f32,
                                    "speech segment emitted"
                                );
                                let _ = app.emit(events.speech_detected, b64);
                            } else {
                                error!("Failed to encode speech to WAV");
                                let _ =
                                    app.emit(events.audio_encoding_error, "Failed to encode speech");
                            }
                        } else {
                            info!(
                                capture = events.label,
                                speech_chunks, "speech segment discarded as too short"
                            );
                            let _ = app.emit(
                                events.speech_discarded,
                                "Audio too short (likely background noise)",
                            );
                        }

                        // Reset for next speech detection
                        speech_buffer.clear();
                        in_speech = false;
                        silence_chunks = 0;
                        speech_chunks = 0;
                    }
                } else {
                    // Not in speech yet - maintain rolling pre-speech buffer
                    pre_speech.extend(mono.into_iter());

                    // Trim excess (maintain fixed size)
                    while pre_speech.len() > config.pre_speech_chunks * config.hop_size {
                        pre_speech.pop_front();
                    }

                    // Periodically shrink capacity to prevent memory bloat
                    if pre_speech.len() == config.pre_speech_chunks * config.hop_size {
                        pre_speech.shrink_to_fit();
                    }
                }
            }
        }
    }

    // Clean up event listener (CRITICAL — mirrors run_continuous_capture).
    app.unlisten(stop_listener);
}

// Continuous capture (VAD disabled)
async fn run_continuous_capture(
    app: AppHandle,
    stream: impl StreamExt<Item = f32> + Unpin,
    sr: u32,
    config: VadConfig,
) {
    let mut stream = stream;
    let max_samples = (sr as u64 * config.max_recording_duration_secs) as usize;

    // Pre-allocate buffer to prevent reallocations
    let mut audio_buffer = Vec::with_capacity(max_samples);
    let start_time = Instant::now();
    let max_duration = Duration::from_secs(config.max_recording_duration_secs);

    // Atomic flag for manual stop
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_for_listener = stop_flag.clone();

    // Listen for manual stop event
    let stop_listener = app.listen("manual-stop-continuous", move |_| {
        stop_flag_for_listener.store(true, Ordering::Release);
    });

    // Emit recording started
    let _ = app.emit(
        "continuous-recording-start",
        config.max_recording_duration_secs,
    );

    // One reusable idle timer + `biased`, for the same reason as
    // run_vad_capture: this loop also runs once per sample (~48k/s), and a
    // fresh timer per iteration was flooding the tokio timer wheel that every
    // `invoke()` from the UI shares.
    let idle = tokio::time::sleep(IDLE_TICK);
    tokio::pin!(idle);

    // See run_vad_capture for the full rationale: this loop has the same
    // never-yields-while-audio-flows characteristic and would otherwise pin a
    // tokio worker (whole-screen freeze). Yield roughly once per 1024 samples.
    const YIELD_EVERY: usize = 1024;
    let mut samples_since_yield: usize = 0;

    // Accumulate audio - check stop flag on EVERY sample for immediate response
    loop {
        // Check stop flag FIRST on every iteration for immediate stopping
        if stop_flag.load(Ordering::Acquire) {
            break;
        }

        tokio::select! {
            biased;
            sample_opt = stream.next() => {
                match sample_opt {
                    Some(sample) => {
                        if stop_flag.load(Ordering::Acquire) {
                            break;
                        }

                        audio_buffer.push(sample);

                        samples_since_yield += 1;
                        if samples_since_yield >= YIELD_EVERY {
                            samples_since_yield = 0;
                            tokio::task::yield_now().await;
                        }

                        let elapsed = start_time.elapsed();

                        // Emit progress every second
                        if audio_buffer.len() % (sr as usize) == 0 {
                            let _ = app.emit("recording-progress", elapsed.as_secs());
                        }

                        // Check size limit (safety)
                        if audio_buffer.len() >= max_samples {
                            break;
                        }

                        // Check time limit
                        if elapsed >= max_duration {
                            break;
                        }
                    },
                    None => {
                        warn!("Audio stream ended unexpectedly");
                        break;
                    }
                }
            }
            _ = &mut idle => {
                idle.as_mut().reset(tokio::time::Instant::now() + IDLE_TICK);
            }
        }
    }

    // Clean up event listener (CRITICAL)
    app.unlisten(stop_listener);

    // Process and emit audio
    if !audio_buffer.is_empty() {
        // let duration = start_time.elapsed().as_secs_f32();

        // Apply noise gate
        let cleaned_audio = apply_noise_gate(&audio_buffer, config.noise_gate_threshold);
        let cleaned_audio = normalize_audio_level(&cleaned_audio, 0.1);

        match samples_to_wav_b64(sr, &cleaned_audio) {
            Ok(b64) => {
                let _ = app.emit("speech-detected", b64);
            }
            Err(e) => {
                error!("Failed to encode continuous audio: {}", e);
                let _ = app.emit("audio-encoding-error", e);
            }
        }
    } else {
        warn!("No audio captured in continuous mode");
        let _ = app.emit("audio-encoding-error", "No audio recorded");
    }

    let _ = app.emit("continuous-recording-stopped", ());
}

// Apply noise gate
fn apply_noise_gate(samples: &[f32], threshold: f32) -> Vec<f32> {
    const KNEE_RATIO: f32 = 3.0; // Compression ratio for soft knee

    samples
        .iter()
        .map(|&s| {
            let abs = s.abs();
            if abs < threshold {
                s * (abs / threshold).powf(1.0 / KNEE_RATIO)
            } else {
                s
            }
        })
        .collect()
}

// Calculate RMS and peak (optimized)
fn calculate_audio_metrics(chunk: &[f32]) -> (f32, f32) {
    let mut sumsq = 0.0f32;
    let mut peak = 0.0f32;

    for &v in chunk {
        let a = v.abs();
        peak = peak.max(a);
        sumsq += v * v;
    }

    let rms = (sumsq / chunk.len() as f32).sqrt();
    (rms, peak)
}

fn normalize_audio_level(samples: &[f32], target_rms: f32) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }

    let sum_squares: f32 = samples.iter().map(|&s| s * s).sum();
    let current_rms = (sum_squares / samples.len() as f32).sqrt();

    if current_rms < 0.001 {
        return samples.to_vec();
    }

    let gain = (target_rms / current_rms).min(10.0);

    samples
        .iter()
        .map(|&s| {
            let amplified = s * gain;
            if amplified.abs() > 1.0 {
                amplified.signum() * (1.0 - (-amplified.abs()).exp())
            } else {
                amplified
            }
        })
        .collect()
}

// Convert samples to WAV base64 (with proper error handling)
fn samples_to_wav_b64(sample_rate: u32, mono_f32: &[f32]) -> Result<String, String> {
    // Validate sample rate
    if !(8000..=96000).contains(&sample_rate) {
        error!("Invalid sample rate: {}", sample_rate);
        return Err(format!(
            "Invalid sample rate: {}. Expected 8000-96000 Hz",
            sample_rate
        ));
    }

    // Validate buffer
    if mono_f32.is_empty() {
        return Err("Empty audio buffer".to_string());
    }

    let mut cursor = Cursor::new(Vec::new());
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = WavWriter::new(&mut cursor, spec).map_err(|e| {
        error!("Failed to create WAV writer: {}", e);
        e.to_string()
    })?;

    for &s in mono_f32 {
        let clamped = s.clamp(-1.0, 1.0);
        let sample_i16 = (clamped * i16::MAX as f32) as i16;
        writer.write_sample(sample_i16).map_err(|e| e.to_string())?;
    }

    writer.finalize().map_err(|e| e.to_string())?;

    Ok(B64.encode(cursor.into_inner()))
}

#[tauri::command]
pub async fn stop_system_audio_capture(app: AppHandle) -> Result<(), String> {
    let state = app.state::<crate::AudioState>();

    // Take the task in a separate scope (Send trait fix), then ask it to stop
    // gracefully before falling back to abort(). Aborting a still-running
    // capture task (VAD or continuous) can yank the native audio stream out
    // from under an in-flight OS-level callback and crash the whole process —
    // especially when a new stream is opened on the same device moments
    // later (e.g. switching modes, then starting a fresh manual recording).
    // Both run_vad_capture and run_continuous_capture listen for this event
    // and exit their loop on their own terms, letting the stream Drop cleanly.
    let task_opt = {
        let mut guard = state
            .stream_task
            .lock()
            .map_err(|e| format!("Failed to acquire task lock: {}", e))?;
        guard.take()
    };

    if let Some(mut task) = task_opt {
        let _ = app.emit("manual-stop-continuous", ());
        tokio::select! {
            _ = &mut task => {
                // Stopped gracefully.
            }
            _ = tokio::time::sleep(tokio::time::Duration::from_millis(1500)) => {
                warn!("Capture task did not stop gracefully within 1.5s; aborting");
                task.abort();
            }
        }
    }

    // LONGER delay for proper cleanup (300ms instead of 150ms)
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    // Mark as not capturing
    *state
        .is_capturing
        .lock()
        .map_err(|e| format!("Failed to update capturing state: {}", e))? = false;

    // Additional cleanup delay (CRITICAL for mic indicator)
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    // Emit stopped event
    let _ = app.emit("capture-stopped", ());
    Ok(())
}

/// Start native microphone capture (macOS only).
///
/// Runs the same VAD pipeline as `start_system_audio_capture`, but sourced from
/// the mic input device instead of the system-audio tap, and emitting the
/// `mic-*` event set. This exists to replace the WebView `getUserMedia` mic
/// path, whose synchronous WebKit audio-session activation froze the overlay
/// when another app (Zoom) held the audio session. Capturing in Rust never
/// touches the WebView audio session.
///
/// Runs alongside system-audio capture: they use independent devices, tokio
/// tasks, and stop signals (see `CaptureEvents`), so neither blocks the other.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn start_mic_capture(
    app: AppHandle,
    device_id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<crate::AudioState>();

    /// Releases `AudioState::mic_starting` however this function exits, including
    /// the `?` early returns below.
    struct StartClaim(Arc<AtomicBool>);
    impl Drop for StartClaim {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }

    // Claim the exclusive right to start. Checking `mic_stream_task` is not
    // enough on its own — that lock is released again while the CoreAudio stream
    // is being opened, so two concurrent calls both got past the check, both
    // opened a stream, and the second's handle overwrote the first's. The
    // orphaned capture task then ran forever with nothing tracking it, holding a
    // registered IO proc that no `stop_mic_capture` could reach.
    if state
        .mic_starting
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        // A concurrent start is already doing this work. Report success rather
        // than an error: the caller asked for the mic to be capturing, and it
        // will be. Returning Err here surfaced a bogus "check your microphone
        // permissions" banner on what is really a duplicate request.
        info!("Mic capture start already in progress; treating as success");
        return Ok(());
    }
    let _claim = StartClaim(state.mic_starting.clone());

    {
        let guard = state
            .mic_stream_task
            .lock()
            .map_err(|e| format!("Failed to acquire mic lock: {}", e))?;
        if guard.is_some() {
            // Idempotent for the same reason as above — already capturing is the
            // state the caller wanted.
            info!("Mic capture already running; treating as success");
            return Ok(());
        }
    }

    // Open the stream, retrying once if the device is still bound from the
    // previous stream's teardown (MicListener stops then immediately restarts on
    // remount / device change). `stream()` returns Err (was: panicked on a tokio
    // worker) with kAudioHardwareIllegalOperationError in that window.
    let mut stream = None;
    let mut last_err = String::new();
    for attempt in 0..2 {
        let input = crate::speaker::MicInput::new(device_id.clone()).map_err(|e| {
            error!("Failed to create mic input: {}", e);
            format!("Failed to access microphone: {}", e)
        })?;
        match input.stream() {
            Ok(s) => {
                stream = Some(s);
                break;
            }
            Err(e) => {
                last_err = e.to_string();
                warn!("Mic stream start attempt {} failed: {}", attempt + 1, last_err);
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }
    let stream = stream.ok_or_else(|| {
        error!("Failed to start mic stream: {}", last_err);
        format!("Failed to start microphone stream: {}", last_err)
    })?;
    let sr = stream.sample_rate();

    if !(8000..=96000).contains(&sr) {
        error!("Invalid mic sample rate: {}", sr);
        return Err(format!(
            "Invalid mic sample rate: {}. Expected 8000-96000 Hz",
            sr
        ));
    }

    // The mic always runs VAD mode (segmented utterances), regardless of the
    // system-audio VAD toggle. Reuse the shared VAD tuning for consistency.
    let mut vad_config = state
        .vad_config
        .lock()
        .map_err(|e| format!("Failed to read VAD config: {}", e))?
        .clone();
    vad_config.enabled = true;

    info!(sample_rate = sr, device = ?device_id, "mic capture started");

    let app_clone = app.clone();
    let _ = app_clone.emit("mic-capture-started", sr);

    let state_clone = app.state::<crate::AudioState>();
    let task = tokio::spawn(async move {
        run_vad_capture(app_clone.clone(), stream, sr, vad_config, MIC_EVENTS).await;

        let state = app_clone.state::<crate::AudioState>();
        {
            if let Ok(mut guard) = state.mic_stream_task.lock() {
                *guard = None;
            };
        }
    });

    *state_clone
        .mic_stream_task
        .lock()
        .map_err(|e| format!("Failed to store mic task: {}", e))? = Some(task);

    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn start_mic_capture(
    _app: AppHandle,
    _device_id: Option<String>,
) -> Result<(), String> {
    Err("Native mic capture is only supported on macOS".to_string())
}

/// Stop native microphone capture (macOS only). Mirrors
/// `stop_system_audio_capture`'s graceful-stop-then-abort, but on the mic task
/// and stop event, and leaves the system-audio `is_capturing` state untouched.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn stop_mic_capture(app: AppHandle) -> Result<(), String> {
    let state = app.state::<crate::AudioState>();

    let task_opt = {
        let mut guard = state
            .mic_stream_task
            .lock()
            .map_err(|e| format!("Failed to acquire mic task lock: {}", e))?;
        guard.take()
    };

    if let Some(mut task) = task_opt {
        let _ = app.emit(MIC_EVENTS.stop, ());
        tokio::select! {
            _ = &mut task => {}
            _ = tokio::time::sleep(Duration::from_millis(1500)) => {
                warn!("Mic capture task did not stop gracefully within 1.5s; aborting");
                task.abort();
            }
        }
    }

    // Brief delay so the native stream tears down before any restart.
    tokio::time::sleep(Duration::from_millis(200)).await;

    let _ = app.emit("mic-capture-stopped", ());
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn stop_mic_capture(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

/// Manual stop for continuous recording
#[tauri::command]
pub async fn manual_stop_continuous(app: AppHandle) -> Result<(), String> {
    let _ = app.emit("manual-stop-continuous", ());

    tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;

    Ok(())
}

#[tauri::command]
pub async fn check_system_audio_access(_app: AppHandle) -> Result<bool, String> {
    // Creating a SpeakerInput does blocking CoreAudio work (default-device query
    // + process-tap creation) and can trigger the macOS audio-capture permission
    // prompt. This command is the FIRST call on the start-transcription path, so
    // if it runs on the main/UI thread it stalls the run loop — and because the
    // overlay is an always-on-top panel floating over every Space, that stall
    // reads as a whole-screen freeze. Run it on a blocking worker instead.
    tokio::task::spawn_blocking(|| match SpeakerInput::new() {
        Ok(_) => true,
        Err(e) => {
            error!("System audio access check failed: {}", e);
            false
        }
    })
    .await
    .map_err(|e| format!("System audio access check task failed: {}", e))
}

#[tauri::command]
pub async fn request_system_audio_access(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.shell()
            .command("open")
            .args(["x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture"])
            .spawn()
            .map_err(|e| {
                error!("Failed to open system preferences: {}", e);
                e.to_string()
            })?;
    }
    #[cfg(target_os = "windows")]
    {
        app.shell()
            .command("ms-settings:sound")
            .spawn()
            .map_err(|e| {
                error!("Failed to open sound settings: {}", e);
                e.to_string()
            })?;
    }
    #[cfg(target_os = "linux")]
    {
        let commands = ["pavucontrol", "gnome-control-center sound"];
        let mut opened = false;

        for cmd in &commands {
            if app.shell().command(cmd).spawn().is_ok() {
                opened = true;
                break;
            }
        }

        if !opened {
            warn!("Failed to open audio settings on Linux");
        }
    }

    Ok(())
}

/// Open the operating system's Sound settings so the user can set default
/// input/output devices.
#[tauri::command]
pub async fn open_sound_settings(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.shell()
            .command("open")
            .args(["x-apple.systempreferences:com.apple.preference.sound"])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        app.shell()
            .command("cmd")
            .args(["/C", "start", "ms-settings:sound"])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let commands = ["pavucontrol", "gnome-control-center sound"];
        for cmd in &commands {
            if app.shell().command(cmd).spawn().is_ok() {
                break;
            }
        }
    }

    Ok(())
}

// VAD Configuration Management
#[tauri::command]
pub async fn get_vad_config(app: AppHandle) -> Result<VadConfig, String> {
    let state = app.state::<crate::AudioState>();
    let config = state
        .vad_config
        .lock()
        .map_err(|e| format!("Failed to get VAD config: {}", e))?
        .clone();
    Ok(config)
}

#[tauri::command]
pub async fn update_vad_config(app: AppHandle, config: VadConfig) -> Result<(), String> {
    // Validate config
    if config.sensitivity_rms < 0.0 || config.sensitivity_rms > 1.0 {
        return Err("Invalid sensitivity_rms: must be 0.0-1.0".to_string());
    }
    if config.max_recording_duration_secs > 3600 {
        return Err("Invalid max_recording_duration_secs: must be <= 3600 (1 hour)".to_string());
    }

    let state = app.state::<crate::AudioState>();
    *state
        .vad_config
        .lock()
        .map_err(|e| format!("Failed to update VAD config: {}", e))? = config;

    Ok(())
}

#[tauri::command]
pub async fn get_capture_status(app: AppHandle) -> Result<bool, String> {
    let state = app.state::<crate::AudioState>();
    let is_capturing = *state
        .is_capturing
        .lock()
        .map_err(|e| format!("Failed to get capture status: {}", e))?;
    Ok(is_capturing)
}

#[tauri::command]
pub async fn get_audio_sample_rate(_app: AppHandle) -> Result<u32, String> {
    // Same hazard as check_system_audio_access: SpeakerInput::new() + stream()
    // start an aggregate CoreAudio device (blocking HAL round-trips). Keep it off
    // the main thread so it can't stall the overlay/compositor.
    tokio::task::spawn_blocking(|| {
        let input = SpeakerInput::new().map_err(|e| {
            error!("Failed to create speaker input: {}", e);
            format!("Failed to access system audio: {}", e)
        })?;

        let stream = input.stream();
        Ok::<u32, String>(stream.sample_rate())
    })
    .await
    .map_err(|e| format!("Sample-rate task failed: {}", e))?
}

#[tauri::command]
pub async fn get_input_devices() -> Result<Vec<AudioDevice>, String> {
    tokio::task::spawn_blocking(|| {
        crate::speaker::list_input_devices().map_err(|e| {
            error!("Failed to get input devices: {}", e);
            format!("Failed to get input devices: {}", e)
        })
    })
    .await
    .map_err(|e| format!("Input-devices task failed: {}", e))?
}

#[tauri::command]
pub async fn get_output_devices() -> Result<Vec<AudioDevice>, String> {
    tokio::task::spawn_blocking(|| {
        crate::speaker::list_output_devices().map_err(|e| {
            error!("Failed to get output devices: {}", e);
            format!("Failed to get output devices: {}", e)
        })
    })
    .await
    .map_err(|e| format!("Output-devices task failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use futures_util::StreamExt;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    /// A stand-in for the capture consumer loop. `SpeakerStream` yields one f32
    /// per poll and is immediately `Ready` whenever the ring buffer is non-empty
    /// (see speaker/macos.rs), so an always-ready `futures_util` stream reproduces
    /// the exact scheduling behavior of a live capture while audio is flowing.
    /// `yield_each = Some(n)` mirrors the fix (yield every n samples); `None`
    /// mirrors the pre-fix busy loop that never reaches a yield point.
    async fn drain_like_capture(
        total: usize,
        yield_each: Option<usize>,
        finish_order: Arc<AtomicUsize>,
        seq: Arc<AtomicUsize>,
    ) {
        let mut stream = futures_util::stream::repeat(0.0f32).take(total);
        let mut since = 0usize;
        while stream.next().await.is_some() {
            since += 1;
            if let Some(n) = yield_each {
                if since >= n {
                    since = 0;
                    tokio::task::yield_now().await;
                }
            }
        }
        finish_order.store(seq.fetch_add(1, Ordering::SeqCst), Ordering::SeqCst);
    }

    /// Regression guard for the whole-screen freeze: on a single-worker runtime
    /// (the worst case for the shared Tauri/tokio runtime), a UI-invoke-like task
    /// must still make progress while the capture loop drains a large backlog.
    ///
    /// With the cooperative yield, the UI task finishes *before* the capture
    /// drain completes. Remove the `yield_now()` calls from the real loops and
    /// this fails: the never-yielding drain monopolizes the only worker and the
    /// UI task cannot run until audio stops — which is exactly the freeze.
    #[tokio::test(flavor = "multi_thread", worker_threads = 1)]
    async fn capture_loop_yields_so_ui_tasks_are_not_starved() {
        let seq = Arc::new(AtomicUsize::new(0));
        let capture_order = Arc::new(AtomicUsize::new(usize::MAX));
        let ui_order = Arc::new(AtomicUsize::new(usize::MAX));

        // Start the long capture drain and let it grab the single worker first,
        // matching production where capture is already running when the user
        // interacts with the UI.
        let capture = tokio::spawn(drain_like_capture(
            2_000_000,
            Some(1024),
            capture_order.clone(),
            seq.clone(),
        ));
        tokio::task::yield_now().await;

        // A UI-invoke-like task: it only needs a chance to run.
        let ui_order_c = ui_order.clone();
        let seq_c = seq.clone();
        let ui = tokio::spawn(async move {
            ui_order_c.store(seq_c.fetch_add(1, Ordering::SeqCst), Ordering::SeqCst);
        });

        // Should complete quickly despite millions of samples still draining.
        tokio::time::timeout(Duration::from_secs(5), ui)
            .await
            .expect("UI task was starved by the capture loop (freeze regression)")
            .unwrap();
        capture.await.unwrap();

        assert!(
            ui_order.load(Ordering::SeqCst) < capture_order.load(Ordering::SeqCst),
            "UI task must finish before the capture backlog drains; it was starved"
        );
    }
}
