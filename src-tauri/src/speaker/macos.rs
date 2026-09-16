// ChannelPulse macos speaker input and stream
use super::AudioDevice;
use anyhow::Result;
use ca::aggregate_device_keys as agg_keys;
use cidre::{arc, av, cat, cf, core_audio as ca, ns, os};
use futures_util::Stream;
use ringbuf::{
    traits::{Consumer, Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Poll, Waker};
use tracing::{error, warn};

pub fn get_input_devices() -> Result<Vec<AudioDevice>> {
    let mut devices = Vec::new();

    let default_input_uid = ca::System::default_input_device()
        .ok()
        .and_then(|d| d.uid().ok())
        .map(|u| u.to_string());

    let all_devices = ca::System::devices()?;

    for device in all_devices.iter() {
        let input_buffers = device
            .input_stream_cfg()
            .map(|cfg| cfg.number_buffers())
            .unwrap_or(0);

        if input_buffers > 0 {
            let name = device
                .name()
                .map(|n| n.to_string())
                .unwrap_or_else(|_| "Unknown Device".to_string());
            let uid = device
                .uid()
                .map(|u| u.to_string())
                .unwrap_or_else(|_| format!("macos_input_unknown"));
            let is_default = default_input_uid
                .as_ref()
                .map(|def| def == &uid)
                .unwrap_or(false);

            devices.push(AudioDevice {
                id: uid,
                name,
                is_default,
            });
        }
    }

    Ok(devices)
}

pub fn get_output_devices() -> Result<Vec<AudioDevice>> {
    let mut devices = Vec::new();

    let default_output_uid = ca::System::default_output_device()
        .ok()
        .and_then(|d| d.uid().ok())
        .map(|u| u.to_string());

    let all_devices = ca::System::devices()?;

    for device in all_devices.iter() {
        let output_buffers = device
            .output_stream_cfg()
            .map(|cfg| cfg.number_buffers())
            .unwrap_or(0);

        let input_buffers = device
            .input_stream_cfg()
            .map(|cfg| cfg.number_buffers())
            .unwrap_or(0);

        if output_buffers > 0 {
            let is_primarily_input = input_buffers > 0 && output_buffers == 0;
            if !is_primarily_input {
                let name = device
                    .name()
                    .map(|n| n.to_string())
                    .unwrap_or_else(|_| "Unknown Device".to_string());
                let uid = device
                    .uid()
                    .map(|u| u.to_string())
                    .unwrap_or_else(|_| format!("macos_output_unknown"));
                let is_default = default_output_uid
                    .as_ref()
                    .map(|def| def == &uid)
                    .unwrap_or(false);

                devices.push(AudioDevice {
                    id: uid,
                    name,
                    is_default,
                });
            }
        }
    }

    Ok(devices)
}

fn find_output_device_by_uid(uid: &str) -> Option<ca::Device> {
    let all_devices = match ca::System::devices() {
        Ok(d) => d,
        Err(e) => {
            error!(
                "[find_output_device_by_uid] Failed to get system devices: {}",
                e
            );
            return None;
        }
    };

    for device in all_devices.into_iter() {
        if let Ok(cfg) = device.output_stream_cfg() {
            if cfg.number_buffers() > 0 {
                if let Ok(device_uid) = device.uid() {
                    if device_uid.to_string() == uid {
                        return Some(device);
                    }
                }
            }
        }
    }

    error!(
        "[find_output_device_by_uid] No matching device found for UID: {}",
        uid
    );
    None
}

pub struct SpeakerInput {
    tap: ca::TapGuard, // Assuming ca::TapGuard from core-audio-rs
    agg_desc: arc::Retained<cf::DictionaryOf<cf::String, cf::Type>>,
}

struct WakerState {
    waker: Option<Waker>,
    has_data: bool,
}

pub struct SpeakerStream {
    consumer: HeapCons<f32>,
    _device: ca::hardware::StartedDevice<ca::AggregateDevice>,
    _ctx: Box<Ctx>,
    _tap: ca::TapGuard,
    waker_state: Arc<Mutex<WakerState>>,
    current_sample_rate: Arc<AtomicU32>,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        self.current_sample_rate.load(Ordering::Acquire)
    }
}

