import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Header,
  Button,
} from "@/components";
import {
  MicIcon,
  RefreshCwIcon,
  HeadphonesIcon,
  CheckCircle2,
  AlertTriangle,
  SquareIcon,
  Volume2Icon,
  PlayIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useApp } from "@/contexts";
import { STORAGE_KEYS } from "@/config/constants";
import { safeLocalStorage } from "@/lib/storage";
import { invoke } from "@tauri-apps/api/core";
import { AudioVisualizer } from "@/pages/app/components/speech/audio-visualizer";
import {
  micAudioConstraints,
  resolveBrowserAudioInputId,
  resolveBrowserAudioOutputId,
} from "@/lib/utils";

export const AudioSelection = () => {
  const { selectedAudioDevices, setSelectedAudioDevices } = useApp();

  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [showSuccess, setShowSuccess] = useState<{
    input: boolean;
    output: boolean;
  }>({
    input: false,
    output: false,
  });
  const [devices, setDevices] = useState<{
    input: { id: string; name: string; is_default: boolean }[];
    output: { id: string; name: string; is_default: boolean }[];
  }>({
    input: [],
    output: [],
  });

  // Microphone test: one button records a few seconds (with a live waveform),
  // then plays it straight back through the selected output.
  const RECORD_SECS = 3;
  const [testStream, setTestStream] = useState<MediaStream | null>(null);
  const [testError, setTestError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const countdownRef = useRef<number | null>(null);
  const recordTimeoutRef = useRef<number | null>(null);
  const playbackRef = useRef<HTMLAudioElement | null>(null);

  // Speaker test state
  const [isPlayingTest, setIsPlayingTest] = useState(false);

  const clearRecordTimers = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (recordTimeoutRef.current) {
      clearTimeout(recordTimeoutRef.current);
      recordTimeoutRef.current = null;
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop(); // fires onstop → builds blob
    clearRecordTimers();
  };

  const startRecording = async () => {
    setTestError("");
    // Drop any previous take.
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }

    try {
      const browserId = await resolveBrowserAudioInputId(
        selectedAudioDevices.input.name
      );
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: micAudioConstraints(browserId),
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: micAudioConstraints(),
        });
      }
      recordStreamRef.current = stream;
      recordChunksRef.current = [];
      // Feed the same stream to the live waveform while recording.
      setTestStream(stream);

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(recordChunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
        recordStreamRef.current?.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        setTestStream(null);
        setIsRecording(false);
        setCountdown(0);
        // Play it straight back so it's a one-tap test.
        void playRecording(url);
      };

      mr.start();
      setIsRecording(true);
      setCountdown(RECORD_SECS);
      countdownRef.current = window.setInterval(() => {
        setCountdown((c) => (c > 0 ? c - 1 : 0));
      }, 1000);
      // Auto-stop after a few seconds (user can also stop early).
      recordTimeoutRef.current = window.setTimeout(
        stopRecording,
        RECORD_SECS * 1000
      );
    } catch (err) {
      setTestError(
        err instanceof Error
          ? err.message
          : "Could not access the microphone. Check permissions."
      );
      setIsRecording(false);
    }
  };

  const playRecording = async (url?: string) => {
    const src = url ?? recordedUrl;
    if (!src || isPlayingBack) return;
    try {
      const audio = playbackRef.current ?? new Audio();
      playbackRef.current = audio;
      audio.src = src;
      // Route playback to the selected output device when supported.
      const outId = await resolveBrowserAudioOutputId(
        selectedAudioDevices.output.name
      );
      const anyAudio = audio as HTMLAudioElement & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (outId && typeof anyAudio.setSinkId === "function") {
        try {
          await anyAudio.setSinkId(outId);
        } catch {
          // Falls back to the default output.
        }
      }
      audio.onended = () => setIsPlayingBack(false);
      setIsPlayingBack(true);
      await audio.play();
    } catch {
      setIsPlayingBack(false);
      setTestError("Couldn't play back the recording.");
    }
  };

  const resetRecording = () => {
    if (playbackRef.current) {
      playbackRef.current.pause();
      playbackRef.current = null;
    }
    setIsPlayingBack(false);
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
  };

  const playTestSound = async () => {
    if (isPlayingTest) return;
    try {
      const ctx = new AudioContext();
      // Route to the selected output device when the webview supports it.
      const outId = await resolveBrowserAudioOutputId(
        selectedAudioDevices.output.name
      );
      const anyCtx = ctx as AudioContext & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (outId && typeof anyCtx.setSinkId === "function") {
        try {
          await anyCtx.setSinkId(outId);
        } catch {
          // Unsupported / not permitted → falls back to default output.
        }
      }

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      // Simple rising two-note chime.
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.setValueAtTime(880, now + 0.22);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.3, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
      osc.start(now);
      osc.stop(now + 0.72);
      setIsPlayingTest(true);
      osc.onended = () => {
        ctx.close().catch(() => {});
        setIsPlayingTest(false);
      };
    } catch (err) {
      console.error("Failed to play test sound:", err);
      setIsPlayingTest(false);
    }
  };

  // Stop the test / recording if the component unmounts
  useEffect(() => {
    return () => {
      clearRecordTimers();
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
      playbackRef.current?.pause();
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save devices to localStorage
  const saveToStorage = (newDevices: typeof selectedAudioDevices) => {
    safeLocalStorage.setItem(
      STORAGE_KEYS.SELECTED_AUDIO_DEVICES,
      JSON.stringify(newDevices)
    );
  };

  // Load all audio devices (input and output)
  const loadAudioDevices = async () => {
    setIsLoadingDevices(true);
    try {
      const [inputDevices, outputDevices] = await Promise.all([
        invoke<{ id: string; name: string; is_default: boolean }[]>(
          "get_input_devices"
        ),
        invoke<{ id: string; name: string; is_default: boolean }[]>(
          "get_output_devices"
        ),
      ]);

      setDevices({
        input:
          inputDevices.map((input) => ({
            id: input?.id,
            name: input?.name,
            is_default: input?.is_default,
          })) || [],
        output:
          outputDevices.map((output) => ({
            id: output?.id,
            name: output?.name,
            is_default: output?.is_default,
          })) || [],
      });

      // Only update if no device is currently selected or if the selected device doesn't exist
      const currentInputExists = inputDevices.some(
        (d) => d.id === selectedAudioDevices.input.id
      );
      const currentOutputExists = outputDevices.some(
        (d) => d.id === selectedAudioDevices.output.id
      );

      if (!currentInputExists || !currentOutputExists) {
        const defaultInput = inputDevices?.find((d) => d?.is_default);
        const defaultOutput = outputDevices?.find((d) => d?.is_default);

        const newDevices = {
          input: currentInputExists
            ? selectedAudioDevices.input
            : {
                id: defaultInput?.id || inputDevices[0]?.id || "",
                name: defaultInput?.name || inputDevices[0]?.name || "",
              },
          output: currentOutputExists
            ? selectedAudioDevices.output
            : {
                id: defaultOutput?.id || outputDevices[0]?.id || "",
                name: defaultOutput?.name || outputDevices[0]?.name || "",
              },
        };

        setSelectedAudioDevices(newDevices);
        saveToStorage(newDevices);
      }
    } catch (error) {
      console.error("Error loading audio devices:", error);
    } finally {
      setIsLoadingDevices(false);
    }
  };

  useEffect(() => {
    loadAudioDevices();
  }, []);

  // Handle device selection changes
  const handleDeviceChange = (type: "input" | "output", deviceId: string) => {
    const deviceList = type === "input" ? devices.input : devices.output;
    const selectedDevice = deviceList.find((d) => d.id === deviceId);

    if (!selectedDevice) return;

    const newDevices = {
      ...selectedAudioDevices,
      [type]: { id: deviceId, name: selectedDevice.name },
    };

    setSelectedAudioDevices(newDevices);
    saveToStorage(newDevices);

    setShowSuccess((prev) => ({ ...prev, [type]: true }));
    setTimeout(() => {
      setShowSuccess((prev) => ({ ...prev, [type]: false }));
    }, 3000);
  };

  return (
    <div id="audio" className="space-y-1 flex flex-col gap-4">
      {/* Microphone Input Section */}
      <div className="space-y-3 rounded-xl border border-border/60 bg-muted/40 p-5">
        <Header
          title="Microphone"
          description="Select your microphone for voice input and speech-to-text. If issues occur, adjust your system's default microphone in OS settings."
        />

        <div className="space-y-3">
          {/* Microphone Selection Dropdown */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Select
                value={selectedAudioDevices.input.id}
                onValueChange={(value) => handleDeviceChange("input", value)}
                disabled={isLoadingDevices || devices?.input?.length === 0}
              >
                <SelectTrigger className="w-full h-11 border-1 border-input/50 focus:border-primary/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <MicIcon className="size-4" />
                    <div className="text-sm font-medium truncate">
                      {isLoadingDevices
                        ? "Loading microphones..."
                        : devices?.input?.length === 0
                        ? "No microphones found"
                        : devices?.input?.find(
                            (mic) => mic?.id === selectedAudioDevices.input.id
                          )?.name +
                            (devices?.input?.find(
                              (mic) => mic?.id === selectedAudioDevices.input.id
                            )?.is_default
                              ? " (Default)"
                              : "") || "Select a microphone"}
                    </div>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {devices?.input?.map((mic) => (
                    <SelectItem key={mic?.id} value={mic?.id}>
                      <div className="flex items-center gap-2">
                        <MicIcon className="size-4" />
                        <div className="font-medium truncate">{mic?.name} </div>
                        {mic?.is_default && " (Default)"}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Refresh button */}
              <Button
                size="icon"
                variant="outline"
                onClick={loadAudioDevices}
                disabled={isLoadingDevices}
                className="h-11 w-11 shrink-0"
                title="Refresh microphone list"
              >
                <RefreshCwIcon
                  className={`size-4 ${isLoadingDevices ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
          </div>

          {/* Success message */}
          {showSuccess.input && (
            <div className="text-xs text-green-500 bg-green-500/10 p-3 rounded-md">
              <strong className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 shrink-0" />
                Microphone changed successfully!
              </strong>
              Using: {selectedAudioDevices.input.name || "Unknown device"}
            </div>
          )}

          {/* Permission Notice */}
          {devices?.input?.length === 0 && !isLoadingDevices && (
            <div className="text-xs text-amber-500 bg-amber-500/10 p-3 rounded-md">
              <span className="inline-flex items-center gap-1.5 align-middle">
                <AlertTriangle className="size-3.5 shrink-0" />
                <strong>
                  Click the refresh button to load your microphone devices.
                </strong>
              </span>{" "}
              If this doesn't work, try changing your default microphone in your
              system settings.
            </div>
          )}
        </div>

        {/* Microphone test — one tap: record a few seconds, then hear it back */}
        <div className="space-y-2">
          {isRecording ? (
            <div className="rounded-md border border-input/50 p-3 space-y-2 bg-muted/20">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <span className="relative flex size-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/70" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
                  </span>
                  Recording…
                  <span className="ml-1 inline-flex size-6 items-center justify-center rounded-full bg-primary/15 text-sm font-bold tabular-nums text-primary">
                    {countdown}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={stopRecording}
                  className="gap-1.5"
                >
                  <SquareIcon className="size-3" />
                  Stop
                </Button>
              </div>
              {/* Live waveform so you can see it's picking you up */}
              <div className="h-9 w-full">
                <AudioVisualizer isRecording stream={testStream} compact />
              </div>
              <p className="text-2xs text-muted-foreground">
                Say a short sentence. We'll play it back automatically.
              </p>
            </div>
          ) : recordedUrl ? (
            <div className="rounded-md border border-input/50 p-3 space-y-2 bg-muted/20">
              <p className="text-xs font-medium flex items-center gap-1.5">
                {isPlayingBack ? (
                  <>
                    <PlayIcon className="size-3.5 animate-pulse text-primary" />
                    Playing back your recording…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-3.5 text-green-600" />
                    That's how your mic sounds.
                  </>
                )}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => playRecording()}
                  disabled={isPlayingBack}
                  className="gap-2 h-9"
                >
                  <PlayIcon
                    className={`size-4 ${isPlayingBack ? "animate-pulse" : ""}`}
                  />
                  {isPlayingBack ? "Playing…" : "Play again"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={startRecording}
                  className="gap-2 h-9"
                >
                  <RotateCcwIcon className="size-4" />
                  Test again
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetRecording}
                  className="ml-auto text-muted-foreground"
                >
                  Clear
                </Button>
              </div>
              <p className="text-3xs text-muted-foreground">
                Plays through your selected output device above.
              </p>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={startRecording}
              className="gap-2 h-10"
            >
              <MicIcon className="size-4" />
              Test Microphone
            </Button>
          )}

          {testError && (
            <p className="text-xs text-destructive flex items-start gap-1.5">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              {testError}
            </p>
          )}
        </div>

      </div>

      {/* System Audio Output Section */}
      <div className="space-y-3 rounded-xl border border-border/60 bg-muted/40 p-5">
        <Header
          title="System Audio"
          description="Select the output device to capture system sounds and application audio. If issues occur, set the correct default output in OS settings."
        />

        <div className="space-y-3">
          {/* Output Selection Dropdown */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Select
                value={selectedAudioDevices.output.id}
                onValueChange={(value) => handleDeviceChange("output", value)}
                disabled={isLoadingDevices || devices?.output?.length === 0}
              >
                <SelectTrigger className="w-full h-11 border-1 border-input/50 focus:border-primary/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <HeadphonesIcon className="size-4" />
                    <div className="text-sm font-medium truncate">
                      {isLoadingDevices
                        ? "Loading output devices..."
                        : devices?.output?.length === 0
                        ? "No output devices found"
                        : devices?.output?.find(
                            (output) =>
                              output?.id === selectedAudioDevices.output.id
                          )?.name +
                            (devices?.output?.find(
                              (output) =>
                                output?.id === selectedAudioDevices.output.id
                            )?.is_default
                              ? " (Default)"
                              : "") || "Select an output device"}
                    </div>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {devices?.output?.map((output) => (
                    <SelectItem key={output?.id} value={output?.id}>
                      <div className="flex items-center gap-2">
                        <HeadphonesIcon className="size-4" />
                        <div className="font-medium truncate">
                          {output?.name} {output?.is_default && " (Default)"}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Refresh button */}
              <Button
                size="icon"
                variant="outline"
                onClick={loadAudioDevices}
                disabled={isLoadingDevices}
                className="h-11 w-11 shrink-0"
                title="Refresh output device list"
              >
                <RefreshCwIcon
                  className={`size-4 ${isLoadingDevices ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
          </div>

          {/* Success message */}
          {showSuccess.output && (
            <div className="text-xs text-green-500 bg-green-500/10 p-3 rounded-md">
              <strong className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 shrink-0" />
                Output device changed successfully!
              </strong>
              Using: {selectedAudioDevices.output.name || "Unknown device"}
            </div>
          )}

          {/* Permission Notice */}
          {devices?.output?.length === 0 && !isLoadingDevices && (
            <div className="text-xs text-amber-500 bg-amber-500/10 p-3 rounded-md">
              <span className="inline-flex items-center gap-1.5 align-middle">
                <AlertTriangle className="size-3.5 shrink-0" />
                <strong>
                  Click the refresh button to load your system audio devices.
                </strong>
              </span>{" "}
              If this doesn't work, try changing your default system audio
              output in your system settings.
            </div>
          )}
        </div>

        {/* Speaker test */}
        <div className="space-y-1">
          <Button
            variant="outline"
            onClick={playTestSound}
            disabled={isPlayingTest}
            className="gap-2 h-10"
          >
            <Volume2Icon
              className={`size-4 ${isPlayingTest ? "animate-pulse" : ""}`}
            />
            {isPlayingTest ? "Playing…" : "Play test sound"}
          </Button>
          <p className="text-3xs text-muted-foreground">
            Plays a short chime so you can confirm sound is coming from the
            selected output device.
          </p>
        </div>

      </div>
    </div>
  );
};