struct Ctx {
    format: arc::R<av::AudioFormat>,
    producer: HeapProd<f32>,
    waker_state: Arc<Mutex<WakerState>>,
    current_sample_rate: Arc<AtomicU32>,
    consecutive_drops: Arc<AtomicU32>,
    should_terminate: Arc<AtomicBool>,
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        let output_device = match device_id {
            Some(ref uid) if !uid.is_empty() && uid != "default" => {
                match find_output_device_by_uid(uid) {
                    Some(device) => device,
                    None => {
                        ca::System::default_output_device().expect("No default output device found")
                    }
                }
            }
            _ => ca::System::default_output_device()?,
        };

        let output_uid = output_device.uid()?;

        let sub_device = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[output_uid.as_type_ref()],
        );

        let tap_desc = ca::TapDesc::with_mono_global_tap_excluding_processes(&ns::Array::new());
        let tap = tap_desc.create_process_tap()?;

        let sub_tap = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[tap.uid().unwrap().as_type_ref()],
        );

        let agg_desc = cf::DictionaryOf::with_keys_values(
            &[
                agg_keys::is_private(),
                agg_keys::is_stacked(),
                agg_keys::tap_auto_start(),
                agg_keys::name(),
                agg_keys::main_sub_device(),
                agg_keys::uid(),
                agg_keys::sub_device_list(),
                agg_keys::tap_list(),
            ],
            &[
                cf::Boolean::value_true().as_type_ref(),
                cf::Boolean::value_false(),
                cf::Boolean::value_true(),
                cf::str!(c"system-audio-tap"), // Simplified name
                &output_uid,
                &cf::Uuid::new().to_cf_string(),
                &cf::ArrayOf::from_slice(&[sub_device.as_ref()]),
                &cf::ArrayOf::from_slice(&[sub_tap.as_ref()]),
            ],
        );

        Ok(Self { tap, agg_desc })
    }

    fn start_device(
        &self,
        ctx: &mut Box<Ctx>,
    ) -> Result<ca::hardware::StartedDevice<ca::AggregateDevice>> {
        extern "C" fn proc(
            device: ca::Device,
            _now: &cat::AudioTimeStamp,
            input_data: &cat::AudioBufList<1>,
            _input_time: &cat::AudioTimeStamp,
            _output_data: &mut cat::AudioBufList<1>,
            _output_time: &cat::AudioTimeStamp,
            ctx: Option<&mut Ctx>,
        ) -> os::Status {
            let ctx = ctx.unwrap();

            ctx.current_sample_rate.store(
                device
                    .actual_sample_rate()
                    .unwrap_or(ctx.format.absd().sample_rate) as u32,
                Ordering::Release,
            );

            if let Some(view) =
                av::AudioPcmBuf::with_buf_list_no_copy(&ctx.format, input_data, None)
            {
                if let Some(data) = view.data_f32_at(0) {
                    process_audio_data(ctx, data);
                }
            } else if ctx.format.common_format() == av::audio::CommonFormat::PcmF32 {
                let first_buffer = &input_data.buffers[0];
                let byte_count = first_buffer.data_bytes_size as usize;
                let float_count = byte_count / std::mem::size_of::<f32>();

                if float_count > 0 && !first_buffer.data.is_null() {
                    let data = unsafe {
                        std::slice::from_raw_parts(first_buffer.data as *const f32, float_count)
                    };
                    process_audio_data(ctx, data);
                }
            }

            os::Status::NO_ERR
        }

        let agg_device = ca::AggregateDevice::with_desc(&self.agg_desc)?;
        let proc_id = agg_device.create_io_proc_id(proc, Some(ctx))?;
        let started_device = ca::device_start(agg_device, Some(proc_id))?;

        Ok(started_device)
    }

    pub fn stream(self) -> SpeakerStream {
        let asbd = self.tap.asbd().unwrap();

        let format = av::AudioFormat::with_asbd(&asbd).unwrap();

        let buffer_size = 1024 * 128;
        let rb = HeapRb::<f32>::new(buffer_size);
        let (producer, consumer) = rb.split();

        let waker_state = Arc::new(Mutex::new(WakerState {
            waker: None,
            has_data: false,
        }));

        let current_sample_rate = Arc::new(AtomicU32::new(asbd.sample_rate as u32));

        let mut ctx = Box::new(Ctx {
            format,
            producer,
            waker_state: waker_state.clone(),
            current_sample_rate: current_sample_rate.clone(),
            consecutive_drops: Arc::new(AtomicU32::new(0)),
            should_terminate: Arc::new(AtomicBool::new(false)),
        });

        let device = self.start_device(&mut ctx).unwrap();

        SpeakerStream {
            consumer,
            _device: device,
            _ctx: ctx,
            _tap: self.tap,
            waker_state,
            current_sample_rate,
        }
    }
}

fn process_audio_data(ctx: &mut Ctx, data: &[f32]) {
    let buffer_size = data.len();
    let pushed = ctx.producer.push_slice(data);

    // Consistent buffer overflow handling
    if pushed < buffer_size {
        let consecutive = ctx.consecutive_drops.fetch_add(1, Ordering::AcqRel) + 1;

        // Only terminate after many consecutive drops (prevents temporary spikes from killing stream)
        if consecutive == 25 {
            eprintln!("Warning: Audio buffer experiencing drops - system may be overloaded");
        }

        if consecutive > 50 {
            eprintln!("Critical: Audio buffer overflow - capture stopping");
            ctx.should_terminate.store(true, Ordering::Release);
            return;
        }
    } else {
        // Success - reset consecutive drops counter
        ctx.consecutive_drops.store(0, Ordering::Release);
    }

    // Wake up consumer if we have new data
    let should_wake = {
        let mut waker_state = ctx.waker_state.lock().unwrap();
        if !waker_state.has_data {
            waker_state.has_data = true;
            waker_state.waker.take()
        } else {
            None
        }
    };

    if let Some(waker) = should_wake {
        waker.wake();
    }
}

impl Stream for SpeakerStream {
    type Item = f32;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        if let Some(sample) = self.consumer.try_pop() {
            return Poll::Ready(Some(sample));
        }

        if self._ctx.should_terminate.load(Ordering::Acquire) {
            return match self.consumer.try_pop() {
                Some(sample) => Poll::Ready(Some(sample)),
                None => Poll::Ready(None),
            };
        }

        {
            let mut state = self.waker_state.lock().unwrap();
            state.has_data = false;
            state.waker = Some(cx.waker().clone());
        }

        Poll::Pending
    }
}

impl Drop for SpeakerStream {
    fn drop(&mut self) {
        self._ctx.should_terminate.store(true, Ordering::Release);
    }
}

// ---------------------------------------------------------------------------
// Microphone capture (native CoreAudio input device).
//
// `SpeakerInput` above captures *system audio* via a global process tap on an
// output device — it hears what the speakers play (e.g. remote Zoom voices),
// never the local microphone. `MicInput` captures the mic directly by running
// an IO proc on a real input `ca::Device`, so "You" is heard natively.
//
// Why this exists at all: the previous mic path used the WebView's
// `getUserMedia`, which makes WebKit synchronously (re)activate the macOS audio
// session on the JS thread. When another app (Zoom) already holds that session,
// that sync IPC blocks the whole overlay UI — the "freezes when I move/stop/
// pause during a call" report. Capturing in Rust never touches the WebView
// audio session, so the JS thread can't be blocked by it.
//
// Structurally this mirrors `SpeakerStream` (ring buffer + waker + `Stream`),
// reusing `Ctx`, `WakerState`, and `process_audio_data`. The only differences
// are the source (a plain input device, no tap/aggregate) and where the format
// comes from (`input_asbd`).
// ---------------------------------------------------------------------------

fn find_input_device_by_uid(uid: &str) -> Option<ca::Device> {
    let all_devices = match ca::System::devices() {
        Ok(d) => d,
        Err(e) => {
            error!(
                "[find_input_device_by_uid] Failed to get system devices: {}",
                e
            );
            return None;
        }
    };

    for device in all_devices.into_iter() {
        if let Ok(cfg) = device.input_stream_cfg() {
            if cfg.number_buffers() > 0 {
                if let Ok(device_uid) = device.uid() {
                    if device_uid.to_string() == uid {
                        return Some(device);
                    }
                }
            }
        }
    }

    error!(
        "[find_input_device_by_uid] No matching device found for UID: {}",
        uid
    );
    None
}

pub struct MicInput {
    device: ca::Device,
}

extern "C" {
    /// Unregisters an IO proc from a device.
    ///
    /// Declared here because cidre binds `AudioDeviceCreateIOProcID`,
    /// `AudioDeviceStart` and `AudioDeviceStop` but NOT this — see
    /// `IoProcGuard` for why that mattered. The signature mirrors cidre's own
    /// `AudioDeviceStop` exactly (`ca::Device` is `#[repr(transparent)]` over
    /// `AudioObjectID`, `DeviceIoProcId` over the proc function pointer), which
    /// is what makes this safe to declare by hand.
    fn AudioDeviceDestroyIOProcID(
        device: ca::Device,
        proc_id: Option<ca::DeviceIoProcId>,
    ) -> os::Status;
}

/// Unregisters the mic's IO proc when the stream goes away.
///
/// Nothing did that before. cidre's `StartedDevice::drop` calls
/// `AudioDeviceStop` and stops there, so every mic stream permanently leaked
/// its IO proc registration for the life of the process — and CoreAudio keys a
/// registration on the *pair* (proc function, client-data pointer). The proc
/// function is one `extern "C" fn`, and the client data is a fresh
/// `Box<Ctx>` whose address the allocator is free to reuse once a previous box
/// is freed. So after a few stop/start cycles a new `Box<Ctx>` eventually lands
/// on the address of a freed one, `create_io_proc_id` collides with the leaked
/// registration, and it fails with `kAudioHardwareIllegalOperationError`
/// ('nope') — the "Couldn't start the microphone" the app reported with
/// microphone permission perfectly fine, unrecoverable until an app restart.
///
/// This is a separate field rather than work done in `MicStream::drop` because
/// ordering is load-bearing: an explicit `Drop::drop` runs BEFORE any field is
/// dropped, and destroying a proc on a still-running device is invalid. Fields
/// drop in declaration order, so this one is declared AFTER `_device`, and
/// therefore runs after `StartedDevice` has stopped the device.
struct IoProcGuard {
    device: ca::Device,
    proc_id: ca::DeviceIoProcId,
}

impl Drop for IoProcGuard {
    fn drop(&mut self) {
        let status =
            unsafe { AudioDeviceDestroyIOProcID(ca::Device(self.device.0), Some(self.proc_id)) };
        if status != os::Status::NO_ERR {
            // Not fatal on its own, but it is the leak that breaks the next
            // start, so it must not be silent.
            warn!("Failed to destroy mic IO proc: {:?}", status);
        }
    }
}

pub struct MicStream {
    consumer: HeapCons<f32>,
    _device: ca::hardware::StartedDevice<ca::Device>,
    /// Declared after `_device` on purpose — see `IoProcGuard`.
    _io_proc: IoProcGuard,
    _ctx: Box<Ctx>,
    waker_state: Arc<Mutex<WakerState>>,
    current_sample_rate: Arc<AtomicU32>,
}

impl MicStream {
    pub fn sample_rate(&self) -> u32 {
        self.current_sample_rate.load(Ordering::Acquire)
    }
}

impl MicInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        let device = match device_id {
            Some(ref uid) if !uid.is_empty() && uid != "default" => {
                match find_input_device_by_uid(uid) {
                    Some(device) => device,
                    None => ca::System::default_input_device()
                        .map_err(|e| anyhow::anyhow!("No default input device: {:?}", e))?,
                }
            }
            _ => ca::System::default_input_device()
                .map_err(|e| anyhow::anyhow!("No default input device: {:?}", e))?,
        };

        Ok(Self { device })
    }

    pub fn stream(self) -> Result<MicStream> {
        let device = self.device;

        // The mic's virtual input format (sample rate, channel count, interleave).
        // `data_f32_at(0)` in the proc reads channel 0, which is the mic signal
        // for the common mono / non-interleaved device formats.
        let asbd = device
            .input_asbd()
            .map_err(|e| anyhow::anyhow!("Mic input format unavailable: {:?}", e))?;
        let format = av::AudioFormat::with_asbd(&asbd)
            .ok_or_else(|| anyhow::anyhow!("Unsupported mic input format"))?;

        let buffer_size = 1024 * 128;
        let rb = HeapRb::<f32>::new(buffer_size);
        let (producer, consumer) = rb.split();

        let waker_state = Arc::new(Mutex::new(WakerState {
            waker: None,
            has_data: false,
        }));

        let current_sample_rate = Arc::new(AtomicU32::new(asbd.sample_rate as u32));

        let mut ctx = Box::new(Ctx {
            format,
            producer,
            waker_state: waker_state.clone(),
            current_sample_rate: current_sample_rate.clone(),
            consecutive_drops: Arc::new(AtomicU32::new(0)),
            should_terminate: Arc::new(AtomicBool::new(false)),
        });

        extern "C" fn proc(
            device: ca::Device,
            _now: &cat::AudioTimeStamp,
            input_data: &cat::AudioBufList<1>,
            _input_time: &cat::AudioTimeStamp,
            _output_data: &mut cat::AudioBufList<1>,
            _output_time: &cat::AudioTimeStamp,
            ctx: Option<&mut Ctx>,
        ) -> os::Status {
            let ctx = ctx.unwrap();

            ctx.current_sample_rate.store(
                device
                    .actual_sample_rate()
                    .unwrap_or(ctx.format.absd().sample_rate) as u32,
                Ordering::Release,
            );

            if let Some(view) = av::AudioPcmBuf::with_buf_list_no_copy(&ctx.format, input_data, None)
            {
                if let Some(data) = view.data_f32_at(0) {
                    process_audio_data(ctx, data);
                }
            } else if ctx.format.common_format() == av::audio::CommonFormat::PcmF32 {
                let first_buffer = &input_data.buffers[0];
                let byte_count = first_buffer.data_bytes_size as usize;
                let float_count = byte_count / std::mem::size_of::<f32>();

                if float_count > 0 && !first_buffer.data.is_null() {
                    let data = unsafe {
                        std::slice::from_raw_parts(first_buffer.data as *const f32, float_count)
                    };
                    process_audio_data(ctx, data);
                }
            }

            os::Status::NO_ERR
        }

        // Borrow ctx to register the proc (CoreAudio keeps a raw pointer to the
        // boxed Ctx, which `_ctx` below keeps alive at a stable address), then
        // move the device into the started guard.
        //
        // These used to `.unwrap()`. `create_io_proc_id` fails with
        // `kAudioHardwareIllegalOperationError` ('nope') when the device is
        // already bound — e.g. the mic is briefly still held by the previous
        // stream during MicListener's stop→start remount, or another app owns
        // it. Panicking there killed a tokio worker mid-capture; surface it as
        // an error instead so `start_mic_capture` returns cleanly and the
        // frontend can retry.
        let proc_id = device
            .create_io_proc_id(proc, Some(&mut ctx))
            .map_err(|e| anyhow::anyhow!("Failed to register mic IO proc: {:?}", e))?;
        // Take ownership of the registration immediately — before the fallible
        // `device_start` below — so the `?` on that line unregisters the proc on
        // its way out instead of leaking it. (Destroying a proc on a device that
        // was never started is fine; doing it on a *running* device is not,
        // which is what the field ordering in `MicStream` is about.)
        let io_proc = IoProcGuard {
            device: ca::Device(device.0),
            proc_id,
        };
        let started_device = ca::device_start(device, Some(proc_id))
            .map_err(|e| anyhow::anyhow!("Failed to start mic device: {:?}", e))?;

        Ok(MicStream {
            consumer,
            _device: started_device,
            _io_proc: io_proc,
            _ctx: ctx,
            waker_state,
            current_sample_rate,
        })
    }
}

impl Stream for MicStream {
    type Item = f32;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        if let Some(sample) = self.consumer.try_pop() {
            return Poll::Ready(Some(sample));
        }

        if self._ctx.should_terminate.load(Ordering::Acquire) {
            return match self.consumer.try_pop() {
                Some(sample) => Poll::Ready(Some(sample)),
                None => Poll::Ready(None),
            };
        }

        {
            let mut state = self.waker_state.lock().unwrap();
            state.has_data = false;
            state.waker = Some(cx.waker().clone());
        }

        Poll::Pending
    }
}

impl Drop for MicStream {
    fn drop(&mut self) {
        self._ctx.should_terminate.store(true, Ordering::Release);
    }
}
